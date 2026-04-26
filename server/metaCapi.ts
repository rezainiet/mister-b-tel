import crypto from "node:crypto";

const PIXEL_ID = process.env.META_PIXEL_ID ?? "";
const ACCESS_TOKEN = process.env.META_CONVERSIONS_TOKEN ?? "";
const GRAPH_VERSION = "v21.0";
const CAPI_URL = `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events`;
const DEFAULT_SOURCE_URL = process.env.APP_BASE_URL || "https://mister-b.club";

function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value.toLowerCase().trim()).digest("hex");
}

export function toOriginalClickTimestamp(value?: Date | string | number | null) {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildServerFbc(fbclid?: string | null, sessionCreatedAt?: Date | string | number | null) {
  const originalClickTimestamp = toOriginalClickTimestamp(sessionCreatedAt);
  if (!fbclid || !originalClickTimestamp) return undefined;
  return `fb.1.${originalClickTimestamp}.${fbclid}`;
}

function normalizeErrorCode(value: unknown) {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

export type MetaSendResult = {
  success: boolean;
  skipped?: boolean;
  eventId: string;
  httpStatus?: number;
  responseBody?: unknown;
  requestBody?: Record<string, unknown>;
  errorCode?: string;
  errorSubcode?: string;
  errorMessage?: string;
  retryable: boolean;
};

export function isRetryableMetaFailure(result: {
  httpStatus?: number;
  errorCode?: string;
  errorSubcode?: string;
  errorMessage?: string;
}) {
  if (!result.errorMessage && !result.httpStatus && !result.errorCode) {
    return false;
  }

  if (!result.httpStatus) {
    return true;
  }

  if (result.httpStatus >= 500 || result.httpStatus === 429) {
    return true;
  }

  const retryableCodes = new Set([1, 2, 4, 17, 341]);
  const code = Number(result.errorCode);
  if (Number.isFinite(code) && retryableCodes.has(code)) {
    return true;
  }

  const message = (result.errorMessage || "").toLowerCase();
  return message.includes("tempor") || message.includes("timeout") || message.includes("rate limit");
}

export async function postMetaPayload(
  eventId: string,
  payload: Record<string, unknown>,
): Promise<MetaSendResult> {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    return {
      success: false,
      skipped: true,
      eventId,
      requestBody: payload,
      errorCode: "missing_credentials",
      errorMessage: "Meta pixel id or conversions token is missing",
      retryable: false,
    };
  }

  // Clone before mutating so the caller's object — and any payload we may
  // later persist for retries — never sees the env-injected test_event_code.
  const envTestCode = process.env.META_TEST_EVENT_CODE;
  const requestPayload =
    envTestCode && !payload.test_event_code
      ? { ...payload, test_event_code: envTestCode }
      : payload;

  try {
    const response = await fetch(`${CAPI_URL}?access_token=${ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
    });

    const body = (await response.json().catch(() => null)) as
      | {
          events_received?: number;
          messages?: string[];
          fbtrace_id?: string;
          error?: {
            message?: string;
            code?: number | string;
            error_subcode?: number | string;
            type?: string;
          };
        }
      | null;

    const errorMessage = body?.error?.message || (!response.ok ? `HTTP ${response.status}` : undefined);
    const errorCode = normalizeErrorCode(body?.error?.code);
    const errorSubcode = normalizeErrorCode(body?.error?.error_subcode);
    const retryable = !response.ok || body?.error
      ? isRetryableMetaFailure({
          httpStatus: response.status,
          errorCode,
          errorSubcode,
          errorMessage,
        })
      : false;

    return {
      success: Boolean(response.ok && !body?.error),
      eventId,
      httpStatus: response.status,
      responseBody: body,
      requestBody: requestPayload,
      errorCode,
      errorSubcode,
      errorMessage,
      retryable,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      eventId,
      requestBody: requestPayload,
      errorCode: "network_error",
      errorMessage,
      retryable: true,
    };
  }
}

export async function retryStoredMetaRequest(eventId: string, requestPayloadJson?: string | null) {
  if (!requestPayloadJson) {
    return {
      success: false,
      eventId,
      errorCode: "missing_request_payload",
      errorMessage: "No stored Meta request payload was found for retry",
      retryable: false,
    } satisfies MetaSendResult;
  }

  try {
    const parsed = JSON.parse(requestPayloadJson) as Record<string, unknown>;
    return postMetaPayload(eventId, parsed);
  } catch (error) {
    return {
      success: false,
      eventId,
      errorCode: "invalid_request_payload",
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: false,
    } satisfies MetaSendResult;
  }
}

export interface CapiEventData {
  eventId: string;
  eventTime: number;
  telegramUserId: string;
  telegramUsername?: string;
  visitorId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  fbclid?: string;
  fbp?: string;
  sessionCreatedAt?: Date | string | number | null;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  sourceUrl?: string;
  testEventCode?: string;
}

export function buildSubscribePayload(data: CapiEventData) {
  // Prefer the landing-page visitorId for external_id so PageView and
  // Subscribe share the same identifier — Meta's cross-event funnel needs
  // this to attribute the join back to the original ad-driven visit.
  // Fall back to telegramUserId for organic /start flows where no session
  // was ever created.
  const externalIdSource = data.visitorId || String(data.telegramUserId);
  const userData: Record<string, string> = {
    external_id: hashValue(externalIdSource),
  };

  if (data.ipAddress) userData.client_ip_address = data.ipAddress;
  if (data.userAgent) userData.client_user_agent = data.userAgent;
  if (data.fbp) userData.fbp = data.fbp;

  const fbc = buildServerFbc(data.fbclid, data.sessionCreatedAt);
  if (fbc) userData.fbc = fbc;

  const customData: Record<string, string> = {
    content_name: "Telegram Channel Join",
    content_category: "Telegram",
    value: "0.00",
    currency: "EUR",
    predicted_ltv: "0.00",
    telegram_user_id: String(data.telegramUserId),
  };

  if (data.utmCampaign) customData.utm_campaign = data.utmCampaign;
  if (data.utmSource) customData.utm_source = data.utmSource;
  if (data.utmMedium) customData.utm_medium = data.utmMedium;
  if (data.utmContent) customData.utm_content = data.utmContent;
  if (data.telegramUsername) customData.telegram_username = data.telegramUsername;

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: "Subscribe",
        event_time: data.eventTime,
        event_id: data.eventId,
        event_source_url: data.sourceUrl || DEFAULT_SOURCE_URL,
        action_source: "website",
        user_data: userData,
        custom_data: customData,
      },
    ],
  };

  if (data.testEventCode) {
    payload.test_event_code = data.testEventCode;
  }

  return payload;
}

export async function fireSubscribeEvent(data: CapiEventData): Promise<MetaSendResult> {
  const payload = buildSubscribePayload(data);
  return postMetaPayload(data.eventId, payload);
}
