import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  // tracking + meta
  recordEvent: vi.fn().mockResolvedValue(undefined),
  insertUtmSession: vi.fn().mockResolvedValue(undefined),
  markSessionClicked: vi.fn().mockResolvedValue(undefined),
  createMetaEventLog: vi.fn().mockResolvedValue(undefined),
  updateMetaEventLog: vi.fn().mockResolvedValue(undefined),
  getUtmSessionByToken: vi.fn().mockResolvedValue(undefined),
  // dashboard + admin (called via setting endpoints; mock as no-ops)
  getAllSettings: vi.fn().mockResolvedValue([]),
  getDashboardStats: vi.fn(),
  getDashboardStatsByPreset: vi.fn(),
  getLiveStatsSinceMidnight: vi.fn(),
  getMetaEventSummary: vi.fn(),
  getRecentBotStartsWithMetaStatus: vi.fn(),
  getRecentMetaActivityWindow: vi.fn().mockResolvedValue({
    pageViewSentRecently: false,
    subscribeSentRecently: false,
    pageViewLastSentAt: null,
    subscribeLastSentAt: null,
  }),
  getRecentMetaDebugLog: vi.fn(),
  getRetryableMetaEvents: vi.fn().mockResolvedValue([]),
  getTodayStats: vi.fn(),
  getJoinStats: vi.fn(),
  getJoinsByCampaign: vi.fn(),
  getBotStartStats: vi.fn(),
  getBotStartsByCampaign: vi.fn(),
  getAllJoins: vi.fn(),
  getDailyReportStats: vi.fn(),
  getWeeklyJoins: vi.fn(),
  upsertSetting: vi.fn().mockResolvedValue(undefined),
  updateBotStartMetaStatus: vi.fn().mockResolvedValue(undefined),
  updateTelegramJoinMetaStatusByEventId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./facebookCapi", () => ({
  sendPageView: vi.fn(),
  sendSubscribe: vi.fn(),
  sendContact: vi.fn(),
  sendScrollDepth: vi.fn(),
}));

import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import {
  createMetaEventLog,
  insertUtmSession,
  recordEvent,
  updateMetaEventLog,
} from "./db";
import { sendPageView } from "./facebookCapi";

function createContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {
        "user-agent": "VitestAgent/1.0",
        referer: "https://mister-b.test/landing",
        "x-forwarded-for": "203.0.113.9",
      },
      socket: { remoteAddress: "127.0.0.1" },
    } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as TrpcContext["res"],
  };
}

describe("Funnel hardening — server-side P0/P1 fixes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Telegram start payload encoding", () => {
    it("emits short tokens that keep the deep-link payload safely under Telegram's 64-char limit", async () => {
      const caller = appRouter.createCaller(createContext());
      const result = await caller.tracking.createSession({
        utmSource: "facebook",
        utmCampaign: "spring-drop",
        fbclid: "fb_smoke",
        landingPage: "https://mister-b.club/",
        referrer: "https://facebook.com/",
      });

      expect(result.success).toBe(true);
      // The base64url payload must be ≤ 64 chars (Telegram /start limit).
      expect(result.payload.length).toBeLessThanOrEqual(64);
      // The deep-link must always include the start payload.
      expect(result.telegramBotUrl).toMatch(/\?start=/);
      expect(result.telegramDeepLink).toMatch(/&start=/);
      // Tokens must be base64url (no padding, no '+' or '/').
      expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result.funnelToken).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe("PageView Meta — log-before-send ordering (P1-A)", () => {
    it("inserts the meta_event_logs row with status='queued' BEFORE calling Meta", async () => {
      const callOrder: string[] = [];
      vi.mocked(createMetaEventLog).mockImplementation(async () => {
        callOrder.push("createMetaEventLog");
      });
      vi.mocked(sendPageView).mockImplementation(async () => {
        callOrder.push("sendPageView");
        return {
          success: true,
          eventId: "pv_test_123",
          retryable: false,
          httpStatus: 200,
          requestBody: { data: [{}] },
          responseBody: { events_received: 1 },
        } as any;
      });
      vi.mocked(updateMetaEventLog).mockImplementation(async () => {
        callOrder.push("updateMetaEventLog");
      });

      const caller = appRouter.createCaller(createContext());
      await caller.tracking.record({
        eventType: "pageview",
        eventId: "pv_test_123",
        visitorId: "v_test",
        sessionToken: "sess_test",
        funnelToken: "ft_test",
      });

      // Order must be: log first (queued), then send Meta, then update log.
      expect(callOrder).toEqual(["createMetaEventLog", "sendPageView", "updateMetaEventLog"]);

      // The first log row must use status='queued' (recoverable on crash).
      const firstLog = vi.mocked(createMetaEventLog).mock.calls[0][0];
      expect(firstLog.status).toBe("queued");
      expect(firstLog.eventId).toBe("pv_test_123"); // deterministic, matches Meta call
    });

    it("uses the same eventId for the log row and the Meta call (no random fallback collision)", async () => {
      vi.mocked(sendPageView).mockResolvedValue({
        success: true,
        eventId: "pv_unique_id",
        retryable: false,
        httpStatus: 200,
      } as any);

      const caller = appRouter.createCaller(createContext());
      await caller.tracking.record({
        eventType: "pageview",
        eventId: "pv_unique_id",
        visitorId: "v_test",
      });

      const logRowEventId = vi.mocked(createMetaEventLog).mock.calls[0][0].eventId;
      const updateRowEventId = vi.mocked(updateMetaEventLog).mock.calls[0][0];
      expect(logRowEventId).toBe("pv_unique_id");
      expect(updateRowEventId).toBe("pv_unique_id");
    });

    it("mints a deterministic eventId when the client did not provide one and reuses it across log + send", async () => {
      vi.mocked(sendPageView).mockResolvedValue({
        success: true,
        eventId: "ignored_by_caller",
        retryable: false,
        httpStatus: 200,
      } as any);

      const caller = appRouter.createCaller(createContext());
      await caller.tracking.record({
        eventType: "pageview",
        visitorId: "v_test",
      });

      const logEventId = vi.mocked(createMetaEventLog).mock.calls[0][0].eventId;
      const updateEventId = vi.mocked(updateMetaEventLog).mock.calls[0][0];
      const sentEventId = vi.mocked(sendPageView).mock.calls[0][0]?.eventId;

      expect(logEventId).toBeTruthy();
      expect(logEventId).toBe(updateEventId);
      expect(logEventId).toBe(sentEventId);
    });
  });

  describe("Tracking session creation persists fbclid + utm_*", () => {
    it("forwards browser-captured fbp and fbclid to insertUtmSession so Meta CAPI can rebuild fbc later", async () => {
      const caller = appRouter.createCaller(createContext());
      await caller.tracking.createSession({
        utmSource: "facebook",
        utmCampaign: "spring-drop",
        utmContent: "story-1",
        fbclid: "fb_xyz",
        fbp: "fb.1.1700000000000.1234567890",
        landingPage: "https://mister-b.club/?utm_source=facebook",
        referrer: "https://facebook.com/",
      });

      expect(insertUtmSession).toHaveBeenCalledTimes(1);
      const inserted = vi.mocked(insertUtmSession).mock.calls[0][0];
      expect(inserted.fbclid).toBe("fb_xyz");
      expect(inserted.fbp).toBe("fb.1.1700000000000.1234567890");
      expect(inserted.utmSource).toBe("facebook");
      expect(inserted.utmCampaign).toBe("spring-drop");
      expect(inserted.utmContent).toBe("story-1");
    });
  });
});
