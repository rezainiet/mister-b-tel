import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(new URL("../client/src/pages/Dashboard.tsx", import.meta.url), "utf8");
const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

describe("Dashboard Telegram funnel", () => {
  it("splits Telegram bot clicks from direct contact clicks in the aggregation queries", () => {
    expect(dbSource).toContain("COALESCE(eventSource, '') LIKE 'telegram_group%'");
    expect(dbSource).toContain("COALESCE(eventSource, '') NOT LIKE 'telegram_group%'");
  });

  it("renders the clearer Telegram funnel cards and consumes the bot-start overview query", () => {
    expect(dashboardSource).toContain('title="Clic bot Telegram"');
    expect(dashboardSource).toContain('title="Start bot"');
    expect(dashboardSource).toContain('title="Membres rejoints"');
    expect(dashboardSource).toContain('title="Contact direct"');
    expect(dashboardSource).toContain("trpc.dashboard.telegramOverview.useQuery");
    expect(dashboardSource).toContain("botToMemberRate");
  });
});
