"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import type { HostedBillingPlanCode } from "@/src/lib/hosted-onboarding/billing-plans";
import type {
  HostedInviteStatusPayload,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";
import type { PrivyLinkedAccountLike } from "@/src/lib/hosted-onboarding/privy-shared";
import { isHostedOnboardingPendingStage } from "@/src/lib/hosted-onboarding/stage";

import { JoinInviteEyebrow, type JoinInviteEyebrowTone } from "./join-invite-eyebrow";

function resolveJoinInviteEyebrow(
  stage: HostedInviteStatusPayload["stage"],
): { label: string; tone: JoinInviteEyebrowTone } {
  switch (stage) {
    case "invalid":
    case "expired":
      return { label: "Link no longer works", tone: "danger" };
    case "blocked":
      return { label: "Needs support", tone: "danger" };
    default:
      return { label: "Murph signup", tone: "default" };
  }
}

import { requestHostedBillingCheckout } from "./client-api";
import {
  fetchHostedInviteStatus,
  useHostedInviteStatusRefresh,
} from "./invite-status-client";
import {
  hasResolvedHostedInviteVerification,
  resolveJoinInviteStatusFromRefresh,
  resolveJoinInviteSubtitle,
  resolveJoinInviteTitle,
  shouldAwaitHostedInviteSessionResolution,
} from "./join-invite-state";
import { JoinInviteStageContent } from "./join-invite-sections";

interface JoinInviteClientProps {
  initialLinkedAccounts: readonly PrivyLinkedAccountLike[];
  initialStatus: HostedInviteStatusPayload;
  inviteCode: string;
  preview?: boolean;
}

export function JoinInviteClient({
  initialLinkedAccounts,
  initialStatus,
  inviteCode,
  preview = false,
}: JoinInviteClientProps) {
  const [status, setStatus] = useState(initialStatus);
  const [hasCompletedInitialRefresh, setHasCompletedInitialRefresh] = useState(
    hasResolvedHostedInviteVerification(initialStatus),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [billingPlanCode, setBillingPlanCode] = useState<HostedBillingPlanCode | null>(
    initialStatus.billing.defaultPlanCode,
  );
  const [statusRefreshErrorMessage, setStatusRefreshErrorMessage] = useState<string | null>(null);
  const [statusRefreshRetryPending, setStatusRefreshRetryPending] = useState(false);
  const checkoutOutcomeRef = useRef<
    | { kind: "redirect"; url: string }
    | { kind: "alreadyActive" }
    | null
  >(null);

  const awaitingInviteSessionResolution = shouldAwaitHostedInviteSessionResolution({
    hasCompletedInitialRefresh,
    status,
  });

  function applyRefreshedStatus(payload: HostedInviteStatusPayload) {
    setStatus((currentStatus) => resolveJoinInviteStatusFromRefresh({
      nextStatus: payload,
      status: currentStatus,
    }));
  }

  useEffect(() => {
    setBillingPlanCode((currentBillingPlanCode) => {
      if (
        currentBillingPlanCode
        && status.billing.plans.some((plan) => plan.code === currentBillingPlanCode)
      ) {
        return currentBillingPlanCode;
      }

      return status.billing.defaultPlanCode;
    });
  }, [status.billing.defaultPlanCode, status.billing.plans]);

  useHostedInviteStatusRefresh({
    inviteCode,
    onError: (error: unknown) => {
      setStatusRefreshErrorMessage(
        error instanceof Error ? error.message : "We could not refresh your signup state.",
      );
    },
    onStatus: (payload) => {
      applyRefreshedStatus(payload);
      setStatusRefreshErrorMessage(null);
      if (hasResolvedHostedInviteVerification(payload)) {
        setHasCompletedInitialRefresh(true);
      }
    },
    shouldPoll: isHostedOnboardingPendingStage(status.stage),
    disabled: preview,
  });

  async function refreshStatus(): Promise<HostedInviteStatusPayload> {
    const payload = await fetchHostedInviteStatus(inviteCode);
    applyRefreshedStatus(payload);
    setStatusRefreshErrorMessage(null);
    if (hasResolvedHostedInviteVerification(payload)) {
      setHasCompletedInitialRefresh(true);
    }
    return payload;
  }

  async function handleRetryStatusRefresh() {
    setStatusRefreshErrorMessage(null);
    setStatusRefreshRetryPending(true);

    try {
      await refreshStatus();
    } catch (error) {
      setStatusRefreshErrorMessage(
        error instanceof Error ? error.message : "We could not refresh your signup state.",
      );
    } finally {
      setStatusRefreshRetryPending(false);
    }
  }

  async function startCheckout() {
    setErrorMessage(null);
    checkoutOutcomeRef.current = null;
    const payload = await requestHostedBillingCheckout({
      billingPlanCode,
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
      void refreshStatus();
      return;
    }
    window.location.assign(outcome.url);
  }

  function handleCheckoutError(error: unknown) {
    checkoutOutcomeRef.current = null;
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }

  async function handlePhoneVerified(payload: HostedPrivyCompletionPayload) {
    applyRefreshedStatus(payload.status);
    if (hasResolvedHostedInviteVerification(payload.status)) {
      setHasCompletedInitialRefresh(true);
    }
  }

  const eyebrow = resolveJoinInviteEyebrow(status.stage);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <JoinInviteEyebrow label={eyebrow.label} tone={eyebrow.tone} />
        <h1 className="font-serif text-5xl font-normal leading-[1.04] tracking-[-0.03em] text-foreground sm:text-6xl">
          {resolveJoinInviteTitle(status)}
        </h1>
        <p className="max-w-md text-base leading-relaxed text-muted-foreground">
          {resolveJoinInviteSubtitle(status)}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to continue</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <JoinInviteStageContent
          awaitingInviteSessionResolution={awaitingInviteSessionResolution}
          billingPlanCode={billingPlanCode}
          initialLinkedAccounts={initialLinkedAccounts}
          inviteCode={inviteCode}
          status={status}
          statusRefreshErrorMessage={statusRefreshErrorMessage}
          statusRefreshRetryPending={statusRefreshRetryPending}
          onCheckout={startCheckout}
          onCheckoutSuccess={handleCheckoutSuccess}
          onCheckoutError={handleCheckoutError}
          onSelectBillingPlan={setBillingPlanCode}
          onPhoneVerified={handlePhoneVerified}
          onRefreshStatus={refreshStatus}
          onRetryStatusRefresh={handleRetryStatusRefresh}
          onSignOut={async () => {
            await refreshStatus();
          }}
        />
      </div>
    </div>
  );
}

export {
  resolveJoinInviteStatusFromRefresh,
  shouldAwaitHostedInviteSessionResolution,
} from "./join-invite-state";
