"use client";

import { useState } from "react";

import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  HostedAuthLegalNotice,
} from "./hosted-auth-shared";
import { HostedEmailAuthButton } from "./hosted-email-auth-button";
import { HostedPhoneAuth } from "./hosted-phone-auth";
import { HostedPrivyCaptcha } from "./hosted-privy-captcha";
import { HostedTelegramAuthButton } from "./hosted-telegram-auth-button";

type HostedAuthMethod = "phone" | "telegram" | "email";
type HostedAlternateMethod = Exclude<HostedAuthMethod, "phone"> | null;
type HostedAuthMode = "login" | "signup";

export function HostedAuthPanel({
  authMode = "signup",
  methods,
  onCompleted,
  onSignOut,
  showLegalNotice = false,
}: {
  authMode?: HostedAuthMode;
  methods: readonly HostedAuthMethod[];
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  showLegalNotice?: boolean;
}) {
  const [activeMethod, setActiveMethod] = useState<HostedAlternateMethod>(null);
  const disableSignup = authMode === "login";
  const includesPhone = methods.includes("phone");
  const includesTelegram = methods.includes("telegram");
  const includesEmail = methods.includes("email");
  const showAlternateMethods = includesTelegram || includesEmail;

  return (
    <div className="space-y-4">
      <HostedPrivyCaptcha />
      {includesPhone ? (
        <HostedPhoneAuth
          disableSignup={disableSignup}
          onCompleted={onCompleted}
          onSignOut={onSignOut}
          renderCaptcha={false}
          showPassiveConsentNotice={false}
          suppressAuthenticatedSessionIssue={activeMethod !== null}
        />
      ) : null}

      {showAlternateMethods ? (
        <>
          <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-400">
            <span className="h-px flex-1 bg-stone-200" />
            OR
            <span className="h-px flex-1 bg-stone-200" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {includesTelegram ? (
              <HostedTelegramAuthButton
                active={activeMethod === "telegram"}
                disableSignup={disableSignup}
                onActivate={() => setActiveMethod("telegram")}
              />
            ) : null}
            {includesEmail ? (
              <HostedEmailAuthButton
                active={activeMethod === "email"}
                disableSignup={disableSignup}
                onActivate={() => setActiveMethod("email")}
              />
            ) : null}
          </div>
        </>
      ) : null}

      {showLegalNotice ? <HostedAuthLegalNotice /> : null}
    </div>
  );
}
