import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { botStarts, telegramReminderJobs } from "../drizzle/schema";
import { tryAcquireLease } from "./_core/leaderLease";
import { log } from "./_core/logger";
import { getDb, getSetting } from "./db";
import { sendTelegramMessage } from "./telegramBot";
import { DEFAULT_TELEGRAM_GROUP_URL, getTelegramGroupUrl } from "./telegramGroupLink";

const WORKER_NAME = "telegram_reminders";

const TELEGRAM_DIRECT_CONTACT = "@MisterBNMB";
const TELEGRAM_DIRECT_CONTACT_LINE = `Tu peux aussi me contacter directement : ${TELEGRAM_DIRECT_CONTACT}`;
const WORKER_INTERVAL_MS = 60_000;
const PROCESS_BATCH_SIZE = 25;

export const TELEGRAM_REMINDER_STEPS = [
  {
    key: "15m",
    settingKey: "telegram_reminder_15m_message",
    delaySettingKey: "telegram_reminder_15m_delay_min",
    label: "Reminder 1 (15 min)",
    description: "First reminder if not joined.",
    defaultDelayMin: 15,
    defaultTemplate: "Je te renvoie l’accès au canal privé Mister B. Tu y retrouveras les nouveautés, les infos réservées et le contenu partagé en privé. Rejoins-le maintenant ici → {group_url}",
  },
  {
    key: "1h",
    settingKey: "telegram_reminder_1h_message",
    delaySettingKey: "telegram_reminder_1h_delay_min",
    label: "Reminder 2 (1 h)",
    description: "Second reminder if not joined.",
    defaultDelayMin: 60,
    defaultTemplate: "Je me permets de te renvoyer le lien du canal privé Mister B au cas où tu n’aurais pas eu le temps tout à l’heure. L’accès est toujours disponible ici → {group_url}",
  },
  {
    key: "4h",
    settingKey: "telegram_reminder_4h_message",
    delaySettingKey: "telegram_reminder_4h_delay_min",
    label: "Reminder 3 (4 h)",
    description: "Third reminder if not joined.",
    defaultDelayMin: 4 * 60,
    defaultTemplate: "Le canal privé Mister B est toujours ouvert pour toi. Si tu veux voir les nouveautés et le contenu réservé, tu peux le rejoindre directement ici → {group_url}",
  },
  {
    key: "24h",
    settingKey: "telegram_reminder_24h_message",
    delaySettingKey: "telegram_reminder_24h_delay_min",
    label: "Reminder 4 (24 h)",
    description: "24h reminder after /start.",
    defaultDelayMin: 24 * 60,
    defaultTemplate: "Petit rappel : si tu n’as pas encore rejoint le canal privé Mister B, ton accès est toujours disponible. Tu peux entrer directement ici → {group_url}",
  },
  {
    key: "1w",
    settingKey: "telegram_reminder_1w_message",
    delaySettingKey: "telegram_reminder_1w_delay_min",
    label: "Reminder 5 (1 week)",
    description: "Weekly nudge if still not joined.",
    defaultDelayMin: 7 * 24 * 60,
    defaultTemplate: "Je te renvoie l’accès au canal privé Mister B pour cette semaine. Si tu voulais rejoindre mais que tu as repoussé, c’est le bon moment pour entrer → {group_url}",
  },
  {
    key: "2w",
    settingKey: "telegram_reminder_2w_message",
    delaySettingKey: "telegram_reminder_2w_delay_min",
    label: "Reminder 6 (2 weeks)",
    description: "Two-week nudge if still not joined.",
    defaultDelayMin: 14 * 24 * 60,
    defaultTemplate: "Je reviens vers toi avec le lien du canal privé Mister B. Si tu es toujours intéressé, tu peux rejoindre l’espace privé ici → {group_url}",
  },
  {
    key: "1m",
    settingKey: "telegram_reminder_1m_message",
    delaySettingKey: "telegram_reminder_1m_delay_min",
    label: "Reminder 7 (1 month)",
    description: "Final monthly reminder.",
    defaultDelayMin: 30 * 24 * 60,
    defaultTemplate: "Dernier rappel de ma part : si tu veux encore accéder au canal privé Mister B et aux infos réservées, voici le lien direct → {group_url}",
  },
] as const;

export type TelegramReminderStep = (typeof TELEGRAM_REMINDER_STEPS)[number];

const REMINDER_DELAY_MIN = 1; // minutes
const REMINDER_DELAY_MAX = 60 * 24 * 365; // 1 year cap (sanity)

function parseDelayMinutes(raw: string | null, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.max(REMINDER_DELAY_MIN, Math.min(REMINDER_DELAY_MAX, Math.floor(parsed)));
  return clamped;
}

export function isValidReminderDelayMinutes(value: number) {
  return Number.isFinite(value) && value >= REMINDER_DELAY_MIN && value <= REMINDER_DELAY_MAX;
}

export const TELEGRAM_REMINDER_DELAY_BOUNDS = {
  min: REMINDER_DELAY_MIN,
  max: REMINDER_DELAY_MAX,
} as const;

type ReminderTemplateContext = {
  firstName?: string | null;
  groupUrl?: string;
};

type BuildReminderDraftsInput = {
  telegramUserId: string;
  chatId: string;
  firstName?: string | null;
  startedAt?: Date;
};

let workerStarted = false;
let workerInterval: NodeJS.Timeout | null = null;
let workerRunning = false;

export function renderTelegramReminderMessage(template: string, context: ReminderTemplateContext = {}) {
  const firstName = (context.firstName || "").trim() || "toi";
  const groupUrl = context.groupUrl || DEFAULT_TELEGRAM_GROUP_URL;

  const renderedMessage = template
    .replaceAll("{first_name}", firstName)
    .replaceAll("{firstName}", firstName)
    .replaceAll("{group_url}", groupUrl)
    .replaceAll("{groupLink}", groupUrl)
    .replaceAll("{brand}", "Mister B")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();

  if (renderedMessage.includes(TELEGRAM_DIRECT_CONTACT)) {
    return renderedMessage;
  }

  return `${renderedMessage}\n\n${TELEGRAM_DIRECT_CONTACT_LINE}`.trim();
}

// Render the welcome message with the same variable substitution as reminders
// (first name + group URL aliases) AND apply the same URL-rewrite the
// admin's link-editor performs, so legacy welcome messages stored before this
// change still update when the group URL changes.
export function renderTelegramWelcomeMessage(template: string, context: ReminderTemplateContext = {}) {
  const groupUrl = context.groupUrl || DEFAULT_TELEGRAM_GROUP_URL;
  const firstName = (context.firstName || "").trim() || "toi";

  return template
    .replaceAll("{first_name}", firstName)
    .replaceAll("{firstName}", firstName)
    .replaceAll("{group_url}", groupUrl)
    .replaceAll("{groupLink}", groupUrl)
    .replaceAll("{brand}", "Mister B")
    .trim();
}

export type ResolvedReminderStep = TelegramReminderStep & {
  template: string;
  delayMs: number;
  delayMin: number;
};

export async function getResolvedReminderSteps(): Promise<ResolvedReminderStep[]> {
  return Promise.all(
    TELEGRAM_REMINDER_STEPS.map(async (step) => {
      const [storedTemplate, storedDelay] = await Promise.all([
        getSetting(step.settingKey),
        getSetting(step.delaySettingKey),
      ]);
      const delayMin = parseDelayMinutes(storedDelay, step.defaultDelayMin);
      return {
        ...step,
        template: storedTemplate || step.defaultTemplate,
        delayMin,
        delayMs: delayMin * 60 * 1000,
      } satisfies ResolvedReminderStep;
    }),
  );
}

export async function buildTelegramReminderDrafts(input: BuildReminderDraftsInput) {
  const startedAt = input.startedAt || new Date();
  const [steps, groupUrl] = await Promise.all([getResolvedReminderSteps(), getTelegramGroupUrl()]);

  return steps.map((step) => ({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    reminderKey: step.key,
    messageText: renderTelegramReminderMessage(step.template, {
      firstName: input.firstName,
      groupUrl,
    }),
    dueAt: new Date(startedAt.getTime() + step.delayMs),
  }));
}

function mapLegacyReminderUpdate(reminderKey: string) {
  const now = new Date();

  if (reminderKey === "15m") {
    return {
      reminderSent: "sent" as const,
      reminderSentAt: now,
    };
  }

  if (reminderKey === "1h") {
    return {
      reminder2Sent: "sent" as const,
      reminder2SentAt: now,
    };
  }

  if (reminderKey === "4h") {
    return {
      reminder3Sent: "sent" as const,
      reminder3SentAt: now,
    };
  }

  return null;
}

async function markLegacyReminderSent(telegramUserId: string, reminderKey: string) {
  const db = await getDb();
  if (!db) return;

  const legacyUpdate = mapLegacyReminderUpdate(reminderKey);
  if (!legacyUpdate) return;

  await db.update(botStarts).set(legacyUpdate).where(eq(botStarts.telegramUserId, telegramUserId));
}

export async function scheduleTelegramReminderSequence(input: BuildReminderDraftsInput) {
  const db = await getDb();
  if (!db) return;

  const drafts = await buildTelegramReminderDrafts(input);

  // Delete + insert run inside a single transaction so two concurrent /start
  // events for the same user can't interleave their delete-then-insert and
  // produce duplicate reminder jobs (the previous flow was racy).
  await db.transaction(async (tx) => {
    await tx
      .delete(telegramReminderJobs)
      .where(
        and(
          eq(telegramReminderJobs.telegramUserId, input.telegramUserId),
          or(
            eq(telegramReminderJobs.status, "pending"),
            eq(telegramReminderJobs.status, "processing"),
            eq(telegramReminderJobs.status, "failed"),
          ),
        ),
      );

    await tx.insert(telegramReminderJobs).values(drafts);
  });
}

export async function skipPendingTelegramReminderJobs(
  telegramUserId: string,
  reason: "joined_group" | "bot_blocked" | "rescheduled" | "manual_skip",
) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(telegramReminderJobs)
    .set({
      status: "skipped",
      skippedReason: reason,
      skippedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(telegramReminderJobs.telegramUserId, telegramUserId),
        or(eq(telegramReminderJobs.status, "pending"), eq(telegramReminderJobs.status, "processing")),
      ),
    );
}

async function getDueTelegramReminderJobs(limit = PROCESS_BATCH_SIZE) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(telegramReminderJobs)
    .where(and(eq(telegramReminderJobs.status, "pending"), lte(telegramReminderJobs.dueAt, new Date())))
    .orderBy(asc(telegramReminderJobs.dueAt), asc(telegramReminderJobs.id))
    .limit(limit);
}

async function markJobProcessing(jobId: number) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(telegramReminderJobs)
    .set({
      status: "processing",
      attempts: sql`${telegramReminderJobs.attempts} + 1`,
      lastAttemptAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(telegramReminderJobs.id, jobId));
}

async function markJobSent(jobId: number) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(telegramReminderJobs)
    .set({
      status: "sent",
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(telegramReminderJobs.id, jobId));
}

async function markJobSkipped(jobId: number, reason: string) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(telegramReminderJobs)
    .set({
      status: "skipped",
      skippedReason: reason,
      skippedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(telegramReminderJobs.id, jobId));
}

async function markJobFailed(jobId: number, reason?: string) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(telegramReminderJobs)
    .set({
      status: "failed",
      skippedReason: reason || null,
      failedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(telegramReminderJobs.id, jobId));
}

async function markBotBlocked(telegramUserId: string) {
  const db = await getDb();
  if (!db) return;

  await db.update(botStarts).set({ botBlocked: 1 }).where(eq(botStarts.telegramUserId, telegramUserId));
}

async function getBotStartState(telegramUserId: string) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select({
      telegramUserId: botStarts.telegramUserId,
      joinedAt: botStarts.joinedAt,
      botBlocked: botStarts.botBlocked,
    })
    .from(botStarts)
    .where(eq(botStarts.telegramUserId, telegramUserId))
    .limit(1);

  return rows[0] || null;
}

export async function processDueTelegramReminderJobs() {
  const jobs = await getDueTelegramReminderJobs();

  for (const job of jobs) {
    await markJobProcessing(job.id);

    const botStartState = await getBotStartState(job.telegramUserId);

    if (!botStartState) {
      await markJobSkipped(job.id, "missing_bot_start");
      continue;
    }

    if (botStartState.joinedAt) {
      await markJobSkipped(job.id, "joined_group");
      continue;
    }

    if (botStartState.botBlocked) {
      await markJobSkipped(job.id, "bot_blocked");
      continue;
    }

    const result = await sendTelegramMessage(job.chatId, job.messageText);

    if (result.ok) {
      await markJobSent(job.id);
      await markLegacyReminderSent(job.telegramUserId, job.reminderKey);
      continue;
    }

    if (result.blocked) {
      await markBotBlocked(job.telegramUserId);
      await skipPendingTelegramReminderJobs(job.telegramUserId, "bot_blocked");
      await markJobFailed(job.id, result.description);
      continue;
    }

    await markJobFailed(job.id, result.description);
  }
}

export function startTelegramReminderWorker() {
  if (workerStarted) return;
  workerStarted = true;

  const run = async () => {
    if (workerRunning) return;
    workerRunning = true;

    try {
      const isLeader = await tryAcquireLease(WORKER_NAME);
      if (!isLeader) {
        log.info("telegramReminders", "skip_tick_not_leader");
        return;
      }
      await processDueTelegramReminderJobs();
    } catch (error) {
      log.error("telegramReminders", "worker_error", {
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

export function stopTelegramReminderWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  workerStarted = false;
  workerRunning = false;
}
