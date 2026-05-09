import { readFileSync } from "node:fs";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../client/src/pages/Home";

const homeSource = readFileSync(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8");

describe("Landing Mister B WhatsApp CTA", () => {
  // The landing was redesigned around a WhatsApp destination: button label
  // no longer claims a platform, the bot is the gateway, and the WhatsApp
  // green icon is what signals the destination visually.

  it("renders a usable Telegram bot href on first paint (no loading state)", () => {
    const html = renderToStaticMarkup(createElement(Home));

    expect(html).toContain("Rejoindre le groupe privé");
    expect(html).toContain("https://t.me/Misternb_bot");
    expect(html).not.toContain("Chargement Telegram...");
    expect(html).toContain('data-direct-open="telegram-bot"');
    expect(html).toContain('target="_self"');
  });

  it("preserves the mobile deep-link upgrade + funnelToken-fallback attribution path", () => {
    expect(homeSource).toContain("TELEGRAM_BOT_DEEP_LINK");
    expect(homeSource).toContain("TELEGRAM_BOT_URL");
    expect(homeSource).toContain("shouldPreferTelegramDeepLink");
    // Either the session-aware or funnelToken-fallback path must produce the
    // anchor href so /start always carries some attribution hint.
    expect(homeSource).toContain("session.telegramDeepLink");
    expect(homeSource).toContain("session.telegramBotUrl");
    expect(homeSource).toContain("buildFallbackTrackingSession");
    expect(homeSource).toContain("trackTelegramGroupClick");
    expect(homeSource).toContain("window.location.assign");
  });

  it("keeps a separate direct Telegram contact link visible on the page", () => {
    const html = renderToStaticMarkup(createElement(Home));

    expect(html).toContain("Me contacter");
    expect(html).toContain("https://t.me/MisterBNMB");
  });
});
