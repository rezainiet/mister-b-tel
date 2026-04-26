import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable");
  }

  const [schemaNameRows]: any = await db.execute(sql`SELECT DATABASE() AS dbName`);
  const dbName = schemaNameRows?.[0]?.dbName as string;

  const [tableRows]: any = await db.execute(sql`
    SELECT table_name AS tableName
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name IN ('utm_sessions', 'tracking_events', 'bot_starts', 'telegram_joins', 'meta_event_logs')
    ORDER BY table_name
  `);

  const [columnRows]: any = await db.execute(sql`
    SELECT table_name AS tableName, column_name AS columnName
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name IN ('utm_sessions', 'tracking_events', 'bot_starts', 'telegram_joins', 'meta_event_logs')
    ORDER BY table_name, ordinal_position
  `);

  const [totalsRows]: any = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM tracking_events WHERE eventType = 'pageview') AS websiteVisits,
      (SELECT COUNT(*) FROM tracking_events WHERE eventType = 'telegram_click') AS telegramClicks,
      (SELECT COUNT(*) FROM bot_starts) AS botStarts,
      (SELECT COUNT(*) FROM telegram_joins) AS joins,
      (SELECT COUNT(*) FROM telegram_joins WHERE sessionToken IS NOT NULL OR fbclid IS NOT NULL OR utmSource IS NOT NULL) AS attributedJoins,
      (SELECT COUNT(*) FROM telegram_joins WHERE sessionToken IS NULL AND fbclid IS NULL AND utmSource IS NULL) AS unattributedJoins,
      (SELECT COUNT(*) FROM bot_starts WHERE sessionToken IS NOT NULL OR fbclid IS NOT NULL OR utmSource IS NOT NULL) AS attributedBotStarts,
      (SELECT COUNT(*) FROM bot_starts WHERE sessionToken IS NULL AND fbclid IS NULL AND utmSource IS NULL) AS unattributedBotStarts,
      (SELECT COUNT(*) FROM telegram_joins WHERE metaEventSent = 'sent') AS joinMetaSent,
      (SELECT COUNT(*) FROM telegram_joins WHERE metaEventSent = 'failed') AS joinMetaFailed,
      (SELECT COUNT(*) FROM telegram_joins WHERE metaEventSent = 'pending') AS joinMetaPending,
      (SELECT COUNT(*) FROM bot_starts WHERE metaSubscribeStatus = 'sent') AS botMetaSent,
      (SELECT COUNT(*) FROM bot_starts WHERE metaSubscribeStatus = 'failed') AS botMetaFailed,
      (SELECT COUNT(*) FROM bot_starts WHERE metaSubscribeStatus = 'pending') AS botMetaPending
  `);

  const [funnelRows]: any = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM bot_starts bs INNER JOIN telegram_joins tj ON tj.telegramUserId = bs.telegramUserId) AS startsWithJoin,
      (SELECT COUNT(*) FROM bot_starts bs LEFT JOIN telegram_joins tj ON tj.telegramUserId = bs.telegramUserId WHERE tj.id IS NULL) AS startsWithoutJoin,
      (SELECT COUNT(*) FROM telegram_joins tj INNER JOIN bot_starts bs ON bs.telegramUserId = tj.telegramUserId) AS joinsWithStart,
      (SELECT COUNT(*) FROM telegram_joins tj LEFT JOIN bot_starts bs ON bs.telegramUserId = tj.telegramUserId WHERE bs.id IS NULL) AS joinsWithoutStart
  `);

  const [botStartCoverageRows]: any = await db.execute(sql`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN sessionToken IS NOT NULL THEN 1 ELSE 0 END), 0) AS withSessionToken,
      COALESCE(SUM(CASE WHEN fbclid IS NOT NULL THEN 1 ELSE 0 END), 0) AS withFbclid,
      COALESCE(SUM(CASE WHEN utmSource IS NOT NULL THEN 1 ELSE 0 END), 0) AS withUtmSource,
      COALESCE(SUM(CASE WHEN utmCampaign IS NOT NULL THEN 1 ELSE 0 END), 0) AS withUtmCampaign
    FROM bot_starts
  `);

  const [joinCoverageRows]: any = await db.execute(sql`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN sessionToken IS NOT NULL THEN 1 ELSE 0 END), 0) AS withSessionToken,
      COALESCE(SUM(CASE WHEN fbclid IS NOT NULL THEN 1 ELSE 0 END), 0) AS withFbclid,
      COALESCE(SUM(CASE WHEN utmSource IS NOT NULL THEN 1 ELSE 0 END), 0) AS withUtmSource,
      COALESCE(SUM(CASE WHEN utmCampaign IS NOT NULL THEN 1 ELSE 0 END), 0) AS withUtmCampaign,
      COALESCE(SUM(CASE WHEN metaEventId IS NOT NULL THEN 1 ELSE 0 END), 0) AS withMetaEventId
    FROM telegram_joins
  `);

  const [metaLogCountRows]: any = await db.execute(sql`
    SELECT COUNT(*) AS count
    FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'meta_event_logs'
  `);

  let metaEventLogsCount: number | null = null;
  if (Number(metaLogCountRows?.[0]?.count || 0) > 0) {
    const [metaRows]: any = await db.execute(sql`SELECT COUNT(*) AS total FROM meta_event_logs`);
    metaEventLogsCount = Number(metaRows?.[0]?.total || 0);
  }

  const [recentJoinRows]: any = await db.execute(sql`
    SELECT
      id,
      telegramUserId,
      telegramUsername,
      sessionToken,
      utmSource,
      fbclid,
      metaEventSent,
      metaEventId,
      joinedAt
    FROM telegram_joins
    ORDER BY joinedAt DESC
    LIMIT 10
  `);

  const [recentBotRows]: any = await db.execute(sql`
    SELECT
      id,
      telegramUserId,
      telegramUsername,
      sessionToken,
      utmSource,
      fbclid,
      metaSubscribeStatus,
      metaSubscribeEventId,
      startedAt
    FROM bot_starts
    ORDER BY startedAt DESC
    LIMIT 10
  `);

  const totals = totalsRows?.[0] || {};
  const joinMetaAttempts = Number(totals.joinMetaSent || 0) + Number(totals.joinMetaFailed || 0) + Number(totals.joinMetaPending || 0);
  const botMetaAttempts = Number(totals.botMetaSent || 0) + Number(totals.botMetaFailed || 0) + Number(totals.botMetaPending || 0);

  const result = {
    database: dbName,
    schema: {
      tablesPresent: tableRows.map((row: any) => row.tableName),
      columnsByTable: columnRows.reduce((acc: Record<string, string[]>, row: any) => {
        acc[row.tableName] = acc[row.tableName] || [];
        acc[row.tableName].push(row.columnName);
        return acc;
      }, {}),
      metaEventLogsExists: Number(metaLogCountRows?.[0]?.count || 0) > 0,
      metaEventLogsCount,
    },
    liveCounts: {
      websiteVisits: Number(totals.websiteVisits || 0),
      telegramClicks: Number(totals.telegramClicks || 0),
      botStarts: Number(totals.botStarts || 0),
      joins: Number(totals.joins || 0),
      attributedJoins: Number(totals.attributedJoins || 0),
      unattributedJoins: Number(totals.unattributedJoins || 0),
      attributedBotStarts: Number(totals.attributedBotStarts || 0),
      unattributedBotStarts: Number(totals.unattributedBotStarts || 0),
      joinMetaSent: Number(totals.joinMetaSent || 0),
      joinMetaFailed: Number(totals.joinMetaFailed || 0),
      joinMetaPending: Number(totals.joinMetaPending || 0),
      botMetaSent: Number(totals.botMetaSent || 0),
      botMetaFailed: Number(totals.botMetaFailed || 0),
      botMetaPending: Number(totals.botMetaPending || 0),
      joinMetaSuccessRate: joinMetaAttempts ? Number((Number(totals.joinMetaSent || 0) / joinMetaAttempts).toFixed(4)) : null,
      joinMetaFailureRate: joinMetaAttempts ? Number((Number(totals.joinMetaFailed || 0) / joinMetaAttempts).toFixed(4)) : null,
      overallMetaSuccessRate: joinMetaAttempts + botMetaAttempts
        ? Number(((Number(totals.joinMetaSent || 0) + Number(totals.botMetaSent || 0)) / (joinMetaAttempts + botMetaAttempts)).toFixed(4))
        : null,
      overallMetaFailureRate: joinMetaAttempts + botMetaAttempts
        ? Number(((Number(totals.joinMetaFailed || 0) + Number(totals.botMetaFailed || 0)) / (joinMetaAttempts + botMetaAttempts)).toFixed(4))
        : null,
    },
    funnelIntegrity: {
      startsWithJoin: Number(funnelRows?.[0]?.startsWithJoin || 0),
      startsWithoutJoin: Number(funnelRows?.[0]?.startsWithoutJoin || 0),
      joinsWithStart: Number(funnelRows?.[0]?.joinsWithStart || 0),
      joinsWithoutStart: Number(funnelRows?.[0]?.joinsWithoutStart || 0),
    },
    attributionCoverage: {
      botStarts: {
        total: Number(botStartCoverageRows?.[0]?.total || 0),
        withSessionToken: Number(botStartCoverageRows?.[0]?.withSessionToken || 0),
        withFbclid: Number(botStartCoverageRows?.[0]?.withFbclid || 0),
        withUtmSource: Number(botStartCoverageRows?.[0]?.withUtmSource || 0),
        withUtmCampaign: Number(botStartCoverageRows?.[0]?.withUtmCampaign || 0),
      },
      joins: {
        total: Number(joinCoverageRows?.[0]?.total || 0),
        withSessionToken: Number(joinCoverageRows?.[0]?.withSessionToken || 0),
        withFbclid: Number(joinCoverageRows?.[0]?.withFbclid || 0),
        withUtmSource: Number(joinCoverageRows?.[0]?.withUtmSource || 0),
        withUtmCampaign: Number(joinCoverageRows?.[0]?.withUtmCampaign || 0),
        withMetaEventId: Number(joinCoverageRows?.[0]?.withMetaEventId || 0),
      },
    },
    recentSamples: {
      joins: recentJoinRows,
      botStarts: recentBotRows,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
