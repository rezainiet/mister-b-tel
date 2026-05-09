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

// In-process cache for the WhatsApp destination URL. The setting is operator-
// editable from the dashboard, so we re-read it periodically — but every
// /wa-go redirect should answer in <50ms, which means no DB call in the
// user's critical path. The cache is warmed at boot and refreshed every
// DESTINATION_REFRESH_MS in the background. First-ever request before the
// warm-up returns DEFAULT_TELEGRAM_GROUP_URL.
const DESTINATION_REFRESH_MS = 30_000;
let cachedDestinationUrl: string = DEFAULT_TELEGRAM_GROUP_URL;
let destinationRefreshTimer: NodeJS.Timeout | null = null;

async function refreshDestinationCache() {
  try {
    const fresh = await getTelegramGroupUrl();
    if (fresh) cachedDestinationUrl = fresh;
  } catch (error) {
    log.warn("whatsappRedirect", "destination_refresh_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Keep the previous value rather than reverting to DEFAULT — a transient
    // DB blip shouldn't make existing redirects suddenly go to the fallback.
  }
}

/**
 * Build the per-user tracked redirect URL the bot includes in welcome/reminder
 * DMs.
 *
 * Resolution order (first non-empty wins):
 *   1. WHATSAPP_REDIRECT_BASE_URL — explicit override.
 *   2. RAILWAY_PUBLIC_DOMAIN — auto-injected by Railway, e.g.
 *      "mister-b-tel-production.up.railway.app". This is the path that
 *      ALWAYS hits the Express origin in production, regardless of any
 *      Cloudflare front-door config on the marketing domain.
 *   3. APP_BASE_URL — generic site base, used by other CAPI features.
 *   4. https://mister-b.club — last-resort fallback.
 *
 * The bot DMs hide the URL behind an inline button label, so URL prettiness
 * doesn't matter — reachability does. Cloudflare in front of mister-b.club
 * intercepts non-/api/* paths and serves the SPA HTML, so the redirect can
 * never reach origin via that domain. Pinning to RAILWAY_PUBLIC_DOMAIN is
 * the safest default.
 */
export function buildPersonalWhatsappRedirectUrl(telegramUserId: string | number) {
  const explicit = process.env.WHATSAPP_REDIRECT_BASE_URL;
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : undefined;
  const fallback = process.env.APP_BASE_URL || "https://mister-b.club";
  const base = (explicit || railwayDomain || fallback).replace(/\/+$/, "");
  return `${base}/wa-go?u=${encodeURIComponent(String(telegramUserId))}`;
}

function getQueryString(value: unknown): string | undefined {
  if (Array.isArray(value)) return getQueryString(value[0]);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function setupWhatsappRedirectRoute(app: Express) {
  // Warm the cache once at boot so the very first redirect already uses the
  // operator-configured URL instead of the hardcoded fallback. Then refresh
  // periodically in the background so dashboard updates propagate without
  // requiring a redeploy.
  void refreshDestinationCache();
  if (!destinationRefreshTimer) {
    destinationRefreshTimer = setInterval(() => {
      void refreshDestinationCache();
    }, DESTINATION_REFRESH_MS);
    destinationRefreshTimer.unref?.();
  }

  // Both paths are registered: /wa-go is the production-canonical path used
  // by all bot-DM messages (Cloudflare intercepts /r/* on mister-b.club so
  // the original /r/wa never reaches origin). /r/wa is kept registered as a
  // legacy alias for any links from before the rename — they'll work the
  // moment Cloudflare is reconfigured to pass /r/* through, with no
  // server-side change needed.
  const handler = handleWhatsappRedirect;
  app.get("/wa-go", handler);
  app.get("/r/wa", handler);
}

function handleWhatsappRedirect(req: Request, res: Response) {
  const telegramUserId = getQueryString(req.query.u);
  const suppliedSessionToken = getQueryString(req.query.s);
  const suppliedFunnelToken = getQueryString(req.query.f);

  // Synchronous read — no DB call in the user's critical path. The cache
  // is refreshed on a 30s interval so dashboard updates propagate quickly
  // enough without making every redirect wait on a settings lookup.
  const destinationUrl = cachedDestinationUrl;

  // Fire-and-forget every side effect so the 302 ships immediately.
  // Anything slow (DB write, Meta CAPI round-trip) is fully detached.
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
