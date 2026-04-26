import { getRecentBotStartsWithMetaStatus, getRecentMetaEventLogs, getAllJoins } from "./server/db.ts";

const botStarts = await getRecentBotStartsWithMetaStatus(10);
const metaLogs = await getRecentMetaEventLogs(10);
const joins = await getAllJoins(10);

console.log(JSON.stringify({ botStarts, metaLogs, joins }, null, 2));
