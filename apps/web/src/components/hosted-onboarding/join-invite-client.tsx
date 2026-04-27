"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import type { HostedSharePreview } from "@/src/lib/hosted-share/service";
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
import {
  JoinInviteSharePreviewAlert,
  JoinInviteStageContent,
} from "./join-invite-sections";
import { useJoinInviteShareImport } from "./use-join-invite-share-import";

interface JoinInviteClientProps {
  initialLinkedAccounts: readonly PrivyLinkedAccountLike[];
  initialStatus: HostedInviteStatusPayload;
  inviteCode: string;
  shareCode: string | null;
  sharePreview: HostedSharePreview | null;
  preview?: boolean;
}

export function JoinInviteClient({
  initialLinkedAccounts,
  initialStatus,
  inviteCode,
  shareCode,
  sharePreview,
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
  const [pendingAction, setPendingAction] = useState<"checkout" | "share" | null>(null);
  const [statusRefreshErrorMessage, setStatusRefreshErrorMessage] = useState<string | null>(null);
  const [statusRefreshRetryPending, setStatusRefreshRetryPending] = useState(false);

  const awaitingInviteSessionResolution = shouldAwaitHostedInviteSessionResolution({
    hasCompletedInitialRefresh,
    status,
  });
  const checkoutPending = pendingAction === "checkout";
  const { handleAcceptShare, shareImportState } = useJoinInviteShareImport({
    inviteCode,
    onErrorMessage: setErrorMessage,
    onPendingAction: setPendingAction,
    shareCode,
    statusStage: status.stage,
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
    setPendingAction("checkout");

    try {
      const payload = await requestHostedBillingCheckout({
        billingPlanCode,
        inviteCode,
        shareCode,
      });

      if (payload.alreadyActive) {
        await refreshStatus();
        return;
      }

      if (!payload.url) {
        throw new Error("Checkout did not return a redirect URL.");
      }

      window.location.assign(payload.url);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handlePhoneVerified(payload: HostedPrivyCompletionPayload) {
    applyRefreshedStatus(payload.status);
    if (hasResolvedHostedInviteVerification(payload.status)) {
      setHasCompletedInitialRefresh(true);
    }
  }

  const eyebrow = resolveJoinInviteEyebrow(status.stage);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <JoinInviteEyebrow label={eyebrow.label} tone={eyebrow.tone} />
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#2d3436] md:text-4xl">
          {resolveJoinInviteTitle(status)}
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
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

        {sharePreview ? (
          <JoinInviteSharePreviewAlert sharePreview={sharePreview} />
        ) : null}

        <JoinInviteStageContent
          awaitingInviteSessionResolution={awaitingInviteSessionResolution}
          billingPlanCode={billingPlanCode}
          checkoutPending={checkoutPending}
          initialLinkedAccounts={initialLinkedAccounts}
          inviteCode={inviteCode}
          pendingAction={pendingAction}
          shareImportState={shareImportState}
          sharePreview={sharePreview}
          status={status}
          statusRefreshErrorMessage={statusRefreshErrorMessage}
          statusRefreshRetryPending={statusRefreshRetryPending}
          onAcceptShare={handleAcceptShare}
          onCheckout={startCheckout}
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
  resolveJoinInviteShareStateFromAccept,
  resolveJoinInviteShareStateFromStatus,
  shouldAwaitHostedInviteSessionResolution,
} from "./join-invite-state";
