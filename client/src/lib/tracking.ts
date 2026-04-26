export type TrackingSession = {
  sessionToken: string;
  funnelToken: string;
  telegramBotUrl: string;
  telegramDeepLink: string;
  payload: string;
};

type MetaWindow = Window & {
  __misterbPageViewEventId?: string;
  clarity?: (...args: unknown[]) => void;
};

const STORAGE_KEY = "misterb_tracking_session_v4";
const LEGACY_STORAGE_KEYS = ["misterb_tracking_session_v3", "misterb_tracking_session_v2"];
const VISITOR_STORAGE_KEY = "misterb_vid";
const FUNNEL_STORAGE_KEY = "misterb_funnel_token";
const FUNNEL_COOKIE_KEY = "misterb_funnel_token";
const BOT_USERNAME = "Misternb_bot";
export const TELEGRAM_BOT_URL = `https://t.me/${BOT_USERNAME}`;
export const TELEGRAM_BOT_DEEP_LINK = `tg://resolve?domain=${BOT_USERNAME}`;

const CLICK_DEBOUNCE_MS = 1500;
const lastClickTimestamps = new Map<string, number>();

let sessionPromise: Promise<TrackingSession | null> | null = null;
let initialized = false;

function base64UrlEncode(input: string): string {
  if (typeof btoa === "function") {
    return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  // Node fallback for tests / SSR.
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Build a `?start=` payload that always carries at least the funnelToken so
 * /start is never received without any attribution hint, even when the
 * tracking-session API call fails (network blip, cold backend, MySQL down).
 */
export function buildFallbackTelegramPayload(funnelToken: string) {
  // Format: g::funnelToken — empty sessionToken, server resolver will look the
  // landing session up by funnelToken via getLatestUtmSessionByFunnelToken.
  return base64UrlEncode(`g::${funnelToken}`);
}

export function buildFallbackTrackingSession(funnelToken: string): TrackingSession {
  const payload = buildFallbackTelegramPayload(funnelToken);
  return {
    sessionToken: "",
    funnelToken,
    telegramBotUrl: `${TELEGRAM_BOT_URL}?start=${payload}`,
    telegramDeepLink: `${TELEGRAM_BOT_DEEP_LINK}&start=${payload}`,
    payload,
  };
}

function shouldDebounceClick(source: string): boolean {
  const now = Date.now();
  const previous = lastClickTimestamps.get(source) || 0;
  if (now - previous < CLICK_DEBOUNCE_MS) return true;
  lastClickTimestamps.set(source, now);
  return false;
}

function ensureFbpCookie() {
  if (typeof document === "undefined") return undefined;
  const existing = getCookie("_fbp");
  if (existing) return existing;
  // Canonical Meta format: fb.<subdomainIndex>.<timestamp>.<random>
  // Subdomain index 1 is the standard for top-level domains.
  const random = Math.floor(Math.random() * 1e16).toString();
  const fbp = `fb.1.${Date.now()}.${random}`;
  setCookie("_fbp", fbp, 60 * 60 * 24 * 90); // 90 days, matching Meta's documented lifetime.
  return fbp;
}

function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1] || "") : undefined;
}

function setCookie(name: string, value: string, maxAgeSeconds = 60 * 60 * 24 * 365) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}

function getFbpValue() {
  // Always ensure the cookie exists so the Meta CAPI gets a stable fbp even
  // though we don't load the Meta Pixel browser-side.
  return ensureFbpCookie();
}

function getCurrentUtmParams() {
  if (typeof window === "undefined") {
    return {
      utmSource: undefined,
      utmMedium: undefined,
      utmCampaign: undefined,
      utmContent: undefined,
      utmTerm: undefined,
      fbclid: undefined,
      fbp: undefined,
      landingPage: undefined,
      referrer: undefined,
      isMobile: undefined,
    };
  }

  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get("utm_source") || undefined,
    utmMedium: params.get("utm_medium") || undefined,
    utmCampaign: params.get("utm_campaign") || undefined,
    utmContent: params.get("utm_content") || undefined,
    utmTerm: params.get("utm_term") || undefined,
    fbclid: params.get("fbclid") || undefined,
    fbp: getFbpValue(),
    landingPage: window.location.href,
    referrer: document.referrer || undefined,
    isMobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
  };
}

function getVisitorId() {
  if (typeof window === "undefined") return "";
  let visitorId = window.localStorage.getItem(VISITOR_STORAGE_KEY);
  if (!visitorId) {
    visitorId = `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(VISITOR_STORAGE_KEY, visitorId);
  }
  return visitorId;
}

function getOrCreateFunnelToken() {
  if (typeof window === "undefined") return "";

  const existingFromStorage = window.localStorage.getItem(FUNNEL_STORAGE_KEY);
  const existingFromCookie = getCookie(FUNNEL_COOKIE_KEY);
  const funnelToken = existingFromStorage || existingFromCookie || randomId("ft");

  window.localStorage.setItem(FUNNEL_STORAGE_KEY, funnelToken);
  setCookie(FUNNEL_COOKIE_KEY, funnelToken);

  return funnelToken;
}

function getBootstrappedPageViewEventId() {
  if (typeof window === "undefined") return undefined;
  try {
    const stored = sessionStorage.getItem("misterb_pv_event_id");
    if (stored) return stored;
  } catch {}
  return (window as MetaWindow).__misterbPageViewEventId || undefined;
}

function trackClarityEvent(eventName: string, metadata?: Record<string, string>) {
  if (typeof window === "undefined") return;

  try {
    const clarity = (window as MetaWindow).clarity;
    clarity?.("event", eventName);

    if (!metadata) return;

    Object.entries(metadata).forEach(([key, value]) => {
      clarity?.("set", key, value);
    });
  } catch {
    // Clarity must never block the landing flow.
  }
}

function normalizeStoredSession(raw: unknown): TrackingSession | null {
  if (!raw || typeof raw !== "object") return null;

  const candidate = raw as Partial<TrackingSession>;
  if (!candidate.sessionToken || !candidate.telegramBotUrl || !candidate.telegramDeepLink || !candidate.payload) {
    return null;
  }

  return {
    sessionToken: candidate.sessionToken,
    funnelToken: candidate.funnelToken || getOrCreateFunnelToken(),
    telegramBotUrl: candidate.telegramBotUrl,
    telegramDeepLink: candidate.telegramDeepLink,
    payload: candidate.payload,
  };
}

function readStoredSession(): TrackingSession | null {
  if (typeof window === "undefined") return null;

  let raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    for (const legacyKey of LEGACY_STORAGE_KEYS) {
      raw = window.sessionStorage.getItem(legacyKey);
      if (raw) break;
    }
  }
  if (!raw) return null;

  try {
    const parsed = normalizeStoredSession(JSON.parse(raw));
    if (parsed) {
      storeSession(parsed);
    }
    return parsed;
  } catch {
    return null;
  }
}

function storeSession(session: TrackingSession) {
  if (typeof window === "undefined") return;
  // Only the v4 key is written. Reads still fall back to LEGACY_STORAGE_KEYS
  // so an in-flight session created before this deploy continues to resolve
  // for one browser session; new sessions stop polluting old keys.
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

async function postTrackingRecord(input: {
  eventType: string;
  eventSource: string;
  visitorId?: string;
  eventId?: string;
  sourceUrl?: string;
  sessionToken?: string;
  funnelToken?: string;
}) {
  try {
    await fetch("/api/trpc/tracking.record?batch=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        0: {
          json: {
            eventType: input.eventType,
            eventSource: input.eventSource,
            visitorId: input.visitorId,
            eventId: input.eventId,
            sourceUrl: input.sourceUrl || (typeof window !== "undefined" ? window.location.href : undefined),
            sessionToken: input.sessionToken,
            funnelToken: input.funnelToken,
            fbp: getFbpValue(),
          },
        },
      }),
    });
  } catch {
    // Tracking must never block the landing flow.
  }
}

async function createTrackingSession(): Promise<TrackingSession | null> {
  try {
    const response = await fetch("/api/trpc/tracking.createSession?batch=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        0: {
          json: {
            ...getCurrentUtmParams(),
            funnelToken: getOrCreateFunnelToken(),
            visitorId: getVisitorId(),
          },
        },
      }),
    });
    const data = (await response.json()) as Array<{
      result?: {
        data?: {
          json?: TrackingSession;
        };
      };
    }>;
    const session = data?.[0]?.result?.data?.json || null;
    if (session) {
      storeSession({ ...session, funnelToken: session.funnelToken || getOrCreateFunnelToken() });
    }
    return session;
  } catch {
    return null;
  }
}

export async function ensureTrackingSession(): Promise<TrackingSession | null> {
  const existing = readStoredSession();
  if (existing) return existing;

  if (!sessionPromise) {
    sessionPromise = createTrackingSession().finally(() => {
      sessionPromise = null;
    });
  }

  return sessionPromise;
}

async function resolveSessionWithRetry(): Promise<TrackingSession | null> {
  // First try the in-memory / sessionStorage cached session.
  const cached = readStoredSession();
  if (cached) return cached;

  // Try once.
  const first = await ensureTrackingSession();
  if (first) return first;

  // Wait briefly and retry once. Most "session creation failures" are network
  // races on cold mobile connections; a 500 ms backoff catches the vast
  // majority without blocking the user perceptibly.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const second = await ensureTrackingSession();
  return second;
}

export async function trackTelegramGroupClick(source = "telegram_group_cta") {
  const fallbackFunnelToken = getOrCreateFunnelToken();
  // Ensure the _fbp cookie is created at click time even if it wasn't on first paint.
  ensureFbpCookie();

  const session = await resolveSessionWithRetry();
  const debounce = shouldDebounceClick(source);

  if (!session) {
    // Critical: never strip attribution. Build a funnelToken-only payload so
    // /start carries cross-visit identity even when the session API failed.
    const fallback = buildFallbackTrackingSession(fallbackFunnelToken);

    // Best-effort: still try to register the click against the funnelToken
    // so the dashboard reflects the user attempted to open Telegram.
    if (!debounce) {
      void postTrackingRecord({
        eventType: "telegram_click",
        eventSource: source,
        visitorId: getVisitorId(),
        eventId: randomId("tg_click"),
        sessionToken: undefined,
        funnelToken: fallbackFunnelToken,
      });
    }

    trackClarityEvent("telegram_group_click_fallback", {
      clarity_event_source: source,
      clarity_event_target: "telegram_group_fallback",
    });

    return fallback;
  }

  trackClarityEvent("telegram_group_click", {
    clarity_event_source: source,
    clarity_event_target: "telegram_group",
  });

  if (debounce) {
    return session; // Already counted within the debounce window.
  }

  try {
    await fetch("/api/trpc/tracking.markTelegramClick?batch=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        0: {
          json: {
            sessionToken: session.sessionToken,
            funnelToken: session.funnelToken,
            source,
            eventId: randomId("tg_click"),
          },
        },
      }),
    });
  } catch {
    // Click tracking must never block the Telegram open flow.
  }

  return session;
}

export async function trackTelegramClick(source = "telegram_contact_cta") {
  const storedSession = readStoredSession();

  trackClarityEvent("telegram_contact_click", {
    clarity_event_source: source,
    clarity_event_target: "telegram_contact",
  });

  await postTrackingRecord({
    eventType: "telegram_click",
    eventSource: source,
    visitorId: getVisitorId(),
    eventId: randomId("tg_contact"),
    sessionToken: storedSession?.sessionToken,
    funnelToken: storedSession?.funnelToken || getOrCreateFunnelToken(),
  });
}

export async function initAdvancedTracking(): Promise<TrackingSession | null> {
  ensureFbpCookie();
  const fallbackFunnelToken = getOrCreateFunnelToken();
  const session = await ensureTrackingSession();

  if (!initialized) {
    initialized = true;
    const bootstrappedPageViewEventId = getBootstrappedPageViewEventId();
    const pageViewEventId = bootstrappedPageViewEventId || randomId("pv");
    void postTrackingRecord({
      eventType: "pageview",
      eventSource: "landing",
      visitorId: getVisitorId(),
      eventId: pageViewEventId,
      sessionToken: session?.sessionToken,
      funnelToken: session?.funnelToken || fallbackFunnelToken,
    });
    initScrollDepthTracking();
  }

  return session;
}

const SCROLL_DEPTH_FIRED = new Set<25 | 50 | 75 | 100>();
let scrollListenerAttached = false;

function emitScrollDepth(depth: 25 | 50 | 75 | 100) {
  if (SCROLL_DEPTH_FIRED.has(depth)) return;
  SCROLL_DEPTH_FIRED.add(depth);
  const stored = readStoredSession();
  void postTrackingRecord({
    eventType: `scroll_${depth}`,
    eventSource: "landing",
    visitorId: getVisitorId(),
    eventId: randomId(`scroll_${depth}`),
    sessionToken: stored?.sessionToken,
    funnelToken: stored?.funnelToken || getOrCreateFunnelToken(),
  });
}

function computeScrollPercent(): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;
  const doc = document.documentElement;
  const scrollTop = window.scrollY || doc.scrollTop || 0;
  const viewport = window.innerHeight || doc.clientHeight || 0;
  const fullHeight = Math.max(
    doc.scrollHeight || 0,
    document.body?.scrollHeight || 0,
    doc.offsetHeight || 0,
  );
  const scrollable = Math.max(1, fullHeight - viewport);
  if (fullHeight <= viewport) return 100;
  return Math.min(100, Math.round((scrollTop / scrollable) * 100));
}

function initScrollDepthTracking() {
  if (typeof window === "undefined") return;
  if (scrollListenerAttached) return;
  scrollListenerAttached = true;

  const handler = () => {
    const pct = computeScrollPercent();
    if (pct >= 25) emitScrollDepth(25);
    if (pct >= 50) emitScrollDepth(50);
    if (pct >= 75) emitScrollDepth(75);
    if (pct >= 100) emitScrollDepth(100);

    if (SCROLL_DEPTH_FIRED.size === 4) {
      window.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    }
  };

  // Fire once on init for short pages where the user already sees everything.
  handler();

  window.addEventListener("scroll", handler, { passive: true });
  window.addEventListener("resize", handler, { passive: true });
}

export function __resetScrollDepthForTests() {
  SCROLL_DEPTH_FIRED.clear();
  scrollListenerAttached = false;
}

export function openTelegramGroupDirectly(exactBotUrl?: string) {
  if (typeof window === "undefined") return;

  void (async () => {
    const session = await trackTelegramGroupClick();
    const destinationUrl = exactBotUrl || session?.telegramBotUrl || TELEGRAM_BOT_URL;
    window.location.assign(destinationUrl);
  })();
}
