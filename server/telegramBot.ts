const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

// Cap each Telegram round-trip. Without this, a stalled connection (TLS hang,
// edge outage) would freeze the broadcast worker indefinitely — its tick is
// sequential and the `workerRunning` guard prevents subsequent ticks from
// running while one is in flight.
const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;

// Telegram's exact response strings when a DM is no longer deliverable.
// These are stable, documented Bot API responses; matching on them avoids
// false positives from generic 403s (rate limit, anti-spam, kicked-from-chat).
const USER_UNREACHABLE_PATTERNS = [
  /bot was blocked by the user/i,
  /user is deactivated/i,
  /chat not found/i, // user wiped their account / never started the bot
  /forbidden:\s*bot can't initiate conversation with a user/i,
];

function isUserUnreachableDescription(description: string): boolean {
  return USER_UNREACHABLE_PATTERNS.some((re) => re.test(description));
}

export type SendTelegramMessageResult = {
  ok: boolean;
  blocked: boolean;
  status: number;
  description?: string;
  // True when the request timed out or the network dropped — the call never
  // reached Telegram (or we don't know if it did). Callers should treat these
  // as transient and leave the job in a retryable state.
  transient?: boolean;
};

export type TelegramInlineButton = { text: string; url: string };

export type SendTelegramMessageOptions = {
  // Telegram parse_mode. Default is unset (plain text). Pass "HTML" or
  // "MarkdownV2" only when the caller has either escaped reserved characters
  // or intentionally wants entity parsing. Admin-typed broadcast text MUST
  // be sent without a parse_mode — a stray `<`, `>`, or `&` would otherwise
  // make Telegram reject every send with "can't parse entities".
  parseMode?: "HTML" | "MarkdownV2";
  // Optional inline keyboard rows. Each inner array is one row of buttons.
  // Telegram caps individual button text at ~64 chars; we keep things short.
  inlineButtons?: TelegramInlineButton[][];
};

// Match http(s) URLs while excluding common trailing punctuation that's
// almost always sentence-final, not part of the URL.
const URL_REGEX = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/gi;

function buttonLabelForUrl(url: string): string {
  const lower = url.toLowerCase();
  // t.me/+invite or t.me/joinchat/ → private-group join CTA
  if (/t\.me\/\+|t\.me\/joinchat\/|telegram\.me\/\+/.test(lower)) {
    return "🚀 Rejoindre le groupe privé";
  }
  // Other Telegram links (channel, user, bot deep link)
  if (/t\.me\/|telegram\.me\//.test(lower)) {
    return "💬 Ouvrir sur Telegram";
  }
  return "🔗 Ouvrir le lien";
}

/**
 * Extract URLs from `text` and turn them into a Telegram inline keyboard.
 * Returns `undefined` if no URLs are present so callers can pass the result
 * directly into `inlineButtons`.
 *
 * Behaviour:
 * - One button per unique URL, in the order they appear.
 * - Capped at 3 buttons to keep the keyboard compact (Telegram allows more,
 *   but bulk-CTA UIs perform better with one obvious action).
 * - Labels are inferred from the URL host: t.me invite → "Rejoindre",
 *   other t.me → "Ouvrir sur Telegram", everything else → "Ouvrir le lien".
 */
export function buildUrlInlineKeyboard(
  text: string,
): TelegramInlineButton[][] | undefined {
  const matches = text.match(URL_REGEX);
  if (!matches || matches.length === 0) return undefined;
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of matches) {
    if (seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
    if (unique.length >= 3) break;
  }
  return unique.map((url) => [{ text: buttonLabelForUrl(url), url }]);
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options: SendTelegramMessageOptions = {},
): Promise<SendTelegramMessageResult> {
  if (!BOT_TOKEN) {
    return {
      ok: false,
      blocked: false,
      status: 500,
      description: "Bot token not configured",
    };
  }

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (options.parseMode) {
    body.parse_mode = options.parseMode;
  }
  if (options.inlineButtons && options.inlineButtons.length > 0) {
    body.reply_markup = { inline_keyboard: options.inlineButtons };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TELEGRAM_REQUEST_TIMEOUT_MS),
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; description?: string; error_code?: number }
      | null;

    const description = payload?.description || response.statusText || "Unknown Telegram error";
    // ONLY treat the user as durably unreachable when Telegram says so
    // explicitly. Bare HTTP 403 is too greedy: Telegram also returns 403 for
    // anti-spam restrictions on the bot itself, "chat_write_forbidden", and
    // "bot was kicked" — none of which mean "this user blocked us." Marking
    // them as blocked is one-way and would permanently shrink future
    // broadcast audiences for transient bot-side issues.
    const blocked = isUserUnreachableDescription(description);

    if (!response.ok || payload?.ok === false) {
      return {
        ok: false,
        blocked,
        status: payload?.error_code || response.status,
        description,
      };
    }

    return {
      ok: true,
      blocked: false,
      status: response.status,
      description,
    };
  } catch (error) {
    const isTimeout =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      blocked: false,
      status: isTimeout ? 408 : 500,
      description: error instanceof Error ? error.message : "Unknown fetch error",
      transient: true,
    };
  }
}
