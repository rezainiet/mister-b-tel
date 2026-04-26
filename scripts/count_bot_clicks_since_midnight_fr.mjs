import mysql from 'mysql2/promise';

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const map = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );

  const asUtcMs = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return asUtcMs - date.getTime();
}

function getParisMidnightUtc(now = new Date()) {
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const map = Object.fromEntries(
    dateParts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );

  const utcGuess = new Date(
    Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), 0, 0, 0),
  );
  const offsetMs = getTimeZoneOffsetMs(utcGuess, 'Europe/Paris');

  return new Date(utcGuess.getTime() - offsetMs);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not available');
  process.exit(1);
}

const midnightUtc = getParisMidnightUtc();
const connection = await mysql.createConnection(databaseUrl);

try {
  const [trackingRows] = await connection.execute(
    `
      SELECT
        COUNT(*) AS totalClicks,
        COUNT(DISTINCT visitorId) AS uniqueVisitors
      FROM tracking_events
      WHERE eventType = 'telegram_click'
        AND createdAt >= ?
    `,
    [midnightUtc],
  );

  const [sessionRows] = await connection.execute(
    `
      SELECT
        COUNT(*) AS clickedSessions,
        COUNT(DISTINCT sessionToken) AS uniqueSessionTokens
      FROM utm_sessions
      WHERE clickedTelegramLink = 'yes'
        AND clickedAt IS NOT NULL
        AND clickedAt >= ?
    `,
    [midnightUtc],
  );

  const [sourceRows] = await connection.execute(
    `
      SELECT
        COALESCE(eventSource, 'unknown') AS eventSource,
        COUNT(*) AS clicks,
        COUNT(DISTINCT visitorId) AS uniqueVisitors
      FROM tracking_events
      WHERE eventType = 'telegram_click'
        AND createdAt >= ?
      GROUP BY COALESCE(eventSource, 'unknown')
      ORDER BY clicks DESC, eventSource ASC
    `,
    [midnightUtc],
  );

  const [groupOnlyRows] = await connection.execute(
    `
      SELECT
        COUNT(*) AS totalClicks,
        COUNT(DISTINCT visitorId) AS uniqueVisitors
      FROM tracking_events
      WHERE eventType = 'telegram_click'
        AND eventSource IN ('telegram_group_cta', 'telegram_group_button')
        AND createdAt >= ?
    `,
    [midnightUtc],
  );

  const [latestRows] = await connection.execute(
    `
      SELECT
        id,
        eventSource,
        visitorId,
        createdAt
      FROM tracking_events
      WHERE eventType = 'telegram_click'
        AND createdAt >= ?
      ORDER BY createdAt DESC
      LIMIT 5
    `,
    [midnightUtc],
  );

  const result = {
    timezone: 'Europe/Paris',
    parisMidnightUtc: midnightUtc.toISOString(),
    tracking: trackingRows[0],
    sessions: sessionRows[0],
    groupOnly: groupOnlyRows[0],
    bySource: sourceRows,
    latest: latestRows,
  };

  console.log(JSON.stringify(result, null, 2));
} finally {
  await connection.end();
}
