import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { log } from "./_core/logger";
import {
  createMetaEventLog,
  deleteTelegramUpdateId,
  getAllJoins,
  getBotStartByTelegramUserId,
  getLatestUtmSessionByFunnelToken,
  getSetting,
  getTelegramJoinByUserId,
  getTelegramLinkageByUserId,
  getUtmSessionByToken,
  insertTelegramJoin,
  markBotStartJoined,
  resolveTelegramLinkage,
  tryRecordTelegramUpdateId,
  updateBotStartMetaStatus,
  updateMetaEventLog,
  upsertBotStart,
  upsertTelegramLinkage,
} from "./db";
import { fireSubscribeEvent } from "./metaCapi";
import {
  buildTelegramAdminReportText,
  isTelegramAdminAuthorized,
} from "./telegramAdminReports";
import { sendTelegramMessage } from "./telegramBot";
import {
  DEFAULT_TELEGRAM_GROUP_URL,
  getTelegramGroupUrl,
  replaceTelegramGroupUrlInText,
} from "./telegramGroupLink";
import {
  renderTelegramWelcomeMessage,
  scheduleTelegramReminderSequence,
  skipPendingTelegramReminderJobs,
} from "./telegramReminders";

const TELEGRAM_DIRECT_CONTACT = "@MisterBNMB";
const META_RETRY_DELAY_MS = 5 * 60 * 1000;

function getBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

function getWebhookSecret() {
  return process.env.TELEGRAM_WEBHOOK_SECRET || "";
}

function timingSafeEqualString(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// In-process LRU of recently seen Telegram update_ids. Survives transient DB
// outages and is a strict superset of the durable `telegram_update_log` check
// for the lifetime of the process.
const RECENT_UPDATE_LRU_LIMIT = 5_000;
const recentUpdateIds = new Set<number>();

function rememberUpdateIdInMemory(updateId: number) {
  if (recentUpdateIds.has(updateId)) return false;
  recentUpdateIds.add(updateId);
  if (recentUpdateIds.size > RECENT_UPDATE_LRU_LIMIT) {
    const oldest = recentUpdateIds.values().next().value;
    if (typeof oldest === "number") recentUpdateIds.delete(oldest);
  }
  return true;
}

export function __resetWebhookDedupForTests() {
  recentUpdateIds.clear();
}

function isWebhookSecretValid(supplied: string | string[] | undefined) {
  const expected = getWebhookSecret();
  if (!expected) {
    // Always refuse when no secret is configured. Telegram webhooks are
    // un-authenticated public endpoints; without the secret an attacker can
    // forge updates and create fake bot starts / fake Subscribe events.
    log.error("telegramWebhook", "secret_not_configured_refusing_request");
    return false;
  }
  const headerValue = Array.isArray(supplied) ? supplied[0] : supplied;
  if (!headerValue) return false;
  return timingSafeEqualString(expected, headerValue);
}

export function buildDefaultWelcomeMessage(groupUrl: string = DEFAULT_TELEGRAM_GROUP_URL) {
  return [
    "Bienvenue chez Mister B.",
    "Ici, tu vas pouvoir accéder aux nouveautés, aux infos réservées et au contenu privé.",
    `Rejoins maintenant le canal privé ici → ${groupUrl}`,
    "",
    `Et si tu veux échanger directement avec moi, tu peux aussi me contacter ici : ${TELEGRAM_DIRECT_CONTACT}`,
  ].join("\n");
}

interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  title?: string;
  type: string;
}

interface TelegramChatMemberUpdate {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  new_chat_member: { user: TelegramUser; status: string };
  old_chat_member: { user: TelegramUser; status: string };
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    from: TelegramUser;
    chat: TelegramChat;
    date: number;
    text?: string;
    new_chat_members?: TelegramUser[];
  };
  chat_member?: TelegramChatMemberUpdate;
  my_chat_member?: TelegramChatMemberUpdate;
}

type DecodedStartPayload = {
  sessionToken: string | null;
  funnelToken: string | null;
  type: string;
};

function decodeStartPayload(payload: string): DecodedStartPayload | null {
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(base64, "base64").toString("utf-8");
    const parts = decoded.split(":");

    if (parts.length >= 3) {
      return {
        type: parts[0] || "group",
        sessionToken: parts[1] || null,
        funnelToken: parts.slice(2).join(":") || null,
      };
    }

    if (parts.length >= 2) {
      return {
        type: parts[0] || "group",
        sessionToken: parts.slice(1).join(":") || null,
        funnelToken: null,
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function resolveLandingSession(sessionToken?: string | null, funnelToken?: string | null) {
  if (sessionToken) {
    const bySession = await getUtmSessionByToken(sessionToken);
    if (bySession) return bySession;
  }

  if (funnelToken) {
    return getLatestUtmSessionByFunnelToken(funnelToken);
  }

  return undefined;
}

async function fireSubscribeForStart(args: {
  telegramUserId: string;
  telegramUsername?: string | null;
  eventTime: number;
  session?: Awaited<ReturnType<typeof resolveLandingSession>>;
  sessionToken: string | null;
  funnelToken: string | null;
  ip: string | null;
  ua: string | null;
}) {
  const existing = await getBotStartByTelegramUserId(args.telegramUserId);
  // Idempotent: only fire once per user. Subsequent /starts skip Meta if it
  // was already sent. The metaWorker handles retries for failed/retrying.
  if (existing?.metaSubscribeStatus === "sent") {
    return;
  }
  if (
    existing?.metaSubscribeStatus &&
    ["retrying", "failed", "queued"].includes(existing.metaSubscribeStatus)
  ) {
    // A prior /start already created the meta_event_log row — let the
    // metaWorker's retry logic drive it to completion. Don't double-create.
    return;
  }

  // eventId tied to firstStartedAt epoch so re-/start would compute the
  // same id (but we skip via the idempotency check above anyway).
  const firstStartedAt = existing?.firstStartedAt || existing?.startedAt || new Date();
  const epochSeconds = Math.floor(new Date(firstStartedAt).getTime() / 1000);
  const eventId = `tg_start_${args.telegramUserId}_${epochSeconds}`;

  await createMetaEventLog({
    eventType: "Subscribe",
    eventScope: "telegram_start",
    eventId,
    funnelToken: args.funnelToken,
    sessionToken: args.sessionToken,
    telegramUserId: args.telegramUserId,
    status: "queued",
    retryable: 0,
    attemptCount: 0,
  });

  try {
    const metaResult = await fireSubscribeEvent({
      eventId,
      eventTime: Math.floor(args.eventTime),
      telegramUserId: args.telegramUserId,
      telegramUsername: args.telegramUsername || undefined,
      visitorId: args.session?.visitorId || undefined,
      fbclid: args.session?.fbclid || undefined,
      fbp: args.session?.fbp || undefined,
      sessionCreatedAt: args.session?.createdAt,
      utmSource: args.session?.utmSource || undefined,
      utmMedium: args.session?.utmMedium || undefined,
      utmCampaign: args.session?.utmCampaign || undefined,
      utmContent: args.session?.utmContent || undefined,
      sourceUrl: args.session?.landingPage || undefined,
      userAgent: args.session?.userAgent || args.ua || undefined,
      ipAddress: args.session?.ipAddress || args.ip || undefined,
    });

    const status = metaResult.success ? "sent" : metaResult.retryable ? "retrying" : "failed";

    await Promise.all([
      updateMetaEventLog(eventId, {
        requestPayloadJson: metaResult.requestBody ? JSON.stringify(metaResult.requestBody) : null,
        responsePayloadJson: metaResult.responseBody ? JSON.stringify(metaResult.responseBody) : null,
        httpStatus: metaResult.httpStatus ?? null,
        status,
        errorCode: metaResult.errorCode ?? null,
        errorSubcode: metaResult.errorSubcode ?? null,
        errorMessage: metaResult.errorMessage ?? null,
        retryable: metaResult.retryable ? 1 : 0,
        attemptCount: 1,
        attemptedAt: new Date(),
        completedAt: metaResult.success ? new Date() : null,
        nextRetryAt: metaResult.retryable ? new Date(Date.now() + META_RETRY_DELAY_MS) : null,
      }),
      updateBotStartMetaStatus(args.telegramUserId, status, metaResult.eventId),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("telegramWebhook", "meta_start_unexpected_error", {
      telegramUserId: args.telegramUserId,
      eventId,
      error: message,
    });

    await Promise.all([
      updateMetaEventLog(eventId, {
        status: "retrying",
        errorCode: "unexpected_error",
        errorMessage: message,
        retryable: 1,
        attemptCount: 1,
        attemptedAt: new Date(),
        nextRetryAt: new Date(Date.now() + META_RETRY_DELAY_MS),
      }),
      updateBotStartMetaStatus(args.telegramUserId, "retrying", eventId),
    ]);
  }
}

async function handleNewMember(
  user: TelegramUser,
  chat: TelegramChat,
  date: number,
  ip: string | null,
  ua: string | null,
) {
  const telegramUserId = String(user.id);
  const channelId = String(chat.id);

  const existing = await getTelegramJoinByUserId(telegramUserId, channelId);
  if (existing) {
    console.log("[Telegram] Duplicate join, skipping");
    return;
  }

  const [storedBotStart, linkage] = await Promise.all([
    getBotStartByTelegramUserId(telegramUserId),
    getTelegramLinkageByUserId(telegramUserId),
  ]);

  const resolvedSessionToken = linkage?.sessionToken || storedBotStart?.sessionToken || null;
  const resolvedFunnelToken = linkage?.funnelToken || storedBotStart?.funnelToken || null;
  const session = await resolveLandingSession(resolvedSessionToken, resolvedFunnelToken);

  const attributionStatus = session
    ? "attributed_join"
    : storedBotStart
      ? "unattributed_join"
      : "bypass_join";

  // Subscribe fires on /start, NOT on join. We mirror the /start-time Meta
  // event id/status onto the join row so dashboard queries that join
  // telegram_joins.metaEventId → meta_event_logs still work.
  const startMetaEventId = storedBotStart?.metaSubscribeEventId || null;
  const startMetaStatus = storedBotStart?.metaSubscribeStatus || null;

  await insertTelegramJoin({
    telegramUserId,
    telegramUsername: user.username || null,
    telegramFirstName: user.first_name || null,
    telegramLastName: user.last_name || null,
    channelId,
    channelTitle: chat.title || null,
    funnelToken: resolvedFunnelToken || session?.funnelToken || null,
    attributionStatus,
    utmSource: session?.utmSource || null,
    utmMedium: session?.utmMedium || null,
    utmCampaign: session?.utmCampaign || null,
    utmContent: session?.utmContent || null,
    utmTerm: session?.utmTerm || null,
    fbclid: session?.fbclid || null,
    fbp: session?.fbp || null,
    metaEventId: startMetaEventId,
    metaEventSent: startMetaStatus || undefined,
    sessionToken: resolvedSessionToken || session?.sessionToken || null,
    ipAddress: session?.ipAddress || ip,
    userAgent: session?.userAgent || ua,
    joinedAt: new Date(date * 1000),
  });

  await Promise.all([
    markBotStartJoined(telegramUserId),
    skipPendingTelegramReminderJobs(telegramUserId, "joined_group"),
    resolveTelegramLinkage(telegramUserId),
  ]);

  log.info("telegramWebhook", "join_recorded_no_meta_fire", {
    telegramUserId,
    channelId,
    attributionStatus,
    mirroredMetaStatus: startMetaStatus,
    mirroredMetaEventId: startMetaEventId,
  });
}

export function setupTelegramWebhook(app: Express) {
  app.post("/api/telegram/webhook", async (req: Request, res: Response) => {
    if (!isWebhookSecretValid(req.headers["x-telegram-bot-api-secret-token"] as string | string[] | undefined)) {
      res.status(403).json({ error: "Unauthorized" });
      return;
    }

    const update = req.body as TelegramUpdate;
    const updateId = typeof update?.update_id === "number" ? update.update_id : null;

    // Layer 1: in-memory LRU. Cheap, fast, survives DB outages. Drops only
    // duplicates we *know* we've seen this process — safe to ack.
    if (updateId !== null) {
      const freshInMemory = rememberUpdateIdInMemory(updateId);
      if (!freshInMemory) {
        log.info("telegramWebhook", "duplicate_update_dropped_memory", { updateId });
        res.json({ ok: true });
        return;
      }
    }

    // Layer 2: durable DB dedup BEFORE processing. We INSERT-IGNORE and only
    // proceed if the row was newly created. If the dedup INSERT fails for a
    // transient reason (deadlock, connection refused), we return 500 so
    // Telegram retries — better to retry than silently drop.
    if (updateId !== null) {
      try {
        const freshInDb = await tryRecordTelegramUpdateId(updateId);
        if (!freshInDb) {
          log.info("telegramWebhook", "duplicate_update_dropped_db", { updateId });
          res.json({ ok: true });
          return;
        }
      } catch (error) {
        const code = (error as { errno?: number; code?: string })?.errno;
        if (code === 1146) {
          // Migration 0007 not applied yet — degrade gracefully, in-memory LRU is still active.
          log.warn("telegramWebhook", "dedup_table_missing_run_migration_0007", { updateId });
        } else {
          log.error("telegramWebhook", "dedup_failed_retryable", {
            updateId,
            error: error instanceof Error ? error.message : String(error),
          });
          res.status(500).json({ ok: false, error: "dedup_failed" });
          return;
        }
      }
    }

    try {
      await processTelegramUpdate(req, update);
      res.json({ ok: true });
    } catch (error) {
      log.error("telegramWebhook", "processing_failed_will_retry", {
        updateId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // The dedup row was already inserted, so a Telegram retry would skip
      // processing. Roll it back so the retry can re-process.
      if (updateId !== null) {
        try {
          await deleteTelegramUpdateId(updateId);
        } catch (rollbackError) {
          log.error("telegramWebhook", "dedup_rollback_failed", {
            updateId,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          });
        }
        recentUpdateIds.delete(updateId);
      }
      res.status(500).json({ ok: false, error: "processing_failed" });
    }
  });

  async function processTelegramUpdate(req: Request, update: TelegramUpdate) {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null;
    const ua = (req.headers["user-agent"] as string) || null;
    const telegramMessage = update.message;
    const messageText = telegramMessage?.text?.trim() || "";

    if (/^\/rapport(?:@\w+)?(?:\s.*)?$/i.test(messageText) && telegramMessage?.from) {
      const userId = String(telegramMessage.from.id);
      const allowed = await isTelegramAdminAuthorized(userId, telegramMessage.from.username || null);

      if (!allowed) {
        await sendTelegramMessage(telegramMessage.chat.id, "Commande réservée à l’administration.");
        return;
      }

      const report = await buildTelegramAdminReportText();
      await sendTelegramMessage(telegramMessage.chat.id, report.text);
      return;
    }

    if (messageText.startsWith("/start") && telegramMessage?.from) {
      const payload = telegramMessage.text?.split(" ")[1] || null;
      const userId = String(telegramMessage.from.id);
      const decoded = payload ? decodeStartPayload(payload) : null;

      if (decoded?.sessionToken || decoded?.funnelToken) {
        await upsertTelegramLinkage({
          telegramUserId: userId,
          sessionToken: decoded.sessionToken,
          funnelToken: decoded.funnelToken,
          payloadType: decoded.type || "group",
          payloadSource: "telegram_start",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      }

      const linkage = await getTelegramLinkageByUserId(userId);
      const session = await resolveLandingSession(
        decoded?.sessionToken || linkage?.sessionToken || null,
        decoded?.funnelToken || linkage?.funnelToken || null,
      );

      await upsertBotStart({
        telegramUserId: userId,
        telegramUsername: telegramMessage.from.username || null,
        telegramFirstName: telegramMessage.from.first_name || null,
        sessionToken: decoded?.sessionToken || linkage?.sessionToken || session?.sessionToken || null,
        funnelToken: decoded?.funnelToken || linkage?.funnelToken || session?.funnelToken || null,
        attributionStatus: session || decoded?.sessionToken || decoded?.funnelToken ? "attributed_start" : "organic_start",
        utmSource: session?.utmSource || null,
        utmMedium: session?.utmMedium || null,
        utmCampaign: session?.utmCampaign || null,
        utmContent: session?.utmContent || null,
        utmTerm: session?.utmTerm || null,
        fbclid: session?.fbclid || null,
        fbp: session?.fbp || null,
      });

      // Fire Meta Subscribe at /start time (the conversion moment) — not at
      // join time. /start is the optimization signal we want Meta to learn.
      // Skip for organic_start (no session/funnel attribution) to keep the
      // optimization signal clean.
      const isAttributed = Boolean(session) || Boolean(decoded?.sessionToken) || Boolean(decoded?.funnelToken);
      if (isAttributed) {
        await fireSubscribeForStart({
          telegramUserId: userId,
          telegramUsername: telegramMessage.from.username,
          eventTime: telegramMessage.date,
          session,
          sessionToken: decoded?.sessionToken || linkage?.sessionToken || session?.sessionToken || null,
          funnelToken: decoded?.funnelToken || linkage?.funnelToken || session?.funnelToken || null,
          ip,
          ua,
        });
      }

      await scheduleTelegramReminderSequence({
        telegramUserId: userId,
        chatId: userId,
        firstName: telegramMessage.from.first_name || null,
        startedAt: new Date(telegramMessage.date * 1000),
      });

      const [welcomeMsg, currentGroupUrl] = await Promise.all([
        getSetting("welcome_message"),
        getTelegramGroupUrl(),
      ]);
      const welcomeBody = welcomeMsg
        ? renderTelegramWelcomeMessage(
            replaceTelegramGroupUrlInText(welcomeMsg, currentGroupUrl),
            { firstName: telegramMessage.from.first_name || null, groupUrl: currentGroupUrl },
          )
        : buildDefaultWelcomeMessage(currentGroupUrl);
      await sendTelegramMessage(telegramMessage.from.id, welcomeBody);
    }

    const memberUpdate = update.chat_member || update.my_chat_member;
    if (memberUpdate) {
      const { new_chat_member, old_chat_member, chat, from, date } = memberUpdate;
      const isJoin =
        ["left", "kicked", "restricted", "banned"].includes(old_chat_member?.status) &&
        ["member", "administrator", "creator"].includes(new_chat_member?.status);
      const joinedUser = new_chat_member?.user || from;
      if (isJoin && joinedUser && !joinedUser.is_bot) {
        await handleNewMember(joinedUser, chat, date, ip, ua);
      }
    }

    if (update.message?.new_chat_members) {
      for (const member of update.message.new_chat_members) {
        if (!member.is_bot) {
          await handleNewMember(member, update.message.chat, Math.floor(Date.now() / 1000), ip, ua);
        }
      }
    }
  }

  app.post("/api/telegram/setup-webhook", async (req: Request, res: Response) => {
    const { webhookUrl } = req.body as { webhookUrl?: string };
    if (!webhookUrl) {
      res.status(400).json({ error: "webhookUrl is required" });
      return;
    }
    const botToken = getBotToken();
    if (!botToken) {
      res.status(500).json({ error: "Bot token not configured" });
      return;
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: getWebhookSecret(),
        allowed_updates: ["chat_member", "my_chat_member", "message"],
      }),
    });

    res.json(await response.json());
  });
}
