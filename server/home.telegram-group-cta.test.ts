import { readFileSync } from "node:fs";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../client/src/pages/Home";

const homeSource = readFileSync(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8");

describe("Landing Mister B Telegram CTA", () => {
  it("renders the Telegram group CTA as a desktop-safe HTTPS Telegram bot link from the first render", () => {
    const html = renderToStaticMarkup(createElement(Home));

    expect(html).toContain("Groupe Telegram");
    expect(html).toContain('href="https://t.me/Misternb_bot"');
    expect(html).not.toContain("Chargement Telegram...");
    expect(html).toContain('data-direct-open="telegram-bot"');
    expect(html).toContain('target="_self"');
  });

  it("keeps the desktop-safe HTTPS flow while preserving the mobile deep-link upgrade path when a session is available", () => {
    expect(homeSource).toContain("TELEGRAM_BOT_DEEP_LINK");
    expect(homeSource).toContain("TELEGRAM_BOT_URL");
    expect(homeSource).toContain("function shouldPreferTelegramDeepLink()");
    expect(homeSource).toContain("function getTelegramGroupHref(session?: TrackingSession | null)");
    expect(homeSource).toContain('useState<string>(getTelegramGroupHref())');
    expect(homeSource).toContain('setTelegramGroupHref(getTelegramGroupHref(session))');
    // After the P0-A fix, the deep-link/bot-URL fall back through a
    // funnelToken-only payload before ever returning the bare URL — so we
    // assert that both the session-aware branch AND the funnelToken fallback
    // path exist, instead of pinning the exact `||` shape.
    expect(homeSource).toContain("session.telegramDeepLink");
    expect(homeSource).toContain("session.telegramBotUrl");
    expect(homeSource).toContain("buildFallbackTrackingSession");
    expect(homeSource).toContain("TELEGRAM_BOT_DEEP_LINK");
    expect(homeSource).toContain("TELEGRAM_BOT_URL");
    expect(homeSource).toContain('href={telegramGroupHref}');
    expect(homeSource).toContain('label="Groupe Telegram"');
    expect(homeSource).toContain("event.preventDefault()");
    expect(homeSource).toContain('const session = await trackTelegramGroupClick("telegram_group_cta")');
    expect(homeSource).toContain("const targetHref = getTelegramGroupHref(session)");
    expect(homeSource).toContain("window.location.assign(targetHref)");
  });

  it("conserve un lien Telegram séparé pour le contact direct", () => {
    const html = renderToStaticMarkup(createElement(Home));

    expect(html).toContain("Me contacter");
    expect(html).toContain("https://t.me/MisterBNMB");
  });
});
