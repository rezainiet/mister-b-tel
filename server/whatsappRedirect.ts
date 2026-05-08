import type { Express, Request, Response } from "express";
import { log } from "./_core/logger";
import {
  createMetaEventLog,
  getBotStartByTelegramUserId,
  getLatestUtmSessionByFunnelToken,
  getUtmSessionByToken,
  markBotStartJoined,
  recordEvent,
  updateMetaEventLog,
} from "./db";
import { sendCapiEvent } from "./facebookCapi";
import { isRetryableMetaFailure } from "./metaCapi";
import { getTelegramGroupUrl, DEFAULT_TELEGRAM_GROUP_URL } from "./telegramGroupLink";
import { skipPendingTelegramReminderJobs } from "./telegramReminders";

const META_RETRY_DELAY_MS = 5 * 60 * 1000;

/**
 * Build the per-user tracked redirect URL the bot includes in welcome/reminder
 * DMs. Falls back to APP_BASE_URL = mister-b.club so a missing env var doesn't
 * silently produce a broken link in production messages.
 */
export function buildPersonalWhatsappRedirectUrl(telegramUserId: string | number) {
  const base = (process.env.APP_BASE_URL || "https://mister-b.club").replace(/\/+$/, "");
  return `${base}/r/wa?u=${encodeURIComponent(String(telegramUserId))}`;
}

function getQueryString(value: unknown): string | undefined {
  if (Array.isArray(value)) return getQueryString(value[0]);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function setupWhatsappRedirectRoute(app: Express) {
  app.get("/r/wa", async (req: Request, res: Response) => {
    const telegramUserId = getQueryString(req.query.u);
    const suppliedSessionToken = getQueryString(req.query.s);
    const suppliedFunnelToken = getQueryString(req.query.f);

    // Resolve destination first so the redirect always works even if all
    // logging/Meta calls fail. Tracking is best-effort, the user's click is not.
    let destinationUrl = DEFAULT_TELEGRAM_GROUP_URL;
    try {
      destinationUrl = (await getTelegramGroupUrl()) || DEFAULT_TELEGRAM_GROUP_URL;
    } catch (error) {
      log.warn("whatsappRedirect", "destination_lookup_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fire-and-forget the side effects so the user is redirected immediately.
    // Anything slow (DB write, Meta CAPI round-trip) must not block the 302.
    void recordWhatsappClick({
      telegramUserId,
      suppliedSessionToken,
      suppliedFunnelToken,
      ip:
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        null,
      userAgent: (req.headers["user-agent"] as string) || null,
      referer: (req.headers.referer as string) || null,
    }).catch((error) => {
      log.error("whatsappRedirect", "side_effects_failed", {
        telegramUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    res.redirect(302, destinationUrl);
  });
}

async function recordWhatsappClick(args: {
  telegramUserId: string | undefined;
  suppliedSessionToken: string | undefined;
  suppliedFunnelToken: string | undefined;
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
}) {
  const { telegramUserId, suppliedSessionToken, suppliedFunnelToken } = args;

  // Pull bot_start for attribution. When ?u= is missing (link tampering, copy-
  // paste of the URL outside the bot DM) we still log the click with whatever
  // session/funnel token was supplied, but skip the bot_start join marker.
  const botStart = telegramUserId
    ? await getBotStartByTelegramUserId(telegramUserId)
    : undefined;

  const sessionToken = botStart?.sessionToken || suppliedSessionToken || null;
  const funnelToken = botStart?.funnelToken || suppliedFunnelToken || null;

  const session =
    (sessionToken ? await getUtmSessionByToken(sessionToken) : undefined) ??
    (funnelToken ? await getLatestUtmSessionByFunnelToken(funnelToken) : undefined);

  const eventId = `wa_click_${telegramUserId || "anon"}_${Math.floor(Date.now() / 1000)}`;

  // Always log the click, even for repeats (analytics need raw click count).
  await recordEvent({
    eventType: "whatsapp_click",
    eventSource: "bot_dm_redirect",
    eventId,
    visitorId: session?.visitorId || telegramUserId || null,
    sessionToken,
    funnelToken,
    sourceUrl: args.referer,
    userAgent: args.userAgent,
    referrer: args.referer,
    ip: args.ip,
    country: null,
  });

  // First-click semantics: only on the first click do we (a) mark the bot
  // start as joined (soft signal — they left for WhatsApp), (b) cancel
  // remaining reminders, and (c) fire Meta Lead. Subsequent clicks are pure
  // redirects so we don't double-count the conversion in Meta.
  const isFirstClick = Boolean(botStart && !botStart.joinedAt);
  if (telegramUserId && isFirstClick) {
    await Promise.all([
      markBotStartJoined(telegramUserId),
      skipPendingTelegramReminderJobs(telegramUserId, "joined_group"),
    ]);

    await fireWhatsappLeadEvent({
      telegramUserId,
      session,
      sessionToken,
      funnelToken,
      ip: args.ip,
      userAgent: args.userAgent,
      eventId,
    });
  }
}

async function fireWhatsappLeadEvent(args: {
  telegramUserId: string;
  session: Awaited<ReturnType<typeof getUtmSessionByToken>>;
  sessionToken: string | null;
  funnelToken: string | null;
  ip: string | null;
  userAgent: string | null;
  eventId: string;
}) {
  await createMetaEventLog({
    eventType: "Lead",
    eventScope: "whatsapp_click",
    eventId: args.eventId,
    funnelToken: args.funnelToken,
    sessionToken: args.sessionToken,
    telegramUserId: args.telegramUserId,
    status: "queued",
    retryable: 0,
    attemptCount: 0,
  });

  try {
    const result = await sendCapiEvent("Lead", {
      eventId: args.eventId,
      visitorId: args.session?.visitorId || args.telegramUserId,
      eventSourceUrl: args.session?.landingPage || undefined,
      userAgent: args.session?.userAgent || args.userAgent || undefined,
      clientIpAddress: args.session?.ipAddress || args.ip || undefined,
      fbp: args.session?.fbp || undefined,
      fbc: args.session?.fbclid
        ? `fb.1.${new Date(args.session.createdAt || Date.now()).getTime()}.${args.session.fbclid}`
        : undefined,
      utmSource: args.session?.utmSource || undefined,
      utmMedium: args.session?.utmMedium || undefined,
      utmCampaign: args.session?.utmCampaign || undefined,
      utmContent: args.session?.utmContent || undefined,
      utmTerm: args.session?.utmTerm || undefined,
      source: "whatsapp_click",
      customData: {
        content_name: "WhatsApp Channel Click",
        content_category: "WhatsApp",
        click_source: "telegram_bot_dm",
      },
    });

    const status = result.success
      ? ("sent" as const)
      : isRetryableMetaFailure({
            httpStatus: result.httpStatus,
            errorCode: result.errorCode,
            errorSubcode: result.errorSubcode,
            errorMessage: result.errorMessage,
          })
        ? ("retrying" as const)
        : ("failed" as const);

    await updateMetaEventLog(args.eventId, {
      requestPayloadJson: result.requestBody ? JSON.stringify(result.requestBody) : null,
      responsePayloadJson: result.responseBody ? JSON.stringify(result.responseBody) : null,
      httpStatus: result.httpStatus ?? null,
      status,
      errorCode: result.errorCode ?? null,
      errorSubcode: result.errorSubcode ?? null,
      errorMessage: result.errorMessage ?? null,
      retryable: status === "retrying" ? 1 : 0,
      attemptCount: 1,
      attemptedAt: new Date(),
      completedAt: result.success ? new Date() : null,
      nextRetryAt: status === "retrying" ? new Date(Date.now() + META_RETRY_DELAY_MS) : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("whatsappRedirect", "meta_lead_unexpected_error", {
      telegramUserId: args.telegramUserId,
      eventId: args.eventId,
      error: message,
    });
    await updateMetaEventLog(args.eventId, {
      status: "retrying",
      errorCode: "unexpected_error",
      errorMessage: message,
      retryable: 1,
      attemptCount: 1,
      attemptedAt: new Date(),
      nextRetryAt: new Date(Date.now() + META_RETRY_DELAY_MS),
    });
  }
}
