import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(new URL("../client/src/pages/Dashboard.tsx", import.meta.url), "utf8");

describe("Dashboard Telegram labels", () => {
  it("affiche désormais un tunnel Telegram plus précis entre clic bot, contact direct et ajouts confirmés", () => {
    expect(dashboardSource).toContain('whatsapp_click: "Telegram bot click"');
    expect(dashboardSource).toContain('title="Clic bot Telegram"');
    expect(dashboardSource).toContain('title="Start bot"');
    expect(dashboardSource).toContain('title="Membres rejoints"');
    expect(dashboardSource).toContain('title="Contact direct"');
    expect(dashboardSource).toContain('>Clic bot</th>');
    expect(dashboardSource).toContain('>Contact direct</th>');
  });

  it("ne conserve plus les anciens libellés WhatsApp dans les zones principales du dashboard", () => {
    expect(dashboardSource).not.toContain('title="WhatsApp Clicks"');
    expect(dashboardSource).not.toContain('>WhatsApp</th>');
    expect(dashboardSource).not.toContain('whatsapp_click: "WhatsApp click"');
  });
});
