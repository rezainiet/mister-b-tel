import React, { useEffect, useMemo, useState } from "react";
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

const telegramUrl = "https://t.me/MisterBNMB";
const logoUrl =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663482010907/nmN5FRo8qmaVANQi8aWFsw/misterb-logo_21161f1e.jpeg";

// NOTE: This is intentional demo / social-proof content, not real-time data.
// Names and actions are illustrative — the rotation only animates the toast,
// it does not reflect live joins. If you need real activity here, wire it to
// the dashboard.subscriberLog tRPC query instead.
const socialNotifications = [
  { id: "lucas-group", name: "Lucas", detail: "a rejoint le groupe privé" },
  { id: "mehdi-tg", name: "Mehdi", detail: "vient de cliquer sur Telegram" },
  { id: "sofia-msg", name: "Sofia", detail: "vient d’écrire à Mister B" },
  { id: "antoine-group", name: "Antoine", detail: "a rejoint le groupe" },
  { id: "yasmine-news", name: "Yasmine", detail: "vient de demander les nouveautés" },
  { id: "marco-tg", name: "Marco", detail: "vient de cliquer sur Telegram" },
  { id: "karim-group", name: "Karim", detail: "a rejoint le groupe privé" },
  { id: "lea-tg", name: "Léa", detail: "vient de cliquer sur Telegram" },
  { id: "amine-msg", name: "Amine", detail: "vient d’écrire à Mister B" },
  { id: "giulia-vip", name: "Giulia", detail: "vient de rejoindre la liste VIP" },
  { id: "nora-group", name: "Nora", detail: "a rejoint le groupe" },
  { id: "samir-tg", name: "Samir", detail: "vient de cliquer sur Telegram" },
];

type SocialNotification = (typeof socialNotifications)[number];

function shuffleNotifications(list: SocialNotification[]) {
  const copied = [...list];

  for (let index = copied.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copied[index], copied[randomIndex]] = [copied[randomIndex], copied[index]];
  }

  return copied;
}

function buildVisitSequence() {
  if (typeof window === "undefined") {
    return socialNotifications;
  }

  const shuffled = shuffleNotifications(socialNotifications);
  const lastFirstToastId = window.localStorage.getItem("misterb-last-toast-id");

  if (shuffled.length > 1 && shuffled[0].id === lastFirstToastId) {
    const firstItem = shuffled.shift();
    if (firstItem) {
      shuffled.push(firstItem);
    }
  }

  window.localStorage.setItem("misterb-last-toast-id", shuffled[0].id);
  return shuffled;
}

function WhatsAppIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className="h-7.5 w-7.5 rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.10)]"
    >
      <circle cx="16" cy="16" r="15" fill="#25D366" />
      <path
        fill="#fff"
        d="M23.4 8.5A10.15 10.15 0 0 0 6.57 20.1L5 26.94l7-1.82a10.16 10.16 0 0 0 4.84 1.24h.01A10.16 10.16 0 0 0 23.4 8.5Zm-6.56 16.13h-.01a8.46 8.46 0 0 1-4.31-1.18l-.31-.18-4.16 1.09 1.11-4.05-.2-.33a8.43 8.43 0 1 1 7.88 4.65Zm4.63-6.32c-.25-.12-1.5-.74-1.73-.82-.23-.08-.4-.12-.56.13-.16.25-.64.82-.78.99-.14.16-.29.19-.54.06-.25-.12-1.04-.38-1.99-1.22-.74-.66-1.24-1.47-1.39-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.42.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.77-1.84-.2-.48-.4-.41-.56-.42h-.48c-.16 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.39 1.01 2.55.12.16 1.75 2.67 4.24 3.74.59.25 1.05.4 1.4.51.59.19 1.12.16 1.55.1.47-.07 1.5-.61 1.71-1.21.21-.6.21-1.11.15-1.21-.06-.1-.23-.16-.48-.29Z"
      />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className="h-7.5 w-7.5 rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.10)]"
    >
      <circle cx="16" cy="16" r="15" fill="#2AABEE" />
      <path
        fill="#fff"
        d="M23.97 9.18 21.58 22.3c-.18.93-.66 1.16-1.33.72l-4.28-3.16-2.06 1.98c-.23.23-.42.42-.86.42l.31-4.39 8-7.23c.35-.31-.07-.49-.54-.18l-9.89 6.22-4.26-1.33c-.93-.29-.95-.93.19-1.38L22.62 8c.73-.27 1.36.18 1.12 1.18Z"
      />
    </svg>
  );
}

type CtaButtonProps = {
  href: string;
  label: string;
  icon: "whatsapp" | "telegram";
  animationDelay: string;
  onTrack: (event: React.MouseEvent<HTMLAnchorElement>) => void | Promise<void>;
  openInSameTab?: boolean;
  disabled?: boolean;
};

function CtaButton({ href, label, icon, animationDelay, onTrack, openInSameTab = false, disabled = false }: CtaButtonProps) {
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    void onTrack(event);
  };

  return (
    <a
      href={href}
      target={openInSameTab ? "_self" : "_blank"}
      rel={openInSameTab ? undefined : "noreferrer"}
      data-direct-open={openInSameTab ? "telegram-bot" : undefined}
      aria-disabled={disabled ? "true" : undefined}
      onClick={handleClick}
      style={{ animation: disabled ? undefined : `ctaFloat 2.8s ease-in-out ${animationDelay} infinite` }}
      className={`flex min-h-[66px] w-full items-center justify-center gap-3 rounded-[21px] bg-white px-4.5 py-3 text-[0.9rem] font-[650] uppercase tracking-[-0.02em] text-black shadow-[0_9px_20px_rgba(145,255,127,0.22)] transition-transform duration-150 ${disabled ? "cursor-wait opacity-80" : "hover:-translate-y-1 hover:shadow-[0_11px_24px_rgba(145,255,127,0.28)] active:translate-y-0"}`}
    >
      <span
        className="shrink-0"
        style={{ animation: `ctaIconPulse 2.8s ease-in-out ${animationDelay} infinite` }}
      >
        {icon === "whatsapp" ? <WhatsAppIcon /> : <TelegramIcon />}
      </span>
      <span>{label}</span>
    </a>
  );
}

function shouldPreferTelegramDeepLink() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function getTelegramGroupHref(session?: TrackingSession | null) {
  const preferDeepLink = shouldPreferTelegramDeepLink();

  if (session) {
    return preferDeepLink ? session.telegramDeepLink : session.telegramBotUrl;
  }

  // No session yet — build a funnelToken-only fallback link so the href in
  // the DOM always carries some attribution hint, even before React mount or
  // if the user taps before the createSession round-trip completes.
  const funnelToken = readPersistedFunnelToken();
  if (funnelToken) {
    const fallback = buildFallbackTrackingSession(funnelToken);
    return preferDeepLink ? fallback.telegramDeepLink : fallback.telegramBotUrl;
  }

  return preferDeepLink ? TELEGRAM_BOT_DEEP_LINK : TELEGRAM_BOT_URL;
}

export default function Home() {
  const notifications = useMemo(() => buildVisitSequence(), []);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [telegramGroupHref, setTelegramGroupHref] = useState<string>(getTelegramGroupHref());

  useEffect(() => {
    void initAdvancedTracking().then((session) => {
      setTelegramGroupHref(getTelegramGroupHref(session));
    });
  }, []);

  useEffect(() => {
    const initialTimeout = window.setTimeout(() => {
      setIsToastVisible(true);
    }, 1600);

    let fadeTimeout: number | undefined;

    const interval = window.setInterval(() => {
      setIsToastVisible(false);

      fadeTimeout = window.setTimeout(() => {
        setActiveIndex((currentIndex) => (currentIndex + 1) % notifications.length);
        setIsToastVisible(true);
      }, 260);
    }, 4200);

    return () => {
      window.clearTimeout(initialTimeout);
      window.clearInterval(interval);
      if (fadeTimeout) {
        window.clearTimeout(fadeTimeout);
      }
    };
  }, [notifications.length]);

  const activeToast = notifications[activeIndex];

  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-[#1BD51C] text-black">
      <style>{`
        @keyframes ctaFloat {
          0%, 100% {
            transform: translateY(0) scale(1);
            box-shadow: 0 12px 24px rgba(145, 255, 127, 0.26);
          }
          50% {
            transform: translateY(-4px) scale(1.018);
            box-shadow: 0 18px 34px rgba(145, 255, 127, 0.38);
          }
        }

        @keyframes ctaIconPulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.08);
          }
        }

        @keyframes toastDrift {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-2px);
          }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0 opacity-90">
        <div className="absolute left-[-14%] top-[4%] h-40 w-40 rounded-full bg-[#c1ffb9] blur-3xl" />
        <div className="absolute right-[-10%] top-[16%] h-44 w-44 rounded-full bg-[#cbffc6] blur-3xl" />
        <div className="absolute left-[0%] top-[50%] h-52 w-52 rounded-full bg-[#c5ffbd] blur-3xl" />
        <div className="absolute right-[3%] bottom-[14%] h-56 w-56 rounded-full bg-[#c8ffc1] blur-3xl" />
      </div>

      <div className="pointer-events-none absolute right-3 top-3 z-20 sm:right-4 sm:top-4">
        <div
          aria-live="polite"
          className={`max-w-[150px] rounded-[15px] border border-white/45 bg-white/68 px-2.5 py-1.5 text-left shadow-[0_7px_16px_rgba(15,45,23,0.08)] backdrop-blur-sm transition-all duration-300 ${
            isToastVisible ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"
          }`}
          style={{ animation: "toastDrift 4.2s ease-in-out infinite" }}
        >
          <div className="flex items-start gap-2">
            <div className="mt-[2px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#42c85e] shadow-[0_0_0_3px_rgba(66,200,94,0.12)]" />
            <div className="min-w-0">
              <p className="text-[0.64rem] font-[640] leading-none tracking-[-0.015em] text-[#244428]">
                {activeToast.name}
              </p>
              <p className="mt-0.5 text-[0.62rem] font-[430] leading-[1.18] tracking-[-0.01em] text-black/58">
                {activeToast.detail}
              </p>
            </div>
          </div>
        </div>
      </div>

      <section
        id="hero-section"
        className="relative mx-auto flex min-h-[100svh] w-full max-w-[374px] flex-col items-center justify-center px-4.5 py-2 text-center"
      >
        <div className="w-full">
          <div className="flex justify-center">
            <div className="rounded-full bg-white p-[5px] shadow-[0_8px_18px_rgba(124,255,113,0.28)]">
              <img
                src={logoUrl}
                alt="Logo Mister B"
                className="h-[120px] w-[120px] rounded-full object-cover shadow-[0_0_18px_rgba(243,255,126,0.26)]"
              />
            </div>
          </div>

          <h1 className="mt-3.5 text-[2.55rem] font-[700] tracking-[-0.05em] text-black">Mister B</h1>

          <div id="hero-copy" className="mx-auto mt-3.5 max-w-[302px]">
            <p className="text-[1.68rem] font-[620] leading-[1.1] tracking-[-0.038em] text-black">
              Vendeur numéro 1 en France aujourd&apos;hui jamais égalé <span aria-hidden="true">🇫🇷</span>
            </p>
          </div>

          <p className="mx-auto mt-3.5 max-w-[314px] text-[0.94rem] font-[430] leading-[1.22] tracking-[-0.02em] text-black/82">
            Clique pour rejoindre le groupe privé <span aria-hidden="true">✅</span>
          </p>
        </div>

        <div id="cta-group" className="mt-4.5 w-full space-y-3">
          <CtaButton
            href={telegramGroupHref}
            label="Groupe Telegram"
            icon="telegram"
            animationDelay="0s"
            openInSameTab
            onTrack={async (event) => {
              event.preventDefault();
              const session = await trackTelegramGroupClick("telegram_group_cta");
              // trackTelegramGroupClick is guaranteed to return a session whose
              // telegramBotUrl already contains a non-empty `?start=` payload
              // (real session OR funnelToken-only fallback). Trust that — never
              // fall back to a payload-less bot URL here.
              const targetHref = getTelegramGroupHref(session);
              setTelegramGroupHref(targetHref);
              window.location.assign(targetHref);
            }}
          />
          <CtaButton
            href={telegramUrl}
            label="Me contacter"
            icon="telegram"
            animationDelay="0.45s"
            openInSameTab
            onTrack={async (event) => {
              event.preventDefault();
              try {
                await trackTelegramClick("telegram_contact_cta");
              } finally {
                window.location.assign(telegramUrl);
              }
            }}
          />
        </div>

        <div className="mt-4.5 flex flex-col items-center gap-1">
          <p className="text-[0.76rem] font-normal tracking-[-0.01em] text-black/36">Join Mister B</p>
          <a href="/dashboard" className="text-[0.64rem] font-medium tracking-[0.14em] uppercase text-black/30 transition hover:text-black/50">
            Accès suivi privé
          </a>
        </div>
      </section>
    </main>
  );
}
