import { describe, expect, it } from "vitest";

describe("telegram secrets", () => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const runExternalValidation = process.env.RUN_EXTERNAL_SECRET_VALIDATION === "true";

  it("vérifie la présence du secret webhook et du token bot configurés", () => {
    expect(botToken).toBeTruthy();
    expect(webhookSecret).toBeTruthy();
    expect((webhookSecret || "").length).toBeGreaterThanOrEqual(16);
  });

  it.skipIf(!(botToken && runExternalValidation))(
    "valide le token du bot via getMe quand la validation externe est explicitement activée",
    async () => {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const payload = (await response.json()) as {
        ok?: boolean;
        result?: { username?: string; is_bot?: boolean };
        description?: string;
      };

      expect(response.ok).toBe(true);
      expect(payload.ok).toBe(true);
      expect(payload.result?.is_bot).toBe(true);
      expect(payload.result?.username).toBe("Misternb_bot");
    },
    20_000,
  );
});
