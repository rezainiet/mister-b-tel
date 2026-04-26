import { describe, expect, it, vi } from "vitest";
import { getFreshnessTone, getStatusHeadline, minutesSince } from "@shared/dashboard";

describe("dashboard presentation helpers", () => {
  it("retourne le bon libellé selon l’état publicitaire", () => {
    expect(getStatusHeadline("active")).toBe("Ad active");
    expect(getStatusHeadline("warming")).toBe("Ad warming");
    expect(getStatusHeadline("idle")).toBe("Ad idle");
  });

  it("calcule les minutes écoulées depuis un événement récent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T12:00:00.000Z"));

    expect(minutesSince("2026-04-13T11:57:00.000Z")).toBe(3);
    expect(minutesSince(null)).toBeNull();

    vi.useRealTimers();
  });

  it("classe correctement la fraîcheur des données", () => {
    expect(getFreshnessTone(null)).toEqual({
      dot: "bg-slate-500",
      text: "text-slate-300",
      label: "Aucune donnée récente",
    });

    expect(getFreshnessTone(2)).toEqual({
      dot: "bg-emerald-400",
      text: "text-emerald-300",
      label: "Flux très frais",
    });

    expect(getFreshnessTone(12)).toEqual({
      dot: "bg-amber-300",
      text: "text-amber-200",
      label: "Flux à surveiller",
    });

    expect(getFreshnessTone(45)).toEqual({
      dot: "bg-red-400",
      text: "text-red-300",
      label: "Flux refroidi",
    });
  });
});
