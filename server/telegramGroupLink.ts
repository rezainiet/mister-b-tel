import { eq, or } from "drizzle-orm";
import { telegramReminderJobs } from "../drizzle/schema";
import { getAllSettings, getDb, getSetting, upsertSetting } from "./db";

export const DEFAULT_TELEGRAM_GROUP_URL =
  process.env.TELEGRAM_GROUP_URL || "https://t.me/+sdIa7KNoIbNjMTg0";
export const TELEGRAM_GROUP_URL_SETTING_KEY = "telegram_group_url";

const BOT_TEXT_SETTING_KEYS = [
  "welcome_message",
  "telegram_reminder_15m_message",
  "telegram_reminder_1h_message",
  "telegram_reminder_4h_message",
  "telegram_reminder_24h_message",
  "telegram_reminder_1w_message",
  "telegram_reminder_2w_message",
  "telegram_reminder_1m_message",
] as const;

export async function getTelegramGroupUrl() {
  return (await getSetting(TELEGRAM_GROUP_URL_SETTING_KEY)) || DEFAULT_TELEGRAM_GROUP_URL;
}

export function replaceTelegramGroupUrlInText(text: string, nextGroupUrl: string) {
  return text
    .replaceAll("{group_url}", nextGroupUrl)
    .replace(/https?:\/\/t\.me\/[^\s)]+/g, nextGroupUrl)
    .trim();
}

export async function syncTelegramGroupUrlContent(nextGroupUrl: string) {
  await upsertSetting(TELEGRAM_GROUP_URL_SETTING_KEY, nextGroupUrl);

  const settings = await getAllSettings();
  const settingMap = new Map(settings.map((entry) => [entry.settingKey, entry.settingValue]));

  for (const settingKey of BOT_TEXT_SETTING_KEYS) {
    const currentValue = settingMap.get(settingKey);
    if (!currentValue) continue;

    const updatedValue = replaceTelegramGroupUrlInText(currentValue, nextGroupUrl);
    if (updatedValue !== currentValue) {
      await upsertSetting(settingKey, updatedValue);
    }
  }

  const db = await getDb();
  if (!db) return;

  const pendingJobs = await db
    .select({
      id: telegramReminderJobs.id,
      messageText: telegramReminderJobs.messageText,
    })
    .from(telegramReminderJobs)
    .where(
      or(
        eq(telegramReminderJobs.status, "pending"),
        eq(telegramReminderJobs.status, "processing"),
        eq(telegramReminderJobs.status, "failed"),
      ),
    );

  for (const job of pendingJobs) {
    const updatedMessageText = replaceTelegramGroupUrlInText(job.messageText, nextGroupUrl);
    if (updatedMessageText === job.messageText) continue;

    await db
      .update(telegramReminderJobs)
      .set({
        messageText: updatedMessageText,
        updatedAt: new Date(),
      })
      .where(eq(telegramReminderJobs.id, job.id));
  }
}
