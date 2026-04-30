"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import type { HostedBillingPlanCode } from "@/src/lib/hosted-onboarding/billing-plans";
import type {
  HostedInviteStatusPayload,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";
import type { PrivyLinkedAccountLike } from "@/src/lib/hosted-onboarding/privy-shared";
import { isHostedOnboardingPendingStage } from "@/src/lib/hosted-onboarding/stage";

import { JoinInviteEyebrow, type JoinInviteEyebrowTone } from "./join-invite-eyebrow";
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

const JOIN_INVITE_STEPS = [
  { step: 1, label: "Invite" },
  { step: 2, label: "Contact" },
  { step: 3, label: "Plan" },
];

function JoinInviteStepIndicator({ activeStep }: { activeStep: number }) {
  return (
    <div className="flex items-center gap-2">
      {JOIN_INVITE_STEPS.map((item, i) => {
        const completed = item.step < activeStep;
        const active = item.step === activeStep;

        return (
          <div key={item.step} className="flex items-center gap-2">
            {i > 0 ? (
              <div
                className={`h-px w-6 ${completed || active ? "bg-olive/40" : "bg-border"}`}
              />
            ) : null}
            <span
              className={[
                "flex size-7 items-center justify-center rounded-full text-xs font-medium",
                completed
                  ? "bg-olive text-white"
                  : active
                    ? "bg-olive/15 text-olive ring-1 ring-olive/30"
                    : "bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {completed ? (
                <CheckIcon className="size-3.5" strokeWidth={2.5} />
              ) : (
                item.step
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function resolveJoinInviteEyebrow(
  stage: HostedInviteStatusPayload["stage"],
): { label: string; tone: JoinInviteEyebrowTone } {
  switch (stage) {
    case "invalid":
    case "expired":
      return { label: "Link no longer works", tone: "danger" };
    case "blocked":
      return { label: "Needs support", tone: "danger" };
    case "verify":
      return { label: "Chat with Murph", tone: "default" };
    default:
      return { label: "Murph", tone: "default" };
  }
}

function shouldGatePostPhoneVerificationWithLaunchConsent(
  payload: HostedPrivyCompletionPayload,
): boolean {
  if (!payload.status.session.authenticated || !payload.status.session.matchesInvite) {
    return false;
  }

  return (
    payload.status.stage === "checkout"
    || payload.status.stage === "activating"
    || payload.status.stage === "active"
  );
}

function shouldGateJoinInviteStatusWithLaunchConsent(
  status: HostedInviteStatusPayload,
): boolean {
  if (!status.session.authenticated || !status.session.matchesInvite) {
    return false;
  }

  return (
    status.stage === "checkout"
    || status.stage === "activating"
    || status.stage === "active"
  );
}

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
  const [pendingLegalConsentCompletion, setPendingLegalConsentCompletionState] =
    useState<HostedPrivyCompletionPayload | null>(null);
  const [launchLegalConsentSatisfied, setLaunchLegalConsentSatisfied] = useState(false);
  const pendingLegalConsentCompletionRef = useRef<HostedPrivyCompletionPayload | null>(null);
  const checkoutOutcomeRef = useRef<
    | { kind: "redirect"; url: string }
    | { kind: "alreadyActive" }
    | null
  >(null);

  const awaitingInviteSessionResolution = shouldAwaitHostedInviteSessionResolution({
    hasCompletedInitialRefresh,
    status,
  });
  const launchLegalConsentGateActive =
    pendingLegalConsentCompletion !== null
    || (
      shouldGateJoinInviteStatusWithLaunchConsent(status)
      && !launchLegalConsentSatisfied
    );

  function applyRefreshedStatus(payload: HostedInviteStatusPayload) {
    setStatus((currentStatus) => resolveJoinInviteStatusFromRefresh({
      nextStatus: payload,
      status: currentStatus,
    }));
  }

  function setPendingLegalConsentCompletion(
    payload: HostedPrivyCompletionPayload | null,
  ) {
    pendingLegalConsentCompletionRef.current = payload;
    setPendingLegalConsentCompletionState(payload);
  }

  function applyPhoneVerifiedStatus(payload: HostedPrivyCompletionPayload) {
    applyRefreshedStatus(payload.status);
    if (hasResolvedHostedInviteVerification(payload.status)) {
      setHasCompletedInitialRefresh(true);
    }
  }

  useEffect(() => {
    if (!shouldGateJoinInviteStatusWithLaunchConsent(status)) {
      setLaunchLegalConsentSatisfied(false);
    }
  }, [status]);

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
      if (pendingLegalConsentCompletionRef.current) {
        return;
      }
      applyRefreshedStatus(payload);
      setStatusRefreshErrorMessage(null);
      if (hasResolvedHostedInviteVerification(payload)) {
        setHasCompletedInitialRefresh(true);
      }
    },
    shouldPoll: isHostedOnboardingPendingStage(status.stage) && !launchLegalConsentGateActive,
    disabled: preview || launchLegalConsentGateActive,
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

  async function startCheckout(selectedBillingPlanCode?: HostedBillingPlanCode | null) {
    setErrorMessage(null);
    checkoutOutcomeRef.current = null;
    const payload = await requestHostedBillingCheckout({
      billingPlanCode: selectedBillingPlanCode ?? billingPlanCode,
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
    if (shouldGatePostPhoneVerificationWithLaunchConsent(payload)) {
      if (payload.status.stage === "checkout") {
        applyPhoneVerifiedStatus(payload);
        return;
      }
      setPendingLegalConsentCompletion(payload);
      setStatusRefreshErrorMessage(null);
      setHasCompletedInitialRefresh(true);
      return;
    }

    applyPhoneVerifiedStatus(payload);
  }

  async function handlePostPhoneVerificationLegalConsentSatisfied() {
    const payload = pendingLegalConsentCompletionRef.current;
    setLaunchLegalConsentSatisfied(true);

    if (!payload) return;

    setPendingLegalConsentCompletion(null);
    applyPhoneVerifiedStatus(payload);
  }

  const consentGateOverridesChrome =
    launchLegalConsentGateActive && status.stage !== "checkout";
  const eyebrow = consentGateOverridesChrome
    ? { label: "Murph", tone: "default" as const }
    : resolveJoinInviteEyebrow(status.stage);
  const title = consentGateOverridesChrome
    ? "One quick step"
    : resolveJoinInviteTitle(status);
  const subtitle = consentGateOverridesChrome
    ? "Review and accept the legal agreements below to get started."
    : resolveJoinInviteSubtitle(status);

  const showStepIndicator = !launchLegalConsentGateActive && status.stage === "verify";

  return (
    <div
      className={[
        "flex w-full flex-col gap-6",
        status.stage === "checkout" ? "max-w-5xl" : "max-w-xl",
      ].join(" ")}
    >
      <div>
        <JoinInviteEyebrow label={eyebrow.label} tone={eyebrow.tone} />
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {subtitle}
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
          initialLinkedAccounts={initialLinkedAccounts}
          inviteCode={inviteCode}
          launchLegalConsentGateActive={launchLegalConsentGateActive}
          launchLegalConsentSatisfied={launchLegalConsentSatisfied}
          status={status}
          statusRefreshErrorMessage={statusRefreshErrorMessage}
          statusRefreshRetryPending={statusRefreshRetryPending}
          onCheckout={startCheckout}
          onCheckoutSuccess={handleCheckoutSuccess}
          onCheckoutError={handleCheckoutError}
          onLaunchLegalConsentSatisfied={handlePostPhoneVerificationLegalConsentSatisfied}
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
