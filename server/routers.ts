import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import {
  buildDashboardToken,
  isDashboardTokenValid,
  verifyDashboardPassword,
} from "./_core/dashboardAuth";
import { log } from "./_core/logger";
import { checkRateLimit, getClientIp, recordSuccess } from "./_core/rateLimit";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  getAllJoins,
  getAllSettings,
  getBotStartStats,
  getBotStartsByCampaign,
  getDashboardStats,
  getDashboardStatsByPreset,
  getDailyReportStats,
  getJoinStats,
  getJoinsByCampaign,
  getLiveStatsSinceMidnight,
  getMetaEventSummary,
  getRecentBotStartsWithMetaStatus,
  getRecentMetaActivityWindow,
  getRecentMetaDebugLog,
  getRecordEventStats,
  getRetryableMetaEvents,
  getTodayStats,
  updateBotStartMetaStatus,
  getWeeklyJoins,
  insertUtmSession,
  markSessionClicked,
  recordEvent,
  createMetaEventLog,
  updateMetaEventLog,
  updateTelegramJoinMetaStatusByEventId,
  upsertSetting,
} from "./db";
import { sendPageView } from "./facebookCapi";
import { buildServerFbc, retryStoredMetaRequest } from "./metaCapi";
import { getUtmSessionByToken, getSetting } from "./db";
import { syncTelegramGroupUrlContent, TELEGRAM_GROUP_URL_SETTING_KEY, validateTelegramGroupUrl } from "./telegramGroupLink";
import {
  TELEGRAM_REMINDER_DELAY_BOUNDS,
  TELEGRAM_REMINDER_STEPS,
  isValidReminderDelayMinutes,
} from "./telegramReminders";
import { buildDefaultWelcomeMessage } from "./telegramWebhook";
import { getTelegramGroupUrl } from "./telegramGroupLink";

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "Misternb_bot";

function randomSessionToken() {
  // 16 raw bytes → 22 base64url chars. Keeps the Telegram /start payload safely
  // under the documented 64-char limit:
  //   base64url("g:" + 22 + ":" + 22) = base64url(47 chars) = 64 chars
  return crypto.randomBytes(16).toString("base64url");
}

function encodeTelegramStartPayload(sessionToken: string, funnelToken: string, type: "group" | "contact" = "group") {
  // Single-char type prefix keeps the wire format short; the webhook decoder
  // accepts both old ("group:") and new ("g:") prefixes for compatibility.
  const prefix = type === "group" ? "g" : "c";
  return Buffer.from(`${prefix}:${sessionToken}:${funnelToken}`, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getHeaderString(value: string | string[] | undefined, fallback = "") {
  if (Array.isArray(value)) {
    return value[0] || fallback;
  }

  return value || fallback;
}

const TRACKING_BUDGET = { limit: 120, windowMs: 60_000 } as const;
const LOGIN_BUDGET = { limit: 8, windowMs: 15 * 60_000, blockMs: 15 * 60_000 } as const;

function isAllowedTrackingOrigin(origin: string, host: string) {
  if (!origin) return true; // many privacy-respecting browsers strip Origin on same-origin POST
  try {
    const parsed = new URL(origin);
    if (!host) return true;
    // Strip port from host (e.g. "mister-b.club:443") for comparison.
    const hostName = host.split(":")[0];
    return parsed.hostname === hostName || parsed.hostname.endsWith(`.${hostName}`);
  } catch {
    return false;
  }
}

const dashboardAuthInput = z.object({
  token: z.string().min(1),
});

const WELCOME_MESSAGE_SETTING_KEY = "welcome_message";
const REMINDER_MESSAGE_SETTING_KEYS = TELEGRAM_REMINDER_STEPS.map((step) => step.settingKey);
const REMINDER_DELAY_SETTING_KEYS = TELEGRAM_REMINDER_STEPS.map((step) => step.delaySettingKey);

const TELEGRAM_MESSAGE_SETTING_KEYS = new Set<string>([
  WELCOME_MESSAGE_SETTING_KEY,
  ...REMINDER_MESSAGE_SETTING_KEYS,
]);
const TELEGRAM_DELAY_SETTING_KEYS = new Set<string>(REMINDER_DELAY_SETTING_KEYS);

const TELEGRAM_SETTING_ALLOWLIST = new Set<string>([
  TELEGRAM_GROUP_URL_SETTING_KEY,
  WELCOME_MESSAGE_SETTING_KEY,
  ...REMINDER_MESSAGE_SETTING_KEYS,
  ...REMINDER_DELAY_SETTING_KEYS,
]);

const TELEGRAM_MESSAGE_MAX_LENGTH = 4000; // Telegram message limit is 4096; cap a bit lower to leave room for footer.

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  tracking: router({
    createSession: publicProcedure
      .input(
        z.object({
          utmSource: z.string().optional(),
          utmMedium: z.string().optional(),
          utmCampaign: z.string().optional(),
          utmContent: z.string().optional(),
          utmTerm: z.string().optional(),
          fbclid: z.string().optional(),
          fbp: z.string().optional(),
          landingPage: z.string().optional(),
          referrer: z.string().optional(),
          isMobile: z.boolean().optional(),
          funnelToken: z.string().optional(),
          visitorId: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const ip = getClientIp(ctx.req);
        const origin = getHeaderString(ctx.req.headers.origin);
        const host = getHeaderString(ctx.req.headers.host);
        if (!isAllowedTrackingOrigin(origin, host)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cross-origin tracking is not allowed." });
        }
        const limit = checkRateLimit(`tracking.createSession:${ip}`, TRACKING_BUDGET);
        if (!limit.allowed) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Rate limit exceeded." });
        }
        const sessionToken = randomSessionToken();
        const funnelToken = input.funnelToken || randomSessionToken();
        const payload = encodeTelegramStartPayload(sessionToken, funnelToken, "group");
        const telegramBotUrl = `https://t.me/${BOT_USERNAME}?start=${payload}`;
        const userAgent = getHeaderString(ctx.req.headers["user-agent"]);
        const forwardedFor = getHeaderString(ctx.req.headers["x-forwarded-for"]);
        const clientIpAddress = forwardedFor
          ? forwardedFor.split(",")[0]?.trim() || ""
          : ctx.req.socket.remoteAddress || "";

        await insertUtmSession({
          sessionToken,
          funnelToken,
          visitorId: input.visitorId || null,
          utmSource: input.utmSource || null,
          utmMedium: input.utmMedium || null,
          utmCampaign: input.utmCampaign || null,
          utmContent: input.utmContent || null,
          utmTerm: input.utmTerm || null,
          fbclid: input.fbclid || null,
          fbp: input.fbp || null,
          landingPage: input.landingPage || null,
          referrer: input.referrer || null,
          ipAddress: clientIpAddress || null,
          userAgent: userAgent || null,
        });

        return {
          success: true,
          sessionToken,
          funnelToken,
          telegramBotUrl,
          telegramDeepLink: `tg://resolve?domain=${BOT_USERNAME}&start=${payload}`,
          payload,
        } as const;
      }),
    markTelegramClick: publicProcedure
      .input(
        z.object({
          sessionToken: z.string().min(1),
          funnelToken: z.string().optional(),
          source: z.string().optional(),
          eventId: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const ip = getClientIp(ctx.req);
        const origin = getHeaderString(ctx.req.headers.origin);
        const host = getHeaderString(ctx.req.headers.host);
        if (!isAllowedTrackingOrigin(origin, host)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cross-origin tracking is not allowed." });
        }
        const limit = checkRateLimit(`tracking.markTelegramClick:${ip}`, TRACKING_BUDGET);
        if (!limit.allowed) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Rate limit exceeded." });
        }
        await markSessionClicked(input.sessionToken);
        await recordEvent({
          eventType: "telegram_click",
          eventSource: input.source || "telegram_group_button",
          visitorId: input.sessionToken,
          sessionToken: input.sessionToken,
          funnelToken: input.funnelToken || null,
          userAgent: null,
          referrer: null,
          ip: null,
          country: null,
        });
        return { success: true } as const;
      }),
    record: publicProcedure
      .input(
        z.object({
          eventType: z.string().min(1),
          eventSource: z.string().optional(),
          visitorId: z.string().optional(),
          eventId: z.string().optional(),
          sourceUrl: z.string().optional(),
          sessionToken: z.string().optional(),
          funnelToken: z.string().optional(),
          fbc: z.string().optional(),
          fbp: z.string().optional(),
          country: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const ip = getClientIp(ctx.req);
        const origin = getHeaderString(ctx.req.headers.origin);
        const host = getHeaderString(ctx.req.headers.host);
        if (!isAllowedTrackingOrigin(origin, host)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cross-origin tracking is not allowed." });
        }
        const limit = checkRateLimit(`tracking.record:${ip}`, TRACKING_BUDGET);
        if (!limit.allowed) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Rate limit exceeded." });
        }
        const userAgent = getHeaderString(ctx.req.headers["user-agent"]);
        const referrer = getHeaderString(ctx.req.headers.referer);
        const forwardedFor = getHeaderString(ctx.req.headers["x-forwarded-for"]);
        const clientIpAddress = forwardedFor
          ? forwardedFor.split(",")[0]?.trim() || ""
          : ctx.req.socket.remoteAddress || "";
        const sourceUrl = input.sourceUrl || referrer;

        await recordEvent({
          eventType: input.eventType,
          eventSource: input.eventSource || null,
          eventId: input.eventId || null,
          visitorId: input.visitorId || null,
          sessionToken: input.sessionToken || null,
          funnelToken: input.funnelToken || null,
          sourceUrl: sourceUrl || null,
          userAgent: userAgent.slice(0, 512),
          referrer: referrer.slice(0, 512),
          ip: clientIpAddress.slice(0, 64) || null,
          country: input.country || null,
        });

        // Resolve the matching landing session so we can build server-side fbc
        // and propagate UTMs into the Meta payload. Without this, ad-driven
        // PageView attribution to fbclid is lost.
        const session = input.sessionToken ? await getUtmSessionByToken(input.sessionToken) : undefined;
        const serverFbc = buildServerFbc(session?.fbclid, session?.createdAt);

        const capiPayload = {
          visitorId: input.visitorId,
          eventId: input.eventId,
          eventSourceUrl: sourceUrl,
          userAgent,
          clientIpAddress,
          fbc: input.fbc || serverFbc,
          fbp: input.fbp || session?.fbp || undefined,
          country: input.country,
          source: input.eventSource || "button",
          utmSource: session?.utmSource || undefined,
          utmMedium: session?.utmMedium || undefined,
          utmCampaign: session?.utmCampaign || undefined,
          utmContent: session?.utmContent || undefined,
          utmTerm: session?.utmTerm || undefined,
        };

        if (input.eventType === "pageview") {
          // Reuse the client's eventId so DB ↔ Meta dedupe by eventId. If the
          // client failed to provide one, mint a deterministic one so the same
          // ID is used in both the log row and the Meta call.
          const pageViewEventId = input.eventId || `pv_${randomSessionToken()}`;
          const capiPayloadWithId = { ...capiPayload, eventId: pageViewEventId };

          // STEP 1: write the log row first with status='queued' so a crash
          // between log + send leaves a recoverable trail (the worker will
          // pick it up via getRetryableMetaEvents).
          await createMetaEventLog({
            eventType: "PageView",
            eventScope: "pageview",
            eventId: pageViewEventId,
            funnelToken: input.funnelToken || null,
            sessionToken: input.sessionToken || null,
            requestPayloadJson: JSON.stringify(capiPayloadWithId),
            status: "queued",
            retryable: 0,
            attemptCount: 0,
          });

          // STEP 2: actually call Meta.
          const pageViewResult = (await sendPageView(capiPayloadWithId)) as any;
          const status = pageViewResult.success
            ? ("sent" as const)
            : pageViewResult.retryable
              ? ("retrying" as const)
              : ("failed" as const);

          // STEP 3: update the same log row with the outcome.
          await updateMetaEventLog(pageViewEventId, {
            requestPayloadJson: pageViewResult.requestBody
              ? JSON.stringify(pageViewResult.requestBody)
              : JSON.stringify(capiPayloadWithId),
            responsePayloadJson: pageViewResult.responseBody
              ? JSON.stringify(pageViewResult.responseBody)
              : null,
            httpStatus: pageViewResult.httpStatus ?? null,
            status,
            errorCode: pageViewResult.errorCode ?? null,
            errorSubcode: pageViewResult.errorSubcode ?? null,
            errorMessage: pageViewResult.errorMessage ?? null,
            retryable: pageViewResult.retryable ? 1 : 0,
            attemptCount: 1,
            attemptedAt: new Date(),
            completedAt: pageViewResult.success ? new Date() : null,
            nextRetryAt: pageViewResult.retryable ? new Date(Date.now() + 5 * 60 * 1000) : null,
          });
        }

        return { success: true } as const;
      }),
  }),
  dashboard: router({
    login: publicProcedure
      .input(
        z.object({
          password: z.string().min(1),
        }),
      )
      .mutation(({ input, ctx }) => {
        const ip = getClientIp(ctx.req);
        const limitKey = `dashboard.login:${ip}`;
        const limit = checkRateLimit(limitKey, LOGIN_BUDGET);

        if (!limit.allowed) {
          log.warn("dashboard.login", "rate_limited", { ip, retryAfterMs: limit.retryAfterMs });
          const retryAfterSeconds = Math.ceil(limit.retryAfterMs / 1000);
          return {
            success: false,
            token: null,
            error: `Trop de tentatives — réessaie dans ${retryAfterSeconds}s.`,
          } as const;
        }

        if (!verifyDashboardPassword(input.password)) {
          log.warn("dashboard.login", "rejected_password_attempt", { ip });
          return {
            success: false,
            token: null,
            error: "Mot de passe incorrect",
          } as const;
        }

        try {
          const token = buildDashboardToken();
          recordSuccess(limitKey);
          return {
            success: true,
            token,
          } as const;
        } catch (error) {
          log.error("dashboard.login", "token_issuance_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            success: false,
            token: null,
            error: "Configuration serveur incomplète",
          } as const;
        }
      }),
    stats: publicProcedure
      .input(
        z.object({
          token: z.string().min(1),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          mode: z.enum(["range", "today"]).optional(),
          preset: z.enum(["24h", "48h", "7d", "15d", "30d", "custom"]).optional(),
        }),
      )
      .query(async ({ input }) => {
        if (!isDashboardTokenValid(input.token)) {
          return { error: "Unauthorized" } as const;
        }

        if (input.mode === "today" || input.preset === "24h") {
          return (await getLiveStatsSinceMidnight()) || ({ error: "No data" } as const);
        }

        if (input.preset && input.preset !== "custom") {
          return (await getDashboardStatsByPreset(input.preset)) || ({ error: "No data" } as const);
        }

        if (input.mode === "range" || input.preset === "custom" || input.startDate || input.endDate) {
          return (
            (await getDashboardStats(input.startDate, input.endDate, input.preset || "custom")) ||
            ({ error: "No data" } as const)
          );
        }

        return (await getLiveStatsSinceMidnight()) || ({ error: "No data" } as const);
      }),
    telegramOverview: publicProcedure.input(dashboardAuthInput).query(async ({ input }) => {
      if (!isDashboardTokenValid(input.token)) {
        return { error: "Unauthorized" } as const;
      }

      const [joinStats, joinsByCampaign, botStartStats, botStartsByCampaign, joins, dailyReport, weeklyJoins] =
        await Promise.all([
          getJoinStats(),
          getJoinsByCampaign(),
          getBotStartStats(),
          getBotStartsByCampaign(),
          getAllJoins(100),
          getDailyReportStats(),
          getWeeklyJoins(),
        ]);

      return {
        joinStats,
        joinsByCampaign,
        botStartStats,
        botStartsByCampaign,
        joins,
        dailyReport,
        weeklyJoins,
      } as const;
    }),
    settings: publicProcedure.input(dashboardAuthInput).query(async ({ input }) => {
      if (!isDashboardTokenValid(input.token)) {
        return { error: "Unauthorized" } as const;
      }
      return { settings: await getAllSettings() } as const;
    }),
    metaStatus: publicProcedure.input(dashboardAuthInput).query(async ({ input }) => {
      if (!isDashboardTokenValid(input.token)) {
        return { error: "Unauthorized" } as const;
      }

      const pixelId = process.env.META_PIXEL_ID ?? "";
      const accessToken = process.env.META_CONVERSIONS_TOKEN ?? "";
      const [summary, activity] = await Promise.all([
        getMetaEventSummary(),
        getRecentMetaActivityWindow(),
      ]);

      const credentialsReady = Boolean(pixelId && accessToken);

      return {
        config: {
          pixelId,
          pixelConfigured: Boolean(pixelId),
          tokenConfigured: Boolean(accessToken),
          pageViewTrackingActive: credentialsReady && activity.pageViewSentRecently,
          subscribeTrackingActive: credentialsReady && activity.subscribeSentRecently,
          pageViewLastSentAt: activity.pageViewLastSentAt,
          subscribeLastSentAt: activity.subscribeLastSentAt,
        },
        summary,
      } as const;
    }),
    subscriberLog: publicProcedure
      .input(
        dashboardAuthInput.extend({
          limit: z.number().int().min(1).max(200).optional(),
        }),
      )
      .query(async ({ input }) => {
        if (!isDashboardTokenValid(input.token)) {
          return { error: "Unauthorized" } as const;
        }

        return {
          rows: await getRecentBotStartsWithMetaStatus(input.limit || 50),
        } as const;
      }),
    metaDebugLog: publicProcedure
      .input(
        dashboardAuthInput.extend({
          limit: z.number().int().min(1).max(20).optional(),
        }),
      )
      .query(async ({ input }) => {
        if (!isDashboardTokenValid(input.token)) {
          return { error: "Unauthorized" } as const;
        }

        return await getRecentMetaDebugLog(input.limit || 5);
      }),
    processMetaRetries: publicProcedure
      .input(
        dashboardAuthInput.extend({
          limit: z.number().int().min(1).max(50).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        if (!isDashboardTokenValid(input.token)) {
          return { error: "Unauthorized" } as const;
        }

        const retryCandidates = await getRetryableMetaEvents(input.limit || 10);
        let sent = 0;
        let failed = 0;
        let abandoned = 0;

        for (const candidate of retryCandidates) {
          const nextAttempt = (candidate.attemptCount || 0) + 1;
          const result = await retryStoredMetaRequest(candidate.eventId, candidate.requestPayloadJson);
          const status = result.success
            ? "sent"
            : result.retryable
              ? nextAttempt >= 5
                ? "abandoned"
                : "retrying"
              : "failed";

          if (status === "sent") sent += 1;
          else if (status === "abandoned") abandoned += 1;
          else failed += 1;

          await updateMetaEventLog(candidate.eventId, {
            status,
            requestPayloadJson: result.requestBody ? JSON.stringify(result.requestBody) : candidate.requestPayloadJson,
            responsePayloadJson: result.responseBody ? JSON.stringify(result.responseBody) : null,
            httpStatus: result.httpStatus ?? null,
            errorCode: result.errorCode ?? null,
            errorSubcode: result.errorSubcode ?? null,
            errorMessage: result.errorMessage ?? null,
            retryable: result.retryable ? 1 : 0,
            attemptCount: nextAttempt,
            attemptedAt: new Date(),
            completedAt: result.success ? new Date() : null,
            nextRetryAt: status === "retrying" ? new Date(Date.now() + 5 * 60 * 1000) : null,
          });

          if (candidate.telegramUserId) {
            await updateBotStartMetaStatus(candidate.telegramUserId, status, result.eventId);
          }

          if (candidate.eventScope === "telegram_join") {
            await updateTelegramJoinMetaStatusByEventId(candidate.eventId, status);
          }
        }

        return {
          processed: retryCandidates.length,
          sent,
          failed,
          abandoned,
        } as const;
      }),
    updateSetting: publicProcedure
      .input(
        z.object({
          token: z.string().min(1),
          key: z.string().min(1),
          value: z.string(),
        }),
      )
      .mutation(async ({ input }) => {
        if (!isDashboardTokenValid(input.token)) {
          return { error: "Unauthorized" } as const;
        }

        // Reject any key not on the allowlist — settings are user-controlled
        // text rendered into Telegram messages, so we don't want arbitrary
        // keys to bloat the table or be set by a stolen dashboard token.
        if (!TELEGRAM_SETTING_ALLOWLIST.has(input.key)) {
          log.warn("dashboard.updateSetting", "rejected_unknown_key", { key: input.key });
          return { success: false, error: "Unknown setting key." } as const;
        }

        if (input.key === TELEGRAM_GROUP_URL_SETTING_KEY) {
          const validation = validateTelegramGroupUrl(input.value);
          if (!validation.ok) {
            log.warn("dashboard.updateSetting", "telegram_group_url_rejected", {
              error: validation.error,
            });
            return { success: false, error: validation.error } as const;
          }
          await syncTelegramGroupUrlContent(validation.value);
          return { success: true } as const;
        }

        if (TELEGRAM_MESSAGE_SETTING_KEYS.has(input.key)) {
          const trimmed = input.value.trim();
          if (!trimmed) {
            return { success: false, error: "Message must not be empty." } as const;
          }
          if (trimmed.length > TELEGRAM_MESSAGE_MAX_LENGTH) {
            return {
              success: false,
              error: `Message too long (max ${TELEGRAM_MESSAGE_MAX_LENGTH} characters).`,
            } as const;
          }
          await upsertSetting(input.key, trimmed);
          return { success: true } as const;
        }

        if (TELEGRAM_DELAY_SETTING_KEYS.has(input.key)) {
          const parsed = Number(input.value);
          if (!isValidReminderDelayMinutes(parsed)) {
            return {
              success: false,
              error: `Delay must be an integer between ${TELEGRAM_REMINDER_DELAY_BOUNDS.min} and ${TELEGRAM_REMINDER_DELAY_BOUNDS.max} minutes.`,
            } as const;
          }
          await upsertSetting(input.key, String(Math.floor(parsed)));
          return { success: true } as const;
        }

        // Defensive — should be unreachable given the allowlist gate above.
        return { success: false, error: "Setting not handled." } as const;
      }),
    telegramSettings: publicProcedure.input(dashboardAuthInput).query(async ({ input }) => {
      if (!isDashboardTokenValid(input.token)) {
        return { error: "Unauthorized" } as const;
      }

      const groupUrl = await getTelegramGroupUrl();
      const [welcomeStored, ...reminderEntries] = await Promise.all([
        getSetting(WELCOME_MESSAGE_SETTING_KEY),
        ...TELEGRAM_REMINDER_STEPS.map(async (step) => {
          const [storedTemplate, storedDelay] = await Promise.all([
            getSetting(step.settingKey),
            getSetting(step.delaySettingKey),
          ]);
          const delayMinNum = Number(storedDelay);
          const delayMin =
            storedDelay && isValidReminderDelayMinutes(delayMinNum)
              ? Math.floor(delayMinNum)
              : step.defaultDelayMin;
          return {
            key: step.key,
            label: step.label,
            description: step.description,
            messageSettingKey: step.settingKey,
            delaySettingKey: step.delaySettingKey,
            defaultDelayMin: step.defaultDelayMin,
            delayMin,
            message: storedTemplate || step.defaultTemplate,
            usesDefaultMessage: !storedTemplate,
            usesDefaultDelay: !storedDelay,
          };
        }),
      ]);

      return {
        groupUrl,
        welcome: {
          settingKey: WELCOME_MESSAGE_SETTING_KEY,
          message: welcomeStored || buildDefaultWelcomeMessage(groupUrl),
          usesDefault: !welcomeStored,
          variables: ["{firstName}", "{groupLink}", "{group_url}"],
          description: "Sent when a user runs /start. Variables: {firstName}, {groupLink}.",
        },
        reminders: reminderEntries,
        delayBounds: TELEGRAM_REMINDER_DELAY_BOUNDS,
        messageMaxLength: TELEGRAM_MESSAGE_MAX_LENGTH,
      } as const;
    }),
    today: publicProcedure.input(dashboardAuthInput).query(async ({ input }) => {
      if (!isDashboardTokenValid(input.token)) {
        return { error: "Unauthorized" } as const;
      }

      return (
        (await getTodayStats()) ||
        ({
          pageviews: 0,
          uniqueVisitors: 0,
          whatsappClicks: 0,
          telegramClicks: 0,
        } as const)
      );
    }),
    trackingHealth: publicProcedure.input(dashboardAuthInput).query(({ input }) => {
      if (!isDashboardTokenValid(input.token)) {
        return { error: "Unauthorized" } as const;
      }
      // Surfaces the in-process recordEvent counter so silent DB failures
      // become visible to the operator (the function used to swallow errors
      // with a single console.error).
      return getRecordEventStats();
    }),
  }),
});

export type AppRouter = typeof appRouter;
