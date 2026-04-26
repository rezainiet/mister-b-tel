import { sendTelegramAdminReport } from "../server/telegramAdminReports.ts";

const result = await sendTelegramAdminReport({ reportHour: 19 });
console.log(JSON.stringify(result, null, 2));
