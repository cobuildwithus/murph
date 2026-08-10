"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useUser } from "@privy-io/react-auth";
import { ArrowRightIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { PaymentButton } from "@/src/components/ui/payment-button";
import type {
  HostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { isHostedOnboardingPendingStage } from "@/src/lib/hosted-onboarding/stage";
import {
  HOSTED_PRIVY_AUTH_METHODS,
  type HostedInviteEmailAuthTarget,
  type HostedInvitePhoneAuthTarget,
  type HostedInviteVerificationMode,
} from "@/src/lib/hosted-onboarding/types";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import {
  consumeHostedGroupStartHandoff,
  HOSTED_GROUP_START_PATH,
} from "@/src/lib/hosted-groups/group-start-handoff";

import { ConsentSkeleton, HostedLegalConsentCard } from "../legal/hosted-legal-consent-card";
import { useHostedPhoneLinkDiagnostics } from "../settings/hosted-phone-link-diagnostics";
import { ConnectTelegram } from "../settings/hosted-telegram-settings";
import { HostedPhoneSettings } from "../settings/hosted-phone-settings";
import {
  HostedIdentitySessionLoading,
  HostedIdentitySessionMismatch,
} from "../settings/hosted-settings-identity-link-dialog";
import { requestHostedBillingCheckout } from "./client-api";
import { HostedAuthPanel } from "./hosted-auth-panel";
import { HostedContactChannelChoice } from "./hosted-contact-channel-choice";
import { HostedEmailAuthButton } from "./hosted-email-auth-button";
import { logoutHostedAppSession } from "./hosted-app-session-client";
import { HostedInvitePhoneAuth } from "./hosted-invite-phone-auth";
import { useHostedInviteStatusRefresh } from "./invite-status-client";
import type { JoinInviteTelegramAccountSeed } from "./join-invite-page-model";
import {
  shouldRefreshJoinInviteStatusFromPayload,
  type JoinInviteStatusRefreshSnapshot,
} from "./join-invite-state";
import { useHostedAuthCompletion } from "./use-hosted-auth-completion";

export function JoinInviteStatusRefreshIsland({
  current,
  disabled = false,
  inviteCode,
  legalGateActive,
}: {
  current: JoinInviteStatusRefreshSnapshot;
  disabled?: boolean;
  inviteCode: string;
  legalGateActive: boolean;
}) {
  const router = useRouter();
  const [refreshErrorMessage, setRefreshErrorMessage] = useState<string | null>(null);
  const pollingEligible = isHostedOnboardingPendingStage(current.stage);

  useHostedInviteStatusRefresh({
    disabled: disabled || legalGateActive || !pollingEligible,
    inviteCode,
    onError: (error) => {
      setRefreshErrorMessage(error instanceof Error ? error.message : String(error));
    },
    onStatus: (payload) => {
      setRefreshErrorMessage(null);
      const shouldRefresh = shouldRefreshJoinInviteStatusFromPayload({
        current,
        nextStatus: payload,
      });

      if (!shouldRefresh) {
        return;
      }

      router.refresh();
    },
    shouldPoll: pollingEligible && !legalGateActive,
  });

  if (!refreshErrorMessage) {
    return null;
  }

  return (
    <Alert variant="destructive" className="mt-4">
      <AlertTitle>Unable to refresh invite status</AlertTitle>
      <AlertDescription>{refreshErrorMessage}</AlertDescription>
      <div className="mt-3">
        <Button
          type="button"
          onClick={() => {
            setRefreshErrorMessage(null);
            router.refresh();
          }}
          variant="outline"
          size="lg"
        >
          Try again
        </Button>
      </div>
    </Alert>
  );
}

export function JoinInvitePhoneVerificationIsland({
  emailAuthTarget,
  inviteCode,
  phoneAuthTarget,
  phoneHint,
  verificationMode,
}: {
  emailAuthTarget?: HostedInviteEmailAuthTarget | null;
  inviteCode: string;
  phoneAuthTarget?: HostedInvitePhoneAuthTarget | null;
  phoneHint?: string | null;
  verificationMode: HostedInviteVerificationMode;
}) {
  const router = useRouter();
  const { logout } = usePrivy();
  const emailAuthCompletion = useHostedAuthCompletion({
    inviteCode,
    onCompleted: () => {
      router.refresh();
    },
  });

  if (verificationMode === "invite_email") {
    if (emailAuthCompletion.completingMethod) {
      return (
        <div aria-busy="true" aria-live="polite" role="status">
          <ConsentSkeleton />
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <HostedEmailAuthButton
          active
          inline
          lockedEmailAddress={
            emailAuthTarget?.kind === "saved" ? emailAuthTarget.emailAddress : null
          }
          onAuthenticated={emailAuthCompletion.completeAuth}
        />
        {emailAuthCompletion.errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to continue</AlertTitle>
            <AlertDescription>{emailAuthCompletion.errorMessage}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    );
  }

  if (verificationMode === "manual_phone") {
    return (
      <HostedAuthPanel
        inviteCode={inviteCode}
        methods={HOSTED_PRIVY_AUTH_METHODS}
        onCompleted={() => {
          router.refresh();
        }}
        onSignOut={() => {
          router.refresh();
        }}
        requireLaunchConsentOnCompletion
        size="compact"
      />
    );
  }

  const resolvedPhoneAuthTarget =
    verificationMode === "invite_phone"
      ? phoneAuthTarget
      : ({ kind: "manual" } as const);
  const resolvedPhoneHint = verificationMode === "invite_phone" ? phoneHint : null;

  return (
    <HostedInvitePhoneAuth
      inviteCode={inviteCode}
      phoneAuthTarget={resolvedPhoneAuthTarget}
      phoneHint={resolvedPhoneHint}
      onSignOut={async () => {
        await logoutHostedAppSession({ logoutPrivy: logout });
        router.refresh();
      }}
      onCompleted={() => {
        router.refresh();
      }}
    />
  );
}

export function JoinInviteSignOutButtonIsland({
  idleLabel = "Use this invite instead",
  pendingLabel = "Signing out...",
}: {
  idleLabel?: string;
  pendingLabel?: string;
} = {}) {
  const router = useRouter();
  const { logout } = usePrivy();
  const [signOutPending, setSignOutPending] = useState(false);

  async function handleSignOut() {
    setSignOutPending(true);

    try {
      await logoutHostedAppSession({ logoutPrivy: logout });
      router.refresh();
    } finally {
      setSignOutPending(false);
    }
  }

  return (
    <Button
      type="button"
      onClick={handleSignOut}
      disabled={signOutPending}
      variant="outline"
      size="lg"
    >
      {signOutPending ? pendingLabel : idleLabel}
    </Button>
  );
}

export function JoinInviteMessagingSetupIsland({
  authenticated,
  expectedPrivyUserId,
  initialTelegramAccount,
  privySessionMatchesAppSession,
}: {
  authenticated: boolean;
  expectedPrivyUserId: string | null;
  initialTelegramAccount: JoinInviteTelegramAccountSeed | null;
  privySessionMatchesAppSession: boolean;
}) {
  const router = useRouter();
  const {
    authenticated: privyAuthenticated,
    logout,
    ready: privyReady,
  } = usePrivy();
  const { user } = useUser();
  const [reauthPending, setReauthPending] = useState(false);
  const clientIdentityPending =
    !privyReady || (privyAuthenticated && user === null);
  const clientSessionMatchesAppSession =
    authenticated
    && privyReady
    && privyAuthenticated
    && privySessionMatchesAppSession
    && expectedPrivyUserId !== null
    && user?.id === expectedPrivyUserId;
  const createPhoneDiagnosticReporter = useHostedPhoneLinkDiagnostics({
    appAuthenticated: authenticated,
    clientUserMatchesExpected: expectedPrivyUserId !== null && user?.id === expectedPrivyUserId,
    clientUserPresent: Boolean(user?.id),
    expectedUserPresent: expectedPrivyUserId !== null,
    operation: user?.phone?.number ? "update" : "link",
    privyAuthenticated,
    privyReady,
    serverSessionMatches: privySessionMatchesAppSession,
    showLinkForm: true,
    surface: "join_invite",
  });

  function refresh() {
    router.refresh();
  }

  async function handleSignInAgain() {
    setReauthPending(true);

    try {
      await logoutHostedAppSession({ logoutPrivy: logout });
      router.refresh();
    } finally {
      setReauthPending(false);
    }
  }

  if (clientIdentityPending) {
    return <HostedIdentitySessionLoading />;
  }

  if (!clientSessionMatchesAppSession) {
    return (
      <HostedIdentitySessionMismatch
        disabled={reauthPending}
        onSignInAgain={handleSignInAgain}
        pending={reauthPending}
      />
    );
  }

  return (
    <HostedContactChannelChoice
      phone={
        <HostedPhoneSettings
          diagnosticReporterFactory={createPhoneDiagnosticReporter}
          onLinked={refresh}
        />
      }
      telegram={
        <ConnectTelegram
          authenticated={clientSessionMatchesAppSession}
          initialTelegramAccount={initialTelegramAccount}
          onSynced={refresh}
        />
      }
    />
  );
}

export function JoinInviteLegalConsentIsland({
  initialStatus,
}: {
  initialStatus: HostedConsentStatus | null;
}) {
  const router = useRouter();

  function refreshRoute() {
    router.refresh();
  }

  return (
    <HostedLegalConsentCard
      acceptedPendingLabel="Continuing..."
      initialStatus={initialStatus}
      mode="compact"
      onAccepted={refreshRoute}
      onRequirementChange={(required) => {
        if (!required) {
          refreshRoute();
        }
      }}
      preferredScope="launch.legal"
      source="join-invite-phone-verify"
    />
  );
}

export function JoinInviteRefreshButtonIsland({
  label = "Try again",
}: {
  label?: string;
}) {
  const router = useRouter();

  return (
    <Button type="button" onClick={() => router.refresh()} variant="outline" size="lg">
      {label}
    </Button>
  );
}

export function JoinInviteCheckoutPlanButtonIsland({
  billingReady,
  className,
  disabledLabel,
  idleLabel,
  inviteCode,
  planCode,
}: {
  billingReady: boolean;
  className?: string;
  disabledLabel?: string;
  idleLabel: string;
  inviteCode: string;
  planCode: HostedBillingPlanCode | null;
}) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const checkoutOutcomeRef = useRef<
    | { kind: "redirect"; url: string }
    | { kind: "alreadyActive" }
    | null
  >(null);

  async function startCheckout() {
    setErrorMessage(null);
    checkoutOutcomeRef.current = null;

    if (!planCode) {
      throw new Error("This plan is not available yet.");
    }

    const payload = await requestHostedBillingCheckout({
      billingPlanCode: planCode,
      inviteCode,
    });

    if (payload.alreadyActive) {
      checkoutOutcomeRef.current = { kind: "alreadyActive" };
      return;
    }

    if (!payload.url) {
      throw new Error("Checkout did not return a redirect URL.");
    }

    checkoutOutcomeRef.current = { kind: "redirect", url: payload.url };
  }

  function handleCheckoutSuccess() {
    const outcome = checkoutOutcomeRef.current;
    checkoutOutcomeRef.current = null;
    if (!outcome) return;
    if (outcome.kind === "alreadyActive") {
      if (consumeHostedGroupStartHandoff()) {
        router.replace(HOSTED_GROUP_START_PATH);
      } else {
        router.refresh();
      }
      return;
    }

    window.location.assign(outcome.url);
  }

  function handleCheckoutError(error: unknown) {
    checkoutOutcomeRef.current = null;
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }

  return (
    <div className="space-y-3">
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to continue</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <PaymentButton
        onClick={startCheckout}
        onSuccess={handleCheckoutSuccess}
        onError={handleCheckoutError}
        disabled={!billingReady || !planCode}
        size="lg"
        className={className}
        idleLabel={billingReady && planCode ? idleLabel : disabledLabel ?? idleLabel}
        idleAdornment={<ArrowRightIcon className="size-4" />}
      />
    </div>
  );
}
