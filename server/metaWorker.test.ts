import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getRetryableMetaEvents: vi.fn(),
  updateBotStartMetaStatus: vi.fn(),
  updateMetaEventLog: vi.fn(),
  updateTelegramJoinMetaStatusByEventId: vi.fn(),
}));

vi.mock("./metaCapi", () => ({
  retryStoredMetaRequest: vi.fn(),
}));

import { processOneMetaRetryBatch } from "./metaWorker";
import {
  getRetryableMetaEvents,
  updateBotStartMetaStatus,
  updateMetaEventLog,
  updateTelegramJoinMetaStatusByEventId,
} from "./db";
import { retryStoredMetaRequest } from "./metaCapi";

describe("metaWorker.processOneMetaRetryBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks a successful retry as 'sent' and propagates to bot_starts and telegram_joins", async () => {
    vi.mocked(getRetryableMetaEvents).mockResolvedValue([
      {
        id: 1,
        eventScope: "telegram_join",
        eventId: "tg_join_42_-100123_1700000000",
        attemptCount: 1,
        telegramUserId: "42",
        requestPayloadJson: JSON.stringify({ data: [{ event_name: "Subscribe" }] }),
      } as any,
    ]);

    vi.mocked(retryStoredMetaRequest).mockResolvedValue({
      success: true,
      eventId: "tg_join_42_-100123_1700000000",
      retryable: false,
      requestBody: { data: [{}] },
      responseBody: { events_received: 1 },
      httpStatus: 200,
    } as any);

    const result = await processOneMetaRetryBatch(10);
    expect(result.sent).toBe(1);
    expect(updateMetaEventLog).toHaveBeenCalledWith(
      "tg_join_42_-100123_1700000000",
      expect.objectContaining({ status: "sent", attemptCount: 2 }),
    );
    expect(updateBotStartMetaStatus).toHaveBeenCalledWith(
      "42",
      "sent",
      "tg_join_42_-100123_1700000000",
    );
    expect(updateTelegramJoinMetaStatusByEventId).toHaveBeenCalledWith(
      "tg_join_42_-100123_1700000000",
      "sent",
    );
  });

  it("marks a retryable failure under the attempt cap as 'retrying' and schedules nextRetryAt", async () => {
    vi.mocked(getRetryableMetaEvents).mockResolvedValue([
      {
        id: 2,
        eventScope: "pageview",
        eventId: "pv_xyz",
        attemptCount: 1,
        telegramUserId: null,
        requestPayloadJson: JSON.stringify({ data: [{ event_name: "PageView" }] }),
      } as any,
    ]);

    vi.mocked(retryStoredMetaRequest).mockResolvedValue({
      success: false,
      eventId: "pv_xyz",
      retryable: true,
      httpStatus: 503,
      errorMessage: "service unavailable",
      errorCode: "1",
    } as any);

    await processOneMetaRetryBatch(10);
    expect(updateMetaEventLog).toHaveBeenCalledWith(
      "pv_xyz",
      expect.objectContaining({
        status: "retrying",
        attemptCount: 2,
        nextRetryAt: expect.any(Date),
        retryable: 1,
      }),
    );
    // Pageview events have no telegram user, so the per-user updates should be skipped.
    expect(updateBotStartMetaStatus).not.toHaveBeenCalled();
    expect(updateTelegramJoinMetaStatusByEventId).not.toHaveBeenCalled();
  });

  it("marks a retryable failure as 'abandoned' once attempt cap is reached", async () => {
    vi.mocked(getRetryableMetaEvents).mockResolvedValue([
      {
        id: 3,
        eventScope: "telegram_join",
        eventId: "tg_join_99",
        attemptCount: 14, // next attempt = 15 = MAX_ATTEMPTS cap
        telegramUserId: "99",
        requestPayloadJson: JSON.stringify({ data: [{}] }),
      } as any,
    ]);

    vi.mocked(retryStoredMetaRequest).mockResolvedValue({
      success: false,
      eventId: "tg_join_99",
      retryable: true,
      httpStatus: 500,
      errorMessage: "still down",
    } as any);

    const result = await processOneMetaRetryBatch(10);
    expect(result.abandoned).toBe(1);
    expect(updateMetaEventLog).toHaveBeenCalledWith(
      "tg_join_99",
      expect.objectContaining({ status: "abandoned" }),
    );
  });

  it("marks a non-retryable failure as 'failed' immediately", async () => {
    vi.mocked(getRetryableMetaEvents).mockResolvedValue([
      {
        id: 4,
        eventScope: "pageview",
        eventId: "pv_bad_token",
        attemptCount: 0,
        telegramUserId: null,
        requestPayloadJson: JSON.stringify({ data: [{}] }),
      } as any,
    ]);

    vi.mocked(retryStoredMetaRequest).mockResolvedValue({
      success: false,
      eventId: "pv_bad_token",
      retryable: false,
      httpStatus: 400,
      errorMessage: "invalid token",
    } as any);

    const result = await processOneMetaRetryBatch(10);
    expect(result.failed).toBe(1);
    expect(updateMetaEventLog).toHaveBeenCalledWith(
      "pv_bad_token",
      expect.objectContaining({ status: "failed", retryable: 0 }),
    );
  });
});
