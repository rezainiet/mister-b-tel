import { describe, expect, it } from "vitest";

describe("META credentials", () => {
  it("expose un pixel configuré et permet un appel léger à l'API Graph Meta", async () => {
    const pixelId = process.env.META_PIXEL_ID;
    const token = process.env.META_CONVERSIONS_TOKEN;

    expect(pixelId).toBeTruthy();
    expect(pixelId).toBe("945883278158292");
    expect(token).toBeTruthy();

    const response = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(token as string)}`,
    );

    const payload = await response.json();

    expect(response.ok).toBe(true);
    expect(payload).toHaveProperty("id");
  }, 20_000);
});
