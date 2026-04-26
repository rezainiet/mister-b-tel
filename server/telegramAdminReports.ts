import { tryAcquireLease } from "./_core/leaderLease";
import { log } from "./_core/logger";
import {
  getSetting,
  getTelegramCumulativeReportStats,
  getTelegramRecipientsByUsernames,
  upsertSetting,
} from "./db";
import { sendTelegramMessage, type SendTelegramMessageResult } from "./telegramBot";

const WORKER_NAME = "telegram_admin_reports";

const PARIS_TIMEZONE = "Europe/Paris";

const DEFAULT_AUTHORIZED_REPORT_USERNAMES = ["bestmanylitics", "coucoulala123"] as const;

function loadAuthorizedReportUsernames(): readonly string[] {
  // TELEGRAM_ADMIN_USERNAMES is a comma-separated list of bare usernames
  // (no leading @). Falls back to the documented defaults when unset.
  const fromEnv = (process.env.TELEGRAM_ADMIN_USERNAMES || "")
    .split(",")
    .map((entry) => entry.replace(/^@/, "").trim().toLowerCase())
    .filter(Boolean);

  if (fromEnv.length > 0) return fromEnv;
  return DEFAULT_AUTHORIZED_REPORT_USERNAMES;
}

const AUTHORIZED_REPORT_USERNAMES = loadAuthorizedReportUsernames();
const REPORT_LAST_SLOT_SETTING_KEY = "telegram_admin_report_last_slot";
const REPORT_WORKER_INTERVAL_MS = 60_000;
const SCHEDULED_REPORT_MINUTE_WINDOW = 5;

let reportWorkerStarted = false;
let reportWorkerInterval: NodeJS.Timeout | null = null;
let reportWorkerRunning = false;

export type TelegramAdminReportStats = {
  landingVisits: number;
  botStarts: number;
  channelJoins: number;
};

export type TelegramAdminRecipient = {
  username: string;
  chatId: string;
  firstName: string | null;
};

export type TelegramAdminReportSendResult = {
  recipients: TelegramAdminRecipient[];
  missingUsernames: string[];
  text: string;
  stats: TelegramAdminReportStats;
  sentAt: Date;
  reportHourLabel: string;
  deliveries: Array<{
    recipient: TelegramAdminRecipient;
    result: SendTelegramMessageResult;
  }>;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone);
  const utcEquivalent = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return utcEquivalent - date.getTime();
}

export function getParisDateKey(date = new Date()) {
  const parts = getTimeZoneParts(date, PARIS_TIMEZONE);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function getParisHour(date = new Date()) {
  return getTimeZoneParts(date, PARIS_TIMEZONE).hour;
}

export function getParisMidnightUtc(date = new Date()) {
  const parts = getTimeZoneParts(date, PARIS_TIMEZONE);
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0));
  const offsetMs = getTimeZoneOffsetMs(utcGuess, PARIS_TIMEZONE);
  return new Date(utcGuess.getTime() - offsetMs);
}

export function getTelegramAdminReportSlotKey(date = new Date()) {
  return `${getParisDateKey(date)}-${pad2(getParisHour(date))}`;
}

export function isTelegramAdminReportDue(date = new Date()) {
  const parts = getTimeZoneParts(date, PARIS_TIMEZONE);
  return parts.hour % 2 === 1 && parts.minute < SCHEDULED_REPORT_MINUTE_WINDOW;
}

function formatReportHourLabel(rawHour?: number | null, date = new Date()) {
  const hour = Number.isInteger(rawHour) ? Number(rawHour) : getParisHour(date);
  return `${pad2(hour)}h`;
}

export async function getAuthorizedTelegramAdminRecipients() {
  const storedRecipients = await getTelegramRecipientsByUsernames([...AUTHORIZED_REPORT_USERNAMES]);
  const recipientMap = new Map(
    storedRecipients.map((recipient) => [recipient.telegramUsername?.toLowerCase() || "", recipient]),
  );

  return AUTHORIZED_REPORT_USERNAMES.flatMap((username) => {
    const match = recipientMap.get(username);
    if (!match) return [];

    return [
      {
        username: `@${username}`,
        chatId: match.telegramUserId,
        firstName: match.telegramFirstName || null,
      } satisfies TelegramAdminRecipient,
    ];
  });
}

export async function isTelegramAdminAuthorized(userId: string, username?: string | null) {
  const normalizedUsername = username?.replace(/^@/, "").trim().toLowerCase() || "";
  if (normalizedUsername && AUTHORIZED_REPORT_USERNAMES.includes(normalizedUsername)) {
    return true;
  }

  const recipients = await getAuthorizedTelegramAdminRecipients();
  return recipients.some((recipient) => recipient.chatId === userId);
}

export async function buildTelegramAdminReportText(options?: {
  now?: Date;
  reportHour?: number | null;
}) {
  const now = options?.now || new Date();
  const startAt = getParisMidnightUtc(now);
  const stats = await getTelegramCumulativeReportStats(startAt, now);
  const reportHourLabel = formatReportHourLabel(options?.reportHour ?? null, now);

  const text = [
    `Rapport Telegram cumulé · ${reportHourLabel} (Paris)`,
    `Depuis 00:00 Europe/Paris · ${getParisDateKey(now)}`,
    "",
    `1. Visites landing cumulées : ${stats.landingVisits}`,
    `2. Nombre de /start bot cumulés : ${stats.botStarts}`,
    `3. Nombre de personnes ayant rejoint le canal cumulées : ${stats.channelJoins}`,
  ].join("\n");

  return {
    text,
    stats,
    sentAt: now,
    reportHourLabel,
  };
}

export async function sendTelegramAdminReport(options?: {
  now?: Date;
  reportHour?: number | null;
}) {
  const report = await buildTelegramAdminReportText(options);
  const recipients = await getAuthorizedTelegramAdminRecipients();
  const missingUsernames = AUTHORIZED_REPORT_USERNAMES.filter(
    (username) => !recipients.some((recipient) => recipient.username.toLowerCase() === `@${username}`),
  ).map((username) => `@${username}`);

  const deliveries: TelegramAdminReportSendResult["deliveries"] = [];

  for (const recipient of recipients) {
    const result = await sendTelegramMessage(recipient.chatId, report.text);
    deliveries.push({ recipient, result });
  }

  return {
    recipients,
    missingUsernames,
    text: report.text,
    stats: report.stats,
    sentAt: report.sentAt,
    reportHourLabel: report.reportHourLabel,
    deliveries,
  } satisfies TelegramAdminReportSendResult;
}

export async function maybeSendScheduledTelegramAdminReport(now = new Date()) {
  if (!isTelegramAdminReportDue(now)) {
    return { sent: false as const, reason: "not_due" as const };
  }

  const slotKey = getTelegramAdminReportSlotKey(now);
  const previousSlot = await getSetting(REPORT_LAST_SLOT_SETTING_KEY);

  if (previousSlot === slotKey) {
    return { sent: false as const, reason: "already_sent" as const, slotKey };
  }

  const result = await sendTelegramAdminReport({ now, reportHour: getParisHour(now) });
  const deliveredSuccessfully = result.deliveries.some((entry) => entry.result.ok);

  if (deliveredSuccessfully) {
    await upsertSetting(REPORT_LAST_SLOT_SETTING_KEY, slotKey);
  }

  return {
    sent: deliveredSuccessfully,
    reason: deliveredSuccessfully ? ("sent" as const) : ("failed" as const),
    slotKey,
    result,
  };
}

export function startTelegramAdminReportWorker() {
  if (reportWorkerStarted) return;
  reportWorkerStarted = true;

  const run = async () => {
    if (reportWorkerRunning) return;
    reportWorkerRunning = true;

    try {
      const isLeader = await tryAcquireLease(WORKER_NAME);
      if (!isLeader) {
        log.info("telegramAdminReports", "skip_tick_not_leader");
        return;
      }
      await maybeSendScheduledTelegramAdminReport();
    } catch (error) {
      log.error("telegramAdminReports", "worker_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      reportWorkerRunning = false;
    }
  };

  void run();
  reportWorkerInterval = setInterval(() => {
    void run();
  }, REPORT_WORKER_INTERVAL_MS);
}

export function stopTelegramAdminReportWorker() {
  if (reportWorkerInterval) {
    clearInterval(reportWorkerInterval);
    reportWorkerInterval = null;
  }

  reportWorkerStarted = false;
  reportWorkerRunning = false;
}
