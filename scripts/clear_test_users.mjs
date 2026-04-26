import mysql from 'mysql2/promise';

const rawUsernames = process.argv.slice(2);
const normalizedUsernames = Array.from(
  new Set(
    rawUsernames
      .map((value) => value.replace(/^@/, '').trim().toLowerCase())
      .filter(Boolean),
  ),
);

if (normalizedUsernames.length === 0) {
  console.error('Usage: node scripts/clear_test_users.mjs @username1 @username2');
  process.exit(1);
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

const placeholders = normalizedUsernames.map(() => '?').join(', ');

async function selectRows(sql, params) {
  const [rows] = await connection.query(sql, params);
  return rows;
}

try {
  await connection.beginTransaction();

  const botStarts = await selectRows(
    `
      SELECT telegramUserId, telegramUsername, sessionToken
      FROM bot_starts
      WHERE LOWER(COALESCE(telegramUsername, '')) IN (${placeholders})
    `,
    normalizedUsernames,
  );

  const telegramJoins = await selectRows(
    `
      SELECT telegramUserId, telegramUsername, sessionToken
      FROM telegram_joins
      WHERE LOWER(COALESCE(telegramUsername, '')) IN (${placeholders})
    `,
    normalizedUsernames,
  );

  const telegramUserIds = Array.from(
    new Set(
      [...botStarts, ...telegramJoins]
        .map((row) => row.telegramUserId)
        .filter(Boolean),
    ),
  );

  const sessionTokens = Array.from(
    new Set(
      [...botStarts, ...telegramJoins]
        .map((row) => row.sessionToken)
        .filter(Boolean),
    ),
  );

  const reminderDeleteResult = telegramUserIds.length
    ? await connection.query(
        `DELETE FROM telegram_reminder_jobs WHERE telegramUserId IN (${telegramUserIds
          .map(() => '?')
          .join(', ')})`,
        telegramUserIds,
      )
    : [{ affectedRows: 0 }];

  const joinsDeleteResult = telegramUserIds.length
    ? await connection.query(
        `DELETE FROM telegram_joins WHERE telegramUserId IN (${telegramUserIds
          .map(() => '?')
          .join(', ')})`,
        telegramUserIds,
      )
    : [{ affectedRows: 0 }];

  const botStartsDeleteResult = telegramUserIds.length
    ? await connection.query(
        `DELETE FROM bot_starts WHERE telegramUserId IN (${telegramUserIds.map(() => '?').join(', ')})`,
        telegramUserIds,
      )
    : [{ affectedRows: 0 }];

  const sessionDeleteResult = sessionTokens.length
    ? await connection.query(
        `DELETE FROM utm_sessions WHERE sessionToken IN (${sessionTokens.map(() => '?').join(', ')})`,
        sessionTokens,
      )
    : [{ affectedRows: 0 }];

  await connection.commit();

  console.log(
    JSON.stringify(
      {
        usernames: normalizedUsernames,
        matchedBotStarts: botStarts,
        matchedTelegramJoins: telegramJoins,
        deleted: {
          telegramReminderJobs: reminderDeleteResult[0].affectedRows ?? 0,
          telegramJoins: joinsDeleteResult[0].affectedRows ?? 0,
          botStarts: botStartsDeleteResult[0].affectedRows ?? 0,
          utmSessions: sessionDeleteResult[0].affectedRows ?? 0,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  await connection.rollback();
  console.error(error);
  process.exitCode = 1;
} finally {
  await connection.end();
}
