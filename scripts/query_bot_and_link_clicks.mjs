import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;
const targetDates = ['2026-04-22', '2026-04-23'];

if (!databaseUrl) {
  console.error(JSON.stringify({ error: 'DATABASE_URL is not set' }, null, 2));
  process.exit(1);
}

const connection = await mysql.createConnection(databaseUrl);

try {
  const [botRows] = await connection.query(`
    SELECT DATE_FORMAT(startedAt, '%Y-%m-%d') AS date, COUNT(*) AS botStarts
    FROM bot_starts
    WHERE DATE(startedAt) IN ('2026-04-22', '2026-04-23')
    GROUP BY DATE_FORMAT(startedAt, '%Y-%m-%d')
    ORDER BY date ASC
  `);

  const [groupLinkRows] = await connection.query(`
    SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') AS date, COUNT(*) AS groupLinkClicks
    FROM tracking_events
    WHERE eventType = 'telegram_click'
      AND eventSource IN ('telegram_group_cta', 'telegram_group_button')
      AND DATE(createdAt) IN ('2026-04-22', '2026-04-23')
    GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d')
    ORDER BY date ASC
  `);

  const [contactRows] = await connection.query(`
    SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') AS date, COUNT(*) AS contactClicks
    FROM tracking_events
    WHERE eventType = 'telegram_click'
      AND eventSource = 'telegram_contact_cta'
      AND DATE(createdAt) IN ('2026-04-22', '2026-04-23')
    GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d')
    ORDER BY date ASC
  `);

  const botMap = new Map(botRows.map((row) => [row.date, Number(row.botStarts || 0)]));
  const groupMap = new Map(groupLinkRows.map((row) => [row.date, Number(row.groupLinkClicks || 0)]));
  const contactMap = new Map(contactRows.map((row) => [row.date, Number(row.contactClicks || 0)]));

  const summary = targetDates.map((date) => ({
    date,
    botStarts: botMap.get(date) || 0,
    groupLinkClicks: groupMap.get(date) || 0,
    contactClicks: contactMap.get(date) || 0,
  }));

  console.log(JSON.stringify({ summary }, null, 2));
} finally {
  await connection.end();
}
