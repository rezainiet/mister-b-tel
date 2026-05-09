import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(resolve(import.meta.dirname, "../client/src/pages/Home.tsx"), "utf8");
const routerSource = readFileSync(resolve(import.meta.dirname, "./routers.ts"), "utf8");

describe("telegram bot start link regression", () => {
  it("generates a Telegram bot URL containing the start payload on the server session endpoint", () => {
    expect(routerSource).toContain('const telegramBotUrl = `https://t.me/${BOT_USERNAME}?start=${payload}`');
    expect(routerSource).toContain('telegramDeepLink: `tg://resolve?domain=${BOT_USERNAME}&start=${payload}`');
  });

  it("keeps a direct Telegram link on the anchor while intercepting the click long enough to attach the tracked start payload", () => {
    // After the redesign these checks verify INTENT, not the exact helper
    // names: the CTA href is bound to a state value, the click handler
    // intercepts to mark the tracked click, then navigates same-tab.
    expect(homeSource).toContain("href={telegramGroupHref}");
    expect(homeSource).toContain("event.preventDefault()");
    expect(homeSource).toContain('trackTelegramGroupClick("telegram_group_cta")');
    expect(homeSource).toContain("window.location.assign");
    // Same-tab navigation is what allows the bot deep-link to take over the
    // current view on mobile rather than opening a stranded blank tab.
    expect(homeSource).toContain('target="_self"');
  });
});
