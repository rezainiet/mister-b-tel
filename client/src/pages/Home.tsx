import React, { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  TELEGRAM_BOT_DEEP_LINK,
  TELEGRAM_BOT_URL,
  TrackingSession,
  buildFallbackTrackingSession,
  initAdvancedTracking,
  trackTelegramClick,
  trackTelegramGroupClick,
} from "@/lib/tracking";

const FUNNEL_STORAGE_KEY = "misterb_funnel_token";

function readPersistedFunnelToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(FUNNEL_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

const directContactUrl = "https://t.me/MisterBNMB";
const logoUrl =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663482010907/nmN5FRo8qmaVANQi8aWFsw/misterb-logo_21161f1e.jpeg";

// Trust-strip threshold: below this, we hide the live count rather than show
// a number that reads weak. Counts above this render verbatim — no inflation.
const PUBLIC_COUNT_DISPLAY_FLOOR = 80;

// Placeholder testimonials. These are LABELED as illustrative below the page
// — replace with real, consented quotes before running paid traffic. Keeping
// them in the source so the layout always renders; the disclaimer below the
// section makes the legal posture clear.
const PLACEHOLDER_TESTIMONIALS = [
  {
    id: "karim-lyon",
    name: "Karim",
    city: "Lyon",
    quote: "Très réactif, j'ai eu accès à tout en moins d'une minute.",
  },
  {
    id: "sofia-paris",
    name: "Sofia",
    city: "Paris",
    quote: "Le canal vaut clairement le détour, contenu exclusif tous les jours.",
  },
  {
    id: "yacine-marseille",
    name: "Yacine",
    city: "Marseille",
    quote: "J'ai jamais vu un service aussi propre et direct, je recommande.",
  },
] as const;

const VALUE_BULLETS = [
  {
    id: "exclusivites",
    icon: "★",
    title: "Plans privés en avant-première",
    body: "Tu reçois en premier les infos partagées en interne — avant tout le monde.",
  },
  {
    id: "direct",
    icon: "✉",
    title: "Échange direct avec Mister",
    body: "Une question ou un besoin précis ? Tu peux écrire directement, sans intermédiaire.",
  },
  {
    id: "selectif",
    icon: "✓",
    title: "Accès sélectif",
    body: "Le canal est privé et limité — tu rejoins une communauté réelle, pas une mailing-list.",
  },
] as const;

const FAQ_ITEMS = [
  {
    id: "free",
    q: "C'est gratuit ?",
    a: "Oui, l'accès au canal privé est offert. Aucune carte demandée, aucun engagement.",
  },
  {
    id: "delay",
    q: "Combien de temps avant d'avoir accès ?",
    a: "Immédiat. Tu cliques, tu valides sur Telegram, le bot t'envoie le lien WhatsApp dans la seconde.",
  },
  {
    id: "what",
    q: "Qu'est-ce que je reçois exactement ?",
    a: "Un accès au canal WhatsApp privé Mister B et la possibilité d'écrire directement.",
  },
  {
    id: "leave",
    q: "Je peux me désabonner ?",
    a: "Oui, à tout moment. Tu quittes le canal WhatsApp en un clic, sans justification.",
  },
  {
    id: "why-wa",
    q: "Pourquoi WhatsApp et pas autre chose ?",
    a: "C'est la messagerie la plus fluide pour rester en contact direct. Le bot Telegram sert juste à valider l'accès et à filtrer les bots.",
  },
] as const;

type FaqItem = (typeof FAQ_ITEMS)[number];

function useTelegramGroupHref() {
  const [href, setHref] = useState<string>(() => getInitialTelegramGroupHref());

  useEffect(() => {
    void initAdvancedTracking().then((session) => {
      setHref(buildHrefFromSession(session));
    });
  }, []);

  const updateFromSession = (session: TrackingSession | null) => {
    setHref(buildHrefFromSession(session));
  };

  return [href, updateFromSession] as const;
}

function shouldPreferTelegramDeepLink() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function buildHrefFromSession(session: TrackingSession | null): string {
  const preferDeepLink = shouldPreferTelegramDeepLink();
  if (session) return preferDeepLink ? session.telegramDeepLink : session.telegramBotUrl;
  return getInitialTelegramGroupHref();
}

function getInitialTelegramGroupHref(): string {
  const preferDeepLink = shouldPreferTelegramDeepLink();
  const funnelToken = readPersistedFunnelToken();
  if (funnelToken) {
    const fallback = buildFallbackTrackingSession(funnelToken);
    return preferDeepLink ? fallback.telegramDeepLink : fallback.telegramBotUrl;
  }
  return preferDeepLink ? TELEGRAM_BOT_DEEP_LINK : TELEGRAM_BOT_URL;
}

function WhatsAppIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className="rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.10)]"
    >
      <circle cx="16" cy="16" r="15" fill="#25D366" />
      <path
        fill="#fff"
        d="M23.4 8.5A10.15 10.15 0 0 0 6.57 20.1L5 26.94l7-1.82a10.16 10.16 0 0 0 4.84 1.24h.01A10.16 10.16 0 0 0 23.4 8.5Zm-6.56 16.13h-.01a8.46 8.46 0 0 1-4.31-1.18l-.31-.18-4.16 1.09 1.11-4.05-.2-.33a8.43 8.43 0 1 1 7.88 4.65Zm4.63-6.32c-.25-.12-1.5-.74-1.73-.82-.23-.08-.4-.12-.56.13-.16.25-.64.82-.78.99-.14.16-.29.19-.54.06-.25-.12-1.04-.38-1.99-1.22-.74-.66-1.24-1.47-1.39-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.42.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.77-1.84-.2-.48-.4-.41-.56-.42h-.48c-.16 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.39 1.01 2.55.12.16 1.75 2.67 4.24 3.74.59.25 1.05.4 1.4.51.59.19 1.12.16 1.55.1.47-.07 1.5-.61 1.71-1.21.21-.6.21-1.11.15-1.21-.06-.1-.23-.16-.48-.29Z"
      />
    </svg>
  );
}

function TelegramIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className="rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.10)]"
    >
      <circle cx="16" cy="16" r="15" fill="#2AABEE" />
      <path
        fill="#fff"
        d="M23.97 9.18 21.58 22.3c-.18.93-.66 1.16-1.33.72l-4.28-3.16-2.06 1.98c-.23.23-.42.42-.86.42l.31-4.39 8-7.23c.35-.31-.07-.49-.54-.18l-9.89 6.22-4.26-1.33c-.93-.29-.95-.93.19-1.38L22.62 8c.73-.27 1.36.18 1.12 1.18Z"
      />
    </svg>
  );
}

type PrimaryCtaProps = {
  href: string;
  onTrack: (event: React.MouseEvent<HTMLAnchorElement>) => void | Promise<void>;
  size?: "hero" | "sticky";
};

function PrimaryCta({ href, onTrack, size = "hero" }: PrimaryCtaProps) {
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    void onTrack(event);
  };

  const sizeClasses =
    size === "hero"
      ? "min-h-[68px] text-[1rem] px-5 py-3"
      : "min-h-[58px] text-[0.95rem] px-4 py-2.5";

  return (
    <a
      href={href}
      target="_self"
      data-direct-open="telegram-bot"
      onClick={handleClick}
      className={`flex w-full items-center justify-center gap-3 rounded-[20px] bg-white font-[660] uppercase tracking-[-0.02em] text-black shadow-[0_10px_24px_rgba(0,0,0,0.16)] transition-transform duration-150 hover:-translate-y-1 hover:shadow-[0_14px_30px_rgba(0,0,0,0.22)] active:translate-y-0 ${sizeClasses}`}
    >
      <WhatsAppIcon size={size === "hero" ? 28 : 24} />
      <span>Rejoindre le groupe privé</span>
    </a>
  );
}

function FaqRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-black/15 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-[0.95rem] font-[600] tracking-[-0.015em] text-black">
          {item.q}
        </span>
        <span
          aria-hidden="true"
          className={`shrink-0 text-[1.1rem] font-[700] text-black/55 transition-transform ${open ? "rotate-45" : ""}`}
        >
          +
        </span>
      </button>
      {open ? (
        <p className="pb-3 text-[0.88rem] leading-[1.45] text-black/72">{item.a}</p>
      ) : null}
    </div>
  );
}

function TrustStrip() {
  // This component is the ONLY caller of the tRPC hook on the page so it
  // can be safely gated behind the client-mount check below — the hook
  // never runs during SSR/test renders (no Provider in those environments).
  const publicStatsQuery = trpc.tracking.publicStats.useQuery(undefined, {
    staleTime: 60_000, // Trust strip doesn't need to be second-accurate.
    refetchOnWindowFocus: false,
  });

  const trustCount = useMemo(() => {
    const stats = publicStatsQuery.data;
    if (!stats) return null;
    // Prefer 7d when it crosses the floor, else 30d, else hide. Avoids
    // ever rendering "12 personnes" which reads as low traction.
    if (stats.recentBotStarts7d >= PUBLIC_COUNT_DISPLAY_FLOOR) {
      return { value: stats.recentBotStarts7d, window: "7d" as const };
    }
    if (stats.recentBotStarts30d >= PUBLIC_COUNT_DISPLAY_FLOOR) {
      return { value: stats.recentBotStarts30d, window: "30d" as const };
    }
    return null;
  }, [publicStatsQuery.data]);

  if (!trustCount) return null;
  return (
    <p className="mt-5 text-[0.78rem] font-[500] tracking-[-0.005em] text-black/62">
      {trustCount.value.toLocaleString("fr-FR")} personnes ont rejoint{" "}
      {trustCount.window === "7d" ? "cette semaine" : "ce mois-ci"}
    </p>
  );
}

export default function Home() {
  const [telegramGroupHref, updateTelegramGroupHref] = useTelegramGroupHref();
  // The trust strip needs a tRPC provider to call its hook. We mount it
  // client-side only so SSR / test renders skip the hook entirely.
  const [showTrustStrip, setShowTrustStrip] = useState(false);
  useEffect(() => {
    setShowTrustStrip(true);
  }, []);

  const handlePrimaryClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const session = await trackTelegramGroupClick("telegram_group_cta");
    const href = buildHrefFromSession(session);
    updateTelegramGroupHref(session);
    window.location.assign(href);
  };

  const handleContactClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    try {
      await trackTelegramClick("telegram_contact_cta");
    } finally {
      window.location.assign(directContactUrl);
    }
  };

  return (
    <main className="relative min-h-[100svh] bg-[#1BD51C] text-black">
      <style>{`
        @keyframes ctaPulse {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-2px) scale(1.012); }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[420px] opacity-90">
        <div className="absolute left-[-12%] top-[6%] h-44 w-44 rounded-full bg-[#c1ffb9] blur-3xl" />
        <div className="absolute right-[-8%] top-[18%] h-44 w-44 rounded-full bg-[#cbffc6] blur-3xl" />
      </div>

      {/* HERO */}
      <section className="relative mx-auto flex w-full max-w-[420px] flex-col items-center px-5 pt-8 pb-10 text-center">
        <div className="rounded-full bg-white p-[5px] shadow-[0_8px_22px_rgba(124,255,113,0.32)]">
          <img
            src={logoUrl}
            alt="Logo Mister B"
            className="h-[110px] w-[110px] rounded-full object-cover"
          />
        </div>

        <h1 className="mt-4 text-[2.5rem] font-[700] tracking-[-0.05em] text-black">Mister B</h1>

        <p className="mt-3 max-w-[330px] text-[1.45rem] font-[620] leading-[1.1] tracking-[-0.035em] text-black">
          Le canal privé n°1 en France pour rester en contact direct.
        </p>

        <p className="mt-3 max-w-[320px] text-[0.92rem] font-[440] leading-[1.35] tracking-[-0.015em] text-black/78">
          Accès gratuit au canal WhatsApp privé. Tu valides sur Telegram, le bot t'envoie le lien dans la seconde.
        </p>

        <div className="mt-5 w-full" style={{ animation: "ctaPulse 2.8s ease-in-out infinite" }}>
          <PrimaryCta href={telegramGroupHref} onTrack={handlePrimaryClick} size="hero" />
        </div>

        <a
          href={directContactUrl}
          target="_self"
          onClick={handleContactClick}
          className="mt-4 inline-flex items-center gap-2 text-[0.85rem] font-[540] tracking-[-0.01em] text-black/68 hover:text-black"
        >
          <TelegramIcon size={20} />
          <span>Me contacter directement</span>
        </a>

        {showTrustStrip ? <TrustStrip /> : null}
      </section>

      {/* CE QUE TU REÇOIS */}
      <section className="relative mx-auto w-full max-w-[420px] px-5 pb-8">
        <div className="rounded-[24px] border border-black/12 bg-white/65 p-5 backdrop-blur-sm">
          <h2 className="text-[0.78rem] font-[640] uppercase tracking-[0.16em] text-black/58">
            Ce que tu reçois
          </h2>
          <ul className="mt-3 space-y-3">
            {VALUE_BULLETS.map((bullet) => (
              <li key={bullet.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black text-[0.8rem] font-[700] text-[#1BD51C]"
                >
                  {bullet.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-[0.95rem] font-[640] leading-[1.2] tracking-[-0.015em] text-black">
                    {bullet.title}
                  </p>
                  <p className="mt-1 text-[0.85rem] leading-[1.4] tracking-[-0.005em] text-black/72">
                    {bullet.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="relative mx-auto w-full max-w-[420px] px-5 pb-8">
        <h2 className="text-[0.78rem] font-[640] uppercase tracking-[0.16em] text-black/58">
          Ils en parlent
        </h2>
        <div className="mt-3 space-y-3">
          {PLACEHOLDER_TESTIMONIALS.map((testimonial) => (
            <figure
              key={testimonial.id}
              className="rounded-[20px] border border-black/12 bg-white/72 p-4 backdrop-blur-sm"
            >
              <blockquote className="text-[0.92rem] font-[480] leading-[1.4] tracking-[-0.01em] text-black">
                « {testimonial.quote} »
              </blockquote>
              <figcaption className="mt-2 text-[0.75rem] font-[540] tracking-[0.01em] text-black/58">
                {testimonial.name}, {testimonial.city}
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-2 text-[0.66rem] leading-[1.35] tracking-[0.005em] text-black/45">
          Témoignages illustratifs présentés à titre d'exemple.
        </p>
      </section>

      {/* FAQ */}
      <section className="relative mx-auto w-full max-w-[420px] px-5 pb-32">
        <h2 className="text-[0.78rem] font-[640] uppercase tracking-[0.16em] text-black/58">
          FAQ
        </h2>
        <div className="mt-3 rounded-[20px] border border-black/12 bg-white/72 px-4 backdrop-blur-sm">
          {FAQ_ITEMS.map((item) => (
            <FaqRow key={item.id} item={item} />
          ))}
        </div>

        <div className="mt-6 flex flex-col items-center gap-1">
          <p className="text-[0.74rem] font-normal tracking-[-0.005em] text-black/35">Join Mister B</p>
          <a
            href="/dashboard"
            className="text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/30 transition hover:text-black/55"
          >
            Accès suivi privé
          </a>
        </div>
      </section>

      {/* STICKY MOBILE CTA */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-[#1BD51C]/92 px-4 pb-[max(env(safe-area-inset-bottom,12px),12px)] pt-3 backdrop-blur-md">
        <div className="mx-auto w-full max-w-[420px]">
          <PrimaryCta href={telegramGroupHref} onTrack={handlePrimaryClick} size="sticky" />
        </div>
      </div>
    </main>
  );
}
