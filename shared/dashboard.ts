export type DashboardAdStatus = "active" | "warming" | "idle";

export function getStatusHeadline(status: DashboardAdStatus) {
  if (status === "active") return "Ad active";
  if (status === "warming") return "Ad warming";
  return "Ad idle";
}

export function minutesSince(value: string | Date | null) {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
}

export function getFreshnessTone(minutes: number | null) {
  if (minutes === null) {
    return {
      dot: "bg-slate-500",
      text: "text-slate-300",
      label: "Aucune donnée récente",
    };
  }

  if (minutes <= 5) {
    return {
      dot: "bg-emerald-400",
      text: "text-emerald-300",
      label: "Flux très frais",
    };
  }

  if (minutes <= 20) {
    return {
      dot: "bg-amber-300",
      text: "text-amber-200",
      label: "Flux à surveiller",
    };
  }

  return {
    dot: "bg-red-400",
    text: "text-red-300",
    label: "Flux refroidi",
  };
}
