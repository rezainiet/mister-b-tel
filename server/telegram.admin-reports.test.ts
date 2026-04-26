import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getTelegramCumulativeReportStats: vi.fn(),
  getTelegramRecipientsByUsernames: vi.fn(),
  upsertSetting: vi.fn(),
}));

const telegramBotMocks = vi.hoisted(() => ({
  sendTelegramMessage: vi.fn(),
}));

vi.mock("./db", () => dbMocks);
vi.mock("./telegramBot", () => telegramBotMocks);

import {
  buildTelegramAdminReportText,
  getParisMidnightUtc,
  isTelegramAdminReportDue,
  maybeSendScheduledTelegramAdminReport,
  sendTelegramAdminReport,
} from "./telegramAdminReports";

const webhookSource = fs.readFileSync(path.resolve(import.meta.dirname, "./telegramWebhook.ts"), "utf-8");
const serverSource = fs.readFileSync(path.resolve(import.meta.dirname, "./_core/index.ts"), "utf-8");

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getSetting.mockResolvedValue(null);
  dbMocks.getTelegramCumulativeReportStats.mockResolvedValue({
    landingVisits: 180,
    botStarts: 15,
    channelJoins: 7,
  });
  dbMocks.getTelegramRecipientsByUsernames.mockResolvedValue([
    {
      telegramUserId: "8521066448",
      telegramUsername: "bestmanylitics",
      telegramFirstName: "Best M",
      startedAt: new Date("2026-04-23T18:08:23.000Z"),
    },
    {
      telegramUserId: "8078913373",
      telegramUsername: "coucoulala123",
      telegramFirstName: "Best management",
      startedAt: new Date("2026-04-23T03:26:23.000Z"),
    },
  ]);
  telegramBotMocks.sendTelegramMessage.mockResolvedValue({
    ok: true,
    blocked: false,
    status: 200,
    description: "OK",
  });
});

describe("telegram admin reports", () => {
  it("calcule correctement minuit Europe/Paris en UTC pour un jour d’été", () => {
    const start = getParisMidnightUtc(new Date("2026-04-23T17:15:00.000Z"));
    expect(start.toISOString()).toBe("2026-04-22T22:00:00.000Z");
  });

  it("ouvre la fenêtre d’envoi automatique toutes les 2 heures sur les créneaux impairs en heure de Paris", () => {
    expect(isTelegramAdminReportDue(new Date("2026-04-23T17:02:00.000Z"))).toBe(true);
    expect(isTelegramAdminReportDue(new Date("2026-04-23T17:07:00.000Z"))).toBe(false);
    expect(isTelegramAdminReportDue(new Date("2026-04-23T16:02:00.000Z"))).toBe(false);
  });

  it("construit le rapport cumulé demandé avec uniquement les 3 métriques depuis minuit Paris", async () => {
    const report = await buildTelegramAdminReportText({ now: new Date("2026-04-23T17:15:00.000Z") });

    expect(report.reportHourLabel).toBe("19h");
    expect(report.text).toContain("Rapport Telegram cumulé · 19h (Paris)");
    expect(report.text).toContain("Depuis 00:00 Europe/Paris · 2026-04-23");
    expect(report.text).toContain("1. Visites landing cumulées : 180");
    expect(report.text).toContain("2. Nombre de /start bot cumulés : 15");
    expect(report.text).toContain("3. Nombre de personnes ayant rejoint le canal cumulées : 7");
  });

  it("envoie le rapport uniquement aux deux comptes Telegram autorisés résolus depuis les bot starts", async () => {
    const result = await sendTelegramAdminReport({
      now: new Date("2026-04-23T17:15:00.000Z"),
      reportHour: 19,
    });

    expect(result.missingUsernames).toEqual([]);
    expect(result.recipients.map((recipient) => recipient.username)).toEqual([
      "@bestmanylitics",
      "@coucoulala123",
    ]);
    expect(telegramBotMocks.sendTelegramMessage).toHaveBeenCalledTimes(2);
    expect(telegramBotMocks.sendTelegramMessage).toHaveBeenNthCalledWith(
      1,
      "8521066448",
      expect.stringContaining("Rapport Telegram cumulé · 19h (Paris)"),
    );
    expect(telegramBotMocks.sendTelegramMessage).toHaveBeenNthCalledWith(
      2,
      "8078913373",
      expect.stringContaining("Rapport Telegram cumulé · 19h (Paris)"),
    );
  });

  it("n’envoie pas deux fois le même créneau automatique déjà mémorisé", async () => {
    dbMocks.getSetting.mockResolvedValue("2026-04-23-19");

    const result = await maybeSendScheduledTelegramAdminReport(new Date("2026-04-23T17:02:00.000Z"));

    expect(result).toMatchObject({ sent: false, reason: "already_sent", slotKey: "2026-04-23-19" });
    expect(telegramBotMocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(dbMocks.upsertSetting).not.toHaveBeenCalled();
  });

  it("branche la commande /rapport dans le webhook et démarre le worker d’admin au boot serveur", () => {
    expect(webhookSource).toContain("/^\\/rapport");
    expect(webhookSource).toContain("isTelegramAdminAuthorized");
    expect(webhookSource).toContain("buildTelegramAdminReportText");
    expect(serverSource).toContain("startTelegramAdminReportWorker");
  });
});
