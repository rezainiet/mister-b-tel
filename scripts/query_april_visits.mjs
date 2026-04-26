import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;
const targetDates = ['2026-04-22', '2026-04-23'];

if (!databaseUrl) {
  console.error(JSON.stringify({ error: 'DATABASE_URL is not set' }, null, 2));
  process.exit(1);
}

const connection = await mysql.createConnection(databaseUrl);

try {
  const [dailyRows] = await connection.query(
    `
      SELECT date, pageviews, uniqueVisitors, whatsappClicks, telegramClicks
      FROM daily_stats
      WHERE date IN ('2026-04-22', '2026-04-23')
      ORDER BY date ASC
    `,
  );

  const [eventRows] = await connection.query(
    `
      SELECT DATE(createdAt) AS date,
             COUNT(*) AS pageviewEvents,
             COUNT(DISTINCT CASE WHEN visitorId IS NOT NULL AND visitorId <> '' THEN visitorId END) AS uniqueVisitorEvents
      FROM tracking_events
      WHERE eventType = 'pageview'
        AND DATE(createdAt) IN ('2026-04-22', '2026-04-23')
      GROUP BY DATE(createdAt)
      ORDER BY DATE(createdAt) ASC
    `,
  );

  const dailyMap = new Map(
    dailyRows.map((row) => [row.date, row]),
  );
  const eventMap = new Map(
    eventRows.map((row) => [String(row.date).slice(0, 10), row]),
  );

  const summary = targetDates.map((date) => ({
    date,
    pageviews: Number(dailyMap.get(date)?.pageviews || 0),
    uniqueVisitorsDaily: Number(dailyMap.get(date)?.uniqueVisitors || 0),
    telegramClicks: Number(dailyMap.get(date)?.telegramClicks || 0),
    rawPageviewEvents: Number(eventMap.get(date)?.pageviewEvents || 0),
    rawUniqueVisitors: Number(eventMap.get(date)?.uniqueVisitorEvents || 0),
  }));

  console.log(JSON.stringify({ summary }, null, 2));
} finally {
  await connection.end();
}
