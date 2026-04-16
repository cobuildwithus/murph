"use client";

import { useState } from "react";

import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  HostedAuthLegalNotice,
  type HostedAuthIntent,
} from "./hosted-auth-shared";
import { HostedEmailAuthButton } from "./hosted-email-auth-button";
import { HostedPhoneAuth } from "./hosted-phone-auth";
import { HostedTelegramAuthButton } from "./hosted-telegram-auth-button";

type HostedAuthMethod = "phone" | "telegram" | "email";
type HostedAlternateMethod = Exclude<HostedAuthMethod, "phone"> | null;

export function HostedAuthPanel({
  intent = "signup",
  methods,
  onCompleted,
  onSignOut,
  showLegalNotice = false,
}: {
  intent?: HostedAuthIntent;
  methods: readonly HostedAuthMethod[];
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  showLegalNotice?: boolean;
}) {
  const [activeMethod, setActiveMethod] = useState<HostedAlternateMethod>(null);
  const includesPhone = methods.includes("phone");
  const includesTelegram = methods.includes("telegram");
  const includesEmail = methods.includes("email");
  const showAlternateMethods = includesTelegram || includesEmail;

  return (
    <div className="space-y-4">
      {includesPhone ? (
        <HostedPhoneAuth
          intent={intent}
          onCompleted={onCompleted}
          onSignOut={onSignOut}
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
                intent={intent}
                onActivate={() => setActiveMethod("telegram")}
              />
            ) : null}
            {includesEmail ? (
              <HostedEmailAuthButton
                active={activeMethod === "email"}
                intent={intent}
                onActivate={() => setActiveMethod("email")}
              />
            ) : null}
          </div>
        </>
      ) : null}

      {showLegalNotice && intent === "signup" ? <HostedAuthLegalNotice /> : null}
    </div>
  );
}
