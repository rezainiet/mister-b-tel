import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const clientHtml = readFileSync(resolve(import.meta.dirname, "../client/index.html"), "utf8");
const trackingSource = readFileSync(resolve(import.meta.dirname, "../client/src/lib/tracking.ts"), "utf8");
const pageViewSource = readFileSync(resolve(import.meta.dirname, "./facebookCapi.ts"), "utf8");
const subscribeSource = readFileSync(resolve(import.meta.dirname, "./metaCapi.ts"), "utf8");
const webhookSource = readFileSync(resolve(import.meta.dirname, "./telegramWebhook.ts"), "utf8");

describe("Meta server-only wiring", () => {
  it("keeps the landing bootstrap free of a browser Meta pixel and does not self-generate _fbp", () => {
    expect(clientHtml).toContain('window.__misterbPageViewEventId = _pvEventId');
    expect(clientHtml).toContain('sessionStorage.setItem("misterb_pv_event_id", _pvEventId)');
    expect(clientHtml).not.toContain('if (!document.cookie.includes("_fbp="))');
    expect(clientHtml).not.toContain("connect.facebook.net/en_US/fbevents.js");
    expect(clientHtml).not.toContain("window.__misterbFbPixelId");
    expect(clientHtml).not.toContain('window.fbq("init"');
    expect(clientHtml).not.toContain('window.fbq("track", "PageView"');
    expect(clientHtml).not.toContain("facebook.com/tr?id=");
  });

  it("captures only browser-read fbp on the client and leaves fbc construction to the server", () => {
    expect(trackingSource).toContain('fbp: getFbpValue()');
    expect(trackingSource).toContain('return getCookie("_fbp")');
    expect(trackingSource).not.toContain("function getFbcValue()");
    expect(trackingSource).not.toContain('document.cookie = `_fbc=${fbc}; expires=${exp}; path=/; SameSite=Lax`');
    expect(trackingSource).toContain('const stored = sessionStorage.getItem("misterb_pv_event_id")');
    expect(trackingSource).toContain('const bootstrappedPageViewEventId = getBootstrappedPageViewEventId()');
    expect(trackingSource).toContain('const pageViewEventId = bootstrappedPageViewEventId || randomId("pv")');
    expect(pageViewSource).toContain("process.env.META_CONVERSIONS_TOKEN");
    expect(pageViewSource).toContain("process.env.META_PIXEL_ID");
  });

  it("builds fbc on the server from the original stored session timestamp and reuses landing session identity in the Telegram join flow", () => {
    expect(subscribeSource).toContain("sessionCreatedAt?: Date | string | number | null");
    expect(subscribeSource).toContain("const originalClickTimestamp = toOriginalClickTimestamp(data.sessionCreatedAt)");
    expect(subscribeSource).toContain('userData.fbc = `fb.1.${originalClickTimestamp}.${data.fbclid}`');
    expect(subscribeSource).not.toContain("Date.now()");
    expect(webhookSource).toContain("getBotStartByTelegramUserId");
    expect(webhookSource).toContain("const resolvedSessionToken = sessionToken || storedBotStart?.sessionToken || null");
    expect(webhookSource).toContain("fbp: utmData.fbp || undefined");
    expect(webhookSource).toContain("sessionCreatedAt: utmData.sessionCreatedAt");
    expect(webhookSource).toContain("userAgent: utmData.userAgent || ua || undefined");
    expect(webhookSource).toContain("ipAddress: utmData.ipAddress || ip || undefined");
    expect(webhookSource).toContain("await updateBotStartMetaStatus(telegramUserId, metaResult.success ? \"sent\" : \"failed\", metaResult.eventId)");
    expect(webhookSource).not.toContain("const startEventId = `tg_start_");
    expect(webhookSource).not.toContain("[Meta CAPI] /start error:");
  });

  it("loads Microsoft Clarity directly from the landing HTML entry", () => {
    expect(clientHtml).toContain('https://www.clarity.ms/tag/' + '" + i');
    expect(clientHtml).toContain('})(window, document, "clarity", "script", "wgvif26xqx")');
    expect(clientHtml).toContain('c[a].q = c[a].q || []');
  });
});
