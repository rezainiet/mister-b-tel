/**
 * Pure unit tests for the client-side tracking module's deterministic helpers.
 * These are run in node (no jsdom) by checking only the pure-function exports
 * that don't touch window/document.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  // Provide minimal window/document shims so the module can import without
  // crashing. The functions under test do their own `typeof` checks.
  // @ts-ignore
  globalThis.window = globalThis.window || {};
  // @ts-ignore
  globalThis.document = globalThis.document || { cookie: "" };
});

afterEach(() => {
  // @ts-ignore
  delete globalThis.window;
  // @ts-ignore
  delete globalThis.document;
});

describe("client/lib/tracking — fallback payload encoding (P0-A)", () => {
  it("buildFallbackTelegramPayload encodes group::funnelToken as base64url under Telegram's limit", async () => {
    const { buildFallbackTelegramPayload } = await import("../client/src/lib/tracking");
    const payload = buildFallbackTelegramPayload("ft_abcdef1234567890");
    expect(payload.length).toBeLessThanOrEqual(64);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    // Decode and verify it carries the funnelToken.
    const decoded = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    expect(decoded).toBe("g::ft_abcdef1234567890");
  });

  it("buildFallbackTrackingSession always returns a non-empty start payload in both URLs", async () => {
    const { buildFallbackTrackingSession } = await import("../client/src/lib/tracking");
    const session = buildFallbackTrackingSession("ft_xyz");
    expect(session.payload).not.toBe("");
    expect(session.telegramBotUrl).toContain("?start=");
    expect(session.telegramDeepLink).toContain("&start=");
    // Funnel token round-trips cleanly.
    expect(session.funnelToken).toBe("ft_xyz");
  });

  it("fallback URL never points at the bare bot URL (no ?start= would mean silent attribution loss)", async () => {
    const { buildFallbackTrackingSession, TELEGRAM_BOT_URL } = await import("../client/src/lib/tracking");
    const session = buildFallbackTrackingSession("ft_test");
    expect(session.telegramBotUrl).not.toBe(TELEGRAM_BOT_URL);
    expect(session.telegramBotUrl.startsWith(TELEGRAM_BOT_URL + "?start=")).toBe(true);
  });
});
