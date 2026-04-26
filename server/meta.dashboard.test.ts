import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  getMetaEventSummary: vi.fn(),
  getRecentBotStartsWithMetaStatus: vi.fn(),
  getRecentMetaDebugLog: vi.fn(),
  getRecentMetaActivityWindow: vi.fn().mockResolvedValue({
    pageViewSentRecently: true,
    subscribeSentRecently: true,
    pageViewLastSentAt: new Date("2026-04-25T10:00:00.000Z"),
    subscribeLastSentAt: new Date("2026-04-25T10:00:00.000Z"),
  }),
}));

vi.mock("./facebookCapi", () => ({
  sendPageView: vi.fn(),
  sendSubscribe: vi.fn(),
  sendContact: vi.fn(),
  sendScrollDepth: vi.fn(),
}));

import { appRouter } from "./routers";
import { getMetaEventSummary, getRecentBotStartsWithMetaStatus, getRecentMetaDebugLog } from "./db";
import { buildDashboardToken } from "./_core/dashboardAuth";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-vitest-1234567890";
const VALID_TOKEN = buildDashboardToken();

const appSource = fs.readFileSync(path.resolve(import.meta.dirname, "../client/src/App.tsx"), "utf-8");
const dashboardSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "../client/src/pages/Dashboard.tsx"),
  "utf-8",
);
const metaDebugSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "../client/src/pages/MetaDebug.tsx"),
  "utf-8",
);
const webhookSource = fs.readFileSync(path.resolve(import.meta.dirname, "./telegramWebhook.ts"), "utf-8");

function createContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {
        "user-agent": "VitestAgent/1.0",
        referer: "https://mister-b.test/dashboard",
        "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      },
      socket: {
        remoteAddress: "127.0.0.1",
      },
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as TrpcContext["res"],
  };
}

describe("meta dashboard procedures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses Meta status access when the dashboard token is invalid", async () => {
    const caller = appRouter.createCaller(createContext());

    const result = await caller.dashboard.metaStatus({ token: "invalid-token" });

    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("returns server-side Meta status details and summary counts for the dashboard", async () => {
    process.env.META_PIXEL_ID = "945883278158292";
    process.env.META_CONVERSIONS_TOKEN = "meta_test_token";

    vi.mocked(getMetaEventSummary).mockResolvedValue({
      totalStarts: 15,
      totalSent: 11,
      totalFailed: 3,
      totalPending: 1,
      todayStarts: 4,
      todaySent: 2,
      todayFailed: 1,
      todayPending: 1,
    });

    const caller = appRouter.createCaller(createContext());
    const result = await caller.dashboard.metaStatus({ token: VALID_TOKEN });

    expect(getMetaEventSummary).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      config: {
        pixelId: "945883278158292",
        pixelConfigured: true,
        tokenConfigured: true,
        pageViewTrackingActive: true,
        subscribeTrackingActive: true,
      },
      summary: {
        totalSent: 11,
        todaySent: 2,
        totalFailed: 3,
      },
    });
  });

  it("returns the subscriber conversion log for recent Telegram bot starts", async () => {
    vi.mocked(getRecentBotStartsWithMetaStatus).mockResolvedValue([
      {
        id: 7,
        telegramUserId: "123456",
        telegramUsername: "misterb_lead",
        telegramFirstName: "Lucas",
        utmSource: "facebook",
        utmCampaign: "spring-drop",
        utmMedium: "cpc",
        utmContent: "story-1",
        utmTerm: "mister-b",
        sessionToken: "sess_123",
        fbclid: "fbclid_123",
        metaSubscribeStatus: "sent",
        metaSubscribeEventId: "tg_start_123456_1712760000",
        metaSubscribeSentAt: new Date("2026-04-22T10:15:00.000Z"),
        startedAt: new Date("2026-04-22T10:15:00.000Z"),
        joinedAt: null,
      },
    ]);

    const caller = appRouter.createCaller(createContext());
    const result = await caller.dashboard.subscriberLog({
      token: VALID_TOKEN,
      limit: 12,
    });

    expect(getRecentBotStartsWithMetaStatus).toHaveBeenCalledWith(12);
    expect(result).toMatchObject({
      rows: [
        {
          telegramUserId: "123456",
          telegramUsername: "misterb_lead",
          utmCampaign: "spring-drop",
          sessionToken: "sess_123",
          fbclid: "fbclid_123",
          metaSubscribeStatus: "sent",
        },
      ],
    });
  });

  it("returns the last 5 PageView and Subscribe rows for the private Meta debug page", async () => {
    vi.mocked(getRecentMetaDebugLog).mockResolvedValue({
      pageviews: [
        {
          id: 41,
          eventType: "pageview",
          eventSource: "landing_auto",
          visitorId: "visitor_123",
          referrer: "https://facebook.com/",
          country: "FR",
          ip: "203.0.113.10",
          userAgent: "Mozilla/5.0",
          createdAt: new Date("2026-04-24T08:00:00.000Z"),
        },
      ],
      sessions: [
        {
          id: 14,
          sessionToken: "sess_987",
          utmSource: "facebook",
          utmMedium: "cpc",
          utmCampaign: "drop-2",
          utmContent: "story-4",
          utmTerm: "vip",
          fbclid: "fbclid_987",
          fbp: "fb.1.1777129000000.123456",
          ipAddress: "203.0.113.10",
          userAgent: "Mozilla/5.0",
          referrer: "https://facebook.com/",
          landingPage: "https://mister-b.club/?utm_campaign=drop-2",
          clickedTelegramLink: "yes",
          clickedAt: new Date("2026-04-24T08:01:00.000Z"),
          createdAt: new Date("2026-04-24T08:00:00.000Z"),
        },
      ],
      joins: [
        {
          id: 4,
          telegramUserId: "987654",
          telegramUsername: "vip_lead",
          telegramFirstName: "Nora",
          channelTitle: "Mister B Club",
          metaEventSent: "sent",
          metaEventId: "tg_join_987654_1713945720",
          metaEventSentAt: new Date("2026-04-24T08:03:10.000Z"),
          utmSource: "facebook",
          utmMedium: "cpc",
          utmCampaign: "drop-2",
          sessionToken: "sess_987",
          fbclid: "fbclid_987",
          ipAddress: "203.0.113.10",
          userAgent: "Mozilla/5.0",
          joinedAt: new Date("2026-04-24T08:03:00.000Z"),
          createdAt: new Date("2026-04-24T08:03:00.000Z"),
        },
      ],
      subscribes: [
        {
          id: 9,
          telegramUserId: "987654",
          telegramUsername: "vip_lead",
          telegramFirstName: "Nora",
          metaSubscribeStatus: "sent",
          metaSubscribeEventId: "tg_join_987654_1713945720",
          metaSubscribeSentAt: new Date("2026-04-24T08:03:10.000Z"),
          startedAt: new Date("2026-04-24T08:02:00.000Z"),
          joinedAt: new Date("2026-04-24T08:03:00.000Z"),
          utmSource: "facebook",
          utmCampaign: "drop-2",
          utmMedium: "cpc",
          sessionToken: "sess_987",
          fbclid: "fbclid_987",
          fbp: "fb.1.1777129000000.123456",
          ipAddress: "203.0.113.10",
          userAgent: "Mozilla/5.0",
          sessionCreatedAt: new Date("2026-04-24T08:00:00.000Z"),
        },
      ],
    });

    const caller = appRouter.createCaller(createContext());
    const result = await caller.dashboard.metaDebugLog({
      token: VALID_TOKEN,
      limit: 5,
    });

    expect(getRecentMetaDebugLog).toHaveBeenCalledWith(5);
    expect(result).toMatchObject({
      pageviews: [
        {
          id: 41,
          eventSource: "landing_auto",
          visitorId: "visitor_123",
        },
      ],
      sessions: [
        {
          sessionToken: "sess_987",
          fbp: "fb.1.1777129000000.123456",
          clickedTelegramLink: "yes",
        },
      ],
      joins: [
        {
          telegramUserId: "987654",
          metaEventSent: "sent",
          metaEventId: "tg_join_987654_1713945720",
        },
      ],
      subscribes: [
        {
          telegramUserId: "987654",
          metaSubscribeStatus: "sent",
          metaSubscribeEventId: "tg_join_987654_1713945720",
          fbp: "fb.1.1777129000000.123456",
        },
      ],
    });
  });

  it("adds a dedicated Meta status card, a Meta debug page link, and the upgraded live tracking debug view", () => {
    expect(dashboardSource).toContain("Meta Server Status");
    expect(dashboardSource).toContain("Derniers starts bot");
    expect(dashboardSource).toContain("Qui a start / qui a rejoint");
    expect(dashboardSource).toContain("Open Meta Debug Page");
    expect(dashboardSource).toContain("/dashboard/meta-debug");
    expect(dashboardSource).toContain("trpc.dashboard.metaStatus.useQuery");
    expect(dashboardSource).toContain("trpc.dashboard.subscriberLog.useQuery");
    expect(dashboardSource).toContain("trpc.dashboard.telegramOverview.useQuery");
    expect(metaDebugSource).toContain("trpc.dashboard.metaDebugLog.useQuery");
    expect(metaDebugSource).toContain("Live Tracking Debug");
    expect(metaDebugSource).toContain("Current Browser Snapshot");
    expect(metaDebugSource).toContain("Latest Landing Sessions");
    expect(metaDebugSource).toContain("Latest Telegram Joins");
    expect(metaDebugSource).toContain("Latest Meta Subscribe Outcomes");
    expect(metaDebugSource).toContain('window.sessionStorage.getItem("misterb_pv_event_id")');
    expect(metaDebugSource).toContain('getCookieValue("_fbp")');
    expect(appSource).toContain('path="/dashboard/meta-debug"');
  });

  it("persists Meta Subscribe outcomes for Telegram joins in the webhook flow with retry-aware status handling", () => {
    expect(webhookSource).toContain("updateBotStartMetaStatus");
    expect(webhookSource).toContain('metaResult.success ? "sent" : metaResult.retryable ? "retrying" : "failed"');
    expect(webhookSource).toContain("const resolvedSessionToken = linkage?.sessionToken || storedBotStart?.sessionToken || null");
    expect(webhookSource).toContain("fbp: session?.fbp || undefined");
    expect(webhookSource).toContain("sessionCreatedAt: session?.createdAt");
    expect(webhookSource).toContain("createMetaEventLog({");
    expect(webhookSource).toContain("updateMetaEventLog(eventId");
    expect(webhookSource).not.toContain("[Meta CAPI] /start error:");
    expect(webhookSource).not.toContain("void fireSubscribeEvent(");
  });
});
