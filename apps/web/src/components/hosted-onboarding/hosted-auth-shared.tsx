"use client";

import { LoaderCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";

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
    <Alert className="border-stone-200 bg-stone-50">
      <LoaderCircleIcon className="mt-0.5 size-4 animate-spin" />
      <AlertTitle>Finishing setup...</AlertTitle>
      <AlertDescription>
        Keep this tab open. We are getting your account ready.
      </AlertDescription>
    </Alert>
  );
}

export function HostedAuthLegalNotice({
  className,
}: {
  className?: string;
}) {
  return (
    <p className={cn("text-xs leading-relaxed text-stone-500", className)}>
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
