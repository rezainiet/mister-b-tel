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

  it("skips Meta Subscribe entirely for bypass joins (no /start, no session)", async () => {
    // Setup: getTelegramJoinByUserId returns undefined for the existence check,
    // then returns the inserted row on the post-insert read.
    vi.mocked(getTelegramJoinByUserId)
      .mockResolvedValueOnce(undefined) // existence check
      .mockResolvedValueOnce({ id: 99 } as any); // post-insert lookup

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

    // Subscribe must NOT be fired for organic bypass joins.
    expect(vi.mocked(fireSubscribeEvent)).not.toHaveBeenCalled();

    // But the abandoned log row must exist for visibility.
    const logCall = vi.mocked(createMetaEventLog).mock.calls.find(
      (c) => c[0].errorCode === "organic_bypass_skipped",
    );
    expect(logCall).toBeTruthy();
    expect(logCall![0].status).toBe("abandoned");

    // Status helpers must mark the join + bot_start as abandoned (not pending).
    expect(vi.mocked(updateMetaEventStatus)).toHaveBeenCalledWith(99, "abandoned", undefined);
    expect(vi.mocked(updateBotStartMetaStatus)).toHaveBeenCalledWith("7777", "abandoned", undefined);
  });

  it("uses a deterministic event_id for joins so duplicate webhook bursts collapse to one Meta event", async () => {
    // Two consecutive deliveries of the same join (different update_ids, same
    // user/channel/date) should produce identical event_ids if they reached
    // handleNewMember (LRU prevents real second processing).
    vi.mocked(getTelegramJoinByUserId)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 1 } as any);

    const date = Math.floor(Date.now() / 1000);
    const joinUpdate = (updateId: number) => ({
      update_id: updateId,
      chat_member: {
        chat: { id: -100, type: "supergroup", title: "Test" },
        from: { id: 8888, first_name: "Att" },
        date,
        old_chat_member: { user: { id: 8888 }, status: "left" },
        new_chat_member: { user: { id: 8888 }, status: "member" },
      },
    });

    await postUpdate(app.baseUrl, joinUpdate(999_020));
    await sleep(50);

    // The deterministic event_id format is `tg_join_<user>_<channel>_<date>`.
    expect(vi.mocked(insertTelegramJoin)).toHaveBeenCalledTimes(1);
    const inserted = vi.mocked(insertTelegramJoin).mock.calls[0][0];
    expect(inserted.metaEventId).toBe(`tg_join_8888_-100_${date}`);
  });
});
