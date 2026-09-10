"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { PaymentButton } from "@/src/components/ui/payment-button";
import type {
  HostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { isHostedOnboardingPendingStage } from "@/src/lib/hosted-onboarding/stage";
import {
  type HostedInviteEmailAuthTarget,
  type HostedInvitePhoneAuthTarget,
  type HostedInviteVerificationMode,
} from "@/src/lib/hosted-onboarding/types";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import {
  completeHostedStarterUsageHandoff,
  consumeHostedGroupStartHandoff,
  HOSTED_GROUP_START_PATH,
} from "@/src/lib/hosted-groups/group-start-handoff";

import {
  HostedLegalConsentCard,
  type HostedLegalConsentAcceptScope,
} from "../legal/hosted-legal-consent-card";
import {
  requestHostedBillingCheckout,
  requestHostedOnboardingJson,
  type HostedStarterUsageEnrollmentResponse,
} from "./client-api";
import { HostedFirstPartyAuthPanel } from "./hosted-first-party-auth-panel";
import { logoutHostedAppSession } from "./hosted-app-session-client";
import { useHostedInviteStatusRefresh } from "./invite-status-client";
import {
  shouldRefreshJoinInviteStatusFromPayload,
  type JoinInviteStatusRefreshSnapshot,
} from "./join-invite-state";

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
  const savedPhoneHint = phoneAuthTarget?.kind === "saved" ? phoneAuthTarget.phoneHint : phoneHint;
  return <div className="flex flex-col gap-4">
    {verificationMode === "invite_phone" && savedPhoneHint ? <p className="text-sm text-muted-foreground">
      Enter the phone number ending in {savedPhoneHint.replace(/\D/gu, "").slice(-4)} to use this invite.
    </p> : null}
    <HostedFirstPartyAuthPanel
      inviteCode={inviteCode}
      initialEmailAddress={emailAuthTarget?.kind === "saved" ? emailAuthTarget.emailAddress : undefined}
      methods={verificationMode === "manual_phone" ? ["phone", "email", "telegram"] : verificationMode === "invite_email" ? ["email"] : ["phone"]}
      onCompleted={() => router.refresh()}
      onSignOut={() => router.refresh()}
      requireLaunchConsentOnCompletion
      size="compact"
    />
  </div>;
}

export function JoinInviteSignOutButtonIsland({
  idleLabel = "Use this invite instead",
  pendingLabel = "Signing out...",
}: {
  idleLabel?: string;
  pendingLabel?: string;
} = {}) {
  const router = useRouter();
  const [signOutPending, setSignOutPending] = useState(false);

  async function handleSignOut() {
    setSignOutPending(true);

    try {
      await logoutHostedAppSession();
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

export function JoinInviteMessagingSetupIsland() {
  const router = useRouter();
  return <div className="flex flex-col gap-4">
    <p className="text-sm leading-relaxed text-muted-foreground">
      Add a phone number or connect Telegram in your account settings. Your current sign-in stays active.
    </p>
    <Button nativeButton={false} render={<Link href="/settings/accounts" />}>Connect a messaging account</Button>
    <Button type="button" variant="outline" onClick={() => router.refresh()}>I’ve connected my account</Button>
  </div>;
}

export function JoinInviteLegalConsentIsland({
  inviteCode,
  initialStatus,
}: {
  inviteCode: string;
  initialStatus: HostedConsentStatus | null;
}) {
  const router = useRouter();
  const completionStartedRef = useRef(false);
  const starterEnrollmentRef = useRef<HostedStarterUsageEnrollmentResponse | null>(null);
  const acceptScope = useCallback<HostedLegalConsentAcceptScope>(
    async (input) => {
      const status = await requestHostedOnboardingJson<
        HostedConsentStatus & {
          starterEnrollment?: HostedStarterUsageEnrollmentResponse | null;
        }
      >({
        method: "POST",
        payload: {
          acceptedDocumentVersions: input.acceptedDocumentVersions,
          inviteCode,
          scope: input.scope,
          source: input.source,
        },
        url: "/api/legal/consent/accept",
      });
      starterEnrollmentRef.current = status.starterEnrollment ?? null;
      return status;
    },
    [inviteCode],
  );

  function refreshRoute() {
    if (completionStartedRef.current) {
      return;
    }
    completionStartedRef.current = true;
    if (starterEnrollmentRef.current) {
      completeHostedStarterUsageHandoff(
        starterEnrollmentRef.current.redirectPath,
      );
      return;
    }
    router.refresh();
  }

  return (
    <HostedLegalConsentCard
      acceptedPendingLabel="Continuing..."
      acceptScope={acceptScope}
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
