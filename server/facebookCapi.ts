import crypto from "node:crypto";
import { MetaSendResult, postMetaPayload } from "./metaCapi";

type ConversionEventName = "PageView" | "Subscribe" | "Contact" | "CustomEvent";

export type ConversionPayload = {
  visitorId?: string;
  eventId?: string;
  eventSourceUrl?: string;
  userAgent?: string;
  clientIpAddress?: string;
  fbc?: string;
  fbp?: string;
  country?: string;
  source?: string;
  customData?: Record<string, unknown>;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
};

function hashForFb(value?: string | null) {
  if (!value) return undefined;
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function buildCustomData(eventName: ConversionEventName, payload: ConversionPayload) {
  if (eventName === "Subscribe") {
    const isTelegramSubscribe = (payload.source || "").includes("telegram") || (payload.source || "").includes("group");
    const defaults = isTelegramSubscribe
      ? {
          content_name: "Telegram",
          content_category: "Groupe Telegram",
          subscribe_source: payload.source || "telegram_group_button",
        }
      : {
          content_name: "WhatsApp",
          content_category: "Canal WhatsApp",
          subscribe_source: payload.source || "button",
        };

    return payload.customData && Object.keys(payload.customData).length > 0
      ? { ...defaults, ...payload.customData }
      : defaults;
  }

  if (eventName === "Contact") {
    return {
      content_name: "Telegram",
      content_category: "Contact privé Telegram",
      contact_source: payload.source || "button",
    };
  }

  if (eventName === "CustomEvent") {
    return payload.customData && Object.keys(payload.customData).length > 0
      ? payload.customData
      : undefined;
  }

  const base: Record<string, unknown> = {
    content_name: "Mister B Landing",
  };
  if (payload.utmSource) base.utm_source = payload.utmSource;
  if (payload.utmMedium) base.utm_medium = payload.utmMedium;
  if (payload.utmCampaign) base.utm_campaign = payload.utmCampaign;
  if (payload.utmContent) base.utm_content = payload.utmContent;
  if (payload.utmTerm) base.utm_term = payload.utmTerm;
  return base;
}

export function buildCapiEventPayload(
  eventName: ConversionEventName,
  payload: ConversionPayload = {},
) {
  const eventId = payload.eventId || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const customData = buildCustomData(eventName, payload);

  return {
    eventId,
    body: {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: "website",
          event_source_url: payload.eventSourceUrl || undefined,
          user_data: {
            client_ip_address: payload.clientIpAddress || undefined,
            client_user_agent: payload.userAgent || undefined,
            external_id: hashForFb(payload.visitorId),
            country: hashForFb(payload.country),
            fbc: payload.fbc || undefined,
            fbp: payload.fbp || undefined,
          },
          custom_data: customData,
        },
      ],
    },
  };
}

export async function sendCapiEvent(
  eventName: ConversionEventName,
  payload: ConversionPayload = {},
): Promise<MetaSendResult> {
  const built = buildCapiEventPayload(eventName, payload);
  return postMetaPayload(built.eventId, built.body);
}

export async function sendPageView(payload: ConversionPayload = {}): Promise<MetaSendResult> {
  return sendCapiEvent("PageView", payload);
}

export async function sendSubscribe(payload: ConversionPayload = {}): Promise<MetaSendResult> {
  return sendCapiEvent("Subscribe", payload);
}

export async function sendContact(payload: ConversionPayload = {}): Promise<MetaSendResult> {
  return sendCapiEvent("Contact", payload);
}

export async function sendScrollDepth(payload: ConversionPayload = {}): Promise<MetaSendResult> {
  return sendCapiEvent("CustomEvent", payload);
}
