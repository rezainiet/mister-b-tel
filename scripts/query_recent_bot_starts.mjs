import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [rows] = await connection.query(`
    SELECT telegramUserId, telegramUsername, startedAt
    FROM bot_starts
    ORDER BY startedAt DESC
    LIMIT 10
  `);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await connection.end();
}
