import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { getUtmSessionByToken } from "./db";

function buildCaller() {
  return appRouter.createCaller({
    req: {
      headers: {
        "user-agent": "vitest-telegram-tracking",
        "x-forwarded-for": "203.0.113.10",
      },
      socket: { remoteAddress: "203.0.113.10" },
    } as any,
    res: {} as any,
    user: null,
  });
}

describe("telegram tracking router", () => {
  it("crée une session Telegram, génère les liens bot et marque le clic", async () => {
    const caller = buildCaller();

    const created = await caller.tracking.createSession({
      utmSource: "facebook",
      utmMedium: "cpc",
      utmCampaign: "campaign_test",
      utmContent: "creative_a",
      utmTerm: "landing",
      fbclid: "fbclid_test_value",
      landingPage: "https://mister-b.club/?utm_source=facebook",
      referrer: "https://facebook.com",
      isMobile: true,
    });

    expect(created.success).toBe(true);
    expect(created.sessionToken.length).toBeGreaterThan(20);
    expect(created.telegramBotUrl).toContain("https://t.me/Misternb_bot?start=");
    expect(created.telegramDeepLink).toContain("tg://resolve?domain=Misternb_bot&start=");
    expect(created.payload.length).toBeGreaterThan(10);

    const storedBeforeClick = await getUtmSessionByToken(created.sessionToken);
    expect(storedBeforeClick?.utmSource).toBe("facebook");
    expect(storedBeforeClick?.clickedTelegramLink).toBe("no");

    const marked = await caller.tracking.markTelegramClick({
      sessionToken: created.sessionToken,
      source: "telegram_group_button",
    });

    expect(marked.success).toBe(true);

    const storedAfterClick = await getUtmSessionByToken(created.sessionToken);
    expect(storedAfterClick?.clickedTelegramLink).toBe("yes");
  }, 20_000);
});
