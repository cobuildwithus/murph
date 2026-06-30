"use client";

import { cn } from "@/lib/utils";
import { MurphPulseLoader } from "@/src/components/ui/murph-pulse-loader";

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
      <MurphPulseLoader className="h-9 w-auto shrink-0" />
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
