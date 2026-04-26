import { tryAcquireLease } from "./_core/leaderLease";
import { log } from "./_core/logger";
import {
  getRetryableMetaEvents,
  updateBotStartMetaStatus,
  updateMetaEventLog,
  updateTelegramJoinMetaStatusByEventId,
} from "./db";
import { retryStoredMetaRequest } from "./metaCapi";

const WORKER_NAME = "meta_retry";

const WORKER_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5 * 60 * 1000;

let workerStarted = false;
let workerInterval: NodeJS.Timeout | null = null;
let workerRunning = false;

function backoffMs(nextAttempt: number) {
  // 5m, 10m, 20m, 40m, 80m... with full jitter to avoid thundering herd.
  const exponential = BASE_BACKOFF_MS * Math.pow(2, Math.max(0, nextAttempt - 1));
  const capped = Math.min(exponential, 6 * 60 * 60 * 1000); // cap at 6h
  return Math.floor(Math.random() * capped) + Math.floor(capped / 2);
}

export async function processOneMetaRetryBatch(limit = 10) {
  const candidates = await getRetryableMetaEvents(limit);
  let sent = 0;
  let failed = 0;
  let abandoned = 0;

  for (const candidate of candidates) {
    const nextAttempt = (candidate.attemptCount || 0) + 1;
    let result;
    try {
      result = await retryStoredMetaRequest(candidate.eventId, candidate.requestPayloadJson);
    } catch (error) {
      log.error("metaWorker", "retry_threw", {
        eventId: candidate.eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      result = {
        success: false,
        eventId: candidate.eventId,
        errorCode: "worker_exception",
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: true,
      } as const;
    }

    let status: "sent" | "failed" | "abandoned" | "retrying";
    if (result.success) {
      status = "sent";
      sent += 1;
    } else if (result.retryable && nextAttempt < MAX_ATTEMPTS) {
      status = "retrying";
    } else if (result.retryable) {
      status = "abandoned";
      abandoned += 1;
    } else {
      status = "failed";
      failed += 1;
    }

    await updateMetaEventLog(candidate.eventId, {
      status,
      requestPayloadJson: result.requestBody
        ? JSON.stringify(result.requestBody)
        : candidate.requestPayloadJson,
      responsePayloadJson: result.responseBody ? JSON.stringify(result.responseBody) : null,
      httpStatus: result.httpStatus ?? null,
      errorCode: result.errorCode ?? null,
      errorSubcode: result.errorSubcode ?? null,
      errorMessage: result.errorMessage ?? null,
      retryable: result.retryable ? 1 : 0,
      attemptCount: nextAttempt,
      attemptedAt: new Date(),
      completedAt: result.success ? new Date() : null,
      nextRetryAt: status === "retrying" ? new Date(Date.now() + backoffMs(nextAttempt)) : null,
    });

    if (candidate.telegramUserId) {
      try {
        await updateBotStartMetaStatus(candidate.telegramUserId, status, result.eventId);
      } catch (error) {
        log.error("metaWorker", "bot_start_status_update_failed", {
          eventId: candidate.eventId,
          telegramUserId: candidate.telegramUserId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (candidate.eventScope === "telegram_join") {
      try {
        await updateTelegramJoinMetaStatusByEventId(candidate.eventId, status);
      } catch (error) {
        log.error("metaWorker", "telegram_join_status_update_failed", {
          eventId: candidate.eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    log.info("metaWorker", "retry_processed", {
      eventId: candidate.eventId,
      eventScope: candidate.eventScope,
      attempt: nextAttempt,
      status,
      httpStatus: result.httpStatus ?? null,
    });
  }

  return {
    processed: candidates.length,
    sent,
    failed,
    abandoned,
  };
}

export function startMetaRetryWorker() {
  if (workerStarted) return;
  if (process.env.WORKERS_ENABLED && process.env.WORKERS_ENABLED.toLowerCase() === "false") {
    log.info("metaWorker", "disabled_by_env");
    return;
  }
  workerStarted = true;

  const run = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      const isLeader = await tryAcquireLease(WORKER_NAME);
      if (!isLeader) {
        log.info("metaWorker", "skip_tick_not_leader");
        return;
      }
      await processOneMetaRetryBatch();
    } catch (error) {
      log.error("metaWorker", "tick_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      workerRunning = false;
    }
  };

  void run();
  workerInterval = setInterval(() => {
    void run();
  }, WORKER_INTERVAL_MS);
}

export function stopMetaRetryWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  workerStarted = false;
  workerRunning = false;
}
