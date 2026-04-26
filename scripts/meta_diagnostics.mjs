import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const url = new URL(databaseUrl);
const config = {
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''),
  ssl: url.searchParams.get('ssl') === 'false' ? undefined : {},
};

const connection = await mysql.createConnection(config);

async function query(sql, params = []) {
  const [rows] = await connection.execute(sql, params);
  return rows;
}

try {
  const [trackingLast24h, recentTracking, recentSessions, recentBotStarts, recentJoins] = await Promise.all([
    query(`
      select
        eventType,
        count(*) as total,
        min(createdAt) as first_seen,
        max(createdAt) as last_seen
      from tracking_events
      where createdAt >= (utc_timestamp() - interval 1 day)
      group by eventType
      order by total desc, eventType asc
    `),
    query(`
      select id, eventType, eventSource, visitorId, referrer, createdAt
      from tracking_events
      order by id desc
      limit 20
    `),
    query(`
      select id, sessionToken, utmSource, utmMedium, utmCampaign, fbclid,
             clickedTelegramLink, createdAt, clickedAt, landingPage, referrer
      from utm_sessions
      order by id desc
      limit 20
    `),
    query(`
      select id, telegramUserId, telegramUsername, telegramFirstName, sessionToken,
             utmSource, utmCampaign, metaSubscribeStatus, metaSubscribeEventId,
             metaSubscribeSentAt, startedAt
      from bot_starts
      order by id desc
      limit 20
    `),
    query(`
      select id, telegramUserId, telegramUsername, telegramFirstName, sessionToken,
             utmSource, utmCampaign, metaEventSent, metaEventId, metaEventSentAt,
             joinedAt
      from telegram_joins
      order by id desc
      limit 20
    `),
  ]);

  const report = {
    env: {
      meta_pixel_id_present: Boolean(process.env.META_PIXEL_ID),
      meta_conversions_token_present: Boolean(process.env.META_CONVERSIONS_TOKEN),
      meta_pixel_id_tail: process.env.META_PIXEL_ID ? String(process.env.META_PIXEL_ID).slice(-6) : null,
    },
    tracking_last_24h: trackingLast24h,
    recent_tracking_events: recentTracking,
    recent_utm_sessions: recentSessions,
    recent_bot_starts: recentBotStarts,
    recent_telegram_joins: recentJoins,
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  await connection.end();
}
