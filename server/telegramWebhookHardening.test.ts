import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

vi.mock("./db", () => ({
  // dedup
  tryRecordTelegramUpdateId: vi.fn(),
  // webhook funnel
  upsertTelegramLinkage: vi.fn().mockResolvedValue(undefined),
  upsertBotStart: vi.fn().mockResolvedValue(undefined),
  getTelegramLinkageByUserId: vi.fn().mockResolvedValue(undefined),
  getBotStartByTelegramUserId: vi.fn().mockResolvedValue(undefined),
  getTelegramJoinByUserId: vi.fn().mockResolvedValue(undefined),
  getUtmSessionByToken: vi.fn().mockResolvedValue(undefined),
  getLatestUtmSessionByFunnelToken: vi.fn().mockResolvedValue(undefined),
  insertTelegramJoin: vi.fn().mockResolvedValue(undefined),
  markBotStartJoined: vi.fn().mockResolvedValue(undefined),
  resolveTelegramLinkage: vi.fn().mockResolvedValue(undefined),
  createMetaEventLog: vi.fn().mockResolvedValue(undefined),
  updateMetaEventLog: vi.fn().mockResolvedValue(undefined),
  updateMetaEventStatus: vi.fn().mockResolvedValue(undefined),
  updateBotStartMetaStatus: vi.fn().mockResolvedValue(undefined),
  getAllJoins: vi.fn().mockResolvedValue([]),
  getSetting: vi.fn().mockResolvedValue(null),
}));

vi.mock("./metaCapi", () => ({
  fireSubscribeEvent: vi.fn(),
}));

vi.mock("./telegramBot", () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue({ ok: true, blocked: false, status: 200 }),
}));

vi.mock("./telegramAdminReports", () => ({
  buildTelegramAdminReportText: vi.fn(),
  isTelegramAdminAuthorized: vi.fn().mockResolvedValue(false),
}));

vi.mock("./telegramGroupLink", () => ({
  DEFAULT_TELEGRAM_GROUP_URL: "https://t.me/+test",
  getTelegramGroupUrl: vi.fn().mockResolvedValue("https://t.me/+test"),
  replaceTelegramGroupUrlInText: vi.fn((text: string) => text),
}));

vi.mock("./telegramReminders", () => ({
  scheduleTelegramReminderSequence: vi.fn().mockResolvedValue(undefined),
  skipPendingTelegramReminderJobs: vi.fn().mockResolvedValue(undefined),
}));

import {
  __resetWebhookDedupForTests,
  setupTelegramWebhook,
} from "./telegramWebhook";
import {
  createMetaEventLog,
  getTelegramJoinByUserId,
  insertTelegramJoin,
  tryRecordTelegramUpdateId,
  updateBotStartMetaStatus,
  updateMetaEventStatus,
} from "./db";
import { fireSubscribeEvent } from "./metaCapi";

function buildApp() {
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret-1234567890abcdef";
  __resetWebhookDedupForTests();

  const app = express();
  app.use(express.json());
  setupTelegramWebhook(app);

  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { server, baseUrl };
}

async function postUpdate(baseUrl: string, body: unknown, secret = "test-secret-1234567890abcdef") {
  return fetch(`${baseUrl}/api/telegram/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: JSON.stringify(body),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Telegram webhook hardening", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tryRecordTelegramUpdateId).mockResolvedValue(true);
    app = buildApp();
  });

  afterEach(() => {
    app.server.close();
  });

  it("rejects requests without the correct webhook secret (timing-safe)", async () => {
    const res = await postUpdate(app.baseUrl, { update_id: 1 }, "wrong-secret");
    expect(res.status).toBe(403);
  });

  it("dedupes via in-memory LRU even when the DB returns 'fresh'", async () => {
    // Even if the DB layer says fresh, the in-memory LRU should drop the second
    // delivery of the same update_id within the same process.
    vi.mocked(tryRecordTelegramUpdateId).mockResolvedValue(true);

    const update = {
      update_id: 999_001,
      message: {
        from: { id: 42, first_name: "Test", username: "tester" },
        chat: { id: 42, type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: "/start",
      },
    };

    await postUpdate(app.baseUrl, update);
    await postUpdate(app.baseUrl, update);
    await sleep(50);

    // tryRecordTelegramUpdateId is the DB layer; should be hit only once because
    // the in-memory LRU eats the duplicate.
    expect(vi.mocked(tryRecordTelegramUpdateId)).toHaveBeenCalledTimes(1);
  });

  it("fails closed when DB dedup throws an unexpected error (NOT 'table missing')", async () => {
    vi.mocked(tryRecordTelegramUpdateId).mockRejectedValueOnce(
      Object.assign(new Error("connection lost"), { errno: 2013 }),
    );

    const update = {
      update_id: 999_002,
      message: {
        from: { id: 50, first_name: "X" },
        chat: { id: 50, type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: "/start",
      },
    };

    await postUpdate(app.baseUrl, update);
    await sleep(50);

    // Critical: when dedup is unreliable, we must NOT continue processing.
    // upsertBotStart should never be called because we failed closed.
    const { upsertBotStart } = await import("./db");
    expect(vi.mocked(upsertBotStart)).not.toHaveBeenCalled();
  });

  it("continues (best-effort) when dedup table is missing (errno 1146) — relies on in-memory LRU", async () => {
    vi.mocked(tryRecordTelegramUpdateId).mockRejectedValueOnce(
      Object.assign(new Error("Table 'telegram_update_log' doesn't exist"), { errno: 1146 }),
    );

    const update = {
      update_id: 999_003,
      message: {
        from: { id: 60, first_name: "X" },
        chat: { id: 60, type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: "/start",
      },
    };

    await postUpdate(app.baseUrl, update);
    await sleep(50);

    // Migration not yet applied → degrade to in-memory dedup, keep processing.
    const { upsertBotStart } = await import("./db");
    expect(vi.mocked(upsertBotStart)).toHaveBeenCalledTimes(1);
  });

  it("does not fire Meta Subscribe on join (Subscribe fires on /start instead)", async () => {
    vi.mocked(getTelegramJoinByUserId).mockResolvedValue(undefined);

    const joinUpdate = {
      update_id: 999_010,
      chat_member: {
        chat: { id: -1003932081102, type: "supergroup", title: "Mister B" },
        from: { id: 7777, first_name: "Organic" },
        date: Math.floor(Date.now() / 1000),
        old_chat_member: { user: { id: 7777, first_name: "Organic" }, status: "left" },
        new_chat_member: { user: { id: 7777, first_name: "Organic" }, status: "member" },
      },
    };

    await postUpdate(app.baseUrl, joinUpdate);
    await sleep(100);

    // Subscribe is now /start-driven. Joins never call Meta directly — they
    // only insert the analytics row.
    expect(vi.mocked(fireSubscribeEvent)).not.toHaveBeenCalled();
    expect(vi.mocked(insertTelegramJoin)).toHaveBeenCalledTimes(1);
    // No legacy "abandoned" log row for bypass joins — that pattern is gone.
    expect(vi.mocked(createMetaEventLog)).not.toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "organic_bypass_skipped" }),
    );
  });

  it("mirrors the /start-time Meta event id onto the join row so dashboard JOINs to meta_event_logs still resolve", async () => {
    // Simulate: the user previously /started the bot and that Subscribe was
    // already sent. The join row should carry the same metaEventId so the
    // dashboard can correlate.
    const { getBotStartByTelegramUserId } = await import("./db");
    vi.mocked(getBotStartByTelegramUserId).mockResolvedValue({
      telegramUserId: "8888",
      metaSubscribeEventId: "tg_start_8888_1700000000",
      metaSubscribeStatus: "sent",
    } as any);
    vi.mocked(getTelegramJoinByUserId).mockResolvedValue(undefined);

    const date = Math.floor(Date.now() / 1000);
    const joinUpdate = {
      update_id: 999_020,
      chat_member: {
        chat: { id: -100, type: "supergroup", title: "Test" },
        from: { id: 8888, first_name: "Att" },
        date,
        old_chat_member: { user: { id: 8888 }, status: "left" },
        new_chat_member: { user: { id: 8888 }, status: "member" },
      },
    };

    await postUpdate(app.baseUrl, joinUpdate);
    await sleep(50);

    expect(vi.mocked(insertTelegramJoin)).toHaveBeenCalledTimes(1);
    const inserted = vi.mocked(insertTelegramJoin).mock.calls[0][0];
    expect(inserted.metaEventId).toBe("tg_start_8888_1700000000");
    expect(inserted.metaEventSent).toBe("sent");
  });
});
