import { tryAcquireLease } from "./_core/leaderLease";
import { log } from "./_core/logger";
import {
  claimNextBroadcast,
  getDueBroadcastJobs,
  markBroadcastJobBlocked,
  markBroadcastJobFailed,
  markBroadcastJobSent,
  refreshBroadcastCounters,
} from "./db";
import { sendTelegramMessage } from "./telegramBot";

// Telegram's published bulk-send safety zone is ~30 messages/sec to distinct
// users. Going higher risks a bot-wide flood-ban (HTTP 429 + retry_after) that
// would also block reminders and welcome messages. We aim for 20/sec to leave
// headroom for parallel reminder/admin traffic on the same bot token.
const WORKER_NAME = "broadcast";
const WORKER_INTERVAL_MS = 1_000;
const MESSAGES_PER_TICK = 20;
// Refresh broadcast counters every Nth tick to keep the dashboard live without
// hammering the DB. With one tick/sec, every 5 ticks = once every 5 seconds.
const COUNTER_REFRESH_EVERY_TICKS = 5;

let workerStarted = false;
let workerInterval: NodeJS.Timeout | null = null;
let workerRunning = false;
let tickCount = 0;

async function processOneTick() {
  const broadcast = await claimNextBroadcast();
  if (!broadcast) return;

  const jobs = await getDueBroadcastJobs(broadcast.id, MESSAGES_PER_TICK);
  if (jobs.length === 0) {
    // No pending jobs left — recompute counters which will mark the broadcast
    // as completed if remainingCount=0.
    await refreshBroadcastCounters(broadcast.id);
    return;
  }

  // Send sequentially within the tick so we never burst above MESSAGES_PER_TICK
  // per second. Telegram rate-limits per-bot, not per-recipient, so parallelism
  // doesn't help and only risks hitting the burst ceiling.
  for (const job of jobs) {
    const result = await sendTelegramMessage(job.chatId, broadcast.messageText);

    if (result.ok) {
      await markBroadcastJobSent(job.id);
    } else if (result.blocked) {
      await markBroadcastJobBlocked(job.id, job.telegramUserId, result.description || "blocked");
    } else if (result.status === 429) {
      // Flood-banned: stop this tick early. The next tick (1s later) will
      // resume; remaining jobs stay 'pending' and get retried automatically.
      log.warn("broadcastWorker", "rate_limited", {
        broadcastId: broadcast.id,
        description: result.description,
      });
      break;
    } else {
      await markBroadcastJobFailed(job.id, result.description || `status ${result.status}`);
    }
  }

  if (tickCount % COUNTER_REFRESH_EVERY_TICKS === 0 || jobs.length < MESSAGES_PER_TICK) {
    await refreshBroadcastCounters(broadcast.id);
  }
}

export async function processOneBroadcastTick() {
  // Exposed for tests; mirrors the in-worker tick body.
  await processOneTick();
}

export function startBroadcastWorker() {
  if (workerStarted) return;
  workerStarted = true;

  const run = async () => {
    if (workerRunning) return;
    workerRunning = true;
    tickCount += 1;

    try {
      const isLeader = await tryAcquireLease(WORKER_NAME);
      if (!isLeader) return;
      await processOneTick();
    } catch (error) {
      log.error("broadcastWorker", "worker_error", {
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

export function stopBroadcastWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  workerStarted = false;
  workerRunning = false;
}
