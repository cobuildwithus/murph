"use client";

import { cn } from "@/lib/utils";

const HOSTED_TERMS_URL = "/legal/terms.pdf";
const HOSTED_PRIVACY_URL = "/legal/privacy.pdf";

export function normalizeEmailAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
}

const TELEGRAM_CANCEL_PATTERNS = [
  /cancel/i,
  /closed by/i,
  /user (?:closed|aborted|dismissed)/i,
  /popup.*(?:closed|blocked)/i,
];

export type TelegramAuthErrorTone = "cancel" | "error";

export type TelegramAuthNotice = {
  message: string;
  tone: TelegramAuthErrorTone;
};

export function describeTelegramAuthError(error: unknown): TelegramAuthNotice {
  const raw = toErrorMessage(error, "").trim();

  if (raw && TELEGRAM_CANCEL_PATTERNS.some((pattern) => pattern.test(raw))) {
    return {
      tone: "cancel",
      message: "Telegram sign-in was canceled. Try again or use another option.",
    };
  }

  if (!raw) {
    return {
      tone: "error",
      message: "Could not continue with Telegram right now. Try again or use another option.",
    };
  }

  return { tone: "error", message: raw };
}

export function HostedAuthFinishingNotice() {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-[#1A1F16]/[0.035] px-4 py-3.5">
      <MurphPulseMark className="h-9 w-auto shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-serif text-[15px] font-medium leading-tight text-[#1A1F16]">
          Setting things up
        </p>
        <p className="mt-1 text-xs leading-snug text-pretty text-[#7A7870]">
          Keep this tab open — should just be a moment.
        </p>
      </div>
    </div>
  );
}

// Animated Murph mark: warm center dots breathe first, mid amber ring trails by
// 200ms, sage outer ring by 400ms — a quiet ripple radiating from the core.
function MurphPulseMark({ className }: { className?: string }) {
  const core = "animate-pulse [animation-duration:1800ms]";
  const mid = "animate-pulse [animation-duration:1800ms] [animation-delay:200ms]";
  const outer = "animate-pulse [animation-duration:1800ms] [animation-delay:400ms]";
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 65 44"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="6.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="16.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="27" cy="5.5" r="2.5" fill="#c4956a" fillOpacity=".55" className={mid} />
      <circle cx="38" cy="5.5" r="2.5" fill="#c4956a" fillOpacity=".55" className={mid} />
      <circle cx="48.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="58.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="4.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="14.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={mid} />
      <circle cx="26" cy="15.5" r="3.5" fill="#a07a4e" className={core} />
      <circle cx="39" cy="15.5" r="3.5" fill="#a07a4e" className={core} />
      <circle cx="50.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={mid} />
      <circle cx="60.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="2" cy="27.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="12.5" cy="27.5" r="2.5" fill="#c4956a" fillOpacity=".55" className={mid} />
      <circle cx="25" cy="27.5" r="4" fill="#8b6840" className={core} />
      <circle cx="39.5" cy="27.5" r="4.5" fill="#8b6840" className={core} />
      <circle cx="52.5" cy="27.5" r="2.5" fill="#c4956a" fillOpacity=".55" className={mid} />
      <circle cx="63" cy="27.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="6.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="16.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="27" cy="38.5" r="2.5" fill="#c4956a" fillOpacity=".55" className={mid} />
      <circle cx="38" cy="38.5" r="2.5" fill="#c4956a" fillOpacity=".55" className={mid} />
      <circle cx="48.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="58.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
    </svg>
  );
}

export function HostedAuthLegalNotice({
  className,
}: {
  className?: string;
}) {
  return (
    <p className={cn("text-xs leading-relaxed text-pretty text-stone-500", className)}>
      By continuing, you agree to our{" "}
      <a href={HOSTED_TERMS_URL} target="_blank" rel="noreferrer" className="hover:underline hover:underline-offset-4">
        Terms
      </a>{" "}
      and{" "}
      <a href={HOSTED_PRIVACY_URL} target="_blank" rel="noreferrer" className="hover:underline hover:underline-offset-4">
        Privacy Policy
      </a>
      .
    </p>
  );
}
