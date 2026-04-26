import mysql from "mysql2/promise";

// Comprehensive funnel data-integrity audit. Picks the latest bot_start row
// and walks the entire chain (visit → tracking events → /start → join →
// Meta payloads), asserting every required field is populated and that
// cross-event identity (external_id) is consistent.
//
// Usage:
//   DATABASE_URL=mysql://... node scripts/funnel_audit.mjs

const c = await mysql.createConnection(process.env.DATABASE_URL);

const [bsRows] = await c.query("SELECT * FROM bot_starts ORDER BY id DESC LIMIT 1");
if (!bsRows.length) {
  console.log("⚠️  No bot_starts row found — run a /start first.");
  process.exit(0);
}
const bs = bsRows[0];
const TG = bs.telegramUserId;
const sessionToken = bs.sessionToken;
console.log(`Auditing telegramUserId=${TG} sessionToken=${sessionToken}`);
console.log();

let pass = 0;
let fail = 0;
const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log("  ✅", label, detail);
  } else {
    fail++;
    failures.push(`${label} ${detail}`);
    console.log("  ❌", label, detail);
  }
};

// =====================================================================
// 1. utm_sessions — page visit was captured with full attribution
// =====================================================================
console.log("[1] utm_sessions — landing visit row");
const [s] = await c.query("SELECT * FROM utm_sessions WHERE sessionToken=?", [sessionToken]);
let session = null;
if (!s.length) {
  fail++;
  failures.push("utm_sessions row missing");
  console.log("  ❌ session row not found");
} else {
  session = s[0];
  check("sessionToken", !!session.sessionToken);
  check("funnelToken", !!session.funnelToken);
  check("ipAddress", !!session.ipAddress, `(${session.ipAddress})`);
  check("userAgent", !!session.userAgent);
  check("landingPage", !!session.landingPage);
  check("createdAt", !!session.createdAt);
  // UTMs/fbclid only if URL had them — soft check (warn if missing).
  if (!session.utmSource) console.log("  ⚠️  utmSource missing (visit had no ?utm_source=...)");
  if (!session.fbclid) console.log("  ⚠️  fbclid missing (visit had no ?fbclid=...)");
  check("fbp captured", !!session.fbp, `(${session.fbp})`);
  check("visitorId captured", !!session.visitorId, `(${session.visitorId})`);
}

// =====================================================================
// 2. tracking_events — pageview + telegram_click for this session
// =====================================================================
console.log("\n[2] tracking_events — client-side event records");
const [te] = await c.query(
  "SELECT eventType, COUNT(*) as n FROM tracking_events WHERE sessionToken=? GROUP BY eventType",
  [sessionToken],
);
const types = Object.fromEntries(te.map((r) => [r.eventType, r.n]));
check("pageview row exists", (types.pageview || 0) >= 1, `(${types.pageview || 0})`);
check("telegram_click row exists", (types.telegram_click || 0) >= 1, `(${types.telegram_click || 0})`);

// =====================================================================
// 3. bot_starts — /start preserved attribution
// =====================================================================
console.log("\n[3] bot_starts — /start handler row");
check("attributionStatus = attributed_start", bs.attributionStatus === "attributed_start", `(${bs.attributionStatus})`);
check("sessionToken matches visit", bs.sessionToken === sessionToken);
check("funnelToken populated", !!bs.funnelToken);
check("metaSubscribeStatus = sent", bs.metaSubscribeStatus === "sent", `(${bs.metaSubscribeStatus})`);
check("metaSubscribeEventId populated", !!bs.metaSubscribeEventId);
check("metaSubscribeEventId is /start-scoped (tg_start_*)", bs.metaSubscribeEventId?.startsWith("tg_start_"), `(${bs.metaSubscribeEventId})`);
check("metaSubscribeSentAt populated", !!bs.metaSubscribeSentAt);

// =====================================================================
// 4. telegram_joins — analytics row mirrors /start Meta event
// =====================================================================
console.log("\n[4] telegram_joins — channel join (analytics, no Meta fire)");
const [tj] = await c.query("SELECT * FROM telegram_joins WHERE telegramUserId=? AND attributionStatus='attributed_join'", [TG]);
if (!tj.length) {
  console.log("  ⚠️  no attributed_join row yet — user has not joined the channel (or join hasn't propagated)");
} else {
  const j = tj[0];
  check("attributionStatus = attributed_join", j.attributionStatus === "attributed_join");
  check("sessionToken matches visit", j.sessionToken === sessionToken);
  check("funnelToken populated", !!j.funnelToken);
  check("ipAddress populated", !!j.ipAddress);
  check("userAgent populated", !!j.userAgent);
  // Mirror check: join row should reference the same Meta event id as
  // bot_starts (since Subscribe fires on /start, not on join).
  check(
    "metaEventId mirrors bot_starts (same /start eventId)",
    j.metaEventId === bs.metaSubscribeEventId,
    `(join=${j.metaEventId} vs start=${bs.metaSubscribeEventId})`,
  );
  check("metaEventSent mirrors bot_starts", j.metaEventSent === bs.metaSubscribeStatus);
}

// =====================================================================
// 5. meta_event_logs — payload integrity for Subscribe + PageView
// =====================================================================
console.log("\n[5] meta_event_logs — Meta CAPI payload integrity");
const [m] = await c.query(
  "SELECT * FROM meta_event_logs WHERE (sessionToken=? OR telegramUserId=?) ORDER BY id DESC",
  [sessionToken, TG],
);
const subRow = m.find((r) => r.eventType === "Subscribe" && r.eventScope === "telegram_start" && r.status === "sent");
const pvRows = m.filter((r) => r.eventType === "PageView" && r.status === "sent");

check("Subscribe sent (eventScope=telegram_start)", !!subRow, subRow ? `id=${subRow.id}` : "(NOT FOUND)");
check("PageView sent (≥1)", pvRows.length >= 1, `(${pvRows.length})`);

// Decode Subscribe payload
let subExternalId = null;
if (subRow) {
  try {
    const req = JSON.parse(subRow.requestPayloadJson || "{}");
    const res = JSON.parse(subRow.responsePayloadJson || "{}");
    const data = req.data?.[0] || {};
    const ud = data.user_data || {};
    const cd = data.custom_data || {};
    subExternalId = ud.external_id;

    console.log("\n  Subscribe payload sent to Meta:");
    console.log("    event_name      ", data.event_name);
    console.log("    event_id        ", data.event_id);
    console.log("    action_source   ", data.action_source);
    console.log("    test_event_code ", req.test_event_code || "(none)");
    console.log("    user_data       ", JSON.stringify(ud).slice(0, 120) + "...");
    console.log("    custom_data     ", JSON.stringify(cd));
    console.log("    response        ", JSON.stringify(res));

    check("event_name = Subscribe", data.event_name === "Subscribe");
    check("action_source = website", data.action_source === "website");
    check("event_id is /start-scoped", data.event_id?.startsWith("tg_start_"), `(${data.event_id})`);
    check("user_data.external_id present (sha256)", !!ud.external_id && ud.external_id.length === 64);
    check("user_data.client_ip_address present", !!ud.client_ip_address);
    check("user_data.client_user_agent present", !!ud.client_user_agent);
    check("user_data.fbp present", !!ud.fbp);
    if (session?.fbclid) check("user_data.fbc present (built from session)", !!ud.fbc, `(${ud.fbc})`);
    check("custom_data.telegram_user_id present", !!cd.telegram_user_id);
    if (session?.utmCampaign) check("custom_data.utm_campaign present", !!cd.utm_campaign, `(${cd.utm_campaign})`);
    check("response.events_received >= 1", (res.events_received || 0) >= 1);
    check("response.fbtrace_id present", !!res.fbtrace_id);
  } catch (e) {
    fail++;
    failures.push(`Subscribe payload JSON parse: ${e.message}`);
    console.log("  ❌ failed to parse Subscribe payload:", e.message);
  }
}

// Decode PageView payload (latest one)
let pvExternalId = null;
if (pvRows.length) {
  const pvRow = pvRows[0];
  try {
    const req = JSON.parse(pvRow.requestPayloadJson || "{}");
    const data = req.data?.[0] || {};
    const ud = data.user_data || {};
    const cd = data.custom_data || {};
    pvExternalId = ud.external_id;

    console.log("\n  PageView payload sent to Meta (latest):");
    console.log("    event_id        ", data.event_id);
    console.log("    user_data       ", JSON.stringify(ud).slice(0, 120) + "...");
    console.log("    custom_data     ", JSON.stringify(cd));

    check("PageView user_data.external_id present", !!ud.external_id && ud.external_id.length === 64);
    if (session?.fbclid) {
      check("PageView user_data.fbc present (server-built)", !!ud.fbc, `(${ud.fbc})`);
    }
    check("PageView user_data.fbp present", !!ud.fbp);
    if (session?.utmCampaign) {
      check("PageView custom_data.utm_campaign present", !!cd.utm_campaign, `(${cd.utm_campaign})`);
    }
  } catch (e) {
    fail++;
    failures.push(`PageView payload JSON parse: ${e.message}`);
    console.log("  ❌ failed to parse PageView payload:", e.message);
  }
}

// =====================================================================
// 6. Cross-event identity — PageView and Subscribe share external_id
// =====================================================================
console.log("\n[6] Cross-event identity (PageView ↔ Subscribe)");
if (subExternalId && pvExternalId) {
  check(
    "PageView.external_id === Subscribe.external_id",
    subExternalId === pvExternalId,
    `(pv=${pvExternalId?.slice(0, 16)}... vs sub=${subExternalId?.slice(0, 16)}...)`,
  );
}

// =====================================================================
// 7. Reminders — scheduled at /start, will skip on join
// =====================================================================
console.log("\n[7] telegram_reminder_jobs — reminder ladder");
const [rj] = await c.query(
  "SELECT status, COUNT(*) as n FROM telegram_reminder_jobs WHERE telegramUserId=? GROUP BY status",
  [TG],
);
const rmap = Object.fromEntries(rj.map((x) => [x.status, x.n]));
const totalReminders = Object.values(rmap).reduce((sum, n) => sum + Number(n), 0);
check("reminders scheduled (7 expected)", totalReminders === 7, JSON.stringify(rmap));

// =====================================================================
// 8. Bypass-join sanity — they exist but have no Meta event
// =====================================================================
console.log("\n[8] bypass_join sanity (organic Telegram members)");
const [bp] = await c.query(
  "SELECT COUNT(*) as n FROM telegram_joins WHERE attributionStatus='bypass_join' AND metaEventId IS NOT NULL",
);
check(
  "bypass joins do NOT carry a Meta eventId (Subscribe is /start-only)",
  Number(bp[0]?.n || 0) === 0,
  `(${bp[0]?.n} bypass rows have non-null metaEventId)`,
);

// =====================================================================
// SUMMARY
// =====================================================================
console.log("\n" + "=".repeat(60));
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
console.log("=".repeat(60));
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  -", f);
  process.exitCode = 1;
}

await c.end();
