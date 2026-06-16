"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowRightIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { PaymentButton } from "@/src/components/ui/payment-button";
import type {
  HostedBillingPlanCode,
  HostedPublicBillingCheckoutOffer,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { isHostedOnboardingPendingStage } from "@/src/lib/hosted-onboarding/stage";
import type {
  HostedInviteEmailAuthTarget,
  HostedInvitePhoneAuthTarget,
  HostedInviteVerificationMode,
} from "@/src/lib/hosted-onboarding/types";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";

import { HostedLegalConsentCard } from "../legal/hosted-legal-consent-card";
import { ConnectTelegram } from "../settings/hosted-telegram-settings";
import { requestHostedBillingCheckout } from "./client-api";
import { HostedAuthFinishingNotice } from "./hosted-auth-shared";
import { HostedEmailAuthButton } from "./hosted-email-auth-button";
import { logoutHostedAppSession } from "./hosted-app-session-client";
import { HostedInvitePhoneAuth } from "./hosted-invite-phone-auth";
import { HostedPhoneAuth } from "./hosted-phone-auth";
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
      return <HostedAuthFinishingNotice />;
    }

    return (
      <div className="space-y-3">
        <HostedEmailAuthButton
          active
          inline
          initialEmailAddress={
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

export function JoinInviteSignOutButtonIsland() {
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
      {signOutPending ? "Signing out..." : "Use this invite instead"}
    </Button>
  );
}

export function JoinInviteMessagingSetupIsland({
  authenticated,
  initialTelegramAccount,
}: {
  authenticated: boolean;
  initialTelegramAccount: JoinInviteTelegramAccountSeed | null;
}) {
  const router = useRouter();

  function refresh() {
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <HostedPhoneAuth intent="link" onLinked={refresh} />

      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>

      <ConnectTelegram
        authenticated={authenticated}
        initialTelegramAccount={initialTelegramAccount}
        onSynced={refresh}
      />
    </div>
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
  checkoutOffer,
  disabledLabel,
  idleLabel,
  inviteCode,
  planCode,
}: {
  billingReady: boolean;
  className?: string;
  checkoutOffer?: HostedPublicBillingCheckoutOffer | null;
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
      ...(checkoutOffer ? { checkoutOffer } : {}),
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
      router.refresh();
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

