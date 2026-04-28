import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Megaphone, RefreshCcw, Send, ShieldAlert, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";

type Props = { token: string };

const MAX_MESSAGE_LENGTH = 4096;
const STATUS_POLL_MS = 2_000;

type BroadcastStatusData = {
  id: number;
  messageText: string;
  status: "pending" | "processing" | "completed" | "cancelled";
  totalRecipients: number;
  sentCount: number;
  blockedCount: number;
  failedCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export function BroadcastPanel({ token }: Props) {
  const recipientsQuery = trpc.dashboard.broadcastRecipients.useQuery(
    { token },
    {
      enabled: Boolean(token),
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: 30_000,
    },
  );
  const sendMutation = trpc.dashboard.broadcastSend.useMutation();

  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [activeBroadcastId, setActiveBroadcastId] = useState<number | null>(null);

  const recipientsRaw = recipientsQuery.data as
    | { recipientCount: number; inflight: boolean }
    | { error: string }
    | undefined;
  const recipientData =
    recipientsRaw && !("error" in recipientsRaw) ? recipientsRaw : null;
  const recipientCount = recipientData?.recipientCount ?? 0;
  const inflight = recipientData?.inflight ?? false;

  const tooLong = draft.length > MAX_MESSAGE_LENGTH;
  const empty = draft.trim().length === 0;

  const statusQuery = trpc.dashboard.broadcastStatus.useQuery(
    { token, broadcastId: activeBroadcastId ?? 0 },
    {
      enabled: Boolean(token) && Boolean(activeBroadcastId),
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: (query) => {
        const data = query.state.data as BroadcastStatusData | { error: string } | undefined;
        if (!data || "error" in data) return STATUS_POLL_MS;
        if (data.status === "completed" || data.status === "cancelled") return false;
        return STATUS_POLL_MS;
      },
    },
  );

  const status = useMemo(() => {
    const raw = statusQuery.data as BroadcastStatusData | { error: string } | undefined;
    return raw && !("error" in raw) ? raw : null;
  }, [statusQuery.data]);

  // When the active broadcast finishes, refresh the recipients count (blocked
  // users found during this broadcast lower the eligible audience for the next).
  useEffect(() => {
    if (status?.status === "completed") {
      void recipientsQuery.refetch();
    }
  }, [status?.status, recipientsQuery]);

  const handleSend = async () => {
    if (empty || tooLong || inflight || sendMutation.isPending) return;
    try {
      const result = await sendMutation.mutateAsync({ token, messageText: draft.trim() });
      if (!result.success) {
        toast.error("Broadcast failed", { description: result.error });
        return;
      }
      toast.success(`Broadcast queued for ${result.totalRecipients} subscribers`);
      setActiveBroadcastId(result.broadcastId);
      setDraft("");
      setConfirming(false);
      await recipientsQuery.refetch();
    } catch (error) {
      toast.error("Broadcast failed", {
        description: error instanceof Error ? error.message : "Network error.",
      });
    }
  };

  const isProcessing = status?.status === "pending" || status?.status === "processing";
  const isCompleted = status?.status === "completed";
  const progressPercent = status && status.totalRecipients > 0
    ? Math.min(100, Math.round(((status.sentCount + status.blockedCount + status.failedCount) / status.totalRecipients) * 100))
    : 0;

  return (
    <div className="space-y-4 lg:col-span-12">
      <div className="flex items-center justify-between rounded-[18px] border border-slate-800 bg-slate-900/95 px-4 py-3">
        <div className="flex items-center gap-2 text-amber-300">
          <Megaphone className="h-4 w-4" />
          <h3 className="text-lg font-semibold tracking-[-0.03em]">Broadcast — Tous les abonnés du bot</h3>
        </div>
        <button
          type="button"
          onClick={() => void recipientsQuery.refetch()}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-medium text-slate-200 transition hover:border-slate-500"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${recipientsQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <section className="rounded-[18px] border border-slate-800 bg-slate-950/70 px-5 py-5">
        <p className="text-sm leading-6 text-slate-300">
          Envoie un message à <span className="font-semibold text-white">toutes les personnes</span> qui ont fait
          {" "}/start sur le bot (non bloquées).
        </p>

        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
          <Users className="h-4 w-4 text-cyan-300" />
          <span className="text-sm text-slate-400">Destinataires :</span>
          <span className="text-2xl font-semibold tabular-nums text-cyan-300">
            {recipientsQuery.isLoading ? "—" : recipientCount.toLocaleString()}
          </span>
          <span className="text-sm text-slate-400">abonnés du bot</span>
        </div>

        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={8}
          placeholder="Écris ton message ici…"
          disabled={isProcessing}
          className="mt-4 w-full resize-y rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-sm leading-relaxed text-slate-100 outline-none transition focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          spellCheck={false}
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className={`text-[11px] uppercase tracking-wider ${tooLong ? "text-red-400" : "text-slate-500"}`}>
            {draft.length} / {MAX_MESSAGE_LENGTH} caractères
          </span>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={empty || tooLong || inflight || isProcessing || recipientCount === 0}
              className="inline-flex h-12 items-center gap-2 rounded-2xl bg-emerald-400 px-5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Megaphone className="h-4 w-4" />
              Envoyer à {recipientCount.toLocaleString()} personnes
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <ShieldAlert className="h-4 w-4 text-amber-300" />
              <span className="text-xs text-amber-200">
                Send to {recipientCount.toLocaleString()} subscribers? This cannot be undone.
              </span>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={sendMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sendMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Confirm send
              </button>
            </div>
          )}
        </div>

        {inflight && !activeBroadcastId ? (
          <p className="mt-3 text-xs text-amber-300">
            A broadcast is already running on the server. Wait for it to finish before queuing another.
          </p>
        ) : null}

        {status ? (
          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {isCompleted ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
                )}
                <span className="text-sm font-semibold text-white">
                  {isCompleted
                    ? `Broadcast #${status.id} completed`
                    : `Broadcast #${status.id} in progress…`}
                </span>
              </div>
              <span className="text-xs tabular-nums text-slate-400">
                {progressPercent}% — {status.sentCount + status.blockedCount + status.failedCount} / {status.totalRecipients}
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all ${isCompleted ? "bg-emerald-400" : "bg-cyan-400"}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
                <div className="text-emerald-300">Sent</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-white">{status.sentCount}</div>
              </div>
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2">
                <div className="text-amber-300">Blocked</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-white">{status.blockedCount}</div>
              </div>
              <div className="rounded-xl border border-red-500/25 bg-red-500/5 px-3 py-2">
                <div className="text-red-300">Failed</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-white">{status.failedCount}</div>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
