import express from "express";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import {
  getAllJoins,
  getBotStartByTelegramUserId,
  getRecentMetaEventLogs,
  getTelegramJoinByUserId,
} from "./db";

const {
  sendTelegramMessageMock,
  scheduleTelegramReminderSequenceMock,
  skipPendingTelegramReminderJobsMock,
  fireSubscribeEventMock,
} = vi.hoisted(() => ({
  sendTelegramMessageMock: vi.fn().mockResolvedValue({ ok: true }),
  scheduleTelegramReminderSequenceMock: vi.fn().mockResolvedValue(undefined),
  skipPendingTelegramReminderJobsMock: vi.fn().mockResolvedValue(undefined),
  fireSubscribeEventMock: vi.fn(),
}));

vi.mock("./telegramBot", () => ({
  sendTelegramMessage: sendTelegramMessageMock,
}));

vi.mock("./telegramReminders", () => ({
  scheduleTelegramReminderSequence: scheduleTelegramReminderSequenceMock,
  skipPendingTelegramReminderJobs: skipPendingTelegramReminderJobsMock,
}));

vi.mock("./metaCapi", async () => {
  const actual = await vi.importActual<typeof import("./metaCapi")>("./metaCapi");
  return {
    ...actual,
    fireSubscribeEvent: fireSubscribeEventMock,
  };
});

function buildCaller() {
  return appRouter.createCaller({
    req: {
      headers: {
        "user-agent": "vitest-telegram-webhook",
        "x-forwarded-for": "203.0.113.20",
      },
      socket: { remoteAddress: "203.0.113.20" },
    } as any,
    res: {} as any,
    user: null,
  });
}

async function bootWebhookApp() {
  vi.resetModules();
  const { setupTelegramWebhook } = await import("./telegramWebhook");
  const app = express();
  app.use(express.json());
  setupTelegramWebhook(app);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  const { port } = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

async function postTelegramUpdate(baseUrl: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api/telegram/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET || "",
    },
    body: JSON.stringify(body),
  });

  expect(response.status).toBe(200);
}

async function waitForValue<T>(loader: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 5_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await loader();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return loader();
}

describe("telegram webhook durable funnel flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
  });

  it("preserves attribution across repeat /start, links the join durably, and ignores duplicate join delivery", async () => {
    fireSubscribeEventMock.mockResolvedValue({
      success: true,
      eventId: "join_success_event",
      httpStatus: 200,
      requestBody: { ok: true },
      responseBody: { events_received: 1 },
      retryable: false,
    });

    const caller = buildCaller();
    const created = await caller.tracking.createSession({
      utmSource: "facebook",
      utmMedium: "cpc",
      utmCampaign: `campaign_${Date.now()}`,
      utmContent: "creative_test",
      utmTerm: "landing",
      fbclid: `fbclid_${Date.now()}`,
      fbp: "fb.1.1700000000000.1234567890",
      landingPage: "https://mister-b.club/?utm_source=facebook",
      referrer: "https://facebook.com",
      isMobile: true,
    });

    const telegramUserId = String(910000000 + (Date.now() % 1_000_000));
    const channelId = "-1002003004001";
    const { server, baseUrl } = await bootWebhookApp();

    try {
      await postTelegramUpdate(baseUrl, {
        update_id: Number(Date.now()),
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          text: `/start ${created.payload}`,
          from: {
            id: Number(telegramUserId),
            is_bot: false,
            first_name: "Start",
            username: `user_${telegramUserId}`,
          },
          chat: {
            id: Number(telegramUserId),
            type: "private",
          },
        },
      });

      const started = await waitForValue(
        () => getBotStartByTelegramUserId(telegramUserId),
        (value) => Boolean(value?.sessionToken),
      );
      expect(started?.sessionToken).toBe(created.sessionToken);
      expect(started?.funnelToken).toBe(created.funnelToken);
      expect(started?.fbclid).toBeTruthy();
      expect(started?.attributionStatus).toBe("attributed_start");

      await postTelegramUpdate(baseUrl, {
        update_id: Number(Date.now()) + 1,
        message: {
          message_id: 2,
          date: Math.floor(Date.now() / 1000) + 1,
          text: "/start",
          from: {
            id: Number(telegramUserId),
            is_bot: false,
            first_name: "Start",
            username: `user_${telegramUserId}`,
          },
          chat: {
            id: Number(telegramUserId),
            type: "private",
          },
        },
      });

      const repeated = await waitForValue(
        () => getBotStartByTelegramUserId(telegramUserId),
        (value) => value?.sessionToken === created.sessionToken && value?.funnelToken === created.funnelToken,
      );
      expect(repeated?.sessionToken).toBe(created.sessionToken);
      expect(repeated?.funnelToken).toBe(created.funnelToken);
      expect(repeated?.fbclid).toBe(started?.fbclid);
      expect(repeated?.attributionStatus).toBe("attributed_start");

      const joinTimestamp = Math.floor(Date.now() / 1000) + 5;

      await postTelegramUpdate(baseUrl, {
        update_id: Number(Date.now()) + 2,
        chat_member: {
          chat: {
            id: Number(channelId),
            title: "Mister B Group",
            type: "supergroup",
          },
          from: {
            id: Number(telegramUserId),
            is_bot: false,
            first_name: "Start",
            username: `user_${telegramUserId}`,
          },
          date: joinTimestamp,
          old_chat_member: {
            user: {
              id: Number(telegramUserId),
              is_bot: false,
              first_name: "Start",
              username: `user_${telegramUserId}`,
            },
            status: "left",
          },
          new_chat_member: {
            user: {
              id: Number(telegramUserId),
              is_bot: false,
              first_name: "Start",
              username: `user_${telegramUserId}`,
            },
            status: "member",
          },
        },
      });

      const join = await waitForValue(
        () => getTelegramJoinByUserId(telegramUserId, channelId),
        (value) => Boolean(value?.sessionToken),
      );
      expect(join?.sessionToken).toBe(created.sessionToken);
      expect(join?.funnelToken).toBe(created.funnelToken);
      expect(join?.fbclid).toBe(started?.fbclid);
      expect(join?.attributionStatus).toBe("attributed_join");

      const joinLog = await waitForValue(
        async () => {
          const logs = await getRecentMetaEventLogs(20);
          return logs.find((row) => row.eventScope === "telegram_join" && row.telegramUserId === telegramUserId);
        },
        (value) => value?.status === "sent",
      );
      expect(joinLog?.status).toBe("sent");

      const joinsBeforeDuplicate = (await getAllJoins(200)).filter(
        (row) => row.telegramUserId === telegramUserId && row.channelId === channelId,
      ).length;

      await postTelegramUpdate(baseUrl, {
        update_id: Number(Date.now()) + 3,
        chat_member: {
          chat: {
            id: Number(channelId),
            title: "Mister B Group",
            type: "supergroup",
          },
          from: {
            id: Number(telegramUserId),
            is_bot: false,
            first_name: "Start",
            username: `user_${telegramUserId}`,
          },
          date: joinTimestamp + 1,
          old_chat_member: {
            user: {
              id: Number(telegramUserId),
              is_bot: false,
              first_name: "Start",
              username: `user_${telegramUserId}`,
            },
            status: "left",
          },
          new_chat_member: {
            user: {
              id: Number(telegramUserId),
              is_bot: false,
              first_name: "Start",
              username: `user_${telegramUserId}`,
            },
            status: "member",
          },
        },
      });

      const joinsAfterDuplicate = (await getAllJoins(200)).filter(
        (row) => row.telegramUserId === telegramUserId && row.channelId === channelId,
      ).length;
      expect(joinsAfterDuplicate).toBe(joinsBeforeDuplicate);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }, 30_000);

  it("stores retryable Meta failure details durably on join attempts", async () => {
    fireSubscribeEventMock.mockResolvedValue({
      success: false,
      eventId: "join_retry_event",
      httpStatus: 503,
      requestBody: { ok: false },
      responseBody: { error: { message: "temporary outage" } },
      errorCode: "service_unavailable",
      errorMessage: "temporary outage",
      retryable: true,
    });

    const caller = buildCaller();
    const created = await caller.tracking.createSession({
      utmSource: "google",
      utmMedium: "organic",
      utmCampaign: `organic_${Date.now()}`,
      landingPage: "https://mister-b.club/",
      isMobile: true,
    });

    const telegramUserId = String(920000000 + (Date.now() % 1_000_000));
    const channelId = "-1002003004002";
    const { server, baseUrl } = await bootWebhookApp();

    try {
      await postTelegramUpdate(baseUrl, {
        update_id: Number(Date.now()) + 10,
        message: {
          message_id: 11,
          date: Math.floor(Date.now() / 1000),
          text: `/start ${created.payload}`,
          from: {
            id: Number(telegramUserId),
            is_bot: false,
            first_name: "Retry",
            username: `user_${telegramUserId}`,
          },
          chat: {
            id: Number(telegramUserId),
            type: "private",
          },
        },
      });

      await postTelegramUpdate(baseUrl, {
        update_id: Number(Date.now()) + 11,
        chat_member: {
          chat: {
            id: Number(channelId),
            title: "Retry Group",
            type: "supergroup",
          },
          from: {
            id: Number(telegramUserId),
            is_bot: false,
            first_name: "Retry",
            username: `user_${telegramUserId}`,
          },
          date: Math.floor(Date.now() / 1000) + 3,
          old_chat_member: {
            user: {
              id: Number(telegramUserId),
              is_bot: false,
              first_name: "Retry",
              username: `user_${telegramUserId}`,
            },
            status: "left",
          },
          new_chat_member: {
            user: {
              id: Number(telegramUserId),
              is_bot: false,
              first_name: "Retry",
              username: `user_${telegramUserId}`,
            },
            status: "member",
          },
        },
      });

      const retryLog = await waitForValue(
        async () => {
          const logs = await getRecentMetaEventLogs(30);
          return logs.find((row) => row.eventScope === "telegram_join" && row.telegramUserId === telegramUserId);
        },
        (value) => value?.status === "retrying",
      );
      expect(retryLog?.status).toBe("retrying");
      expect(retryLog?.retryable).toBe(1);
      expect(retryLog?.httpStatus).toBe(503);
      expect(retryLog?.errorMessage).toContain("temporary outage");
      expect(retryLog?.nextRetryAt).toBeTruthy();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }, 30_000);
});
