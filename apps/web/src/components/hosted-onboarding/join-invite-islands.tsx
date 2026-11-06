"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HostedLoginMethodEditor } from "../settings/hosted-login-method-dialog";
import { HostedContactChannelChoice } from "./hosted-contact-channel-choice";

import {
  LINK_PAGE_NIGHT_TOKENS,
  LinkPageError,
  LinkPageLink,
  LinkPagePill,
  LinkPageScreen,
  LinkPageTicket,
} from "@/src/components/link-page/link-page-shell";
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
import {
  HostedFirstPartyAuthPanel,
  type HostedFirstPartyAuthPanelView,
} from "./hosted-first-party-auth-panel";
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
    <div className="flex shrink-0 flex-col items-center pt-3">
      <LinkPageError>Unable to refresh invite status. {refreshErrorMessage}</LinkPageError>
      <LinkPageLink
        onClick={() => {
          setRefreshErrorMessage(null);
          router.refresh();
        }}
      >
        Try again
      </LinkPageLink>
    </div>
  );
}

export function JoinInvitePhoneVerificationIsland({
  detail,
  emailAuthTarget,
  inviteCode,
  phoneAuthTarget,
  phoneHint,
  title,
  verificationMode,
}: {
  detail: string;
  emailAuthTarget?: HostedInviteEmailAuthTarget | null;
  inviteCode: string;
  phoneAuthTarget?: HostedInvitePhoneAuthTarget | null;
  phoneHint?: string | null;
  title: string;
  verificationMode: HostedInviteVerificationMode;
}) {
  const router = useRouter();
  const [view, setView] = useState<HostedFirstPartyAuthPanelView>("auth");
  const savedPhoneHint = phoneAuthTarget?.kind === "saved" ? phoneAuthTarget.phoneHint : phoneHint;
  return <LinkPageScreen
    actions={<div className="flex w-full flex-col gap-4" style={LINK_PAGE_NIGHT_TOKENS}>
      {verificationMode === "invite_phone" && savedPhoneHint && view === "auth" ? <p className="text-sm text-muted-foreground">
        Use the number ending in {savedPhoneHint.replace(/\D/gu, "").slice(-4)}.
      </p> : null}
      <HostedFirstPartyAuthPanel
        inviteCode={inviteCode}
        initialEmailAddress={emailAuthTarget?.kind === "saved" ? emailAuthTarget.emailAddress : undefined}
        methods={verificationMode === "manual_phone" ? ["phone", "email", "telegram"] : verificationMode === "invite_email" ? ["email"] : ["phone"]}
        onCompleted={() => router.refresh()}
        onSignOut={() => router.refresh()}
        onViewChange={setView}
        requireLaunchConsentOnCompletion
        size="compact"
      />
    </div>}
    announceDetail={false}
    detail={view === "auth" ? detail : undefined}
    title={view === "consent" ? "One quick step." : title}
  >
    {view === "auth" ? <LinkPageTicket kicker="Your invite" title="Meet Murph" /> : null}
  </LinkPageScreen>;
}

export function JoinInviteSignOutButtonIsland({
  appearance,
  idleLabel = "Use this invite instead",
  pendingLabel = "Signing out...",
}: {
  /** The night control on a link page; other pages keep the outline button. */
  appearance?: "link" | "pill";
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

  const label = signOutPending ? pendingLabel : idleLabel;

  if (appearance) {
    const LinkPageControl = appearance === "pill" ? LinkPagePill : LinkPageLink;
    return (
      <LinkPageControl disabled={signOutPending} onClick={handleSignOut}>
        {label}
      </LinkPageControl>
    );
  }

  return (
    <Button
      type="button"
      onClick={handleSignOut}
      disabled={signOutPending}
      variant="outline"
      size="lg"
    >
      {label}
    </Button>
  );
}

export function JoinInviteMessagingSetupIsland() {
  const [phoneActive, setPhoneActive] = useState(false);
  return <HostedContactChannelChoice
    phone={<HostedLoginMethodEditor method="phone" operation="set" presentation="inline" onOpenChange={() => {}} onActiveChange={setPhoneActive} />}
    telegram={phoneActive ? null : <HostedLoginMethodEditor method="telegram" operation="set" presentation="inline" onOpenChange={() => {}} />}
  />;
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
    <div className="w-full" style={LINK_PAGE_NIGHT_TOKENS}>
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
    </div>
  );
}

export function JoinInviteRefreshButtonIsland({
  label = "Try again",
}: {
  label?: string;
}) {
  const router = useRouter();

  return <LinkPagePill onClick={() => router.refresh()}>{label}</LinkPagePill>;
}

export function JoinInviteCheckoutPlanButtonIsland({
  billingReady,
  className,
  disabledLabel,
  idleLabel,
  inviteCode,
  onBusyChange,
  planCode,
}: {
  billingReady: boolean;
  className?: string;
  disabledLabel?: string;
  idleLabel: string;
  inviteCode: string;
  onBusyChange?: (busy: boolean) => void;
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

    onBusyChange?.(true);
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
    onBusyChange?.(false);
  }

  return (
    <div className="flex w-full flex-col">
      {errorMessage ? (
        <LinkPageError>Unable to continue. {errorMessage}</LinkPageError>
      ) : null}
      <PaymentButton
        onClick={startCheckout}
        onSuccess={handleCheckoutSuccess}
        onError={handleCheckoutError}
        disabled={!billingReady || !planCode}
        size="unstyled"
        variant="unstyled"
        className={className}
        idleLabel={billingReady && planCode ? idleLabel : disabledLabel ?? idleLabel}
      />
    </div>
  );
}
