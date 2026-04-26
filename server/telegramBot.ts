const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

export type SendTelegramMessageResult = {
  ok: boolean;
  blocked: boolean;
  status: number;
  description?: string;
};

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
): Promise<SendTelegramMessageResult> {
  if (!BOT_TOKEN) {
    return {
      ok: false,
      blocked: false,
      status: 500,
      description: "Bot token not configured",
    };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; description?: string; error_code?: number }
      | null;

    const description = payload?.description || response.statusText || "Unknown Telegram error";
    const blocked = response.status === 403 || /blocked by the user/i.test(description);

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
    return {
      ok: false,
      blocked: false,
      status: 500,
      description: error instanceof Error ? error.message : "Unknown fetch error",
    };
  }
}
