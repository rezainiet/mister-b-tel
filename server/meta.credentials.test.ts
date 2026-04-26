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
    // Pixel ID is injected by Vite from VITE_META_PIXEL_ID so the browser pixel
    // and server CAPI always share the same id (no hardcoded duplication).
    expect(clientHtml).toContain('var _misterbPixelId = "%VITE_META_PIXEL_ID%"');
    expect(clientHtml).toContain("fbq('init', _misterbPixelId)");
    expect(clientHtml).toContain("fbq('track', 'PageView', {}, { eventID: _pvEventId })");
    expect(clientHtml).toContain('window.__misterbPageViewEventId = _pvEventId');
    expect(clientHtml).toContain('sessionStorage.setItem("misterb_pv_event_id", _pvEventId)');
    expect(clientHtml).toContain("facebook.com/tr?id=%VITE_META_PIXEL_ID%");
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

  it("Subscribe fires at /start (conversion intent) — not at channel join (approval-gating safe)", () => {
    expect(webhookSource).toContain("fireSubscribeForStart");
    expect(webhookSource).toContain('eventScope: "telegram_start"');
    expect(webhookSource).toContain("tg_start_${args.telegramUserId}");
    // Idempotency guard: don't re-fire Meta for repeat /starts.
    expect(webhookSource).toContain('existing?.metaSubscribeStatus === "sent"');
    // The /start handler must skip Meta for organic_start (no attribution).
    expect(webhookSource).toContain("if (isAttributed)");
  });

  it("Join flow records analytics row but does NOT fire Meta (Subscribe is /start-driven)", () => {
    // handleNewMember must not call Meta directly. The legacy abandon path
    // for bypass joins is also gone (no Meta event = nothing to abandon).
    expect(webhookSource).toContain("join_recorded_no_meta_fire");
    expect(webhookSource).not.toContain("organic_bypass_skipped");
    // Mirror /start-time eventId onto the join row for dashboard joins.
    expect(webhookSource).toContain("startMetaEventId");
    expect(webhookSource).toContain("startMetaStatus");
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
