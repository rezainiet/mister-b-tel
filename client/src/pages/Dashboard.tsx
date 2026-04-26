import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Clock3,
  Loader2,
  LockKeyhole,
  Radio,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getFreshnessTone, getStatusHeadline, minutesSince } from "@shared/dashboard";

type DashboardPreset = "24h" | "48h" | "7d" | "15d" | "30d";

type DashboardWindow = {
  pageviews: number;
  uniqueVisitors: number;
  totalContacts: number;
};

type DashboardMeta = {
  preset: DashboardPreset;
  label: string;
  startDate: string;
  endDate: string;
  refreshedAt: string;
  sinceMidnight: boolean;
};

type DashboardTotals = {
  pageviews: number;
  uniqueVisitors: number;
  whatsappClicks: number;
  telegramClicks: number;
  scroll25: number;
  scroll50: number;
  scroll75: number;
  scroll100: number;
  totalContacts: number;
  conversionRate: string;
};

type DashboardDay = {
  date: string;
  pageviews: number;
  uniqueVisitors: number;
  whatsappClicks: number;
  telegramClicks: number;
  scroll25: number;
  scroll50: number;
  scroll75: number;
  scroll100: number;
  totalContacts: number;
  conversionRate: string;
};

type DashboardLiveSnapshot = {
  last5Minutes: DashboardWindow;
  last10Minutes: DashboardWindow;
  last4Hours: DashboardWindow;
  lastVisitAt: string | null;
  lastEventType: string | null;
  adStatus: "active" | "warming" | "idle";
  adStatusLabel: string;
};

type RecentEvent = {
  id: number;
  eventType: string;
  eventSource?: string | null;
  visitorId?: string | null;
  referrer?: string | null;
  country?: string | null;
  createdAt: string | Date;
};

type DashboardData = {
  meta: DashboardMeta;
  totals: DashboardTotals;
  daily: DashboardDay[];
  recentEvents: RecentEvent[];
  live: DashboardLiveSnapshot;
};

type DashboardSetting = {
  settingKey: string;
  settingValue: string;
};

type DashboardSettingsData = {
  settings: DashboardSetting[];
};

type MetaStatusData = {
  config: {
    pixelId: string;
    pixelConfigured: boolean;
    tokenConfigured: boolean;
    pageViewTrackingActive: boolean;
    subscribeTrackingActive: boolean;
  };
  summary: {
    totalStarts: number;
    totalSent: number;
    totalFailed: number;
    totalPending: number;
    todayStarts: number;
    todaySent: number;
    todayFailed: number;
    todayPending: number;
  };
};

type TelegramOverviewData = {
  joinStats: {
    totalJoins: number;
    todayJoins: number;
    totalMetaCount: number;
    todayMetaJoins: number;
    conversionRate: string;
  };
  botStartStats: {
    botStartsCount: number;
    joinedAfterStartCount: number;
    notJoinedCount: number;
  };
  dailyReport: {
    conversionRate: string;
  };
  weeklyJoins: number;
};

type SubscriberLogRow = {
  id: number;
  telegramUserId: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  utmSource: string;
  utmCampaign: string;
  utmMedium: string;
  utmContent: string;
  utmTerm: string;
  sessionToken: string | null;
  fbclid: string | null;
  metaSubscribeStatus: "pending" | "sent" | "failed";
  metaSubscribeEventId: string | null;
  metaSubscribeSentAt: string | Date | null;
  startedAt: string | Date;
  joinedAt: string | Date | null;
};

type SubscriberLogData = {
  rows: SubscriberLogRow[];
};

const TOKEN_KEY = "misterb-dash-token";
const PRESET_KEY = "misterb-dash-preset";

const presetOptions: Array<{ value: DashboardPreset; label: string }> = [
  { value: "24h", label: "Depuis minuit" },
  { value: "48h", label: "48h" },
  { value: "7d", label: "7 jours" },
  { value: "15d", label: "15 jours" },
  { value: "30d", label: "30 jours" },
];

function formatInt(value: number) {
  return new Intl.NumberFormat("fr-FR").format(value || 0);
}

function formatPct(value: string | number) {
  const numeric = typeof value === "number" ? value : Number(value || 0);
  return `${numeric.toFixed(1)}%`;
}

function formatShortDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatDateTime(value: string | Date | null) {
  if (!value) return "Aucune visite";

  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeTime(value: string | Date | null) {
  if (!value) return "aucune visite";

  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));

  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;

  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

function isTelegramGroupSource(eventSource?: string | null) {
  return Boolean(eventSource && eventSource.startsWith("telegram_group"));
}

function eventLabel(eventType: string, eventSource?: string | null) {
  const labels: Record<string, string> = {
    pageview: "Page view",
    unique_visitor: "New visitor",
    whatsapp_click: "Telegram bot click",
    telegram_click: isTelegramGroupSource(eventSource) ? "Telegram bot click" : "Telegram contact click",
    scroll_25: "Scroll 25%",
    scroll_50: "Scroll 50%",
    scroll_75: "Scroll 75%",
    scroll_100: "Scroll 100%",
    time_30s: "Time 30s",
  };

  return labels[eventType] || eventType;
}

function sourceLabel(eventSource?: string | null) {
  if (!eventSource) return "via tracking";
  return `via ${eventSource.replaceAll("_", " ")}`;
}

function eventDotClass(eventType: string, eventSource?: string | null) {
  if (eventType === "unique_visitor") return "bg-cyan-400";
  if (eventType === "whatsapp_click") return "bg-emerald-400";
  if (eventType === "telegram_click") return isTelegramGroupSource(eventSource) ? "bg-emerald-400" : "bg-blue-400";
  return "bg-violet-400";
}

function kpiColorClass(kind: "violet" | "cyan" | "green" | "blue" | "yellow") {
  const map = {
    violet: "text-violet-400",
    cyan: "text-cyan-400",
    green: "text-emerald-400",
    blue: "text-blue-400",
    yellow: "text-amber-300",
  } as const;

  return map[kind];
}

function metaStatusBadge(status: SubscriberLogRow["metaSubscribeStatus"]) {
  if (status === "sent") {
    return {
      label: "Sent",
      dot: "bg-emerald-400",
      text: "text-emerald-300",
      border: "border-emerald-500/30",
      background: "bg-emerald-500/10",
    } as const;
  }

  if (status === "failed") {
    return {
      label: "Failed",
      dot: "bg-red-400",
      text: "text-red-300",
      border: "border-red-500/30",
      background: "bg-red-500/10",
    } as const;
  }

  return {
    label: "Pending",
    dot: "bg-amber-300",
    text: "text-amber-200",
    border: "border-amber-400/30",
    background: "bg-amber-400/10",
  } as const;
}

function formatSubscriberIdentity(row: SubscriberLogRow) {
  if (row.telegramUsername) return `@${row.telegramUsername}`;
  if (row.telegramFirstName) return row.telegramFirstName;
  return `User ${row.telegramUserId}`;
}

function formatSubscriberAttribution(row: SubscriberLogRow) {
  return [row.utmSource, row.utmMedium, row.utmCampaign]
    .filter((value) => Boolean(value && value !== "—"))
    .join(" · ");
}

function presenceBadge(value: string | null) {
  if (value) {
    return {
      label: "Present",
      dot: "bg-emerald-400",
      text: "text-emerald-300",
      border: "border-emerald-500/30",
      background: "bg-emerald-500/10",
    } as const;
  }

  return {
    label: "Missing",
    dot: "bg-red-400",
    text: "text-red-300",
    border: "border-red-500/30",
    background: "bg-red-500/10",
  } as const;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[24px] border border-slate-800 bg-slate-900/95 p-5 ${className}`}>
      {children}
    </section>
  );
}

function StatusPill({
  dotClass,
  label,
  value,
}: {
  dotClass: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 px-3.5 py-3">
      <div className="flex items-center gap-2 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-slate-400">
        <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
        {label}
      </div>
      <p className="mt-2 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  color,
}: {
  title: string;
  value: string;
  subtitle: string;
  color: "violet" | "cyan" | "green" | "blue" | "yellow";
}) {
  return (
    <Card>
      <p className="text-[0.72rem] font-medium uppercase tracking-[0.22em] text-slate-400">{title}</p>
      <p className={`mt-4 text-[2.45rem] font-bold tracking-[-0.06em] ${kpiColorClass(color)}`}>{value}</p>
      <p className="mt-3 text-sm text-slate-400">{subtitle}</p>
    </Card>
  );
}

export default function Dashboard() {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(TOKEN_KEY) || "";
  });
  const [preset, setPreset] = useState<DashboardPreset>(() => {
    if (typeof window === "undefined") return "24h";
    const saved = window.localStorage.getItem(PRESET_KEY);
    return saved === "48h" || saved === "7d" || saved === "15d" || saved === "30d" ? saved : "24h";
  });
  const [telegramGroupUrl, setTelegramGroupUrl] = useState("");

  const loginMutation = trpc.dashboard.login.useMutation();

  const statsQuery = trpc.dashboard.stats.useQuery(
    {
      token,
      preset,
    },
    {
      enabled: Boolean(token),
      retry: false,
      refetchInterval: 10_000,
      refetchOnWindowFocus: true,
    },
  );
  const settingsQuery = trpc.dashboard.settings.useQuery(
    { token },
    {
      enabled: Boolean(token),
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  const metaStatusQuery = trpc.dashboard.metaStatus.useQuery(
    { token },
    {
      enabled: Boolean(token),
      retry: false,
      refetchInterval: 10_000,
      refetchOnWindowFocus: true,
    },
  );
  const subscriberLogQuery = trpc.dashboard.subscriberLog.useQuery(
    { token, limit: 25 },
    {
      enabled: Boolean(token),
      retry: false,
      refetchInterval: 10_000,
      refetchOnWindowFocus: true,
    },
  );
  const telegramOverviewQuery = trpc.dashboard.telegramOverview.useQuery(
    { token },
    {
      enabled: Boolean(token),
      retry: false,
      refetchInterval: 10_000,
      refetchOnWindowFocus: true,
    },
  );
  const updateSettingMutation = trpc.dashboard.updateSetting.useMutation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PRESET_KEY, preset);
  }, [preset]);

  const rawData = statsQuery.data as DashboardData | { error: string } | undefined;
  const rawSettings = settingsQuery.data as DashboardSettingsData | { error: string } | undefined;
  const rawMetaStatus = metaStatusQuery.data as MetaStatusData | { error: string } | undefined;
  const rawSubscriberLog = subscriberLogQuery.data as SubscriberLogData | { error: string } | undefined;
  const rawTelegramOverview = telegramOverviewQuery.data as TelegramOverviewData | { error: string } | undefined;

  useEffect(() => {
    const statsUnauthorized = rawData && "error" in rawData && rawData.error === "Unauthorized";
    const settingsUnauthorized = rawSettings && "error" in rawSettings && rawSettings.error === "Unauthorized";
    const metaStatusUnauthorized =
      rawMetaStatus && "error" in rawMetaStatus && rawMetaStatus.error === "Unauthorized";
    const subscriberLogUnauthorized =
      rawSubscriberLog && "error" in rawSubscriberLog && rawSubscriberLog.error === "Unauthorized";
    const telegramOverviewUnauthorized =
      rawTelegramOverview && "error" in rawTelegramOverview && rawTelegramOverview.error === "Unauthorized";

    if (
      !statsUnauthorized &&
      !settingsUnauthorized &&
      !metaStatusUnauthorized &&
      !subscriberLogUnauthorized &&
      !telegramOverviewUnauthorized
    ) {
      return;
    }

    setToken("");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_KEY);
    }
    toast.error("Dashboard session expired", {
      description: "Please log in again with the private password.",
    });
  }, [rawData, rawSettings, rawMetaStatus, rawSubscriberLog, rawTelegramOverview]);

  const data = rawData && !("error" in rawData) ? rawData : null;
  const settings = rawSettings && !("error" in rawSettings) ? rawSettings.settings : [];
  const metaStatus = rawMetaStatus && !("error" in rawMetaStatus) ? rawMetaStatus : null;
  const subscriberLog = rawSubscriberLog && !("error" in rawSubscriberLog) ? rawSubscriberLog.rows : [];
  const telegramOverview = rawTelegramOverview && !("error" in rawTelegramOverview) ? rawTelegramOverview : null;

  const recentJoinedMembers = subscriberLog.filter((row) => Boolean(row.joinedAt)).slice(0, 5);

  const botClicks = data?.totals.whatsappClicks || 0;
  const directContactClicks = data?.totals.telegramClicks || 0;
  const botStarts = telegramOverview?.botStartStats.botStartsCount || 0;
  const membersJoined = telegramOverview?.botStartStats.joinedAfterStartCount || 0;
  const pendingAfterStart = telegramOverview?.botStartStats.notJoinedCount || 0;
  const botToMemberRate = botStarts > 0 ? `${((membersJoined / botStarts) * 100).toFixed(1)}%` : "0.0%";

  useEffect(() => {
    const currentTelegramGroupUrl = settings.find((entry) => entry.settingKey === "telegram_group_url")?.settingValue;
    setTelegramGroupUrl(currentTelegramGroupUrl || "");
  }, [settings]);

  const trafficChartData = useMemo(
    () =>
      data?.daily.map((day) => ({
        label: formatShortDate(day.date),
        visits: day.pageviews,
        whatsapp: day.whatsappClicks,
        telegram: day.telegramClicks,
      })) || [],
    [data],
  );

  const freshestMinutes = minutesSince(data?.live.lastVisitAt || null);
  const freshness = getFreshnessTone(freshestMinutes);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      const result = await loginMutation.mutateAsync({ password });
      if (!result.success || !result.token) {
        toast.error("Accès refusé", {
          description: result.error || "Mot de passe incorrect.",
        });
        return;
      }

      setToken(result.token);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TOKEN_KEY, result.token);
      }
      setPassword("");
      toast.success("Connexion réussie", {
        description: "Le dashboard Mister B est maintenant accessible.",
      });
    } catch (error) {
      console.error(error);
      toast.error("Connexion impossible", {
        description: "Une erreur est survenue pendant l’authentification.",
      });
    }
  };

  const handleSaveTelegramGroupUrl = async () => {
    const nextTelegramGroupUrl = telegramGroupUrl.trim();

    if (!nextTelegramGroupUrl) {
      toast.error("Telegram link required", {
        description: "Please enter the Telegram group link you want the bot to use.",
      });
      return;
    }

    try {
      const result = await updateSettingMutation.mutateAsync({
        token,
        key: "telegram_group_url",
        value: nextTelegramGroupUrl,
      });

      if (!result.success) {
        toast.error("Save failed", {
          description: "The Telegram link could not be updated right now.",
        });
        return;
      }

      await settingsQuery.refetch();
      toast.success("Telegram link updated", {
        description: "Future bot messages and pending reminders now use the latest Telegram link.",
      });
    } catch (error) {
      console.error(error);
      toast.error("Save failed", {
        description: "An unexpected error happened while saving the Telegram link.",
      });
    }
  };

  const handleLogout = () => {
    setToken("");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_KEY);
    }
    toast.info("Dashboard verrouillé", {
      description: "La session a été retirée de cet appareil.",
    });
  };

  if (!token) {
    return (
      <main className="min-h-screen bg-[#0b1120] px-4 py-8 text-white sm:px-6">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center">
          <Card className="w-full border-slate-800 bg-[radial-gradient(circle_at_top,rgba(234,179,8,0.10),transparent_32%),radial-gradient(circle_at_top_right,rgba(34,197,94,0.10),transparent_28%),#111827] p-6 sm:p-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-amber-300">
              <ShieldCheck className="h-4 w-4" /> Accès privé
            </div>
            <h1 className="mt-5 text-[2rem] font-bold tracking-[-0.06em] text-amber-300">Mister B Tracker</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Dashboard live inspiré de la vidéo de référence, avec statut publicité, lecture depuis minuit,
              fraîcheur des données et événements récents.
            </p>

            <div className="mt-6 grid gap-3">
              <StatusPill dotClass="bg-emerald-400" label="Live" value="Rafraîchissement automatique toutes les 10 secondes" />
              <StatusPill dotClass="bg-violet-400" label="Période" value="Depuis minuit, 48h, 7, 15 ou 30 jours" />
              <StatusPill dotClass="bg-cyan-400" label="Focus" value="Suivi trafic, groupe Telegram, contact Telegram, scroll et publicité active" />
            </div>

            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <div>
                <label htmlFor="dashboard-password" className="mb-2 block text-sm font-medium text-slate-300">
                  Mot de passe d’accès
                </label>
                <input
                  id="dashboard-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Saisis le mot de passe privé"
                  className="h-14 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 text-base text-white outline-none transition focus:border-emerald-400"
                  autoComplete="current-password"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loginMutation.isPending}
                className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-5 text-base font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" /> Vérification en cours...
                  </>
                ) : (
                  <>
                    <LockKeyhole className="h-5 w-5" /> Ouvrir le dashboard
                  </>
                )}
              </button>
            </form>

            <div className="mt-6">
              <Link
                href="/"
                className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 transition hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" /> Retour à la landing Mister B
              </Link>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0b1120] text-white">
      <div className="mx-auto max-w-md px-4 py-5 sm:px-6 sm:py-6">
        <header className="mb-4 rounded-[24px] border border-slate-800 bg-slate-900/95 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[1.6rem] font-bold tracking-[-0.05em] text-amber-300">Mister B Tracker</h1>
              <p className="mt-1 text-sm text-slate-400">mister-b · Real-time Dashboard</p>
            </div>
            <div className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200">
              <span className="text-base">🇫🇷</span>
              <span>FR</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
            <label className="relative">
              <select
                value={preset}
                onChange={(event) => setPreset(event.target.value as DashboardPreset)}
                className="h-11 w-full appearance-none rounded-xl border border-slate-700 bg-slate-950 px-4 pr-10 text-sm text-white outline-none transition focus:border-emerald-400"
              >
                {presetOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </label>
            <button
              type="button"
              onClick={() =>
                void Promise.all([
                  statsQuery.refetch(),
                  metaStatusQuery.refetch(),
                  subscriberLogQuery.refetch(),
                  telegramOverviewQuery.refetch(),
                ])
              }
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 text-sm font-medium text-slate-200 transition hover:border-slate-500"
            >
              <RefreshCcw
                className={`h-4 w-4 ${
                  statsQuery.isFetching || metaStatusQuery.isFetching || subscriberLogQuery.isFetching
                    ? "animate-spin"
                    : ""
                }`}
              /> Refresh
            </button>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-red-500/55 px-4 text-sm font-medium text-red-400 transition hover:bg-red-500/10"
          >
            <LockKeyhole className="h-4 w-4" /> Logout
          </button>

          <div className="mt-4 grid gap-3">
            <StatusPill
              dotClass="bg-emerald-400"
              label="Lecture live"
              value={data?.meta.sinceMidnight ? "Depuis minuit jusqu’à maintenant" : data?.meta.label || "Période active"}
            />
            <StatusPill
              dotClass={freshness.dot}
              label="Fraîcheur"
              value={
                freshestMinutes === null
                  ? "Aucune visite récente détectée"
                  : `${freshness.label} · dernière visite ${formatRelativeTime(data?.live.lastVisitAt || null)}`
              }
            />
            <StatusPill
              dotClass="bg-cyan-400"
              label="Actualisation"
              value={`Dernière synchro ${formatDateTime(data?.meta.refreshedAt || null)}`}
            />
          </div>
        </header>

        {statsQuery.isLoading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="inline-flex items-center gap-3 rounded-full border border-slate-700 bg-slate-900 px-5 py-3 text-sm text-slate-200">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement des statistiques Mister B...
            </div>
          </div>
        ) : data ? (
          <div className="space-y-4">
            <Card>
              <div className="flex items-center gap-2 text-amber-300">
                <LockKeyhole className="h-4 w-4" />
                <h3 className="text-lg font-semibold tracking-[-0.03em]">Telegram link editor</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Update the Telegram group link used by the bot messages without changing the landing page tracking or the rest of the dashboard setup.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="telegram-group-url" className="mb-2 block text-sm font-medium text-slate-300">
                    Telegram group link
                  </label>
                  <input
                    id="telegram-group-url"
                    type="url"
                    value={telegramGroupUrl}
                    onChange={(event) => setTelegramGroupUrl(event.target.value)}
                    placeholder="https://t.me/your-group-link"
                    className="h-14 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 text-base text-white outline-none transition focus:border-emerald-400"
                    autoComplete="off"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleSaveTelegramGroupUrl()}
                  disabled={updateSettingMutation.isPending || settingsQuery.isLoading}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {updateSettingMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Saving latest changes...
                    </>
                  ) : (
                    "Save latest changes"
                  )}
                </button>
              </div>
            </Card>
            <Card className="border-violet-500/40 bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.16),transparent_42%),#111827] shadow-[0_0_0_1px_rgba(168,85,247,0.10),0_0_30px_rgba(59,130,246,0.08)]">
              <div className="flex items-center gap-2 text-amber-300">
                <ShieldCheck className="h-4 w-4" />
                <h3 className="text-lg font-semibold tracking-[-0.03em]">Meta Server Status</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Server-side configuration for PageView and Telegram bot-start Subscribe events, plus the latest conversion totals recorded from bot starts.
              </p>
              <Link
                href="/dashboard/meta-debug"
                className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-cyan-500/35 bg-slate-950 px-4 text-sm font-medium text-cyan-200 transition hover:border-cyan-400"
              >
                <Radio className="h-4 w-4" /> Open Meta Debug Page
              </Link>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <StatusPill
                  dotClass={metaStatus?.config.pixelConfigured ? "bg-emerald-400" : "bg-red-400"}
                  label="Pixel ID"
                  value={metaStatus?.config.pixelId || "Missing"}
                />
                <StatusPill
                  dotClass={metaStatus?.config.tokenConfigured ? "bg-emerald-400" : "bg-red-400"}
                  label="Token"
                  value={metaStatus?.config.tokenConfigured ? "Configured" : "Missing"}
                />
                <StatusPill
                  dotClass={metaStatus?.config.pageViewTrackingActive ? "bg-cyan-400" : "bg-amber-300"}
                  label="PageView"
                  value={metaStatus?.config.pageViewTrackingActive ? "Server-side active" : "Waiting for credentials"}
                />
                <StatusPill
                  dotClass={metaStatus?.config.subscribeTrackingActive ? "bg-violet-400" : "bg-amber-300"}
                  label="Subscribe"
                  value={metaStatus?.config.subscribeTrackingActive ? "Bot /start active" : "Waiting for credentials"}
                />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-[18px] border border-slate-800 bg-slate-950/75 px-4 py-3">
                  <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-slate-400">Sent today</p>
                  <p className="mt-2 text-2xl font-bold tracking-[-0.05em] text-emerald-400">
                    {formatInt(metaStatus?.summary.todaySent || 0)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Successful Subscribe events today</p>
                </div>
                <div className="rounded-[18px] border border-slate-800 bg-slate-950/75 px-4 py-3">
                  <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-slate-400">Sent total</p>
                  <p className="mt-2 text-2xl font-bold tracking-[-0.05em] text-emerald-400">
                    {formatInt(metaStatus?.summary.totalSent || 0)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">All bot starts counted as conversions</p>
                </div>
                <div className="rounded-[18px] border border-slate-800 bg-slate-950/75 px-4 py-3">
                  <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-slate-400">Failed total</p>
                  <p className="mt-2 text-2xl font-bold tracking-[-0.05em] text-red-300">
                    {formatInt(metaStatus?.summary.totalFailed || 0)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Starts that did not reach Meta successfully</p>
                </div>
                <div className="rounded-[18px] border border-slate-800 bg-slate-950/75 px-4 py-3">
                  <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-slate-400">Pending total</p>
                  <p className="mt-2 text-2xl font-bold tracking-[-0.05em] text-amber-200">
                    {formatInt(metaStatus?.summary.totalPending || 0)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Starts awaiting a final server-side status</p>
                </div>
              </div>
            </Card>
            <Card className="border-emerald-500/50 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.18),transparent_38%),#111827] shadow-[0_0_0_1px_rgba(34,197,94,0.12),0_0_34px_rgba(34,197,94,0.10)]">
              <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-400">
                <span className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(74,222,128,0.95)]" />
                AD STATUS
              </div>
              <div className="mt-3">
                <h2 className="text-[2.15rem] font-bold tracking-[-0.05em] text-emerald-400">
                  {getStatusHeadline(data.live.adStatus)}
                </h2>
                <p className="mt-1 text-sm text-slate-300">{data.live.adStatusLabel}</p>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-4">
                <div>
                  <p className="text-[1.95rem] font-bold tracking-[-0.05em] text-emerald-400">
                    {formatInt(data.live.last5Minutes.pageviews)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">visits (5 min)</p>
                </div>
                <div>
                  <p className="text-[1.95rem] font-bold tracking-[-0.05em] text-emerald-400">
                    {formatInt(data.live.last4Hours.pageviews)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">visits (4h)</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Last visit</p>
                  <p className="mt-2 text-base font-semibold text-white">{formatRelativeTime(data.live.lastVisitAt)}</p>
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                <div className="flex items-center justify-between rounded-[18px] border border-slate-800 bg-slate-950/75 px-4 py-3 text-sm">
                  <span className="inline-flex items-center gap-2 text-slate-300">
                    <Activity className="h-4 w-4 text-emerald-400" /> Publicité active
                  </span>
                  <span className="font-medium text-white">{formatInt(data.live.last10Minutes.totalContacts)} contact(s) / 10 min</span>
                </div>
                <div className="flex items-center justify-between rounded-[18px] border border-slate-800 bg-slate-950/75 px-4 py-3 text-sm">
                  <span className="inline-flex items-center gap-2 text-slate-300">
                    <Clock3 className="h-4 w-4 text-amber-300" /> Indicateur de fraîcheur
                  </span>
                  <span className={`font-medium ${freshness.text}`}>{freshestMinutes === null ? "Aucune donnée" : `${freshestMinutes} min`}</span>
                </div>
              </div>
            </Card>

            <MetricCard
              title="Vues landing"
              value={formatInt(data.totals.pageviews)}
              subtitle="Pages vues sur la période"
              color="violet"
            />
            <MetricCard
              title="Visiteurs uniques"
              value={formatInt(data.totals.uniqueVisitors)}
              subtitle="Personnes différentes"
              color="cyan"
            />
            <MetricCard
              title="Clic bot Telegram"
              value={formatInt(botClicks)}
              subtitle="Clic sur le bouton canal / bot"
              color="green"
            />
            <MetricCard
              title="Start bot"
              value={formatInt(botStarts)}
              subtitle="Utilisateurs ayant lancé /start"
              color="blue"
            />
            <MetricCard
              title="Membres rejoints"
              value={formatInt(membersJoined)}
              subtitle="Bot start puis ajout confirmé"
              color="green"
            />
            <MetricCard
              title="Contact direct"
              value={formatInt(directContactClicks)}
              subtitle="Clic vers le contact privé"
              color="cyan"
            />
            <MetricCard
              title="Taux bot → membre"
              value={botToMemberRate}
              subtitle={`${formatInt(pendingAfterStart)} start(s) sans ajout confirmé`}
              color="yellow"
            />

            <MetricCard
              title="Scroll 25%"
              value={formatInt(data.totals.scroll25)}
              subtitle="Saw the beginning"
              color="violet"
            />
            <MetricCard
              title="Scroll 50%"
              value={formatInt(data.totals.scroll50)}
              subtitle="Saw half"
              color="violet"
            />
            <MetricCard
              title="Scroll 75%"
              value={formatInt(data.totals.scroll75)}
              subtitle="Saw almost all"
              color="violet"
            />
            <MetricCard
              title="Scroll 100%"
              value={formatInt(data.totals.scroll100)}
              subtitle="Saw everything"
              color="violet"
            />

            <Card>
              <div className="flex items-center gap-2 text-amber-300">
                <TrendingUp className="h-4 w-4" />
                <h3 className="text-lg font-semibold tracking-[-0.03em]">Daily Traffic</h3>
              </div>
              <div className="mt-4 h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trafficChartData} margin={{ top: 10, right: 8, left: -20, bottom: 4 }}>
                    <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: 16,
                        color: "#fff",
                      }}
                    />
                    <Line type="monotone" dataKey="visits" stroke="#a855f7" strokeWidth={3} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="whatsapp" stroke="#22c55e" strokeWidth={3} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="telegram" stroke="#3b82f6" strokeWidth={3} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-300">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-violet-400" /> Visits
                </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Bot clicks
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-400" /> Contact direct
                  </span>
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-2 text-amber-300">
                <CalendarDays className="h-4 w-4" />
                <h3 className="text-lg font-semibold tracking-[-0.03em]">Daily Breakdown</h3>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="pb-3 pr-4 font-medium">Date</th>
                      <th className="pb-3 pr-4 font-medium">Visits</th>
                      <th className="pb-3 pr-4 font-medium">Unique Visitors</th>
                      <th className="pb-3 pr-4 font-medium">Clic bot</th>
                      <th className="pb-3 font-medium">Contact direct</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.length > 0 ? (
                      data.daily.map((day) => (
                        <tr key={day.date} className="border-b border-slate-800/80 last:border-b-0">
                          <td className="py-3 pr-4 text-slate-300">{day.date}</td>
                          <td className="py-3 pr-4 text-violet-400">{formatInt(day.pageviews)}</td>
                          <td className="py-3 pr-4 text-cyan-400">{formatInt(day.uniqueVisitors)}</td>
                          <td className="py-3 pr-4 text-emerald-400">{formatInt(day.whatsappClicks)}</td>
                          <td className="py-3 text-blue-400">{formatInt(day.telegramClicks)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-4 text-slate-400">
                          Aucune donnée disponible sur cette période.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-2 text-amber-300">
                <Radio className="h-4 w-4 text-red-400" />
                <h3 className="text-lg font-semibold tracking-[-0.03em]">Recent Events</h3>
              </div>
              <div className="mt-4 space-y-3">
                {data.recentEvents.length > 0 ? (
                  data.recentEvents.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-start justify-between gap-4 rounded-[18px] border border-slate-800 bg-slate-950/70 px-4 py-3"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${eventDotClass(event.eventType, event.eventSource)}`} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{eventLabel(event.eventType, event.eventSource)}</p>
                          <p className="truncate text-sm text-slate-400">{sourceLabel(event.eventSource)}</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-xs text-slate-400">
                        <p>{formatRelativeTime(event.createdAt)}</p>
                        <p className="mt-1">{formatDateTime(event.createdAt)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">Aucun événement récent à afficher.</p>
                )}
              </div>
            </Card>

            <Card className="border-cyan-500/35 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_38%),#111827] shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_0_30px_rgba(34,211,238,0.08)]">
              <div className="flex items-center gap-2 text-amber-300">
                <Radio className="h-4 w-4 text-cyan-400" />
                <h3 className="text-lg font-semibold tracking-[-0.03em]">Derniers starts bot</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Vue live des derniers utilisateurs ayant lancé le bot, avec leur identité Telegram, le statut Meta, le token de session, le fbclid et la confirmation d’ajout au canal.
              </p>
              <div className="mt-4 space-y-3">
                {subscriberLogQuery.isLoading ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/80 px-4 py-2 text-sm text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading bot-start diagnostics...
                  </div>
                ) : subscriberLog.length > 0 ? (
                  subscriberLog.map((row) => {
                    const metaBadge = metaStatusBadge(row.metaSubscribeStatus);
                    const sessionBadge = presenceBadge(row.sessionToken);
                    const fbclidBadge = presenceBadge(row.fbclid);

                    return (
                      <div key={row.id} className="rounded-[18px] border border-slate-800 bg-slate-950/70 px-4 py-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{formatSubscriberIdentity(row)}</p>
                            <p className="mt-1 truncate text-sm text-slate-400">
                              {row.telegramFirstName ? `${row.telegramFirstName} · ` : ""}
                              {formatDateTime(row.startedAt)}
                            </p>
                          </div>
                          <span
                            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${metaBadge.border} ${metaBadge.background} ${metaBadge.text}`}
                          >
                            <span className={`h-2 w-2 rounded-full ${metaBadge.dot}`} /> {metaBadge.label}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-400 sm:grid-cols-5">
                          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5">
                            <p className="uppercase tracking-[0.16em] text-slate-500">Start bot</p>
                            <p className="mt-1 text-sm text-slate-200">{formatRelativeTime(row.startedAt)}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5">
                            <p className="uppercase tracking-[0.16em] text-slate-500">Ajout canal</p>
                            <p className="mt-1 text-sm text-slate-200">{row.joinedAt ? formatDateTime(row.joinedAt) : "Pas encore confirmé"}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5">
                            <p className="uppercase tracking-[0.16em] text-slate-500">Meta</p>
                            <p className="mt-1 text-sm text-slate-200">{metaBadge.label}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5">
                            <p className="uppercase tracking-[0.16em] text-slate-500">Session token</p>
                            <span className={`mt-1 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold ${sessionBadge.border} ${sessionBadge.background} ${sessionBadge.text}`}>
                              <span className={`h-2 w-2 rounded-full ${sessionBadge.dot}`} /> {sessionBadge.label}
                            </span>
                          </div>
                          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5">
                            <p className="uppercase tracking-[0.16em] text-slate-500">FBCLID</p>
                            <span className={`mt-1 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold ${fbclidBadge.border} ${fbclidBadge.background} ${fbclidBadge.text}`}>
                              <span className={`h-2 w-2 rounded-full ${fbclidBadge.dot}`} /> {fbclidBadge.label}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-400">No recent bot starts are available for diagnostics yet.</p>
                )}
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-2 text-amber-300">
                <Radio className="h-4 w-4 text-violet-400" />
                <h3 className="text-lg font-semibold tracking-[-0.03em]">Qui a start / qui a rejoint</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Les derniers profils Telegram qui ont lancé le bot, avec l’heure du /start, l’heure d’ajout au canal quand elle existe, et le statut de conversion serveur.
              </p>
              <div className="mt-4 space-y-3">
                {subscriberLogQuery.isLoading ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/80 px-4 py-2 text-sm text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading subscriber conversions...
                  </div>
                ) : subscriberLog.length > 0 ? (
                  subscriberLog.map((row) => {
                    const badge = metaStatusBadge(row.metaSubscribeStatus);
                    const attribution = formatSubscriberAttribution(row);

                    return (
                      <div
                        key={row.id}
                        className="rounded-[18px] border border-slate-800 bg-slate-950/70 px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">
                              {formatSubscriberIdentity(row)}
                            </p>
                            <p className="mt-1 truncate text-sm text-slate-400">
                              {row.telegramFirstName ? `${row.telegramFirstName} · ` : ""}
                              {attribution || "Direct / unknown attribution"}
                            </p>
                          </div>
                          <span
                            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${badge.border} ${badge.background} ${badge.text}`}
                          >
                            <span className={`h-2 w-2 rounded-full ${badge.dot}`} /> {badge.label}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-400 sm:grid-cols-5">
                          <div>
                            <p className="uppercase tracking-[0.16em] text-slate-500">Start bot</p>
                            <p className="mt-1 text-sm text-slate-200">{formatDateTime(row.startedAt)}</p>
                          </div>
                          <div>
                            <p className="uppercase tracking-[0.16em] text-slate-500">Ajout canal</p>
                            <p className="mt-1 text-sm text-slate-200">{row.joinedAt ? formatDateTime(row.joinedAt) : "Pas encore confirmé"}</p>
                          </div>
                          <div>
                            <p className="uppercase tracking-[0.16em] text-slate-500">Meta sent</p>
                            <p className="mt-1 text-sm text-slate-200">{formatDateTime(row.metaSubscribeSentAt)}</p>
                          </div>
                          <div>
                            <p className="uppercase tracking-[0.16em] text-slate-500">Campaign</p>
                            <p className="mt-1 truncate text-sm text-slate-200">{row.utmCampaign || "Direct / inconnu"}</p>
                          </div>
                          <div>
                            <p className="uppercase tracking-[0.16em] text-slate-500">Event ID</p>
                            <p className="mt-1 truncate text-sm text-slate-200">{row.metaSubscribeEventId || "—"}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-400">No bot-start conversions have been logged yet.</p>
                )}
              </div>
            </Card>

            <div className="flex items-center justify-between gap-4 rounded-[18px] border border-slate-800 bg-slate-900/95 px-4 py-3 text-sm text-slate-400">
              <span className="inline-flex items-center gap-2">
                <Clock3 className="h-4 w-4" /> Rafraîchissement automatique toutes les 10 secondes
              </span>
              <span className="inline-flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-400" /> {data.live.adStatusLabel}
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-[22px] border border-slate-700 bg-slate-900/92 px-5 py-10 text-center text-slate-300">
            Impossible de charger les statistiques pour le moment.
          </div>
        )}
      </div>
    </main>
  );
}
