import mysql from 'mysql2/promise';

const usernames = ['bestmanylitics', 'coucoulala123'];
const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [botRows] = await connection.query(
    `
      SELECT 'bot_starts' AS source, telegramUserId, telegramUsername, telegramFirstName, startedAt AS relevantAt
      FROM bot_starts
      WHERE LOWER(COALESCE(telegramUsername, '')) IN (?, ?)
      ORDER BY startedAt DESC
    `,
    usernames,
  );

  const [joinRows] = await connection.query(
    `
      SELECT 'telegram_joins' AS source, telegramUserId, telegramUsername, telegramFirstName, joinedAt AS relevantAt
      FROM telegram_joins
      WHERE LOWER(COALESCE(telegramUsername, '')) IN (?, ?)
      ORDER BY joinedAt DESC
    `,
    usernames,
  );

  console.log(JSON.stringify({ botRows, joinRows }, null, 2));
} finally {
  await connection.end();
}
