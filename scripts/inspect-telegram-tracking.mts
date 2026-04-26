import { getAllJoins, getBotStartStats, getJoinStats } from "../server/db.ts";

async function main() {
  const [joins, botStartStats, joinStats] = await Promise.all([
    getAllJoins(10),
    getBotStartStats(),
    getJoinStats(),
  ]);

  const simplifiedJoins = joins.map((join) => ({
    id: join.id,
    telegramUserId: join.telegramUserId,
    telegramUsername: join.telegramUsername,
    channelId: join.channelId,
    channelTitle: join.channelTitle,
    sessionToken: join.sessionToken,
    metaEventSent: join.metaEventSent,
    metaEventId: join.metaEventId,
    joinedAt: join.joinedAt,
  }));

  console.log(JSON.stringify({ simplifiedJoins, botStartStats, joinStats }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
