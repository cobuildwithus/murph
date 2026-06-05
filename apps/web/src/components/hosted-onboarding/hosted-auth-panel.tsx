"use client";

import { useRef, useState } from "react";
import { PhoneIcon } from "lucide-react";

import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import type { HostedAuthCompletionResult } from "./hosted-auth-completion";
import { navigateHostedAuthRedirect } from "./hosted-auth-navigation";

import {
  HostedAuthLegalNotice,
} from "./hosted-auth-shared";

import { HostedEmailAuthButton } from "./hosted-email-auth-button";
import { HostedInlineAuthButton } from "./hosted-inline-auth-button";
import { HostedPhoneAuth } from "./hosted-phone-auth";
import { HostedPrivyCaptcha } from "./hosted-privy-captcha";
import { HostedTelegramAuthButton } from "./hosted-telegram-auth-button";

type HostedAuthMethod = "phone" | "telegram" | "email";
type HostedPrimaryMethod = "phone" | "email";

export function HostedAuthPanel({
  methods,
  onCompleted,
  onSignOut,
  requireLaunchConsentOnCompletion,
  showPassiveLegalNotice,
  size,
}: {
  methods: readonly HostedAuthMethod[];
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  requireLaunchConsentOnCompletion?: boolean;
  showPassiveLegalNotice?: boolean;
  size?: "default" | "compact";
}) {
  const [primaryMethod, setPrimaryMethod] = useState<HostedPrimaryMethod>("phone");
  const [codeSent, setCodeSent] = useState(false);
  const [telegramActive, setTelegramActive] = useState(false);
  const [pendingAuthCompletion, setPendingAuthCompletion] =
    useState<HostedAuthCompletionResult | null>(null);
  const pendingAuthCompletionRef = useRef<HostedAuthCompletionResult | null>(null);
  const includesPhone = methods.includes("phone");
  const includesTelegram = methods.includes("telegram");
  const includesEmail = methods.includes("email");
  const canSwap = includesPhone && includesEmail;
  const showAlternateMethods = !codeSent && (includesTelegram || canSwap);
  const shouldRequireLaunchConsent = requireLaunchConsentOnCompletion ?? false;
  const shouldShowPassiveLegalNotice = showPassiveLegalNotice ?? false;

  async function handleAuthCompleted(result: HostedAuthCompletionResult) {
    if (shouldGateHostedAuthCompletionWithLaunchConsent({
      result,
      requireLaunchConsentOnCompletion: shouldRequireLaunchConsent,
    })) {
      pendingAuthCompletionRef.current = result;
      setPendingAuthCompletion(result);
      return;
    }

    if (onCompleted) {
      await onCompleted(result.payload);
      return;
    }

    navigateHostedAuthRedirect(result.redirectUrl);
  }

  async function handleConsentSatisfied() {
    const result = pendingAuthCompletionRef.current;
    if (!result) return;

    if (onCompleted) {
      pendingAuthCompletionRef.current = null;
      setPendingAuthCompletion(null);
      await onCompleted(result.payload);
      return;
    }

    pendingAuthCompletionRef.current = null;
    navigateHostedAuthRedirect(result.redirectUrl);
  }

  if (pendingAuthCompletion) {
    return (
      <HostedLegalConsentCard
        mode="compact"
        onAccepted={handleConsentSatisfied}
        onRequirementChange={(required) => {
          if (!required) {
            void handleConsentSatisfied();
          }
        }}
        preferredScope="launch.legal"
        source="homepage-auth-dialog"
      />
    );
  }

  return (
    <div className="space-y-4">
      <HostedPrivyCaptcha />

      {primaryMethod === "phone" && includesPhone ? (
        <HostedPhoneAuth
          onAuthCompleted={handleAuthCompleted}
          onCodeSent={() => setCodeSent(true)}
          onCompleted={onCompleted}
          onSignOut={onSignOut}
          phoneInputAutoFocus
          renderCaptcha={false}
          size={size}
          suppressAuthenticatedSessionIssue={telegramActive}
        />
      ) : null}

      {primaryMethod === "email" && includesEmail ? (
        <HostedEmailAuthButton
          active
          onCompleted={handleAuthCompleted}
          onActivate={() => {}}
          inline
        />
      ) : null}

      {showAlternateMethods ? (
        <>
          <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            OR
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-2 gap-3 [&>*]:!order-none">
            {includesTelegram ? (
              <HostedTelegramAuthButton
                active={telegramActive}
                onCompleted={handleAuthCompleted}
                onActivate={() => {
                  setPrimaryMethod("phone");
                  setTelegramActive(true);
                }}
              />
            ) : null}
            {canSwap ? (
              primaryMethod === "phone" ? (
                <HostedEmailAuthButton
                  active={false}
                  onCompleted={handleAuthCompleted}
                  onActivate={() => {
                    setPrimaryMethod("email");
                    setTelegramActive(false);
                  }}
                />
              ) : (
                <HostedInlineAuthButton
                  active={false}
                  disabled={false}
                  icon={<PhoneIcon className="h-5 w-5" />}
                  onClick={() => {
                    setPrimaryMethod("phone");
                    setTelegramActive(false);
                  }}
                >
                  Phone
                </HostedInlineAuthButton>
              )
            ) : null}
          </div>
        </>
      ) : null}

      {shouldShowPassiveLegalNotice ? <HostedAuthLegalNotice /> : null}
    </div>
  );
}

function shouldGateHostedAuthCompletionWithLaunchConsent({
  requireLaunchConsentOnCompletion,
  result,
}: {
  requireLaunchConsentOnCompletion: boolean;
  result: HostedAuthCompletionResult;
}): boolean {
  if (!requireLaunchConsentOnCompletion) return false;
  if (result.payload.launchConsentGranted) return false;

  return (
    result.payload.stage === "checkout"
    || isHostedOnboardingAccessibleStage(result.payload.stage)
  );
}
