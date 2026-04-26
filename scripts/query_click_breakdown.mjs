import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [rows] = await connection.query(`
    SELECT DATE(createdAt) AS date, eventType, COALESCE(eventSource, 'NULL') AS eventSource, COUNT(*) AS total
    FROM tracking_events
    WHERE DATE(createdAt) IN ('2026-04-22', '2026-04-23')
    GROUP BY DATE(createdAt), eventType, COALESCE(eventSource, 'NULL')
    ORDER BY DATE(createdAt) ASC, eventType ASC, eventSource ASC
  `);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await connection.end();
}
