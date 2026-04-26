import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const clientHtml = readFileSync(resolve(import.meta.dirname, "../client/index.html"), "utf8");
const trackingSource = readFileSync(resolve(import.meta.dirname, "../client/src/lib/tracking.ts"), "utf8");
const pageViewSource = readFileSync(resolve(import.meta.dirname, "./facebookCapi.ts"), "utf8");
const subscribeSource = readFileSync(resolve(import.meta.dirname, "./metaCapi.ts"), "utf8");
const webhookSource = readFileSync(resolve(import.meta.dirname, "./telegramWebhook.ts"), "utf8");
const routersSource = readFileSync(resolve(import.meta.dirname, "./routers.ts"), "utf8");

describe("Meta browser pixel + server CAPI dual-send wiring", () => {
  it("loads the Meta Pixel browser script and fires PageView with the same eventID the server uses", () => {
    expect(clientHtml).toContain("connect.facebook.net/en_US/fbevents.js");
    expect(clientHtml).toContain("fbq('init', '945883278158292')");
    expect(clientHtml).toContain("fbq('track', 'PageView', {}, { eventID: _pvEventId })");
    expect(clientHtml).toContain('window.__misterbPageViewEventId = _pvEventId');
    expect(clientHtml).toContain('sessionStorage.setItem("misterb_pv_event_id", _pvEventId)');
    expect(clientHtml).toContain("facebook.com/tr?id=945883278158292");
  });

  it("ensures _fbp cookie is created early so the very first server PageView captures it", () => {
    expect(clientHtml).toContain('document.cookie = "_fbp=" + _fbpValue');
    expect(trackingSource).toContain('getCookie("_fbp")');
    expect(trackingSource).toContain('fbp: getFbpValue()');
  });

  it("server CAPI module reads pixel id and access token from env", () => {
    expect(pageViewSource).toContain("postMetaPayload");
    expect(subscribeSource).toContain("process.env.META_CONVERSIONS_TOKEN");
    expect(subscribeSource).toContain("process.env.META_PIXEL_ID");
  });

  it("client posts pageview with the bootstrapped event id so server CAPI ↔ browser pixel dedupe", () => {
    expect(trackingSource).toContain('const stored = sessionStorage.getItem("misterb_pv_event_id")');
    expect(trackingSource).toContain('const bootstrappedPageViewEventId = getBootstrappedPageViewEventId()');
    expect(trackingSource).toContain('const pageViewEventId = bootstrappedPageViewEventId || randomId("pv")');
  });

  it("Subscribe payload builds fbc on the server from the original session timestamp (never Date.now)", () => {
    expect(subscribeSource).toContain("sessionCreatedAt?: Date | string | number | null");
    expect(subscribeSource).toContain("buildServerFbc");
    expect(subscribeSource).toContain("fb.1.${originalClickTimestamp}.${fbclid}");
    // Subscribe must not stamp fbc with Date.now() — that would lie about the
    // ad click time and tank Meta attribution.
    const fbcLines = subscribeSource
      .split("\n")
      .filter((line) => line.includes("fbc") && line.includes("Date.now()"));
    expect(fbcLines).toHaveLength(0);
  });

  it("Subscribe payload uses landing-page visitorId for external_id (matches PageView) and keeps telegramUserId in custom_data", () => {
    // Cross-event identity: PageView and Subscribe must share external_id so
    // Meta connects the two events to the same person.
    expect(subscribeSource).toContain("data.visitorId || String(data.telegramUserId)");
    expect(subscribeSource).toContain('hashValue(externalIdSource)');
    expect(subscribeSource).toContain("telegram_user_id: String(data.telegramUserId)");
  });

  it("PageView CAPI receives server-built fbc + UTM custom_data resolved from the matching utm_session", () => {
    expect(routersSource).toContain("getUtmSessionByToken");
    expect(routersSource).toContain("buildServerFbc(session?.fbclid, session?.createdAt)");
    expect(routersSource).toContain("utmSource: session?.utmSource");
    expect(routersSource).toContain("utmCampaign: session?.utmCampaign");
    // PageView custom_data should now include UTM fields.
    expect(pageViewSource).toContain("utm_source");
    expect(pageViewSource).toContain("utm_campaign");
  });

  it("Telegram join flow forwards visitorId from the matching landing session into the Subscribe CAPI payload", () => {
    expect(webhookSource).toContain("visitorId: session?.visitorId || undefined");
    expect(webhookSource).toContain("fireSubscribeEvent");
  });

  it("Webhook handler processes BEFORE responding on the success path so failures are retried by Telegram (no silent data loss)", () => {
    // The success-path 200 must come AFTER processTelegramUpdate. Early
    // 200 responses for memory/DB dedup skips are intentional (no work
    // to do), but the post-processing 200 is what guards real updates.
    const processIndex = webhookSource.indexOf("await processTelegramUpdate");
    expect(processIndex).toBeGreaterThan(0);
    const okAfterProcess = webhookSource.indexOf('res.json({ ok: true })', processIndex);
    expect(okAfterProcess).toBeGreaterThan(processIndex);
    expect(webhookSource).toContain("processing_failed_will_retry");
    expect(webhookSource).toContain('res.status(500)');
    expect(webhookSource).toContain("deleteTelegramUpdateId");
  });

  it("loads Microsoft Clarity directly from the landing HTML entry", () => {
    expect(clientHtml).toContain('https://www.clarity.ms/tag/' + '" + i');
    expect(clientHtml).toContain('})(window, document, "clarity", "script", "wgvif26xqx")');
    expect(clientHtml).toContain('c[a].q = c[a].q || []');
  });
});
