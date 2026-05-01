import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { replaceTelegramGroupUrlInText, validateTelegramGroupUrl } from "./telegramGroupLink";

const dashboardSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "../client/src/pages/Dashboard.tsx"),
  "utf-8",
);
const routerSource = fs.readFileSync(path.resolve(import.meta.dirname, "./routers.ts"), "utf-8");

describe("telegram group link editor", () => {
  it("replaces placeholders and legacy Telegram links with the newest group URL", () => {
    const nextUrl = "https://t.me/new_private_group";

    expect(
      replaceTelegramGroupUrlInText("Join here -> {group_url}", nextUrl),
    ).toContain(nextUrl);
    expect(
      replaceTelegramGroupUrlInText(
        "Join here -> https://t.me/+sdIa7KNoIbNjMTg0 and keep going",
        nextUrl,
      ),
    ).toBe(`Join here -> ${nextUrl} and keep going`);
  });

  it("rewrites stored WhatsApp channel links when the group URL changes", () => {
    const nextUrl = "https://whatsapp.com/channel/NEW";
    expect(
      replaceTelegramGroupUrlInText(
        "Rejoins ici -> https://whatsapp.com/channel/0029Vb7Gsop1XquZ5XHDOl2W et continue",
        nextUrl,
      ),
    ).toBe(`Rejoins ici -> ${nextUrl} et continue`);
  });

  it("accepts both Telegram and WhatsApp channel hosts in the validator", () => {
    expect(validateTelegramGroupUrl("https://t.me/+abc").ok).toBe(true);
    expect(validateTelegramGroupUrl("https://whatsapp.com/channel/0029Vb7Gsop1XquZ5XHDOl2W").ok).toBe(
      true,
    );
    expect(validateTelegramGroupUrl("https://www.whatsapp.com/channel/abc").ok).toBe(true);
    expect(validateTelegramGroupUrl("https://whatsapp.com/").ok).toBe(false);
    expect(validateTelegramGroupUrl("https://whatsapp.com/something-else").ok).toBe(false);
    expect(validateTelegramGroupUrl("https://example.com/channel/abc").ok).toBe(false);
  });

  it("adds a dashboard control and save button for editing the Telegram group link", () => {
    expect(dashboardSource).toContain("Telegram link editor");
    expect(dashboardSource).toContain("telegram-group-url");
    expect(dashboardSource).toContain("Save latest changes");
    expect(dashboardSource).toContain('key: "telegram_group_url"');
  });

  it("syncs pending bot content immediately when the Telegram group link setting is saved", () => {
    expect(routerSource).toContain("TELEGRAM_GROUP_URL_SETTING_KEY");
    expect(routerSource).toContain("syncTelegramGroupUrlContent");
    expect(routerSource).toContain("input.key === TELEGRAM_GROUP_URL_SETTING_KEY");
  });
});
