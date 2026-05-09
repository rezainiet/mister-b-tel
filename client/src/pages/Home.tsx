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

// Illustrative testimonials. The disclaimer in the JSX below makes their
// posture clear; replace with real consented quotes once available.
const PLACEHOLDER_TESTIMONIALS = [
  {
    id: "karim-lyon",
    name: "Karim",
    city: "Lyon",
    quote:
      "J'ai cliqué un peu par curiosité, et franchement le contenu vaut clairement le détour.",
  },
  {
    id: "sofia-paris",
    name: "Sofia",
    city: "Paris",
    quote: "C'est direct, ça va à l'essentiel. Pas de spam, pas de blabla.",
  },
  {
    id: "yacine-marseille",
    name: "Yacine",
    city: "Marseille",
    quote: "Beaucoup de canaux promettent — celui-là tient. Je suis resté.",
  },
] as const;

const VALUE_BULLETS = [
  {
    id: "exclusivites",
    icon: "★",
    title: "Du contenu en avant-première",
    body: "Tu reçois ce qui ne passe pas en public — avant tout le monde.",
  },
  {
    id: "direct",
    icon: "✉",
    title: "Un échange direct",
    body: "Une question, un besoin ? Tu écris, j'y réponds. Sans intermédiaire.",
  },
  {
    id: "selectif",
    icon: "✓",
    title: "Une communauté triée",
    body: "Pas une mailing-list de 100 000 inconnus. Un canal privé entre vrais membres.",
  },
] as const;

const FAQ_ITEMS = [
  {
    id: "free",
    q: "C'est gratuit ?",
    a: "Oui. Aucun paiement, aucune carte demandée, aucun engagement.",
  },
  {
    id: "delay",
    q: "Combien de temps avant d'avoir accès ?",
    a: "Immédiat. Tu cliques, tu y es.",
  },
  {
    id: "what",
    q: "Qu'est-ce que je reçois exactement ?",
    a: "L'accès au canal WhatsApp privé de Mister B, et la possibilité de m'écrire en direct.",
  },
  {
    id: "leave",
    q: "Je peux me désabonner ?",
    a: "Oui, à tout moment. Tu quittes le canal en un clic, sans justification.",
  },
  {
    id: "why-wa",
    q: "Pourquoi WhatsApp ?",
    a: "C'est l'app que tout le monde a déjà. Pas de nouveau compte à créer, rien à installer.",
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
    <div className="border-b border-black/12 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="group flex w-full items-center justify-between gap-4 py-4 text-left md:py-5"
        aria-expanded={open}
      >
        <span className="text-[0.98rem] font-[600] tracking-[-0.015em] text-black md:text-[1.05rem]">
          {item.q}
        </span>
        {/* Smooth chevron: rotates 180° on open. SVG keeps it crisp at any size. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          className={`shrink-0 text-black/55 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div
        className={`grid overflow-hidden transition-all duration-250 ease-out ${open ? "grid-rows-[1fr] pb-4 md:pb-5" : "grid-rows-[0fr]"}`}
      >
        <p className="min-h-0 pr-6 text-[0.92rem] leading-[1.5] text-black/72 md:text-[0.98rem] md:leading-[1.55]">
          {item.a}
        </p>
      </div>
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
    <main className="relative min-h-[100svh] bg-[#1BD51C] text-black antialiased">
      <style>{`
        @keyframes ctaPulse {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-2px) scale(1.012); }
        }
      `}</style>

      {/* SECTION 1 — HERO. Centered column on mobile, two-column on desktop:
          left = brand+copy+CTA, right = soft visual / proof block. */}
      <section className="relative overflow-hidden">
        {/* Soft hero blobs: visible on mobile too but more dramatic on desktop. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 opacity-90">
          <div className="absolute left-[-10%] top-[-6%] h-56 w-56 rounded-full bg-[#c1ffb9] blur-3xl md:h-[28rem] md:w-[28rem]" />
          <div className="absolute right-[-8%] top-[20%] h-52 w-52 rounded-full bg-[#cbffc6] blur-3xl md:h-[26rem] md:w-[26rem]" />
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-[1180px] flex-col items-center px-5 pt-10 pb-12 text-center md:grid md:grid-cols-[1.1fr_0.9fr] md:items-center md:gap-14 md:px-10 md:pt-20 md:pb-24 md:text-left lg:gap-20 lg:pt-24 lg:pb-28">
          {/* Left column on desktop, full-width on mobile */}
          <div className="flex flex-col items-center md:items-start">
            <div className="rounded-full bg-white p-[6px] shadow-[0_10px_28px_rgba(124,255,113,0.32)]">
              <img
                src={logoUrl}
                alt="Logo Mister B"
                className="h-[110px] w-[110px] rounded-full object-cover md:h-[124px] md:w-[124px]"
              />
            </div>

            <h1 className="mt-5 text-[2.5rem] font-[720] leading-[0.95] tracking-[-0.055em] text-black md:mt-6 md:text-[3.75rem] lg:text-[4.5rem]">
              Mister B
            </h1>

            <p className="mt-4 max-w-[330px] text-[1.45rem] font-[620] leading-[1.1] tracking-[-0.035em] text-black md:mt-5 md:max-w-[420px] md:text-[1.85rem] md:leading-[1.05] lg:text-[2.1rem]">
              Bienvenue dans l'espace privé.
            </p>

            <p className="mt-3 max-w-[330px] text-[0.95rem] font-[440] leading-[1.4] tracking-[-0.012em] text-black/78 md:mt-4 md:max-w-[460px] md:text-[1.05rem] md:leading-[1.5]">
              Reçois ce qui ne sort pas en public, directement sur WhatsApp. Accès gratuit, en un clic.
            </p>

            <div
              className="mt-6 w-full max-w-[400px] md:mt-8"
              style={{ animation: "ctaPulse 2.8s ease-in-out infinite" }}
            >
              <PrimaryCta href={telegramGroupHref} onTrack={handlePrimaryClick} size="hero" />
            </div>

            <a
              href={directContactUrl}
              target="_self"
              onClick={handleContactClick}
              className="mt-4 inline-flex items-center gap-2 text-[0.88rem] font-[540] tracking-[-0.01em] text-black/68 transition-colors hover:text-black md:text-[0.95rem]"
            >
              <TelegramIcon size={20} />
              <span>Me contacter directement</span>
            </a>

            {showTrustStrip ? <TrustStrip /> : null}
          </div>

          {/* Right column — desktop-only visual proof block.
              Hidden on mobile to keep the hero compact and the CTA above the fold. */}
          <aside className="hidden md:block">
            <div className="relative mx-auto max-w-[440px]">
              {/* Floating "live" card mockup — subtle, doesn't compete with the CTA. */}
              <div className="relative rounded-[28px] border border-black/15 bg-white/90 p-7 shadow-[0_24px_48px_rgba(0,0,0,0.10)]">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-[#1BD51C] ring-4 ring-[#1BD51C]/20" />
                  <div className="min-w-0">
                    <p className="text-[0.92rem] font-[640] tracking-[-0.012em] text-black">Mister B · Canal privé</p>
                    <p className="text-[0.78rem] text-black/55">accès direct WhatsApp</p>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  <div className="rounded-[16px] bg-black/5 px-4 py-3">
                    <p className="text-[0.72rem] font-[600] uppercase tracking-[0.12em] text-black/45">Aujourd'hui</p>
                    <p className="mt-1 text-[0.95rem] leading-[1.35] text-black">
                      Nouveau plan partagé en exclusivité dans le canal.
                    </p>
                  </div>
                  <div className="rounded-[16px] bg-black/5 px-4 py-3">
                    <p className="text-[0.72rem] font-[600] uppercase tracking-[0.12em] text-black/45">Hier</p>
                    <p className="mt-1 text-[0.95rem] leading-[1.35] text-black">
                      Bienvenue à 27 nouveaux membres.
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex items-center gap-2 border-t border-black/10 pt-4">
                  <div className="h-2 w-2 rounded-full bg-[#1BD51C] shadow-[0_0_0_4px_rgba(27,213,28,0.18)]" />
                  <p className="text-[0.78rem] text-black/55">Canal actif · réponses sous 24h</p>
                </div>
              </div>

              <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/40 blur-2xl" />
              <div className="absolute -bottom-6 -left-6 h-24 w-24 rounded-full bg-white/40 blur-2xl" />
            </div>
          </aside>
        </div>
      </section>

      {/* SECTION 2 — CE QUE TU REÇOIS. Single column mobile, 3-up grid desktop. */}
      <section className="relative">
        <div className="mx-auto w-full max-w-[1180px] px-5 pb-12 md:px-10 md:pb-20 lg:pb-24">
          <h2 className="text-[0.78rem] font-[640] uppercase tracking-[0.18em] text-black/58 md:text-center md:text-[0.84rem]">
            Ce que tu reçois
          </h2>
          <ul className="mt-4 grid gap-3 md:mt-10 md:grid-cols-3 md:gap-6">
            {VALUE_BULLETS.map((bullet) => (
              <li
                key={bullet.id}
                className="flex gap-3 rounded-[20px] border border-black/12 bg-white/72 p-4 backdrop-blur-sm md:flex-col md:gap-4 md:rounded-[24px] md:p-7 md:text-left"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-[0.85rem] font-[700] text-[#1BD51C] md:h-11 md:w-11 md:text-[1.05rem]"
                >
                  {bullet.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-[0.98rem] font-[660] leading-[1.2] tracking-[-0.015em] text-black md:text-[1.18rem]">
                    {bullet.title}
                  </p>
                  <p className="mt-1.5 text-[0.88rem] leading-[1.45] tracking-[-0.005em] text-black/72 md:mt-2 md:text-[0.98rem] md:leading-[1.55]">
                    {bullet.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* SECTION 3 — TESTIMONIALS. Same grid pattern. */}
      <section className="relative">
        <div className="mx-auto w-full max-w-[1180px] px-5 pb-12 md:px-10 md:pb-20 lg:pb-24">
          <h2 className="text-[0.78rem] font-[640] uppercase tracking-[0.18em] text-black/58 md:text-center md:text-[0.84rem]">
            Ils en parlent
          </h2>
          <div className="mt-4 grid gap-3 md:mt-10 md:grid-cols-3 md:gap-6">
            {PLACEHOLDER_TESTIMONIALS.map((testimonial) => (
              <figure
                key={testimonial.id}
                className="rounded-[20px] border border-black/12 bg-white/78 p-5 backdrop-blur-sm md:rounded-[24px] md:p-7"
              >
                <blockquote className="text-[0.95rem] font-[480] leading-[1.45] tracking-[-0.008em] text-black md:text-[1.02rem] md:leading-[1.55]">
                  « {testimonial.quote} »
                </blockquote>
                <figcaption className="mt-3 text-[0.78rem] font-[600] tracking-[0.005em] text-black/58 md:text-[0.84rem]">
                  — {testimonial.name}, {testimonial.city}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-3 text-[0.7rem] leading-[1.4] tracking-[0.005em] text-black/45 md:mt-4 md:text-center md:text-[0.78rem]">
            Témoignages illustratifs présentés à titre d'exemple.
          </p>
        </div>
      </section>

      {/* SECTION 4 — FAQ. Single column on all sizes, just constrained on desktop. */}
      <section className="relative">
        <div className="mx-auto w-full max-w-[760px] px-5 pb-28 md:px-10 md:pb-24 lg:pb-32">
          <h2 className="text-[0.78rem] font-[640] uppercase tracking-[0.18em] text-black/58 md:text-center md:text-[0.84rem]">
            FAQ
          </h2>
          <div className="mt-4 rounded-[20px] border border-black/12 bg-white/78 px-5 backdrop-blur-sm md:mt-8 md:rounded-[24px] md:px-8">
            {FAQ_ITEMS.map((item) => (
              <FaqRow key={item.id} item={item} />
            ))}
          </div>

          {/* Final CTA + footer link, desktop has its own button (mobile uses sticky bar). */}
          <div className="mt-10 hidden flex-col items-center md:flex">
            <div className="w-full max-w-[400px]" style={{ animation: "ctaPulse 2.8s ease-in-out infinite" }}>
              <PrimaryCta href={telegramGroupHref} onTrack={handlePrimaryClick} size="hero" />
            </div>
            <a
              href={directContactUrl}
              target="_self"
              onClick={handleContactClick}
              className="mt-4 inline-flex items-center gap-2 text-[0.92rem] font-[540] tracking-[-0.01em] text-black/65 transition-colors hover:text-black"
            >
              <TelegramIcon size={20} />
              <span>Me contacter directement</span>
            </a>
          </div>

          <div className="mt-10 flex flex-col items-center gap-1 md:mt-14">
            <p className="text-[0.74rem] font-normal tracking-[-0.005em] text-black/35">Join Mister B</p>
            <a
              href="/dashboard"
              className="text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/30 transition hover:text-black/55"
            >
              Accès suivi privé
            </a>
          </div>
        </div>
      </section>

      {/* STICKY MOBILE CTA — hidden on md+ since the desktop hero CTA + post-FAQ CTA cover that role. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-[#1BD51C]/92 px-4 pb-[max(env(safe-area-inset-bottom,12px),12px)] pt-3 backdrop-blur-md md:hidden">
        <div className="mx-auto w-full max-w-[420px]">
          <PrimaryCta href={telegramGroupHref} onTrack={handlePrimaryClick} size="sticky" />
        </div>
      </div>
    </main>
  );
}
