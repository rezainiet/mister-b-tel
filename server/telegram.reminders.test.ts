import { describe, expect, it } from "vitest";
import {
  TELEGRAM_REMINDER_STEPS,
  buildTelegramReminderDrafts,
  renderTelegramReminderMessage,
} from "./telegramReminders";
import { buildDefaultWelcomeMessage } from "./telegramWebhook";

describe("telegram reminders", () => {
  it("définit les sept relances demandées avec des clés distinctes", () => {
    expect(TELEGRAM_REMINDER_STEPS.map((step) => step.key)).toEqual([
      "15m",
      "1h",
      "4h",
      "24h",
      "1w",
      "2w",
      "1m",
    ]);
  });

  it("rend correctement les placeholders des messages de relance", () => {
    const message = renderTelegramReminderMessage("Salut {first_name} → {group_url}", {
      firstName: "Karim",
      groupUrl: "https://t.me/+demo",
    });

    expect(message).toBe("Salut Karim → https://t.me/+demo\n\nTu peux aussi me contacter directement : @MisterBNMB");
  });

  it("construit un message de bienvenue vendeur avec lien du canal et contact direct", () => {
    const message = buildDefaultWelcomeMessage("https://t.me/+demo");

    expect(message).toContain("Bienvenue chez Mister B.");
    expect(message).toContain("https://t.me/+demo");
    expect(message).toContain("@MisterBNMB");
  });

  it("génère une file de sept jobs avec les bons délais et des messages différenciés", async () => {
    const startedAt = new Date("2026-04-20T10:00:00.000Z");

    const drafts = await buildTelegramReminderDrafts({
      telegramUserId: "123456",
      chatId: "123456",
      firstName: "Yassine",
      startedAt,
    });

    expect(drafts).toHaveLength(7);
    expect(new Set(drafts.map((draft) => draft.reminderKey)).size).toBe(7);
    expect(new Set(drafts.map((draft) => draft.messageText)).size).toBe(7);

    const dueOffsets = drafts.map((draft) => draft.dueAt.getTime() - startedAt.getTime());
    expect(dueOffsets).toEqual(
      TELEGRAM_REMINDER_STEPS.map((step) => step.defaultDelayMin * 60 * 1000),
    );

    expect(drafts[0]?.messageText).toContain("Je te renvoie l’accès au canal privé Mister B");
    expect(drafts[0]?.messageText).toContain("https://t.me/");
    expect(drafts[0]?.messageText).toContain("@MisterBNMB");
  });
});
