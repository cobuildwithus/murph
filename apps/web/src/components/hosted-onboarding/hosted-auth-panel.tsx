"use client";

import { usePrivy, useUser } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { PhoneIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { Spinner } from "@/src/components/ui/spinner";
import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import { readHostedPrivyClientSessionState } from "@/src/lib/hosted-onboarding/privy-client";
import {
  extractHostedPrivyTelegramAccount,
  extractHostedPrivyVerifiedEmailAccount,
} from "@/src/lib/hosted-onboarding/privy-shared";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { cn } from "@/src/lib/utils";
import type { HostedAuthCompletionResult } from "./hosted-auth-completion";
import { logoutHostedAppSession } from "./hosted-app-session-client";
import { navigateHostedAuthRedirect } from "./hosted-auth-navigation";

import {
  HostedAuthLegalNotice,
  type TelegramAuthNotice,
} from "./hosted-auth-shared";

import { HostedEmailAuthButton } from "./hosted-email-auth-button";
import { HostedInlineAuthButton } from "./hosted-inline-auth-button";
import { HostedPhoneAuth } from "./hosted-phone-auth";
import { HostedPrivyCaptcha } from "./hosted-privy-captcha";
import { HostedTelegramAuthButton } from "./hosted-telegram-auth-button";
import { useHostedAuthCompletion } from "./use-hosted-auth-completion";

type HostedAuthMethod = "phone" | "telegram" | "email";
type HostedPrimaryMethod = "phone" | "email";
type HostedResumableAuthMethod = "telegram" | "email";
export type HostedResumableAuth = {
  identityLabel: string | null;
  method: HostedResumableAuthMethod;
};

export type HostedAuthPanelView = "auth" | "consent";

export function HostedAuthPanel({
  inviteCode,
  methods,
  onCompleted,
  onSignOut,
  onViewChange,
  requireLaunchConsentOnCompletion,
  showPassiveLegalNotice,
  size,
}: {
  inviteCode?: string | null;
  methods: readonly HostedAuthMethod[];
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  onViewChange?: (view: HostedAuthPanelView) => void;
  requireLaunchConsentOnCompletion?: boolean;
  showPassiveLegalNotice?: boolean;
  size?: "default" | "compact";
}) {
  const [primaryMethod, setPrimaryMethod] = useState<HostedPrimaryMethod>("phone");
  const [codeSent, setCodeSent] = useState(false);
  const [telegramActive, setTelegramActive] = useState(false);
  const [telegramNotice, setTelegramNotice] = useState<TelegramAuthNotice | null>(null);
  const [pendingAuthCompletion, setPendingAuthCompletion] =
    useState<HostedAuthCompletionResult | null>(null);
  const [consentDeclinePending, setConsentDeclinePending] = useState(false);
  const pendingAuthCompletionRef = useRef<HostedAuthCompletionResult | null>(null);
  // Decline is terminal. A status read or acceptance that resolves after it must
  // not advance the journey the member just refused.
  const consentDeclinedRef = useRef(false);
  const { authenticated, logout } = usePrivy();
  const { user } = useUser();
  const completion = useHostedAuthCompletion({
    inviteCode,
    onCompleted: handleAuthCompleted,
  });
  const includesPhone = methods.includes("phone");
  const includesTelegram = methods.includes("telegram");
  const includesEmail = methods.includes("email");
  const resumableAuth = resolveHostedResumableAuth({
    authenticated,
    includesEmail,
    includesTelegram,
    user,
  });
  const canSwap = includesPhone && includesEmail;
  const showAlternateMethods = !codeSent && (includesTelegram || canSwap);
  const showResumableAuthState =
    !codeSent && primaryMethod === "phone" && !telegramActive && resumableAuth !== null;
  const shouldRequireLaunchConsent = requireLaunchConsentOnCompletion ?? false;
  const shouldShowPassiveLegalNotice = showPassiveLegalNotice ?? false;
  const authCompletionPending = completion.completingMethod !== null;

  const view: HostedAuthPanelView = pendingAuthCompletion
    ? "consent"
    : "auth";
  useEffect(() => {
    onViewChange?.(view);
  }, [onViewChange, view]);

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
    if (consentDeclinedRef.current) return;

    const result = pendingAuthCompletionRef.current;
    if (!result) return;

    if (onCompleted) {
      await onCompleted(result.payload);
      pendingAuthCompletionRef.current = null;
      setPendingAuthCompletion(null);
      return;
    }

    pendingAuthCompletionRef.current = null;
    navigateHostedAuthRedirect(result.redirectUrl);
  }

  async function handleConsentDeclined() {
    if (consentDeclinePending) return;

    consentDeclinedRef.current = true;
    setConsentDeclinePending(true);
    try {
      await logoutHostedAppSession({ logoutPrivy: logout });
    } catch {
      // logoutHostedAppSession owns recovery: it revalidates authority by
      // reloading the document, and the fail-closed gate reappears if the
      // session survived. Nothing rendered here would outlive that reload.
      // The decline did not take effect, so it does not keep terminal priority.
      consentDeclinedRef.current = false;
      setConsentDeclinePending(false);
      return;
    }

    try {
      await onSignOut?.();
    } catch {
      // The authoritative Murph app session is already gone.
    }

    // Clear the refused completion before releasing terminal priority, so a
    // late callback from the declined journey still has nothing to advance.
    // The panel stays mounted and returns to auth, so the next authentication
    // in this same panel must be able to complete.
    pendingAuthCompletionRef.current = null;
    consentDeclinedRef.current = false;
    completion.resetCompletion();
    setPendingAuthCompletion(null);
    setConsentDeclinePending(false);
  }

  async function handleContinueResumableAuth() {
    if (!resumableAuth) return;

    await completion.completeAuth({
      authMethod: resumableAuth.method,
    });
  }

  async function handlePhoneAuthenticated(input: { authMethod: "phone" }) {
    await completion.completeAuth(input, { throwOnError: true });
  }

  async function handleSignOutResumableAuth() {
    await logoutHostedAppSession({ logoutPrivy: logout });
    await onSignOut?.();
  }

  if (pendingAuthCompletion) {
    return (
      <div className="space-y-4">
        <HostedLegalConsentCard
          declinePending={consentDeclinePending}
          initialStatus={pendingAuthCompletion.payload.launchConsentStatus}
          mode="compact"
          onAccepted={handleConsentSatisfied}
          onDecline={() => void handleConsentDeclined()}
          onRequirementChange={(required) => {
            if (!required) {
              void handleConsentSatisfied();
            }
          }}
          preferredScope="launch.legal"
          source="homepage-auth-dialog"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <HostedPrivyCaptcha />

      {showResumableAuthState ? (
        <HostedResumableAuthState
          auth={resumableAuth}
          disabled={authCompletionPending}
          pending={completion.completingMethod === resumableAuth.method}
          onContinue={handleContinueResumableAuth}
          onSignOut={handleSignOutResumableAuth}
        />
      ) : primaryMethod === "phone" && includesPhone ? (
        <HostedPhoneAuth
          inviteCode={inviteCode}
          interactionGated={authCompletionPending}
          onAuthenticated={handlePhoneAuthenticated}
          onCodeSent={() => setCodeSent(true)}
          onSignOut={onSignOut}
          phoneInputAutoFocus
          renderCaptcha={false}
          size={size}
          suppressAuthenticatedSessionIssue={telegramActive || resumableAuth !== null}
        />
      ) : null}

      {primaryMethod === "email" && includesEmail ? (
        <HostedEmailAuthButton
          active
          completionPending={completion.completingMethod === "email"}
          disabled={authCompletionPending}
          onAuthenticated={completion.completeAuth}
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
                completionPending={completion.completingMethod === "telegram"}
                disabled={authCompletionPending}
                onAuthenticated={completion.completeAuth}
                onActivate={() => {
                  setPrimaryMethod("phone");
                  setTelegramActive(true);
                }}
                onNoticeChange={setTelegramNotice}
              />
            ) : null}
            {canSwap ? (
              primaryMethod === "phone" ? (
                <HostedEmailAuthButton
                  active={false}
                  disabled={authCompletionPending}
                  onAuthenticated={completion.completeAuth}
                  onActivate={() => {
                    setPrimaryMethod("email");
                    setTelegramActive(false);
                    setTelegramNotice(null);
                  }}
                />
              ) : (
                <HostedInlineAuthButton
                  active={false}
                  disabled={authCompletionPending}
                  icon={<PhoneIcon className="h-5 w-5" />}
                  onClick={() => {
                    setPrimaryMethod("phone");
                    setTelegramActive(false);
                    setTelegramNotice(null);
                  }}
                >
                  Phone
                </HostedInlineAuthButton>
              )
            ) : null}
          </div>
          {telegramActive && telegramNotice ? (
            <p
              role="status"
              className={cn(
                "px-1 text-xs leading-relaxed",
                telegramNotice.tone === "cancel"
                  ? "text-muted-foreground"
                  : "text-destructive/90",
              )}
            >
              {telegramNotice.message}
            </p>
          ) : null}
        </>
      ) : null}

      {completion.errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to continue</AlertTitle>
          <AlertDescription>{completion.errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {shouldShowPassiveLegalNotice ? <HostedAuthLegalNotice /> : null}
    </div>
  );
}

export function HostedResumableAuthState({
  auth,
  disabled,
  pending,
  onContinue,
  onSignOut,
}: {
  auth: HostedResumableAuth;
  disabled: boolean;
  pending: boolean;
  onContinue: () => Promise<void> | void;
  onSignOut: () => Promise<void> | void;
}) {
  const methodLabel = auth.method === "telegram" ? "Telegram" : "email";
  const description = auth.identityLabel
    ? `You're signed in as ${auth.identityLabel}.`
    : `You're already signed in with ${methodLabel}.`;

  return (
    <Alert className="rounded-[2rem] border-stone-200 bg-stone-50">
      <AlertTitle>Continue with {methodLabel}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          aria-busy={pending}
          type="button"
          onClick={onContinue}
          disabled={disabled}
          size="lg"
          className="min-w-32 flex-1"
        >
          {pending ? (
            <>
              <Spinner aria-hidden="true" />
              Finishing...
            </>
          ) : "Continue"}
        </Button>
        <Button
          type="button"
          onClick={onSignOut}
          disabled={disabled}
          variant="outline"
          size="lg"
          className="min-w-32 flex-1"
        >
          Use phone
        </Button>
      </div>
    </Alert>
  );
}

function resolveHostedResumableAuth(input: {
  authenticated?: boolean;
  includesEmail: boolean;
  includesTelegram: boolean;
  user: { linkedAccounts?: unknown; linked_accounts?: unknown; telegram?: unknown } | null;
}): HostedResumableAuth | null {
  if (!input.authenticated) {
    return null;
  }

  const sessionState = readHostedPrivyClientSessionState({ user: input.user });

  if (!sessionState || sessionState.phone) {
    return null;
  }

  if (input.includesTelegram) {
    const telegramAccount = extractHostedPrivyTelegramAccount({
      linkedAccounts: sessionState.linkedAccounts,
    });

    if (telegramAccount) {
      return {
        identityLabel: formatHostedTelegramIdentityLabel(telegramAccount),
        method: "telegram",
      };
    }
  }

  if (input.includesEmail) {
    const emailAccount = extractHostedPrivyVerifiedEmailAccount(
      sessionState.linkedAccounts,
    );

    if (emailAccount) {
      return {
        identityLabel: emailAccount.address,
        method: "email",
      };
    }
  }

  return null;
}

function formatHostedTelegramIdentityLabel(input: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
}): string | null {
  if (input.username) {
    return `@${input.username}`;
  }

  const fullName = [input.firstName, input.lastName]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .trim();

  return fullName || null;
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
