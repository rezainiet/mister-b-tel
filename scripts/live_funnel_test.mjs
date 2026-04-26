// Live end-to-end funnel test — runs against the production Railway URL
// using only HTTP. No browser, no Telegram client. Simulates:
//   1) page visit (tracking.createSession)
//   2) telegram CTA click (tracking.markTelegramClick)
//   3) PageView CAPI (tracking.record with eventType=pageview)
//   4) Telegram /start webhook (POST /api/telegram/webhook with a real start payload)
//
// Use a fake telegramUserId to keep real-user data clean.

const BASE = process.env.LIVE_FUNNEL_BASE_URL || "https://mister-b-tel-production.up.railway.app";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  console.error(
    "TELEGRAM_WEBHOOK_SECRET env var is required (must match production). " +
      "Pass it inline: TELEGRAM_WEBHOOK_SECRET=... node scripts/live_funnel_test.mjs",
  );
  process.exit(1);
}
const FAKE_TG_USER_ID = 999000001;
const FAKE_TG_USERNAME = "claude_qa_test";

async function trpcCall(method, payload) {
  const res = await fetch(`${BASE}/api/trpc/${method}?batch=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 0: { json: payload } }),
  });
  const body = await res.json();
  return body?.[0]?.result?.data?.json;
}

console.log("=".repeat(60));
console.log("LIVE FUNNEL TEST — simulating a real ad click → /start");
console.log("=".repeat(60));

// ====== Step 1: page visit ======
console.log("\n[1] POST tracking.createSession (page visit with UTMs+fbclid)");
const session = await trpcCall("tracking.createSession", {
  utmSource: "facebook",
  utmMedium: "cpc",
  utmCampaign: "claude_live_qa",
  utmContent: "creative_qa",
  utmTerm: "live_test",
  fbclid: "fbclid_claude_qa_live",
  fbp: `fb.1.${Date.now()}.1234567890`,
  landingPage: `${BASE}/?utm_source=facebook&utm_campaign=claude_live_qa`,
  referrer: "https://facebook.com/",
  isMobile: false,
  funnelToken: `ft_claude_${Date.now().toString(36)}`,
  visitorId: `v_claude_${Date.now().toString(36)}`,
});
if (!session?.sessionToken) throw new Error("createSession failed: " + JSON.stringify(session));
console.log("    ✅ sessionToken:", session.sessionToken);
console.log("    ✅ funnelToken: ", session.funnelToken);
console.log("    ✅ start payload:", session.payload);

// ====== Step 2: telegram_click event ======
console.log("\n[2] POST tracking.markTelegramClick");
const click = await trpcCall("tracking.markTelegramClick", {
  sessionToken: session.sessionToken,
  funnelToken: session.funnelToken,
  source: "claude_qa_cta",
  eventId: `click_claude_${Date.now()}`,
});
console.log("    ✅", click);

// ====== Step 3: PageView CAPI fire (server-side) ======
console.log("\n[3] POST tracking.record (eventType=pageview → fires Meta PageView)");
const pageview = await trpcCall("tracking.record", {
  eventType: "pageview",
  eventSource: "landing",
  visitorId: `v_claude_${Date.now().toString(36)}`,
  eventId: `pv_claude_${Date.now()}`,
  sourceUrl: `${BASE}/?utm_source=facebook`,
  sessionToken: session.sessionToken,
  funnelToken: session.funnelToken,
  fbp: `fb.1.${Date.now()}.1234567890`,
});
console.log("    ✅", pageview);

// ====== Step 4: Telegram /start webhook ======
console.log("\n[4] POST /api/telegram/webhook (simulated /start from fake user)");
const updateId = Math.floor(Math.random() * 1_000_000_000) + 800_000_000;
const startBody = {
  update_id: updateId,
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    text: `/start ${session.payload}`,
    from: {
      id: FAKE_TG_USER_ID,
      is_bot: false,
      first_name: "ClaudeQA",
      username: FAKE_TG_USERNAME,
    },
    chat: { id: FAKE_TG_USER_ID, type: "private" },
  },
};
const webhookRes = await fetch(`${BASE}/api/telegram/webhook`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
  },
  body: JSON.stringify(startBody),
});
const webhookText = await webhookRes.text();
console.log(`    Status: HTTP ${webhookRes.status}`);
console.log(`    Body  : ${webhookText}`);

// ====== Summary ======
console.log("\n" + "=".repeat(60));
console.log("LIVE FUNNEL DRIVEN. Now query DB to inspect results.");
console.log("Test fingerprint:");
console.log("  sessionToken    :", session.sessionToken);
console.log("  funnelToken     :", session.funnelToken);
console.log("  telegramUserId  :", FAKE_TG_USER_ID);
console.log("  webhookUpdateId :", updateId);
console.log("=".repeat(60));
