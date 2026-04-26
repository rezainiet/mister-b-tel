import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const trackingSource = readFileSync(resolve(import.meta.dirname, "../client/src/lib/tracking.ts"), "utf8");

describe("Microsoft Clarity CTA events", () => {
  it("fires a Clarity custom event for the Telegram group CTA", () => {
    expect(trackingSource).toContain('function trackClarityEvent(eventName: string, metadata?: Record<string, string>)');
    expect(trackingSource).toContain('clarity?.("event", eventName)');
    expect(trackingSource).toContain('trackClarityEvent("telegram_group_click", {');
    expect(trackingSource).toContain('clarity_event_target: "telegram_group"');
  });

  it("fires a Clarity custom event for the Telegram contact CTA", () => {
    expect(trackingSource).toContain('trackClarityEvent("telegram_contact_click", {');
    expect(trackingSource).toContain('clarity_event_target: "telegram_contact"');
    expect(trackingSource).toContain('clarity_event_source: source');
  });
});
