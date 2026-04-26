import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL manquante');
  process.exit(1);
}

const connection = await mysql.createConnection(databaseUrl);

try {
  const [nowRows] = await connection.query(`
    SELECT
      NOW() AS sql_now,
      UTC_TIMESTAMP() AS sql_utc_now,
      @@session.time_zone AS session_tz,
      @@global.time_zone AS global_tz
  `);

  const [eventRows] = await connection.query(`
    SELECT id, eventType, visitorId, createdAt
    FROM tracking_events
    ORDER BY createdAt DESC
    LIMIT 10
  `);

  const [aggregateRows] = await connection.query(`
    SELECT
      COUNT(*) AS all_events,
      SUM(CASE WHEN createdAt >= NOW() - INTERVAL 4 HOUR THEN 1 ELSE 0 END) AS last_4h_sql_now,
      SUM(CASE WHEN createdAt >= UTC_TIMESTAMP() - INTERVAL 4 HOUR THEN 1 ELSE 0 END) AS last_4h_sql_utc,
      SUM(CASE WHEN DATE(createdAt) = CURDATE() THEN 1 ELSE 0 END) AS today_by_curdate
    FROM tracking_events
  `);

  console.log(JSON.stringify({
    now: nowRows[0],
    recentEvents: eventRows,
    aggregateProbe: aggregateRows[0],
  }, null, 2));
} finally {
  await connection.end();
}
