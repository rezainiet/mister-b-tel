import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  recordEvent: vi.fn(),
  getDashboardStats: vi.fn(),
  getDashboardStatsByPreset: vi.fn(),
  getLiveStatsSinceMidnight: vi.fn(),
  getTodayStats: vi.fn(),
  createMetaEventLog: vi.fn().mockResolvedValue(undefined),
  updateMetaEventLog: vi.fn().mockResolvedValue(undefined),
  insertUtmSession: vi.fn().mockResolvedValue(undefined),
  markSessionClicked: vi.fn().mockResolvedValue(undefined),
  getUtmSessionByToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./facebookCapi", () => ({
  sendPageView: vi.fn(),
  sendSubscribe: vi.fn(),
  sendContact: vi.fn(),
  sendScrollDepth: vi.fn(),
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-vitest-1234567890";
process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "1234";

import { appRouter } from "./routers";
import {
  getDashboardStats,
  getDashboardStatsByPreset,
  getLiveStatsSinceMidnight,
  recordEvent,
} from "./db";
import { sendContact, sendPageView, sendScrollDepth, sendSubscribe } from "./facebookCapi";
import { buildDashboardToken } from "./_core/dashboardAuth";

const VALID_TOKEN = buildDashboardToken();

function createContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {
        "user-agent": "VitestAgent/1.0",
        referer: "https://mister-b.test/landing",
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

describe("Mister B dashboard and tracking routers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authentifie le dashboard avec le mot de passe d’environnement configuré", async () => {
    const password = process.env.DASHBOARD_PASSWORD;

    expect(password).toBeTruthy();

    const caller = appRouter.createCaller(createContext());
    const result = await caller.dashboard.login({ password: password! });

    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty("error");
    expect(result.token).toMatch(/^misterb-dash-/);
  });

  it("refuses dashboard stats access when the token is invalid", async () => {
    const caller = appRouter.createCaller(createContext());

    const result = await caller.dashboard.stats({
      token: "invalid-token",
      preset: "24h",
    });

    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("returns since-midnight live stats when the dashboard token is valid", async () => {
    vi.mocked(getLiveStatsSinceMidnight).mockResolvedValue({
      meta: {
        preset: "24h",
        label: "24 h · depuis minuit",
        startDate: "2026-04-13",
        endDate: "2026-04-13",
        refreshedAt: "2026-04-13T08:00:00.000Z",
        sinceMidnight: true,
      },
      totals: {
        pageviews: 10,
        uniqueVisitors: 8,
        whatsappClicks: 2,
        telegramClicks: 1,
        scroll25: 7,
        scroll50: 5,
        scroll75: 4,
        scroll100: 2,
        totalContacts: 3,
        conversionRate: "30.0",
      },
      daily: [],
      recentEvents: [],
      live: {
        last5Minutes: { pageviews: 4, uniqueVisitors: 3, totalContacts: 1 },
        last10Minutes: { pageviews: 7, uniqueVisitors: 5, totalContacts: 2 },
        last4Hours: { pageviews: 14, uniqueVisitors: 9, totalContacts: 4 },
        lastVisitAt: "2026-04-13T07:58:00.000Z",
        lastEventType: "pageview",
        adStatus: "active",
        adStatusLabel: "Publicité active",
      },
    });

    const caller = appRouter.createCaller(createContext());
    const result = await caller.dashboard.stats({
      token: VALID_TOKEN,
      preset: "24h",
    });

    expect(getLiveStatsSinceMidnight).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      meta: {
        preset: "24h",
        sinceMidnight: true,
      },
      totals: {
        pageviews: 10,
        conversionRate: "30.0",
      },
      live: {
        adStatus: "active",
      },
    });
  });

  it("returns preset range stats when a valid token requests 15 days", async () => {
    vi.mocked(getDashboardStatsByPreset).mockResolvedValue({
      meta: {
        preset: "15d",
        label: "15 jours",
        startDate: "2026-03-30",
        endDate: "2026-04-13",
        refreshedAt: "2026-04-13T08:00:00.000Z",
        sinceMidnight: false,
      },
      totals: {
        pageviews: 30,
        uniqueVisitors: 20,
        whatsappClicks: 6,
        telegramClicks: 3,
        scroll25: 12,
        scroll50: 10,
        scroll75: 8,
        scroll100: 4,
        totalContacts: 9,
        conversionRate: "30.0",
      },
      daily: [
        {
          date: "2026-04-13",
          pageviews: 30,
          uniqueVisitors: 20,
          whatsappClicks: 6,
          telegramClicks: 3,
          scroll25: 12,
          scroll50: 10,
          scroll75: 8,
          scroll100: 4,
          totalContacts: 9,
          conversionRate: "30.0",
        },
      ],
      recentEvents: [],
      live: {
        last5Minutes: { pageviews: 0, uniqueVisitors: 0, totalContacts: 0 },
        last10Minutes: { pageviews: 1, uniqueVisitors: 1, totalContacts: 0 },
        last4Hours: { pageviews: 5, uniqueVisitors: 4, totalContacts: 1 },
        lastVisitAt: "2026-04-13T07:58:00.000Z",
        lastEventType: "whatsapp_click",
        adStatus: "warming",
        adStatusLabel: "Publicité en chauffe",
      },
    });

    const caller = appRouter.createCaller(createContext());
    const result = await caller.dashboard.stats({
      token: VALID_TOKEN,
      preset: "15d",
    });

    expect(getDashboardStatsByPreset).toHaveBeenCalledWith("15d");
    expect(result).toMatchObject({
      meta: {
        preset: "15d",
      },
      totals: {
        whatsappClicks: 6,
      },
    });
  });

  it("returns range stats when a valid token and custom dates are provided", async () => {
    vi.mocked(getDashboardStats).mockResolvedValue({
      meta: {
        preset: "custom",
        label: "Période personnalisée",
        startDate: "2026-04-01",
        endDate: "2026-04-13",
        refreshedAt: "2026-04-13T08:00:00.000Z",
        sinceMidnight: false,
      },
      totals: {
        pageviews: 30,
        uniqueVisitors: 20,
        whatsappClicks: 6,
        telegramClicks: 3,
        scroll25: 12,
        scroll50: 10,
        scroll75: 8,
        scroll100: 4,
        totalContacts: 9,
        conversionRate: "30.0",
      },
      daily: [
        {
          date: "2026-04-13",
          pageviews: 30,
          uniqueVisitors: 20,
          whatsappClicks: 6,
          telegramClicks: 3,
          scroll25: 12,
          scroll50: 10,
          scroll75: 8,
          scroll100: 4,
          totalContacts: 9,
          conversionRate: "30.0",
        },
      ],
      recentEvents: [],
      live: {
        last5Minutes: { pageviews: 0, uniqueVisitors: 0, totalContacts: 0 },
        last10Minutes: { pageviews: 1, uniqueVisitors: 1, totalContacts: 0 },
        last4Hours: { pageviews: 5, uniqueVisitors: 4, totalContacts: 1 },
        lastVisitAt: "2026-04-13T07:58:00.000Z",
        lastEventType: "telegram_click",
        adStatus: "idle",
        adStatusLabel: "Publicité inactive",
      },
    });

    const caller = appRouter.createCaller(createContext());
    const result = await caller.dashboard.stats({
      token: VALID_TOKEN,
      preset: "custom",
      startDate: "2026-04-01",
      endDate: "2026-04-13",
    });

    expect(getDashboardStats).toHaveBeenCalledWith("2026-04-01", "2026-04-13", "custom");
    expect(result).toMatchObject({
      totals: {
        whatsappClicks: 6,
      },
    });
  });

  it("records WhatsApp clicks without forwarding them to Meta CAPI", async () => {
    const caller = appRouter.createCaller(createContext());

    const result = await caller.tracking.record({
      eventType: "whatsapp_click",
      eventSource: "hero_cta",
      visitorId: "visitor_123",
      eventId: "wa_123",
      sourceUrl: "https://mister-b.test/",
      fbc: "fb.1.123.test",
      country: "FR",
    });

    expect(result).toEqual({ success: true });
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "whatsapp_click",
        eventSource: "hero_cta",
        visitorId: "visitor_123",
        userAgent: "VitestAgent/1.0",
        referrer: "https://mister-b.test/landing",
        ip: "203.0.113.9",
        country: "FR",
      }),
    );
    expect(sendSubscribe).not.toHaveBeenCalled();
    expect(sendContact).not.toHaveBeenCalled();
    expect(sendPageView).not.toHaveBeenCalled();
  });

  it("records pageviews and forwards them to Meta CAPI PageView", async () => {
    vi.mocked(sendPageView).mockResolvedValue({
      success: true,
      eventId: "pv_456",
      httpStatus: 200,
      retryable: false,
    });
    const caller = appRouter.createCaller(createContext());

    await caller.tracking.record({
      eventType: "pageview",
      eventSource: "landing",
      visitorId: "visitor_456",
      eventId: "pv_456",
      sourceUrl: "https://mister-b.test/",
    });

    expect(sendPageView).toHaveBeenCalledWith(
      expect.objectContaining({
        visitorId: "visitor_456",
        eventId: "pv_456",
        eventSourceUrl: "https://mister-b.test/",
        source: "landing",
      }),
    );
  });

  it("waits for the Meta PageView call before resolving tracking.record", async () => {
    const caller = appRouter.createCaller(createContext());

    let releaseSendPageView: (() => void) | null = null;
    const sendPageViewDone = new Promise<Awaited<ReturnType<typeof sendPageView>>>((resolve) => {
      releaseSendPageView = () =>
        resolve({ success: true, eventId: "pv_await", httpStatus: 200, retryable: false });
    });

    vi.mocked(sendPageView).mockImplementation(() => sendPageViewDone as ReturnType<typeof sendPageView>);

    let mutationResolved = false;
    const recordPromise = caller.tracking.record({
      eventType: "pageview",
      eventSource: "landing",
      visitorId: "visitor_await",
      eventId: "pv_await",
      sourceUrl: "https://mister-b.test/",
    }).then(() => {
      mutationResolved = true;
    });

    await vi.waitFor(() => {
      expect(sendPageView).toHaveBeenCalledTimes(1);
    });
    expect(mutationResolved).toBe(false);

    releaseSendPageView?.();
    await recordPromise;

    expect(mutationResolved).toBe(true);
  });

  it("records the Telegram group CTA internally without forwarding a Meta conversion on click", async () => {
    const caller = appRouter.createCaller(createContext());

    await caller.tracking.record({
      eventType: "telegram_click",
      eventSource: "telegram_group_cta",
      visitorId: "visitor_tg_group",
      eventId: "tg_group_123",
      sourceUrl: "https://mister-b.test/",
      fbp: "fb.1.123.telegramgroup",
    });

    expect(sendSubscribe).not.toHaveBeenCalled();
    expect(sendContact).not.toHaveBeenCalled();
    expect(sendPageView).not.toHaveBeenCalled();
  });

  it("records the private Telegram CTA internally without forwarding a Meta contact event", async () => {
    const caller = appRouter.createCaller(createContext());

    await caller.tracking.record({
      eventType: "telegram_click",
      eventSource: "telegram_contact_cta",
      visitorId: "visitor_tg_contact",
      eventId: "tg_contact_123",
      sourceUrl: "https://mister-b.test/",
    });

    expect(sendContact).not.toHaveBeenCalled();
    expect(sendSubscribe).not.toHaveBeenCalled();
    expect(sendPageView).not.toHaveBeenCalled();
  });

  it("keeps scroll milestones internal without forwarding them to Meta CAPI", async () => {
    const caller = appRouter.createCaller(createContext());

    await caller.tracking.record({
      eventType: "scroll_50",
      eventSource: "scroll",
      visitorId: "visitor_scroll",
      eventId: "scroll_50_evt",
      sourceUrl: "https://mister-b.test/",
      fbp: "fb.1.123.scroll",
    });

    expect(sendScrollDepth).not.toHaveBeenCalled();
    expect(sendPageView).not.toHaveBeenCalled();
    expect(sendSubscribe).not.toHaveBeenCalled();
    expect(sendContact).not.toHaveBeenCalled();
  });
});
