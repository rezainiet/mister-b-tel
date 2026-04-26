import {
  bigint,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Tracking events table — stores every interaction captured from the landing page.
 * It now keeps durable funnel and session identifiers so pageviews and clicks can be
 * reconciled to downstream bot starts and joins.
 */
export const trackingEvents = mysqlTable("tracking_events", {
  id: int("id").autoincrement().primaryKey(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  eventSource: varchar("eventSource", { length: 128 }),
  eventId: varchar("eventId", { length: 128 }),
  visitorId: varchar("visitorId", { length: 128 }),
  sessionToken: varchar("sessionToken", { length: 128 }),
  funnelToken: varchar("funnelToken", { length: 128 }),
  sourceUrl: text("sourceUrl"),
  userAgent: varchar("userAgent", { length: 512 }),
  referrer: varchar("referrer", { length: 512 }),
  ip: varchar("ip", { length: 64 }),
  country: varchar("country", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TrackingEvent = typeof trackingEvents.$inferSelect;
export type InsertTrackingEvent = typeof trackingEvents.$inferInsert;

/**
 * Daily aggregated stats allow the dashboard to read quickly while we still preserve raw events.
 */
export const dailyStats = mysqlTable("daily_stats", {
  id: int("id").autoincrement().primaryKey(),
  date: varchar("date", { length: 10 }).notNull().unique(), // YYYY-MM-DD; unique so recordEvent can use INSERT … ON DUPLICATE KEY UPDATE.
  pageviews: int("pageviews").default(0).notNull(),
  uniqueVisitors: int("uniqueVisitors").default(0).notNull(),
  whatsappClicks: int("whatsappClicks").default(0).notNull(),
  telegramClicks: int("telegramClicks").default(0).notNull(),
  scroll25: int("scroll25").default(0).notNull(),
  scroll50: int("scroll50").default(0).notNull(),
  scroll75: int("scroll75").default(0).notNull(),
  scroll100: int("scroll100").default(0).notNull(),
  avgTimeOnPage: int("avgTimeOnPage").default(0).notNull(),
  conversionRate: varchar("conversionRate", { length: 10 }).default("0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailyStat = typeof dailyStats.$inferSelect;
export type InsertDailyStat = typeof dailyStats.$inferInsert;

export const utmSessions = mysqlTable("utm_sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull().unique(),
  funnelToken: varchar("funnelToken", { length: 128 }),
  visitorId: varchar("visitorId", { length: 128 }),
  utmSource: varchar("utmSource", { length: 128 }),
  utmMedium: varchar("utmMedium", { length: 128 }),
  utmCampaign: varchar("utmCampaign", { length: 256 }),
  utmContent: varchar("utmContent", { length: 256 }),
  utmTerm: varchar("utmTerm", { length: 256 }),
  fbclid: varchar("fbclid", { length: 512 }),
  fbp: varchar("fbp", { length: 512 }),
  ipAddress: varchar("ipAddress", { length: 64 }),
  userAgent: text("userAgent"),
  referrer: text("referrer"),
  landingPage: text("landingPage"),
  clickedTelegramLink: mysqlEnum("clickedTelegramLink", ["yes", "no"]).default("no").notNull(),
  clickedAt: timestamp("clickedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UtmSession = typeof utmSessions.$inferSelect;
export type InsertUtmSession = typeof utmSessions.$inferInsert;

export const telegramJoins = mysqlTable("telegram_joins", {
  id: int("id").autoincrement().primaryKey(),
  telegramUserId: varchar("telegramUserId", { length: 64 }).notNull(),
  telegramUsername: varchar("telegramUsername", { length: 128 }),
  telegramFirstName: varchar("telegramFirstName", { length: 128 }),
  telegramLastName: varchar("telegramLastName", { length: 128 }),
  channelId: varchar("channelId", { length: 64 }).notNull(),
  channelTitle: varchar("channelTitle", { length: 256 }),
  funnelToken: varchar("funnelToken", { length: 128 }),
  attributionStatus: mysqlEnum("attributionStatus", [
    "attributed_join",
    "unattributed_join",
    "bypass_join",
    "legacy_unattributed",
  ])
    .default("unattributed_join")
    .notNull(),
  utmSource: varchar("utmSource", { length: 128 }),
  utmMedium: varchar("utmMedium", { length: 128 }),
  utmCampaign: varchar("utmCampaign", { length: 256 }),
  utmContent: varchar("utmContent", { length: 256 }),
  utmTerm: varchar("utmTerm", { length: 256 }),
  fbclid: varchar("fbclid", { length: 512 }),
  fbp: varchar("fbp", { length: 512 }),
  metaEventSent: mysqlEnum("metaEventSent", ["pending", "sent", "failed", "retrying", "abandoned"])
    .default("pending")
    .notNull(),
  metaEventId: varchar("metaEventId", { length: 128 }),
  metaEventSentAt: timestamp("metaEventSentAt"),
  sessionToken: varchar("sessionToken", { length: 128 }),
  ipAddress: varchar("ipAddress", { length: 64 }),
  userAgent: text("userAgent"),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TelegramJoin = typeof telegramJoins.$inferSelect;
export type InsertTelegramJoin = typeof telegramJoins.$inferInsert;

export const botStarts = mysqlTable("bot_starts", {
  id: int("id").autoincrement().primaryKey(),
  telegramUserId: varchar("telegramUserId", { length: 64 }).notNull().unique(),
  telegramUsername: varchar("telegramUsername", { length: 128 }),
  telegramFirstName: varchar("telegramFirstName", { length: 128 }),
  funnelToken: varchar("funnelToken", { length: 128 }),
  sessionToken: varchar("sessionToken", { length: 128 }),
  attributionStatus: mysqlEnum("attributionStatus", [
    "attributed_start",
    "organic_start",
    "unknown_start",
    "legacy_unattributed",
  ])
    .default("unknown_start")
    .notNull(),
  utmSource: varchar("utmSource", { length: 128 }),
  utmMedium: varchar("utmMedium", { length: 128 }),
  utmCampaign: varchar("utmCampaign", { length: 256 }),
  utmContent: varchar("utmContent", { length: 256 }),
  utmTerm: varchar("utmTerm", { length: 256 }),
  fbclid: varchar("fbclid", { length: 512 }),
  fbp: varchar("fbp", { length: 512 }),
  metaSubscribeStatus: mysqlEnum("metaSubscribeStatus", ["pending", "sent", "failed", "retrying", "abandoned"])
    .default("pending")
    .notNull(),
  metaSubscribeEventId: varchar("metaSubscribeEventId", { length: 128 }),
  metaSubscribeSentAt: timestamp("metaSubscribeSentAt"),
  reminderSent: mysqlEnum("reminderSent", ["pending", "sent", "skipped"]).default("pending").notNull(),
  reminderSentAt: timestamp("reminderSentAt"),
  reminder2Sent: mysqlEnum("reminder2Sent", ["pending", "sent", "skipped"]).default("pending").notNull(),
  reminder2SentAt: timestamp("reminder2SentAt"),
  reminder3Sent: mysqlEnum("reminder3Sent", ["pending", "sent", "skipped"]).default("pending").notNull(),
  reminder3SentAt: timestamp("reminder3SentAt"),
  botBlocked: int("botBlocked").default(0).notNull(),
  joinedAt: timestamp("joinedAt"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  firstStartedAt: timestamp("firstStartedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BotStart = typeof botStarts.$inferSelect;
export type InsertBotStart = typeof botStarts.$inferInsert;

export const telegramUpdateLog = mysqlTable("telegram_update_log", {
  updateId: bigint("updateId", { mode: "number" }).primaryKey().notNull(),
  processedAt: timestamp("processedAt").defaultNow().notNull(),
});

export type TelegramUpdateLog = typeof telegramUpdateLog.$inferSelect;
export type InsertTelegramUpdateLog = typeof telegramUpdateLog.$inferInsert;

export const telegramLinkages = mysqlTable("telegram_linkages", {
  id: int("id").autoincrement().primaryKey(),
  telegramUserId: varchar("telegramUserId", { length: 64 }).notNull().unique(),
  funnelToken: varchar("funnelToken", { length: 128 }),
  sessionToken: varchar("sessionToken", { length: 128 }),
  payloadType: varchar("payloadType", { length: 32 }).default("group").notNull(),
  payloadSource: varchar("payloadSource", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"),
  resolvedAt: timestamp("resolvedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TelegramLinkage = typeof telegramLinkages.$inferSelect;
export type InsertTelegramLinkage = typeof telegramLinkages.$inferInsert;

export const metaEventLogs = mysqlTable("meta_event_logs", {
  id: int("id").autoincrement().primaryKey(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  eventScope: varchar("eventScope", { length: 64 }).notNull(),
  eventId: varchar("eventId", { length: 128 }).notNull().unique(),
  funnelToken: varchar("funnelToken", { length: 128 }),
  sessionToken: varchar("sessionToken", { length: 128 }),
  telegramUserId: varchar("telegramUserId", { length: 64 }),
  requestPayloadJson: text("requestPayloadJson"),
  responsePayloadJson: text("responsePayloadJson"),
  httpStatus: int("httpStatus"),
  status: mysqlEnum("status", ["queued", "sent", "failed", "retrying", "abandoned"])
    .default("queued")
    .notNull(),
  errorCode: varchar("errorCode", { length: 64 }),
  errorSubcode: varchar("errorSubcode", { length: 64 }),
  errorMessage: text("errorMessage"),
  retryable: int("retryable").default(0).notNull(),
  attemptCount: int("attemptCount").default(0).notNull(),
  attemptedAt: timestamp("attemptedAt"),
  completedAt: timestamp("completedAt"),
  nextRetryAt: timestamp("nextRetryAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MetaEventLog = typeof metaEventLogs.$inferSelect;
export type InsertMetaEventLog = typeof metaEventLogs.$inferInsert;

export const telegramReminderJobs = mysqlTable("telegram_reminder_jobs", {
  id: int("id").autoincrement().primaryKey(),
  telegramUserId: varchar("telegramUserId", { length: 64 }).notNull(),
  chatId: varchar("chatId", { length: 64 }).notNull(),
  reminderKey: varchar("reminderKey", { length: 32 }).notNull(),
  messageText: text("messageText").notNull(),
  dueAt: timestamp("dueAt").notNull(),
  status: mysqlEnum("status", ["pending", "processing", "sent", "failed", "skipped"]).default("pending").notNull(),
  attempts: int("attempts").default(0).notNull(),
  lastAttemptAt: timestamp("lastAttemptAt"),
  sentAt: timestamp("sentAt"),
  failedAt: timestamp("failedAt"),
  skippedAt: timestamp("skippedAt"),
  skippedReason: varchar("skippedReason", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TelegramReminderJob = typeof telegramReminderJobs.$inferSelect;
export type InsertTelegramReminderJob = typeof telegramReminderJobs.$inferInsert;

export const siteSettings = mysqlTable("site_settings", {
  id: int("id").autoincrement().primaryKey(),
  settingKey: varchar("setting_key", { length: 100 }).notNull().unique(),
  settingValue: text("setting_value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type SiteSetting = typeof siteSettings.$inferSelect;
export type InsertSiteSetting = typeof siteSettings.$inferInsert;
