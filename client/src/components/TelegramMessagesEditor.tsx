import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Loader2, MessageSquareText, RefreshCcw } from "lucide-react";
import { trpc } from "@/lib/trpc";

type Props = { token: string };

type ReminderEntry = {
  key: string;
  label: string;
  description: string;
  messageSettingKey: string;
  delaySettingKey: string;
  defaultDelayMin: number;
  delayMin: number;
  message: string;
  usesDefaultMessage: boolean;
  usesDefaultDelay: boolean;
};

type WelcomeEntry = {
  settingKey: string;
  message: string;
  usesDefault: boolean;
  variables: string[];
  description: string;
};

type TelegramSettingsData = {
  groupUrl: string;
  welcome: WelcomeEntry;
  reminders: ReminderEntry[];
  delayBounds: { min: number; max: number };
  messageMaxLength: number;
};

const REMINDER_VARIABLES = ["{firstName}", "{groupLink}"] as const;

function reminderColor(index: number): string {
  // Match the example screenshot's bell color rotation.
  const palette = [
    "text-violet-400",
    "text-amber-300",
    "text-rose-400",
    "text-fuchsia-400",
    "text-emerald-400",
    "text-pink-400",
    "text-cyan-400",
  ];
  return palette[index % palette.length];
}

export function TelegramMessagesEditor({ token }: Props) {
  const settingsQuery = trpc.dashboard.telegramSettings.useQuery(
    { token },
    {
      enabled: Boolean(token),
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  const updateMutation = trpc.dashboard.updateSetting.useMutation();

  const raw = settingsQuery.data as TelegramSettingsData | { error: string } | undefined;
  const data = raw && !("error" in raw) ? raw : null;

  return (
    <div className="space-y-4 lg:col-span-12">
      <div className="flex items-center justify-between rounded-[18px] border border-slate-800 bg-slate-900/95 px-4 py-3">
        <div className="flex items-center gap-2 text-amber-300">
          <MessageSquareText className="h-4 w-4" />
          <h3 className="text-lg font-semibold tracking-[-0.03em]">Telegram messages</h3>
        </div>
        <button
          type="button"
          onClick={() => void settingsQuery.refetch()}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-medium text-slate-200 transition hover:border-slate-500"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${settingsQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {settingsQuery.isLoading || !data ? (
        <div className="rounded-[18px] border border-slate-800 bg-slate-900/95 px-5 py-8 text-center text-sm text-slate-400">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-slate-500" />
          Loading welcome + reminder messages…
        </div>
      ) : (
        <>
          <WelcomeCard
            token={token}
            entry={data.welcome}
            messageMaxLength={data.messageMaxLength}
            mutation={updateMutation}
            onSaved={() => void settingsQuery.refetch()}
          />
          {data.reminders.map((entry, index) => (
            <ReminderCard
              key={entry.key}
              token={token}
              entry={entry}
              colorClass={reminderColor(index)}
              messageMaxLength={data.messageMaxLength}
              delayBounds={data.delayBounds}
              mutation={updateMutation}
              onSaved={() => void settingsQuery.refetch()}
            />
          ))}
        </>
      )}
    </div>
  );
}

type MutationLike = ReturnType<typeof trpc.dashboard.updateSetting.useMutation>;

function WelcomeCard({
  token,
  entry,
  messageMaxLength,
  mutation,
  onSaved,
}: {
  token: string;
  entry: WelcomeEntry;
  messageMaxLength: number;
  mutation: MutationLike;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(entry.message);
  const [savingThis, setSavingThis] = useState(false);

  // Sync local draft when remote value changes (e.g., after refetch). Don't
  // overwrite while the user is mid-edit and hasn't matched remote yet —
  // we trust them to refetch manually if they want.
  useEffect(() => {
    setDraft(entry.message);
  }, [entry.message]);

  const isDirty = draft !== entry.message;
  const isPending = savingThis && mutation.isPending;
  const tooLong = draft.length > messageMaxLength;

  const handleSave = async () => {
    if (!isDirty || tooLong) return;
    setSavingThis(true);
    try {
      const result = await mutation.mutateAsync({ token, key: entry.settingKey, value: draft });
      if (!result.success) {
        toast.error("Save failed", { description: result.error || "Could not save welcome message." });
        return;
      }
      toast.success("Welcome message saved");
      onSaved();
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : "Network error.",
      });
    } finally {
      setSavingThis(false);
    }
  };

  return (
    <section className="rounded-[18px] border border-slate-800 bg-slate-950/70 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sky-300">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-sky-400/15 text-xs font-bold uppercase">
              T
            </span>
            <h4 className="text-sm font-semibold text-white">Welcome message</h4>
            {entry.usesDefault ? (
              <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                default
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {entry.description}
          </p>
        </div>
      </div>

      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={6}
        className="mt-3 w-full resize-y rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-sm leading-relaxed text-slate-100 outline-none transition focus:border-emerald-400"
        spellCheck={false}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
          <span>Variables:</span>
          {REMINDER_VARIABLES.map((variable) => (
            <code key={variable} className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-300">
              {variable}
            </code>
          ))}
          <span className={`ml-2 ${tooLong ? "text-red-400" : "text-slate-500"}`}>
            {draft.length} / {messageMaxLength}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!isDirty || tooLong || isPending}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-400 px-4 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {isDirty ? "Save changes" : "Saved"}
        </button>
      </div>
    </section>
  );
}

function ReminderCard({
  token,
  entry,
  colorClass,
  messageMaxLength,
  delayBounds,
  mutation,
  onSaved,
}: {
  token: string;
  entry: ReminderEntry;
  colorClass: string;
  messageMaxLength: number;
  delayBounds: { min: number; max: number };
  mutation: MutationLike;
  onSaved: () => void;
}) {
  const [messageDraft, setMessageDraft] = useState(entry.message);
  const [delayDraft, setDelayDraft] = useState<string>(String(entry.delayMin));
  const [pendingKey, setPendingKey] = useState<"message" | "delay" | null>(null);

  useEffect(() => {
    setMessageDraft(entry.message);
  }, [entry.message]);
  useEffect(() => {
    setDelayDraft(String(entry.delayMin));
  }, [entry.delayMin]);

  const messageDirty = messageDraft !== entry.message;
  const delayParsed = Number(delayDraft);
  const delayValid =
    Number.isFinite(delayParsed) &&
    Math.floor(delayParsed) === delayParsed &&
    delayParsed >= delayBounds.min &&
    delayParsed <= delayBounds.max;
  const delayDirty = delayValid && delayParsed !== entry.delayMin;
  const tooLong = messageDraft.length > messageMaxLength;

  const handleSaveMessage = async () => {
    if (!messageDirty || tooLong) return;
    setPendingKey("message");
    try {
      const result = await mutation.mutateAsync({
        token,
        key: entry.messageSettingKey,
        value: messageDraft,
      });
      if (!result.success) {
        toast.error("Save failed", { description: result.error || "Could not save reminder." });
        return;
      }
      toast.success(`${entry.label} message saved`);
      onSaved();
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : "Network error.",
      });
    } finally {
      setPendingKey(null);
    }
  };

  const handleSaveDelay = async () => {
    if (!delayDirty) return;
    setPendingKey("delay");
    try {
      const result = await mutation.mutateAsync({
        token,
        key: entry.delaySettingKey,
        value: String(Math.floor(delayParsed)),
      });
      if (!result.success) {
        toast.error("Save failed", { description: result.error || "Could not save delay." });
        return;
      }
      toast.success(`${entry.label} delay set to ${Math.floor(delayParsed)} min`);
      onSaved();
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : "Network error.",
      });
    } finally {
      setPendingKey(null);
    }
  };

  const messagePending = pendingKey === "message" && mutation.isPending;
  const delayPending = pendingKey === "delay" && mutation.isPending;

  return (
    <section className="rounded-[18px] border border-slate-800 bg-slate-950/70 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bell className={`h-4 w-4 ${colorClass}`} />
          <div>
            <h4 className="text-sm font-semibold text-white">{entry.label}</h4>
            <p className="mt-1 text-xs text-slate-400">
              {entry.description} Variables: {REMINDER_VARIABLES.join(", ")}.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <label className="text-slate-500" htmlFor={`${entry.key}-delay`}>
          Delay:
        </label>
        <input
          id={`${entry.key}-delay`}
          type="number"
          min={delayBounds.min}
          max={delayBounds.max}
          step={1}
          value={delayDraft}
          onChange={(event) => setDelayDraft(event.target.value)}
          className="h-9 w-24 rounded-lg border border-slate-800 bg-slate-950 px-3 text-sm text-white outline-none transition focus:border-emerald-400"
        />
        <span className="text-slate-500">min</span>
        {entry.usesDefaultDelay ? (
          <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
            default {entry.defaultDelayMin}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void handleSaveDelay()}
          disabled={!delayDirty || delayPending}
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-500/40 px-3 text-xs font-medium text-emerald-300 transition hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {delayPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save delay
        </button>
      </div>

      <textarea
        value={messageDraft}
        onChange={(event) => setMessageDraft(event.target.value)}
        rows={5}
        className="mt-4 w-full resize-y rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-sm leading-relaxed text-slate-100 outline-none transition focus:border-emerald-400"
        spellCheck={false}
      />

      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider text-slate-500">
        <span className={tooLong ? "text-red-400" : ""}>
          {messageDraft.length} / {messageMaxLength}
        </span>
        <button
          type="button"
          onClick={() => void handleSaveMessage()}
          disabled={!messageDirty || tooLong || messagePending}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-400 px-4 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {messagePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {messageDirty ? "Save message" : "Saved"}
        </button>
      </div>
    </section>
  );
}
