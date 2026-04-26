import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  botStarts,
  dailyStats,
  InsertBotStart,
  InsertMetaEventLog,
  InsertSiteSetting,
  InsertTelegramJoin,
  InsertTelegramLinkage,
  InsertTrackingEvent,
  InsertUser,
  InsertUtmSession,
  metaEventLogs,
  siteSettings,
  telegramJoins,
  telegramLinkages,
  telegramUpdateLog,
  trackingEvents,
  users,
  utmSessions,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ═══════════════════════════════════════════════════════════
// TRACKING FUNCTIONS
// ═══════════════════════════════════════════════════════════

type DailyStatCounter =
  | "pageviews"
  | "uniqueVisitors"
  | "whatsappClicks"
  | "telegramClicks"
  | "scroll25"
  | "scroll50"
  | "scroll75"
  | "scroll100";

const DAILY_STAT_COUNTER_BY_EVENT: Record<string, DailyStatCounter> = {
  pageview: "pageviews",
  unique_visitor: "uniqueVisitors",
  whatsapp_click: "whatsappClicks",
  telegram_click: "telegramClicks",
  scroll_25: "scroll25",
  scroll_50: "scroll50",
  scroll_75: "scroll75",
  scroll_100: "scroll100",
};

function dailyCounterIncrement(counter: DailyStatCounter) {
  switch (counter) {
    case "pageviews": return sql`${dailyStats.pageviews} + 1`;
    case "uniqueVisitors": return sql`${dailyStats.uniqueVisitors} + 1`;
    case "whatsappClicks": return sql`${dailyStats.whatsappClicks} + 1`;
    case "telegramClicks": return sql`${dailyStats.telegramClicks} + 1`;
    case "scroll25": return sql`${dailyStats.scroll25} + 1`;
    case "scroll50": return sql`${dailyStats.scroll50} + 1`;
    case "scroll75": return sql`${dailyStats.scroll75} + 1`;
    case "scroll100": return sql`${dailyStats.scroll100} + 1`;
  }
}

type RecordEventStats = { ok: number; failed: number; lastError: string | null; lastErrorAt: Date | null };
const recordEventStats: RecordEventStats = { ok: 0, failed: 0, lastError: null, lastErrorAt: null };

export function getRecordEventStats(): Readonly<RecordEventStats> {
  return { ...recordEventStats };
}

export async function recordEvent(event: InsertTrackingEvent) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(trackingEvents).values(event);

    const counter = DAILY_STAT_COUNTER_BY_EVENT[event.eventType];
    if (!counter) {
      recordEventStats.ok += 1;
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    // Single round-trip upsert: relies on the UNIQUE INDEX on
    // daily_stats.date (migration 0009). Replaces the legacy SELECT →
    // INSERT/UPDATE 3-statement pattern.
    const insertValues: typeof dailyStats.$inferInsert = {
      date: today,
      pageviews: 0,
      uniqueVisitors: 0,
      whatsappClicks: 0,
      telegramClicks: 0,
      scroll25: 0,
      scroll50: 0,
      scroll75: 0,
      scroll100: 0,
      avgTimeOnPage: 0,
      conversionRate: "0",
    };
    (insertValues as Record<string, unknown>)[counter] = 1;

    await db
      .insert(dailyStats)
      .values(insertValues)
      .onDuplicateKeyUpdate({ set: { [counter]: dailyCounterIncrement(counter) } });

    recordEventStats.ok += 1;
  } catch (error) {
    recordEventStats.failed += 1;
    recordEventStats.lastError = error instanceof Error ? error.message : String(error);
    recordEventStats.lastErrorAt = new Date();
    console.error("[Tracking] Failed to record event:", error);
  }
}

export type DashboardPreset = "24h" | "48h" | "7d" | "15d" | "30d" | "custom";

type DashboardBaseMetrics = {
  pageviews: number;
  uniqueVisitors: number;
  whatsappClicks: number;
  telegramClicks: number;
  scroll25: number;
  scroll50: number;
  scroll75: number;
  scroll100: number;
};

export type DashboardTotals = DashboardBaseMetrics & {
  conversionRate: string;
  totalContacts: number;
};

export type DashboardDay = DashboardBaseMetrics & {
  date: string;
  totalContacts: number;
  conversionRate: string;
};

export type DashboardWindow = {
  pageviews: number;
  uniqueVisitors: number;
  totalContacts: number;
};

export type DashboardLiveSnapshot = {
  last5Minutes: DashboardWindow;
  last10Minutes: DashboardWindow;
  last4Hours: DashboardWindow;
  lastVisitAt: string | null;
  lastEventType: string | null;
  adStatus: "active" | "warming" | "idle";
  adStatusLabel: string;
};

export type DashboardMeta = {
  preset: DashboardPreset;
  label: string;
  startDate: string;
  endDate: string;
  refreshedAt: string;
  sinceMidnight: boolean;
};

export type DashboardStatsResponse = {
  meta: DashboardMeta;
  totals: DashboardTotals;
  daily: DashboardDay[];
  recentEvents: Array<typeof trackingEvents.$inferSelect>;
  live: DashboardLiveSnapshot;
};

type MetricsRow = {
  pageviews?: number | string | null;
  uniqueVisitors?: number | string | null;
  whatsappClicks?: number | string | null;
  telegramClicks?: number | string | null;
  scroll25?: number | string | null;
  scroll50?: number | string | null;
  scroll75?: number | string | null;
  scroll100?: number | string | null;
};

type DailyMetricsRow = MetricsRow & {
  date: string | Date;
};

function toNumber(value: unknown) {
  return Number(value || 0);
}

function emptyMetrics(): DashboardBaseMetrics {
  return {
    pageviews: 0,
    uniqueVisitors: 0,
    whatsappClicks: 0,
    telegramClicks: 0,
    scroll25: 0,
    scroll50: 0,
    scroll75: 0,
    scroll100: 0,
  };
}

function addDerivedMetrics(metrics: DashboardBaseMetrics): DashboardTotals {
  const totalContacts = metrics.whatsappClicks + metrics.telegramClicks;
  const conversionRate =
    metrics.pageviews > 0 ? ((totalContacts / metrics.pageviews) * 100).toFixed(1) : "0.0";

  return {
    ...metrics,
    totalContacts,
    conversionRate,
  };
}

function mapMetricsRow(row?: MetricsRow | null): DashboardBaseMetrics {
  return {
    pageviews: toNumber(row?.pageviews),
    uniqueVisitors: toNumber(row?.uniqueVisitors),
    whatsappClicks: toNumber(row?.whatsappClicks),
    telegramClicks: toNumber(row?.telegramClicks),
    scroll25: toNumber(row?.scroll25),
    scroll50: toNumber(row?.scroll50),
    scroll75: toNumber(row?.scroll75),
    scroll100: toNumber(row?.scroll100),
  };
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function shiftDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function buildRangeFromPreset(
  preset: DashboardPreset,
  startDate?: string,
  endDate?: string,
): { preset: DashboardPreset; label: string; start: Date; end: Date; sinceMidnight: boolean } {
  const now = new Date();
  const todayStart = startOfDay(now);

  switch (preset) {
    case "24h":
      return {
        preset,
        label: "24 h · depuis minuit",
        start: todayStart,
        end: now,
        sinceMidnight: true,
      };
    case "48h":
      return {
        preset,
        label: "48 h · hier minuit à maintenant",
        start: shiftDays(todayStart, -1),
        end: now,
        sinceMidnight: false,
      };
    case "7d":
      return {
        preset,
        label: "7 jours",
        start: shiftDays(todayStart, -6),
        end: now,
        sinceMidnight: false,
      };
    case "15d":
      return {
        preset,
        label: "15 jours",
        start: shiftDays(todayStart, -14),
        end: now,
        sinceMidnight: false,
      };
    case "30d":
      return {
        preset,
        label: "30 jours",
        start: shiftDays(todayStart, -29),
        end: now,
        sinceMidnight: false,
      };
    case "custom": {
      const safeStart = startDate ? startOfDay(new Date(`${startDate}T00:00:00`)) : shiftDays(todayStart, -29);
      const safeEnd = endDate ? endOfDay(new Date(`${endDate}T00:00:00`)) : now;

      return {
        preset,
        label: "Période personnalisée",
        start: safeStart,
        end: safeEnd > now ? now : safeEnd,
        sinceMidnight: false,
      };
    }
    default:
      return {
        preset: "24h",
        label: "24 h · depuis minuit",
        start: todayStart,
        end: now,
        sinceMidnight: true,
      };
  }
}

async function queryAggregateMetrics(start: Date, end: Date) {
  const db = await getDb();
  if (!db) return emptyMetrics();

  const [rows]: any = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN eventType = 'pageview' THEN 1 ELSE 0 END), 0) AS pageviews,
      COALESCE(COUNT(DISTINCT CASE WHEN visitorId IS NOT NULL AND visitorId <> '' THEN visitorId END), 0) AS uniqueVisitors,
      COALESCE(SUM(CASE WHEN eventType = 'whatsapp_click' OR (eventType = 'telegram_click' AND COALESCE(eventSource, '') LIKE 'telegram_group%') THEN 1 ELSE 0 END), 0) AS whatsappClicks,
      COALESCE(SUM(CASE WHEN eventType = 'telegram_click' AND COALESCE(eventSource, '') NOT LIKE 'telegram_group%' THEN 1 ELSE 0 END), 0) AS telegramClicks,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_25' THEN 1 ELSE 0 END), 0) AS scroll25,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_50' THEN 1 ELSE 0 END), 0) AS scroll50,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_75' THEN 1 ELSE 0 END), 0) AS scroll75,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_100' THEN 1 ELSE 0 END), 0) AS scroll100
    FROM tracking_events
    WHERE createdAt >= ${start} AND createdAt <= ${end}
  `);

  return mapMetricsRow(rows?.[0] as MetricsRow | undefined);
}

async function queryDailyMetrics(start: Date, end: Date): Promise<DashboardDay[]> {
  const db = await getDb();
  if (!db) return [];

  const [rows]: any = await db.execute(sql`
    SELECT
      DATE(createdAt) AS date,
      COALESCE(SUM(CASE WHEN eventType = 'pageview' THEN 1 ELSE 0 END), 0) AS pageviews,
      COALESCE(COUNT(DISTINCT CASE WHEN visitorId IS NOT NULL AND visitorId <> '' THEN visitorId END), 0) AS uniqueVisitors,
      COALESCE(SUM(CASE WHEN eventType = 'whatsapp_click' OR (eventType = 'telegram_click' AND COALESCE(eventSource, '') LIKE 'telegram_group%') THEN 1 ELSE 0 END), 0) AS whatsappClicks,
      COALESCE(SUM(CASE WHEN eventType = 'telegram_click' AND COALESCE(eventSource, '') NOT LIKE 'telegram_group%' THEN 1 ELSE 0 END), 0) AS telegramClicks,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_25' THEN 1 ELSE 0 END), 0) AS scroll25,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_50' THEN 1 ELSE 0 END), 0) AS scroll50,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_75' THEN 1 ELSE 0 END), 0) AS scroll75,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_100' THEN 1 ELSE 0 END), 0) AS scroll100
    FROM tracking_events
    WHERE createdAt >= ${start} AND createdAt <= ${end}
    GROUP BY DATE(createdAt)
    ORDER BY DATE(createdAt) ASC
  `);

  return (rows || []).map((row: DailyMetricsRow) => {
    const metrics = mapMetricsRow(row);
    const date = typeof row.date === "string" ? row.date : toDateKey(new Date(row.date));
    const withDerived = addDerivedMetrics(metrics);

    return {
      date,
      ...metrics,
      totalContacts: withDerived.totalContacts,
      conversionRate: withDerived.conversionRate,
    };
  });
}

async function queryRecentEvents(start: Date, end: Date) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(trackingEvents)
    .where(sql`${trackingEvents.createdAt} >= ${start} AND ${trackingEvents.createdAt} <= ${end}`)
    .orderBy(desc(trackingEvents.createdAt))
    .limit(30);
}

async function querySinceMidnightMetrics() {
  const db = await getDb();
  if (!db) return emptyMetrics();

  const [rows]: any = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN eventType = 'pageview' THEN 1 ELSE 0 END), 0) AS pageviews,
      COALESCE(COUNT(DISTINCT CASE WHEN visitorId IS NOT NULL AND visitorId <> '' THEN visitorId END), 0) AS uniqueVisitors,
      COALESCE(SUM(CASE WHEN eventType = 'whatsapp_click' OR (eventType = 'telegram_click' AND COALESCE(eventSource, '') LIKE 'telegram_group%') THEN 1 ELSE 0 END), 0) AS whatsappClicks,
      COALESCE(SUM(CASE WHEN eventType = 'telegram_click' AND COALESCE(eventSource, '') NOT LIKE 'telegram_group%' THEN 1 ELSE 0 END), 0) AS telegramClicks,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_25' THEN 1 ELSE 0 END), 0) AS scroll25,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_50' THEN 1 ELSE 0 END), 0) AS scroll50,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_75' THEN 1 ELSE 0 END), 0) AS scroll75,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_100' THEN 1 ELSE 0 END), 0) AS scroll100
    FROM tracking_events
    WHERE DATE(createdAt) = CURRENT_DATE()
  `);

  return mapMetricsRow(rows?.[0] as MetricsRow | undefined);
}

async function queryDailyMetricsSinceMidnight(): Promise<DashboardDay[]> {
  const db = await getDb();
  if (!db) return [];

  const [rows]: any = await db.execute(sql`
    SELECT
      DATE(createdAt) AS date,
      COALESCE(SUM(CASE WHEN eventType = 'pageview' THEN 1 ELSE 0 END), 0) AS pageviews,
      COALESCE(COUNT(DISTINCT CASE WHEN visitorId IS NOT NULL AND visitorId <> '' THEN visitorId END), 0) AS uniqueVisitors,
      COALESCE(SUM(CASE WHEN eventType = 'whatsapp_click' OR (eventType = 'telegram_click' AND COALESCE(eventSource, '') LIKE 'telegram_group%') THEN 1 ELSE 0 END), 0) AS whatsappClicks,
      COALESCE(SUM(CASE WHEN eventType = 'telegram_click' AND COALESCE(eventSource, '') NOT LIKE 'telegram_group%' THEN 1 ELSE 0 END), 0) AS telegramClicks,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_25' THEN 1 ELSE 0 END), 0) AS scroll25,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_50' THEN 1 ELSE 0 END), 0) AS scroll50,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_75' THEN 1 ELSE 0 END), 0) AS scroll75,
      COALESCE(SUM(CASE WHEN eventType = 'scroll_100' THEN 1 ELSE 0 END), 0) AS scroll100
    FROM tracking_events
    WHERE DATE(createdAt) = CURRENT_DATE()
    GROUP BY DATE(createdAt)
    ORDER BY DATE(createdAt) ASC
  `);

  return (rows || []).map((row: DailyMetricsRow) => {
    const metrics = mapMetricsRow(row);
    const date = typeof row.date === "string" ? row.date : toDateKey(new Date(row.date));
    const withDerived = addDerivedMetrics(metrics);

    return {
      date,
      ...metrics,
      totalContacts: withDerived.totalContacts,
      conversionRate: withDerived.conversionRate,
    };
  });
}

async function queryRecentEventsSinceMidnight() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(trackingEvents)
    .where(sql`DATE(${trackingEvents.createdAt}) = CURRENT_DATE()`)
    .orderBy(desc(trackingEvents.createdAt))
    .limit(30);
}

async function queryWindowSummary(windowMs: number): Promise<DashboardWindow> {
  const db = await getDb();
  if (!db) {
    return {
      pageviews: 0,
      uniqueVisitors: 0,
      totalContacts: 0,
    };
  }

  const windowSeconds = Math.max(1, Math.floor(windowMs / 1000));
  const [rows]: any = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN eventType = 'pageview' THEN 1 ELSE 0 END), 0) AS pageviews,
      COALESCE(COUNT(DISTINCT CASE WHEN visitorId IS NOT NULL AND visitorId <> '' THEN visitorId END), 0) AS uniqueVisitors,
      COALESCE(SUM(CASE WHEN eventType = 'whatsapp_click' OR (eventType = 'telegram_click' AND COALESCE(eventSource, '') LIKE 'telegram_group%') THEN 1 ELSE 0 END), 0) AS whatsappClicks,
      COALESCE(SUM(CASE WHEN eventType = 'telegram_click' AND COALESCE(eventSource, '') NOT LIKE 'telegram_group%' THEN 1 ELSE 0 END), 0) AS telegramClicks
    FROM tracking_events
    WHERE createdAt <= NOW()
      AND TIMESTAMPDIFF(SECOND, createdAt, NOW()) BETWEEN 0 AND ${windowSeconds}
  `);

  const metrics = mapMetricsRow(rows?.[0] as MetricsRow | undefined);

  return {
    pageviews: metrics.pageviews,
    uniqueVisitors: metrics.uniqueVisitors,
    totalContacts: metrics.whatsappClicks + metrics.telegramClicks,
  };
}

async function buildLiveSnapshot(): Promise<DashboardLiveSnapshot> {
  const db = await getDb();
  if (!db) {
    return {
      last5Minutes: { pageviews: 0, uniqueVisitors: 0, totalContacts: 0 },
      last10Minutes: { pageviews: 0, uniqueVisitors: 0, totalContacts: 0 },
      last4Hours: { pageviews: 0, uniqueVisitors: 0, totalContacts: 0 },
      lastVisitAt: null,
      lastEventType: null,
      adStatus: "idle",
      adStatusLabel: "Aucune activité récente",
    };
  }

  const last5Minutes = await queryWindowSummary(5 * 60 * 1000);
  const last10Minutes = await queryWindowSummary(10 * 60 * 1000);
  const last4Hours = await queryWindowSummary(4 * 60 * 60 * 1000);

  const [latestRows]: any = await db.execute(sql`
    SELECT
      UNIX_TIMESTAMP(createdAt) * 1000 AS createdAtMs,
      eventType
    FROM tracking_events
    ORDER BY createdAt DESC
    LIMIT 1
  `);

  const latestCreatedAtMs = Number(latestRows?.[0]?.createdAtMs || 0) || null;
  const latestEventAt = latestCreatedAtMs ? new Date(latestCreatedAtMs) : null;
  const latestEventIso = latestEventAt ? latestEventAt.toISOString() : null;
  const lastEventAgeMs = latestEventAt ? Date.now() - latestEventAt.getTime() : null;
  const hasVeryRecentSignal = lastEventAgeMs !== null && lastEventAgeMs <= 5 * 60 * 1000;
  const hasWarmSignal = lastEventAgeMs !== null && lastEventAgeMs <= 30 * 60 * 1000;

  let adStatus: DashboardLiveSnapshot["adStatus"] = "idle";
  let adStatusLabel = "Aucune activité récente";

  if (
    last5Minutes.pageviews >= 1 ||
    last5Minutes.uniqueVisitors >= 1 ||
    last10Minutes.totalContacts >= 1 ||
    hasVeryRecentSignal
  ) {
    adStatus = "active";
    adStatusLabel = "Publicité active maintenant";
  } else if (last4Hours.pageviews >= 1 || last4Hours.uniqueVisitors >= 1 || hasWarmSignal) {
    adStatus = "warming";
    adStatusLabel = "Trafic récent détecté";
  }

  return {
    last5Minutes,
    last10Minutes,
    last4Hours,
    lastVisitAt: latestEventIso,
    lastEventType: latestRows?.[0]?.eventType || null,
    adStatus,
    adStatusLabel,
  };
}

export async function getDashboardStats(
  startDate?: string,
  endDate?: string,
  preset: DashboardPreset = "custom",
): Promise<DashboardStatsResponse | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const range = buildRangeFromPreset(preset, startDate, endDate);
    const metrics = await queryAggregateMetrics(range.start, range.end);
    const totals = addDerivedMetrics(metrics);
    const daily = await queryDailyMetrics(range.start, range.end);
    const recentEvents = await queryRecentEvents(range.start, range.end);
    const live = await buildLiveSnapshot();

    return {
      meta: {
        preset: range.preset,
        label: range.label,
        startDate: toDateKey(range.start),
        endDate: toDateKey(range.end),
        refreshedAt: new Date().toISOString(),
        sinceMidnight: range.sinceMidnight,
      },
      totals,
      daily,
      recentEvents,
      live,
    };
  } catch (error) {
    console.error("[Dashboard] Failed to get stats:", error);
    return null;
  }
}

export async function getTodayStats() {
  const db = await getDb();
  if (!db) return null;

  const today = new Date().toISOString().slice(0, 10);
  const result = await db.select().from(dailyStats).where(eq(dailyStats.date, today)).limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Stats en temps réel depuis minuit — jamais 24h glissantes.
 */
export async function getLiveStatsSinceMidnight() {
  const db = await getDb();
  if (!db) return null;

  try {
    const [clockRows]: any = await db.execute(sql`
      SELECT
        DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS startDate,
        DATE_FORMAT(NOW(), '%Y-%m-%d') AS endDate,
        UNIX_TIMESTAMP(NOW()) * 1000 AS refreshedAtMs
    `);

    const metrics = await querySinceMidnightMetrics();
    const totals = addDerivedMetrics(metrics);
    const daily = await queryDailyMetricsSinceMidnight();
    const recentEvents = await queryRecentEventsSinceMidnight();
    const live = await buildLiveSnapshot();
    const refreshedAtMs = Number(clockRows?.[0]?.refreshedAtMs || 0) || Date.now();

    return {
      meta: {
        preset: "24h",
        label: "24 h · depuis minuit",
        startDate: clockRows?.[0]?.startDate || toDateKey(startOfDay(new Date())),
        endDate: clockRows?.[0]?.endDate || toDateKey(new Date()),
        refreshedAt: new Date(refreshedAtMs).toISOString(),
        sinceMidnight: true,
      },
      totals,
      daily,
      recentEvents,
      live,
    } satisfies DashboardStatsResponse;
  } catch (error) {
    console.error("[Dashboard] Failed to get live stats since midnight:", error);
    return null;
  }
}

export async function getDashboardStatsByPreset(preset: DashboardPreset) {
  return getDashboardStats(undefined, undefined, preset);
}

export async function insertUtmSession(session: InsertUtmSession) {
  const db = await getDb();
  if (!db) return;
  await db.insert(utmSessions).values(session);
}

export async function getUtmSessionByToken(sessionToken: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(utmSessions)
    .where(eq(utmSessions.sessionToken, sessionToken))
    .limit(1);
  return rows[0];
}

export async function getLatestUtmSessionByFunnelToken(funnelToken: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(utmSessions)
    .where(eq(utmSessions.funnelToken, funnelToken))
    .orderBy(desc(utmSessions.createdAt))
    .limit(1);
  return rows[0];
}

export async function markSessionClicked(sessionToken: string, funnelToken?: string | null) {
  const db = await getDb();
  if (!db) return;

  const patch = { clickedTelegramLink: "yes" as const, clickedAt: new Date() };

  if (sessionToken) {
    await db.update(utmSessions).set(patch).where(eq(utmSessions.sessionToken, sessionToken));
    return;
  }

  if (funnelToken) {
    await db.update(utmSessions).set(patch).where(eq(utmSessions.funnelToken, funnelToken));
  }
}

export async function upsertTelegramLinkage(link: InsertTelegramLinkage) {
  const db = await getDb();
  if (!db) return;

  const existing = await getTelegramLinkageByUserId(link.telegramUserId);
  if (!existing) {
    await db.insert(telegramLinkages).values(link);
    return;
  }

  await db
    .update(telegramLinkages)
    .set({
      funnelToken: existing.funnelToken ?? link.funnelToken ?? null,
      sessionToken: existing.sessionToken ?? link.sessionToken ?? null,
      payloadType: link.payloadType ?? existing.payloadType ?? "group",
      payloadSource: link.payloadSource ?? existing.payloadSource ?? null,
      expiresAt: link.expiresAt ?? existing.expiresAt ?? null,
      resolvedAt: existing.resolvedAt ?? null,
      updatedAt: new Date(),
    })
    .where(eq(telegramLinkages.telegramUserId, link.telegramUserId));
}

export async function getTelegramLinkageByUserId(telegramUserId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(telegramLinkages)
    .where(eq(telegramLinkages.telegramUserId, telegramUserId))
    .limit(1);
  return rows[0];
}

export async function resolveTelegramLinkage(telegramUserId: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(telegramLinkages)
    .set({ resolvedAt: new Date(), updatedAt: new Date() })
    .where(eq(telegramLinkages.telegramUserId, telegramUserId));
}

export async function insertTelegramJoin(join: InsertTelegramJoin) {
  const db = await getDb();
  if (!db) return;
  await db.insert(telegramJoins).values(join);
}

export async function getTelegramJoinByUserId(telegramUserId: string, channelId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(telegramJoins)
    .where(and(eq(telegramJoins.telegramUserId, telegramUserId), eq(telegramJoins.channelId, channelId)))
    .limit(1);
  return rows[0];
}

export async function getAllJoins(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(telegramJoins).orderBy(desc(telegramJoins.joinedAt)).limit(limit);
}

export async function updateMetaEventStatus(
  id: number,
  status: "pending" | "sent" | "failed" | "retrying" | "abandoned",
  metaEventId?: string,
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(telegramJoins)
    .set({
      metaEventSent: status,
      metaEventId: metaEventId ?? null,
      metaEventSentAt: status === "sent" ? new Date() : null,
    })
    .where(eq(telegramJoins.id, id));
}

export async function createMetaEventLog(log: InsertMetaEventLog) {
  const db = await getDb();
  if (!db) return;
  // Idempotent insert. The eventId is the dedup key; webhook/worker retries
  // re-invoking createMetaEventLog must not raise a duplicate-key error
  // (1062), which would otherwise unwind the entire request handler.
  await db
    .insert(metaEventLogs)
    .values(log)
    .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
}

export async function updateMetaEventLog(
  eventId: string,
  patch: Partial<InsertMetaEventLog> & {
    status?: "queued" | "sent" | "failed" | "retrying" | "abandoned";
  },
) {
  const db = await getDb();
  if (!db) return;
  await db.update(metaEventLogs).set(patch).where(eq(metaEventLogs.eventId, eventId));
}

export async function getRetryableMetaEvents(limit = 25) {
  const db = await getDb();
  if (!db) return [];

  const now = new Date();

  return db
    .select()
    .from(metaEventLogs)
    .where(
      and(
        eq(metaEventLogs.retryable, 1),
        or(eq(metaEventLogs.status, "failed"), eq(metaEventLogs.status, "retrying")),
        lte(metaEventLogs.attemptCount, 15),
        or(isNull(metaEventLogs.nextRetryAt), lte(metaEventLogs.nextRetryAt, now)),
      ),
    )
    .orderBy(desc(metaEventLogs.updatedAt))
    .limit(limit);
}

export async function getRecentMetaEventLogs(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(metaEventLogs).orderBy(desc(metaEventLogs.createdAt)).limit(limit);
}

export async function upsertBotStart(start: InsertBotStart) {
  const db = await getDb();
  if (!db) return;

  const existing = await getBotStartByTelegramUserId(start.telegramUserId);
  const providedSession = start.sessionToken ? await getUtmSessionByToken(start.sessionToken) : undefined;
  const existingSession = !providedSession && existing?.sessionToken
    ? await getUtmSessionByToken(existing.sessionToken)
    : undefined;
  const linkedSession = providedSession || existingSession;

  const sessionToken = existing?.sessionToken ?? start.sessionToken ?? null;
  const funnelToken = existing?.funnelToken ?? start.funnelToken ?? linkedSession?.funnelToken ?? null;
  const utmSource = existing?.utmSource ?? start.utmSource ?? linkedSession?.utmSource ?? null;
  const utmMedium = existing?.utmMedium ?? start.utmMedium ?? linkedSession?.utmMedium ?? null;
  const utmCampaign = existing?.utmCampaign ?? start.utmCampaign ?? linkedSession?.utmCampaign ?? null;
  const utmContent = existing?.utmContent ?? start.utmContent ?? linkedSession?.utmContent ?? null;
  const utmTerm = existing?.utmTerm ?? start.utmTerm ?? linkedSession?.utmTerm ?? null;
  const fbclid = existing?.fbclid ?? start.fbclid ?? linkedSession?.fbclid ?? null;
  const fbp = existing?.fbp ?? start.fbp ?? linkedSession?.fbp ?? null;
  const computedAttribution =
    sessionToken || funnelToken || utmSource || utmCampaign || fbclid || fbp
      ? ("attributed_start" as const)
      : ("organic_start" as const);
  // Promote to attributed_start if attribution was previously missing but is now available.
  const attributionStatus =
    existing?.attributionStatus && existing.attributionStatus !== "organic_start" && existing.attributionStatus !== "unknown_start"
      ? existing.attributionStatus
      : computedAttribution;

  if (!existing) {
    const now = new Date();
    await db.insert(botStarts).values({
      ...start,
      sessionToken,
      funnelToken,
      attributionStatus,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      fbclid,
      fbp,
      metaSubscribeStatus: start.metaSubscribeStatus ?? "pending",
      metaSubscribeEventId: start.metaSubscribeEventId ?? null,
      metaSubscribeSentAt: start.metaSubscribeSentAt ?? null,
      firstStartedAt: start.firstStartedAt ?? now,
      startedAt: start.startedAt ?? now,
    });
    return;
  }

  await db
    .update(botStarts)
    .set({
      telegramUsername: start.telegramUsername ?? existing.telegramUsername ?? null,
      telegramFirstName: start.telegramFirstName ?? existing.telegramFirstName ?? null,
      sessionToken,
      funnelToken,
      attributionStatus,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      fbclid,
      fbp,
      // Preserve firstStartedAt; only refresh the latest startedAt.
      firstStartedAt: existing.firstStartedAt ?? new Date(),
      startedAt: new Date(),
    })
    .where(eq(botStarts.telegramUserId, start.telegramUserId));
}

export async function getBotStartByTelegramUserId(telegramUserId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(botStarts)
    .where(eq(botStarts.telegramUserId, telegramUserId))
    .limit(1);
  return rows[0];
}

export async function updateBotStartMetaStatus(
  telegramUserId: string,
  status: "pending" | "sent" | "failed" | "retrying" | "abandoned",
  metaSubscribeEventId?: string,
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(botStarts)
    .set({
      metaSubscribeStatus: status,
      metaSubscribeEventId: metaSubscribeEventId ?? null,
      metaSubscribeSentAt: status === "sent" ? new Date() : null,
    })
    .where(eq(botStarts.telegramUserId, telegramUserId));
}

export async function markBotStartJoined(telegramUserId: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(botStarts)
    .set({ joinedAt: new Date() })
    .where(eq(botStarts.telegramUserId, telegramUserId));
}

export async function getSetting(settingKey: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.settingKey, settingKey))
    .limit(1);
  return rows[0]?.settingValue ?? null;
}

export async function getAllSettings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(siteSettings).orderBy(desc(siteSettings.updatedAt));
}

export async function upsertSetting(settingKey: string, settingValue: string) {
  const db = await getDb();
  if (!db) return;
  const values: InsertSiteSetting = { settingKey, settingValue };
  await db.insert(siteSettings).values(values).onDuplicateKeyUpdate({
    set: { settingValue, updatedAt: new Date() },
  });
}

export async function getJoinStats() {
  const db = await getDb();
  if (!db) {
    return {
      totalJoins: 0,
      todayJoins: 0,
      totalMetaCount: 0,
      todayMetaJoins: 0,
      attributedJoins: 0,
      unattributedJoins: 0,
      bypassJoins: 0,
      conversionRate: "0.0",
    };
  }

  // Bypass joins (organic Telegram members who joined without going through
  // the funnel) are counted separately and excluded from conversion-rate
  // math — they're noise for ad/funnel performance metrics.
  const [rows]: any = await db.execute(sql`
    SELECT
      COUNT(*) AS totalJoins,
      COALESCE(SUM(CASE WHEN tj.attributionStatus <> 'bypass_join' THEN 1 ELSE 0 END), 0) AS funnelJoins,
      COALESCE(SUM(CASE WHEN DATE(tj.joinedAt) = CURRENT_DATE() THEN 1 ELSE 0 END), 0) AS todayJoins,
      COALESCE(SUM(CASE WHEN COALESCE(mel.status, tj.metaEventSent) = 'sent' AND tj.attributionStatus <> 'bypass_join' THEN 1 ELSE 0 END), 0) AS totalMetaCount,
      COALESCE(SUM(CASE WHEN COALESCE(mel.status, tj.metaEventSent) = 'sent' AND DATE(tj.joinedAt) = CURRENT_DATE() AND tj.attributionStatus <> 'bypass_join' THEN 1 ELSE 0 END), 0) AS todayMetaJoins,
      COALESCE(SUM(CASE WHEN tj.attributionStatus = 'attributed_join' THEN 1 ELSE 0 END), 0) AS attributedJoins,
      COALESCE(SUM(CASE WHEN tj.attributionStatus IN ('unattributed_join', 'legacy_unattributed') THEN 1 ELSE 0 END), 0) AS unattributedJoins,
      COALESCE(SUM(CASE WHEN tj.attributionStatus = 'bypass_join' THEN 1 ELSE 0 END), 0) AS bypassJoins
    FROM telegram_joins tj
    LEFT JOIN meta_event_logs mel ON mel.eventId = tj.metaEventId
  `);

  const totalJoins = Number(rows?.[0]?.totalJoins || 0);
  const funnelJoins = Number(rows?.[0]?.funnelJoins || 0);
  const totalMetaCount = Number(rows?.[0]?.totalMetaCount || 0);

  return {
    totalJoins,
    funnelJoins,
    todayJoins: Number(rows?.[0]?.todayJoins || 0),
    totalMetaCount,
    todayMetaJoins: Number(rows?.[0]?.todayMetaJoins || 0),
    attributedJoins: Number(rows?.[0]?.attributedJoins || 0),
    unattributedJoins: Number(rows?.[0]?.unattributedJoins || 0),
    bypassJoins: Number(rows?.[0]?.bypassJoins || 0),
    // Conversion rate is computed against funnel joins (excluding bypass)
    // so external Telegram members who joined directly don't dilute the
    // funnel performance signal.
    conversionRate: funnelJoins > 0 ? ((totalMetaCount / funnelJoins) * 100).toFixed(1) : "0.0",
  };
}

export async function getJoinsByCampaign() {
  const db = await getDb();
  if (!db) return [];
  // Exclude bypass joins from per-campaign aggregations — they have no UTM
  // and would all bucket into "Direct / inconnu", drowning real campaigns.
  const [rows]: any = await db.execute(sql`
    SELECT
      COALESCE(NULLIF(tj.utmCampaign, ''), 'Direct / inconnu') AS campaign,
      COUNT(*) AS joinsCount,
      COALESCE(SUM(CASE WHEN COALESCE(mel.status, tj.metaEventSent) = 'sent' THEN 1 ELSE 0 END), 0) AS metaSentCount,
      COALESCE(SUM(CASE WHEN tj.attributionStatus = 'attributed_join' THEN 1 ELSE 0 END), 0) AS attributedCount
    FROM telegram_joins tj
    LEFT JOIN meta_event_logs mel ON mel.eventId = tj.metaEventId
    WHERE tj.attributionStatus <> 'bypass_join'
    GROUP BY COALESCE(NULLIF(tj.utmCampaign, ''), 'Direct / inconnu')
    ORDER BY joinsCount DESC
  `);
  return rows as Array<{ campaign: string; joinsCount: number; metaSentCount: number; attributedCount: number }>;
}

export async function getBotStartStats() {
  const db = await getDb();
  if (!db) {
    return {
      botStartsCount: 0,
      joinedAfterStartCount: 0,
      notJoinedCount: 0,
      attributedStarts: 0,
      organicStarts: 0,
    };
  }

  const [rows]: any = await db.execute(sql`
    SELECT
      COUNT(*) AS botStartsCount,
      COALESCE(SUM(CASE WHEN joinedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS joinedAfterStartCount,
      COALESCE(SUM(CASE WHEN joinedAt IS NULL THEN 1 ELSE 0 END), 0) AS notJoinedCount,
      COALESCE(SUM(CASE WHEN attributionStatus = 'attributed_start' THEN 1 ELSE 0 END), 0) AS attributedStarts,
      COALESCE(SUM(CASE WHEN attributionStatus = 'organic_start' THEN 1 ELSE 0 END), 0) AS organicStarts
    FROM bot_starts
  `);

  return {
    botStartsCount: Number(rows?.[0]?.botStartsCount || 0),
    joinedAfterStartCount: Number(rows?.[0]?.joinedAfterStartCount || 0),
    notJoinedCount: Number(rows?.[0]?.notJoinedCount || 0),
    attributedStarts: Number(rows?.[0]?.attributedStarts || 0),
    organicStarts: Number(rows?.[0]?.organicStarts || 0),
  };
}

export async function getBotStartsByCampaign() {
  const db = await getDb();
  if (!db) return [];
  const [rows]: any = await db.execute(sql`
    SELECT
      COALESCE(NULLIF(utmCampaign, ''), 'Direct / inconnu') AS campaign,
      COUNT(*) AS startsCount,
      COALESCE(SUM(CASE WHEN joinedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS joinedCount,
      COALESCE(SUM(CASE WHEN attributionStatus = 'attributed_start' THEN 1 ELSE 0 END), 0) AS attributedCount
    FROM bot_starts
    GROUP BY COALESCE(NULLIF(utmCampaign, ''), 'Direct / inconnu')
    ORDER BY startsCount DESC
  `);
  return rows as Array<{ campaign: string; startsCount: number; joinedCount: number; attributedCount: number }>;
}

export async function getRecentMetaActivityWindow(windowMs = 60 * 60 * 1000) {
  const db = await getDb();
  if (!db) {
    return {
      pageViewSentRecently: false,
      subscribeSentRecently: false,
      pageViewLastSentAt: null as Date | null,
      subscribeLastSentAt: null as Date | null,
    };
  }
  const since = new Date(Date.now() - windowMs);
  // Subscribe now fires on /start (eventScope=telegram_start). Legacy
  // telegram_join is kept as a fallback so historical rows still count.
  const [rows]: any = await db.execute(sql`
    SELECT
      MAX(CASE WHEN eventScope = 'pageview' AND status = 'sent' THEN completedAt END) AS pageViewLastSentAt,
      MAX(CASE WHEN eventScope IN ('telegram_start', 'telegram_join') AND status = 'sent' THEN completedAt END) AS subscribeLastSentAt
    FROM meta_event_logs
    WHERE completedAt IS NOT NULL AND completedAt >= ${since}
  `);
  const pv = rows?.[0]?.pageViewLastSentAt ? new Date(rows[0].pageViewLastSentAt) : null;
  const sub = rows?.[0]?.subscribeLastSentAt ? new Date(rows[0].subscribeLastSentAt) : null;
  return {
    pageViewSentRecently: Boolean(pv),
    subscribeSentRecently: Boolean(sub),
    pageViewLastSentAt: pv,
    subscribeLastSentAt: sub,
  };
}

export async function getMetaEventSummary() {
  const db = await getDb();
  if (!db) {
    return {
      totalStarts: 0,
      totalSent: 0,
      totalFailed: 0,
      totalPending: 0,
      todayStarts: 0,
      todaySent: 0,
      todayFailed: 0,
      todayPending: 0,
    };
  }

  // Subscribe now fires on /start (eventScope='telegram_start'); the legacy
  // 'telegram_join' scope is kept so historical rows (before the conversion
  // moment was moved) still count toward the dashboard totals.
  const [rows]: any = await db.execute(sql`
    SELECT
      COUNT(*) AS totalStarts,
      COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS totalSent,
      COALESCE(SUM(CASE WHEN status IN ('failed', 'abandoned') THEN 1 ELSE 0 END), 0) AS totalFailed,
      COALESCE(SUM(CASE WHEN status IN ('queued', 'retrying') THEN 1 ELSE 0 END), 0) AS totalPending,
      COALESCE(SUM(CASE WHEN DATE(createdAt) = CURRENT_DATE() THEN 1 ELSE 0 END), 0) AS todayStarts,
      COALESCE(SUM(CASE WHEN status = 'sent' AND DATE(createdAt) = CURRENT_DATE() THEN 1 ELSE 0 END), 0) AS todaySent,
      COALESCE(SUM(CASE WHEN status IN ('failed', 'abandoned') AND DATE(createdAt) = CURRENT_DATE() THEN 1 ELSE 0 END), 0) AS todayFailed,
      COALESCE(SUM(CASE WHEN status IN ('queued', 'retrying') AND DATE(createdAt) = CURRENT_DATE() THEN 1 ELSE 0 END), 0) AS todayPending
    FROM meta_event_logs
    WHERE eventScope IN ('telegram_start', 'telegram_join')
  `);

  return {
    totalStarts: Number(rows?.[0]?.totalStarts || 0),
    totalSent: Number(rows?.[0]?.totalSent || 0),
    totalFailed: Number(rows?.[0]?.totalFailed || 0),
    totalPending: Number(rows?.[0]?.totalPending || 0),
    todayStarts: Number(rows?.[0]?.todayStarts || 0),
    todaySent: Number(rows?.[0]?.todaySent || 0),
    todayFailed: Number(rows?.[0]?.todayFailed || 0),
    todayPending: Number(rows?.[0]?.todayPending || 0),
  };
}

export async function getRecentBotStartsWithMetaStatus(limit = 50) {
  const db = await getDb();
  if (!db) return [];

  // Subscribe now fires on /start (eventScope='telegram_start'); fall back
  // to 'telegram_join' for legacy rows still on the old code path.
  // sentReminders is a comma-separated list of reminderKey values (e.g.
  // "15m,1h,4h") so the dashboard can render reminder-progression dots.
  const [rows]: any = await db.execute(sql`
    SELECT
      bs.id,
      bs.telegramUserId,
      bs.telegramUsername,
      bs.telegramFirstName,
      COALESCE(NULLIF(bs.utmSource, ''), us.utmSource, 'Direct / inconnu') AS utmSource,
      COALESCE(NULLIF(bs.utmCampaign, ''), us.utmCampaign, 'Direct / inconnu') AS utmCampaign,
      COALESCE(NULLIF(bs.utmMedium, ''), us.utmMedium, '—') AS utmMedium,
      COALESCE(NULLIF(bs.utmContent, ''), us.utmContent, '—') AS utmContent,
      COALESCE(NULLIF(bs.utmTerm, ''), us.utmTerm, '—') AS utmTerm,
      NULLIF(bs.sessionToken, '') AS sessionToken,
      NULLIF(bs.funnelToken, '') AS funnelToken,
      COALESCE(NULLIF(bs.fbclid, ''), NULLIF(us.fbclid, '')) AS fbclid,
      NULLIF(us.ipAddress, '') AS ipAddress,
      NULLIF(us.userAgent, '') AS userAgent,
      COALESCE(mel.status, bs.metaSubscribeStatus, 'pending') AS metaSubscribeStatus,
      COALESCE(mel.eventId, bs.metaSubscribeEventId) AS metaSubscribeEventId,
      COALESCE(mel.completedAt, bs.metaSubscribeSentAt) AS metaSubscribeSentAt,
      mel.eventScope AS metaSubscribeScope,
      bs.attributionStatus,
      bs.startedAt,
      bs.joinedAt,
      (
        SELECT GROUP_CONCAT(trj.reminderKey ORDER BY trj.dueAt ASC SEPARATOR ',')
        FROM telegram_reminder_jobs trj
        WHERE trj.telegramUserId = bs.telegramUserId
          AND trj.status = 'sent'
      ) AS sentReminders
    FROM bot_starts bs
    LEFT JOIN utm_sessions us ON us.sessionToken = bs.sessionToken
    LEFT JOIN meta_event_logs mel
      ON mel.telegramUserId = bs.telegramUserId
      AND mel.eventScope IN ('telegram_start', 'telegram_join')
    ORDER BY bs.startedAt DESC
    LIMIT ${limit}
  `);

  return rows as Array<{
    id: number;
    telegramUserId: string;
    telegramUsername: string | null;
    telegramFirstName: string | null;
    utmSource: string;
    utmCampaign: string;
    utmMedium: string;
    utmContent: string;
    utmTerm: string;
    sessionToken: string | null;
    funnelToken: string | null;
    fbclid: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    attributionStatus: string | null;
    metaSubscribeStatus: "queued" | "retrying" | "pending" | "sent" | "failed" | "abandoned";
    metaSubscribeEventId: string | null;
    metaSubscribeSentAt: Date | null;
    metaSubscribeScope: string | null;
    startedAt: Date;
    joinedAt: Date | null;
    sentReminders: string | null;
  }>;
}

export async function getRecentMetaDebugLog(limit = 5) {
  const db = await getDb();
  if (!db) {
    return {
      pageviews: [],
      sessions: [],
      joins: [],
      subscribes: [],
    };
  }

  const [pageviewRows]: any = await db.execute(sql`
    SELECT
      te.id,
      te.eventType,
      NULLIF(te.eventSource, '') AS eventSource,
      NULLIF(te.eventId, '') AS eventId,
      NULLIF(te.visitorId, '') AS visitorId,
      NULLIF(te.sessionToken, '') AS sessionToken,
      NULLIF(te.funnelToken, '') AS funnelToken,
      NULLIF(te.sourceUrl, '') AS sourceUrl,
      NULLIF(te.referrer, '') AS referrer,
      NULLIF(te.country, '') AS country,
      NULLIF(te.ip, '') AS ip,
      NULLIF(te.userAgent, '') AS userAgent,
      te.createdAt,
      mel.status AS metaStatus,
      mel.httpStatus,
      mel.errorMessage,
      mel.attemptCount,
      mel.retryable,
      mel.completedAt AS metaCompletedAt
    FROM tracking_events te
    LEFT JOIN meta_event_logs mel ON mel.eventId = te.eventId AND mel.eventScope = 'pageview'
    WHERE te.eventType = 'pageview'
    ORDER BY te.createdAt DESC
    LIMIT ${limit}
  `);

  const [sessionRows]: any = await db.execute(sql`
    SELECT
      id,
      sessionToken,
      NULLIF(funnelToken, '') AS funnelToken,
      NULLIF(visitorId, '') AS visitorId,
      COALESCE(NULLIF(utmSource, ''), 'Direct / inconnu') AS utmSource,
      COALESCE(NULLIF(utmMedium, ''), '—') AS utmMedium,
      COALESCE(NULLIF(utmCampaign, ''), '—') AS utmCampaign,
      COALESCE(NULLIF(utmContent, ''), '—') AS utmContent,
      COALESCE(NULLIF(utmTerm, ''), '—') AS utmTerm,
      NULLIF(fbclid, '') AS fbclid,
      NULLIF(fbp, '') AS fbp,
      NULLIF(ipAddress, '') AS ipAddress,
      NULLIF(userAgent, '') AS userAgent,
      NULLIF(referrer, '') AS referrer,
      NULLIF(landingPage, '') AS landingPage,
      clickedTelegramLink,
      clickedAt,
      createdAt
    FROM utm_sessions
    ORDER BY createdAt DESC
    LIMIT ${limit}
  `);

  const [joinRows]: any = await db.execute(sql`
    SELECT
      tj.id,
      tj.telegramUserId,
      tj.telegramUsername,
      tj.telegramFirstName,
      tj.channelTitle,
      COALESCE(mel.status, tj.metaEventSent, 'pending') AS metaEventSent,
      tj.metaEventId,
      COALESCE(mel.completedAt, tj.metaEventSentAt) AS metaEventSentAt,
      COALESCE(NULLIF(tj.utmSource, ''), 'Direct / inconnu') AS utmSource,
      COALESCE(NULLIF(tj.utmMedium, ''), '—') AS utmMedium,
      COALESCE(NULLIF(tj.utmCampaign, ''), '—') AS utmCampaign,
      NULLIF(tj.sessionToken, '') AS sessionToken,
      NULLIF(tj.funnelToken, '') AS funnelToken,
      NULLIF(tj.attributionStatus, '') AS attributionStatus,
      NULLIF(tj.fbclid, '') AS fbclid,
      NULLIF(tj.ipAddress, '') AS ipAddress,
      NULLIF(tj.userAgent, '') AS userAgent,
      tj.joinedAt,
      tj.createdAt,
      mel.errorMessage,
      mel.httpStatus,
      mel.attemptCount,
      mel.retryable
    FROM telegram_joins tj
    LEFT JOIN meta_event_logs mel ON mel.eventId = tj.metaEventId
    ORDER BY tj.joinedAt DESC
    LIMIT ${limit}
  `);

  const [subscribeRows]: any = await db.execute(sql`
    SELECT
      tj.id,
      tj.telegramUserId,
      tj.telegramUsername,
      tj.telegramFirstName,
      COALESCE(mel.status, tj.metaEventSent, 'pending') AS metaSubscribeStatus,
      tj.metaEventId AS metaSubscribeEventId,
      COALESCE(mel.completedAt, tj.metaEventSentAt) AS metaSubscribeSentAt,
      bs.startedAt,
      bs.joinedAt,
      COALESCE(NULLIF(tj.utmSource, ''), NULLIF(bs.utmSource, ''), 'Direct / inconnu') AS utmSource,
      COALESCE(NULLIF(tj.utmCampaign, ''), NULLIF(bs.utmCampaign, ''), 'Direct / inconnu') AS utmCampaign,
      COALESCE(NULLIF(tj.utmMedium, ''), NULLIF(bs.utmMedium, ''), '—') AS utmMedium,
      NULLIF(COALESCE(tj.sessionToken, bs.sessionToken), '') AS sessionToken,
      NULLIF(COALESCE(tj.funnelToken, bs.funnelToken), '') AS funnelToken,
      NULLIF(tj.attributionStatus, '') AS attributionStatus,
      NULLIF(COALESCE(tj.fbclid, bs.fbclid), '') AS fbclid,
      NULLIF(COALESCE(tj.fbp, bs.fbp), '') AS fbp,
      NULLIF(COALESCE(tj.ipAddress, bs.ipAddress), '') AS ipAddress,
      NULLIF(COALESCE(tj.userAgent, bs.userAgent), '') AS userAgent,
      us.createdAt AS sessionCreatedAt,
      mel.errorMessage,
      mel.httpStatus,
      mel.attemptCount,
      mel.retryable
    FROM telegram_joins tj
    LEFT JOIN bot_starts bs ON bs.telegramUserId = tj.telegramUserId
    LEFT JOIN utm_sessions us ON us.sessionToken = COALESCE(tj.sessionToken, bs.sessionToken)
    LEFT JOIN meta_event_logs mel ON mel.eventId = tj.metaEventId
    ORDER BY tj.joinedAt DESC
    LIMIT ${limit}
  `);

  return {
    pageviews: pageviewRows,
    sessions: sessionRows,
    joins: joinRows,
    subscribes: subscribeRows,
  };
}

export async function tryRecordTelegramUpdateId(updateId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return true; // No DB = nothing to dedupe against; let the handler proceed.
  if (!Number.isFinite(updateId)) return true;
  try {
    await db.insert(telegramUpdateLog).values({ updateId });
    return true;
  } catch (error) {
    // MySQL duplicate key (ER_DUP_ENTRY = 1062) means we've already processed this update.
    const code = (error as { code?: string; errno?: number })?.errno;
    if (code === 1062) return false;
    throw error;
  }
}

export async function deleteTelegramUpdateId(updateId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  if (!Number.isFinite(updateId)) return;
  await db.delete(telegramUpdateLog).where(eq(telegramUpdateLog.updateId, updateId));
}

export async function updateTelegramJoinMetaStatusByEventId(
  eventId: string,
  status: "pending" | "sent" | "failed" | "retrying" | "abandoned",
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(telegramJoins)
    .set({
      metaEventSent: status,
      metaEventSentAt: status === "sent" ? new Date() : null,
    })
    .where(eq(telegramJoins.metaEventId, eventId));
}

export async function getNonJoinersAfterR3() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(botStarts)
    .where(and(eq(botStarts.reminder3Sent, "sent"), eq(botStarts.botBlocked, 0)));
}

export async function getDailyReportStats() {
  const db = await getDb();
  if (!db) return null;

  const [rows]: any = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN DATE(joinedAt) = CURRENT_DATE() - INTERVAL 1 DAY THEN 1 ELSE 0 END), 0) AS todayJoins,
      COALESCE(SUM(CASE WHEN DATE(joinedAt) = CURRENT_DATE() - INTERVAL 1 DAY AND metaEventSent = 'sent' THEN 1 ELSE 0 END), 0) AS todayMetaJoins,
      COALESCE(SUM(CASE WHEN DATE(reminderSentAt) = CURRENT_DATE() - INTERVAL 1 DAY THEN 1 ELSE 0 END), 0) AS todayReminders1,
      COALESCE(SUM(CASE WHEN DATE(reminder2SentAt) = CURRENT_DATE() - INTERVAL 1 DAY THEN 1 ELSE 0 END), 0) AS todayReminders2,
      COALESCE(SUM(CASE WHEN DATE(reminder3SentAt) = CURRENT_DATE() - INTERVAL 1 DAY THEN 1 ELSE 0 END), 0) AS todayReminders3,
      COUNT(*) AS botStartsCount,
      (SELECT COUNT(*) FROM telegram_joins WHERE attributionStatus <> 'bypass_join') AS totalJoinsCount,
      (SELECT COALESCE(SUM(CASE WHEN metaEventSent = 'sent' AND attributionStatus <> 'bypass_join' THEN 1 ELSE 0 END), 0) FROM telegram_joins) AS totalMetaCount
    FROM bot_starts
  `);

  const botStartsCount = Number(rows?.[0]?.botStartsCount || 0);
  const todayJoins = Number(rows?.[0]?.todayJoins || 0);

  return {
    todayJoins,
    todayMetaJoins: Number(rows?.[0]?.todayMetaJoins || 0),
    todayReminders1: Number(rows?.[0]?.todayReminders1 || 0),
    todayReminders2: Number(rows?.[0]?.todayReminders2 || 0),
    todayReminders3: Number(rows?.[0]?.todayReminders3 || 0),
    botStartsCount,
    totalJoinsCount: Number(rows?.[0]?.totalJoinsCount || 0),
    totalMetaCount: Number(rows?.[0]?.totalMetaCount || 0),
    conversionRate: botStartsCount > 0 ? ((todayJoins / botStartsCount) * 100).toFixed(1) : "0.0",
  };
}

export async function getWeeklyJoins() {
  const db = await getDb();
  if (!db) return 0;
  const [rows]: any = await db.execute(sql`
    SELECT COALESCE(COUNT(*), 0) AS weeklyJoins
    FROM telegram_joins
    WHERE YEARWEEK(joinedAt, 1) = YEARWEEK(CURRENT_DATE(), 1)
  `);
  return Number(rows?.[0]?.weeklyJoins || 0);
}

export async function getTelegramCumulativeReportStats(startAt: Date, endAt: Date) {
  const db = await getDb();
  if (!db) {
    return {
      landingVisits: 0,
      botStarts: 0,
      channelJoins: 0,
    };
  }

  const [rows]: any = await db.execute(sql`
    SELECT
      (
        SELECT COALESCE(COUNT(*), 0)
        FROM tracking_events
        WHERE eventType = 'pageview'
          AND createdAt >= ${startAt}
          AND createdAt < ${endAt}
      ) AS landingVisits,
      (
        SELECT COALESCE(COUNT(*), 0)
        FROM bot_starts
        WHERE startedAt >= ${startAt}
          AND startedAt < ${endAt}
      ) AS botStarts,
      (
        SELECT COALESCE(COUNT(*), 0)
        FROM telegram_joins
        WHERE joinedAt >= ${startAt}
          AND joinedAt < ${endAt}
      ) AS channelJoins
  `);

  return {
    landingVisits: Number(rows?.[0]?.landingVisits || 0),
    botStarts: Number(rows?.[0]?.botStarts || 0),
    channelJoins: Number(rows?.[0]?.channelJoins || 0),
  };
}

export async function getTelegramRecipientsByUsernames(usernames: string[]) {
  const db = await getDb();
  const normalizedUsernames = Array.from(
    new Set(
      usernames
        .map((username) => username.replace(/^@/, "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  if (!db || normalizedUsernames.length === 0) {
    return [] as Array<{
      telegramUserId: string;
      telegramUsername: string | null;
      telegramFirstName: string | null;
      startedAt: Date;
    }>;
  }

  const conditions = sql.join(
    normalizedUsernames.map((username) => sql`LOWER(${botStarts.telegramUsername}) = ${username}`),
    sql` OR `,
  );

  const [rows]: any = await db.execute(sql`
    SELECT telegramUserId, telegramUsername, telegramFirstName, startedAt
    FROM bot_starts
    WHERE ${conditions}
    ORDER BY startedAt DESC
  `);

  return rows as Array<{
    telegramUserId: string;
    telegramUsername: string | null;
    telegramFirstName: string | null;
    startedAt: Date;
  }>;
}
