"use client";

import { usePrivy, useUser } from "@privy-io/react-auth";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PhoneIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { Spinner } from "@/src/components/ui/spinner";
import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import { readHostedPrivyClientSessionState } from "@/src/lib/hosted-onboarding/privy-client";
import {
  extractHostedPrivyTelegramAccount,
  extractHostedPrivyVerifiedEmailAccount,
  type HostedPrivyLinkedAccountState,
} from "@/src/lib/hosted-onboarding/privy-shared";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { cn } from "@/src/lib/utils";
import type { HostedAuthCompletionResult } from "./hosted-auth-completion";
import {
  declineHostedLaunchConsent,
  logoutHostedAppSession,
} from "./hosted-app-session-client";
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

export type HostedAuthPanelView = "auth" | "auth-active" | "consent";
export type HostedPrivyWaitReason = "action" | "session" | null;

export function HostedAuthPanel({
  autoSendPastedPhoneNumber = false,
  inviteCode,
  methods,
  onCompleted,
  onPrivyWaitChange,
  onSignOut,
  onViewChange,
  phoneInputAutoFocus = true,
  requireLaunchConsentOnCompletion,
  showPassiveLegalNotice,
  size,
}: {
  autoSendPastedPhoneNumber?: boolean;
  inviteCode?: string | null;
  methods: readonly HostedAuthMethod[];
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onPrivyWaitChange?: (reason: HostedPrivyWaitReason) => void;
  onSignOut?: () => Promise<void> | void;
  onViewChange?: (view: HostedAuthPanelView) => void;
  phoneInputAutoFocus?: boolean;
  requireLaunchConsentOnCompletion?: boolean;
  showPassiveLegalNotice?: boolean;
  size?: "default" | "compact";
}) {
  const [primaryMethod, setPrimaryMethod] = useState<HostedPrimaryMethod>("phone");
  const [codeSent, setCodeSent] = useState(false);
  const [queuedAuthMethod, setQueuedAuthMethod] =
    useState<HostedAuthMethod | null>(null);
  const [telegramActive, setTelegramActive] = useState(false);
  const [telegramNotice, setTelegramNotice] = useState<TelegramAuthNotice | null>(null);
  const [pendingAuthCompletion, setPendingAuthCompletion] =
    useState<HostedAuthCompletionResult | null>(null);
  const [consentDeclinePending, setConsentDeclinePending] = useState(false);
  const pendingAuthCompletionRef = useRef<HostedAuthCompletionResult | null>(null);
  const queuedAuthMethodRef = useRef<HostedAuthMethod | null>(null);
  // Decline is terminal. A status read or acceptance that resolves after it must
  // not advance the journey the member just refused.
  const consentDeclinedRef = useRef(false);
  const { authenticated, logout, ready } = usePrivy();
  const { user } = useUser();
  const privySessionState = readHostedPrivyClientSessionState({ user });
  // A cold panel can accept a presentation choice before Privy reveals an
  // existing session. Consume that hydration boundary once so later choices
  // remain deliberate.
  const [privyHydrationPending, setPrivyHydrationPending] = useState(
    () => !ready || (authenticated && privySessionState === null),
  );
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
    sessionState: privySessionState,
  });
  const canSwap = includesPhone && includesEmail;
  const showAlternateMethods = !codeSent && (includesTelegram || canSwap);
  const showResumableAuthState =
    !codeSent
    && queuedAuthMethod !== "phone"
    && primaryMethod === "phone"
    && !telegramActive
    && resumableAuth !== null;
  const shouldRequireLaunchConsent = requireLaunchConsentOnCompletion ?? false;
  const shouldShowPassiveLegalNotice = showPassiveLegalNotice ?? false;
  const authJourneyActive = completion.activeMethod !== null;
  const selectedAuthMethod = completion.activeMethod ?? queuedAuthMethod;
  // Privy keeps authenticated/user in a module-level store while a keyed
  // provider restart resets ready locally. Do not trust that carried session
  // snapshot until the replacement provider becomes ready.
  const privySessionHydrationPending =
    authenticated
    && (!ready || privySessionState === null)
    && !codeSent
    && completion.activeMethod === null
    && completion.completingMethod === null
    && pendingAuthCompletion === null;

  if (privySessionHydrationPending && !privyHydrationPending) {
    setPrivyHydrationPending(true);
  }

  if (privySessionHydrationPending && queuedAuthMethod !== null) {
    setQueuedAuthMethod(null);
  }

  if (privyHydrationPending && ready && !privySessionHydrationPending) {
    setPrivyHydrationPending(false);
    if (
      authenticated
      && !codeSent
      && queuedAuthMethod === null
      && completion.activeMethod === null
      && completion.completingMethod === null
      && pendingAuthCompletion === null
    ) {
      if (includesPhone || resumableAuth !== null) {
        setPrimaryMethod("phone");
      }
      setTelegramActive(false);
      setTelegramNotice(null);
    }
  }

  const view: HostedAuthPanelView = pendingAuthCompletion
    ? "consent"
    : authJourneyActive
      ? "auth-active"
      : "auth";
  useLayoutEffect(() => {
    onViewChange?.(view);
  }, [onViewChange, view]);
  useLayoutEffect(() => {
    if (privySessionHydrationPending) {
      queuedAuthMethodRef.current = null;
    }
  }, [privySessionHydrationPending]);
  useLayoutEffect(() => {
    onPrivyWaitChange?.(
      privySessionHydrationPending
        ? "session"
        : queuedAuthMethod !== null
          ? "action"
          : null,
    );
  }, [
    onPrivyWaitChange,
    privySessionHydrationPending,
    queuedAuthMethod,
  ]);

  if (privySessionHydrationPending) {
    return null;
  }

  function queueAuthMethod(method: HostedAuthMethod): boolean {
    const activeMethod = completion.activeMethod;
    const currentQueuedMethod = queuedAuthMethodRef.current;

    if (
      authenticated
      ||
      (activeMethod !== null && activeMethod !== method)
      || (currentQueuedMethod !== null && currentQueuedMethod !== method)
    ) {
      return false;
    }

    queuedAuthMethodRef.current = method;
    setQueuedAuthMethod(method);
    clearTelegramStateForAcceptedPhone(method);
    return true;
  }

  function clearQueuedAuthMethod(method: HostedAuthMethod) {
    if (queuedAuthMethodRef.current !== method) return;
    queuedAuthMethodRef.current = null;
    setQueuedAuthMethod(null);
    if (authenticated) {
      if (includesPhone) {
        setPrimaryMethod("phone");
      }
      setTelegramActive(false);
      setTelegramNotice(null);
    }
  }

  function beginAuthMethod(method: HostedAuthMethod): boolean {
    if (!completion.beginAuth(method)) return false;
    clearQueuedAuthMethod(method);
    clearTelegramStateForAcceptedPhone(method);
    return true;
  }

  function clearTelegramStateForAcceptedPhone(method: HostedAuthMethod) {
    if (method !== "phone") return;
    setTelegramActive(false);
    setTelegramNotice(null);
  }

  function cancelAuthMethod(method: HostedAuthMethod) {
    clearQueuedAuthMethod(method);
    completion.cancelAuth(method);
  }

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
      await declineHostedLaunchConsent({ logoutPrivy: logout });
    } catch {
      // The session-ending client owns recovery: it revalidates authority by
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
          disabled={authJourneyActive}
          pending={completion.completingMethod === resumableAuth.method}
          onContinue={handleContinueResumableAuth}
          onSignOut={handleSignOutResumableAuth}
        />
      ) : primaryMethod === "phone" && includesPhone ? (
        <HostedPhoneAuth
          autoSendPastedPhoneNumber={autoSendPastedPhoneNumber}
          inviteCode={inviteCode}
          interactionGated={
            selectedAuthMethod !== null
            && selectedAuthMethod !== "phone"
          }
          onAuthCancel={() => cancelAuthMethod("phone")}
          onAuthQueue={() => queueAuthMethod("phone")}
          onAuthQueueCancel={() => clearQueuedAuthMethod("phone")}
          onAuthStart={() => beginAuthMethod("phone")}
          onAuthenticated={handlePhoneAuthenticated}
          onCodeSent={() => setCodeSent(true)}
          onSignOut={onSignOut}
          phoneInputAutoFocus={phoneInputAutoFocus}
          renderCaptcha={false}
          size={size}
          suppressAuthenticatedSessionIssue={telegramActive || resumableAuth !== null}
        />
      ) : null}

      {primaryMethod === "email" && includesEmail ? (
        <HostedEmailAuthButton
          active
          completionPending={completion.completingMethod === "email"}
          disabled={
            selectedAuthMethod !== null
            && selectedAuthMethod !== "email"
          }
          onAuthCancel={() => cancelAuthMethod("email")}
          onAuthQueue={() => queueAuthMethod("email")}
          onAuthQueueCancel={() => clearQueuedAuthMethod("email")}
          onAuthStart={() => beginAuthMethod("email")}
          onAuthenticated={completion.completeAuth}
          onActivate={() => {}}
          onCodeEntryChange={setCodeSent}
          inline
        />
      ) : null}

      {showAlternateMethods ? (
        <HostedAuthPanelAlternateMethods
          telegramNotice={telegramActive ? telegramNotice : null}
        >
          {includesTelegram ? (
            <HostedTelegramAuthButton
              active={telegramActive}
              completionPending={completion.completingMethod === "telegram"}
              disabled={
                selectedAuthMethod !== null
                && selectedAuthMethod !== "telegram"
              }
              onAuthCancel={() => cancelAuthMethod("telegram")}
              onAuthQueue={() => queueAuthMethod("telegram")}
              onAuthQueueCancel={() => clearQueuedAuthMethod("telegram")}
              onAuthStart={() => beginAuthMethod("telegram")}
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
                disabled={
                  selectedAuthMethod !== null
                  && selectedAuthMethod !== "email"
                }
                onAuthCancel={() => cancelAuthMethod("email")}
                onAuthQueue={() => queueAuthMethod("email")}
                onAuthQueueCancel={() => clearQueuedAuthMethod("email")}
                onAuthStart={() => beginAuthMethod("email")}
                onAuthenticated={completion.completeAuth}
                onActivate={() => {
                  setPrimaryMethod("email");
                  setTelegramActive(false);
                  setTelegramNotice(null);
                }}
                onCodeEntryChange={setCodeSent}
              />
            ) : (
              <HostedInlineAuthButton
                active={false}
                disabled={selectedAuthMethod !== null}
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
        </HostedAuthPanelAlternateMethods>
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

export function HostedAuthPanelAlternateMethods({
  children,
  telegramNotice = null,
}: {
  children: ReactNode;
  telegramNotice?: TelegramAuthNotice | null;
}) {
  return (
    <>
      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 gap-3 [&>*]:!order-none">
        {children}
      </div>
      {telegramNotice ? (
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
  sessionState: HostedPrivyLinkedAccountState | null;
}): HostedResumableAuth | null {
  if (!input.authenticated) {
    return null;
  }

  if (!input.sessionState || input.sessionState.phone) {
    return null;
  }

  if (input.includesTelegram) {
    const telegramAccount = extractHostedPrivyTelegramAccount({
      linkedAccounts: input.sessionState.linkedAccounts,
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
      input.sessionState.linkedAccounts,
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
