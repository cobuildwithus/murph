"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { AlertCircleIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { cn } from "@/src/lib/utils";

function resolveJoinInviteEyebrow(
  stage: HostedInviteStatusPayload["stage"],
): { label: string; tone: "default" | "danger" } {
  switch (stage) {
    case "invalid":
      return { label: "Invite not valid", tone: "danger" };
    case "expired":
      return { label: "Invite expired", tone: "danger" };
    case "blocked":
      return { label: "Account blocked", tone: "danger" };
    default:
      return { label: "Murph signup", tone: "default" };
  }
}
import type { HostedSharePreview } from "@/src/lib/hosted-share/service";
import type {
  HostedInviteStatusPayload,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";
import type { PrivyLinkedAccountLike } from "@/src/lib/hosted-onboarding/privy-shared";

import { requestHostedBillingCheckout } from "./client-api";
import {
  fetchHostedInviteStatus,
  useHostedInviteStatusRefresh,
} from "./invite-status-client";
import {
  resolveInviteStatusAfterPrivyCompletion,
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
  authenticated: boolean;
  initialLinkedAccounts: readonly PrivyLinkedAccountLike[];
  initialStatus: HostedInviteStatusPayload;
  inviteCode: string;
  shareCode: string | null;
  sharePreview: HostedSharePreview | null;
  preview?: boolean;
}

export function JoinInviteClient({
  authenticated: _authenticated,
  initialLinkedAccounts,
  initialStatus,
  inviteCode,
  shareCode,
  sharePreview,
  preview = false,
}: JoinInviteClientProps) {
  const [status, setStatus] = useState(initialStatus);
  const [hasCompletedInitialRefresh, setHasCompletedInitialRefresh] = useState(
    initialStatus.stage !== "verify" || !initialStatus.session.authenticated,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"checkout" | "share" | null>(null);
  const [statusRefreshErrorMessage, setStatusRefreshErrorMessage] = useState<string | null>(null);
  const [statusRefreshRetryPending, setStatusRefreshRetryPending] = useState(false);
  const [autoCheckoutArmed, setAutoCheckoutArmed] = useState(false);

  const awaitingInviteSessionResolution = shouldAwaitHostedInviteSessionResolution({
    hasCompletedInitialRefresh,
    status,
  });
  const checkoutPending = autoCheckoutArmed || pendingAction === "checkout";
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
      if (!payload.session.authenticated || payload.stage !== "verify") {
        setHasCompletedInitialRefresh(true);
      }
    },
    shouldPoll: status.stage === "verify" || status.stage === "checkout" || status.activationPending,
    disabled: preview,
  });

  async function refreshStatus(): Promise<HostedInviteStatusPayload> {
    const payload = await fetchHostedInviteStatus(inviteCode);
    applyRefreshedStatus(payload);
    setStatusRefreshErrorMessage(null);
    if (!payload.session.authenticated || payload.stage !== "verify") {
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
    setAutoCheckoutArmed(false);
    setErrorMessage(null);
    setPendingAction("checkout");

    try {
      const payload = await requestHostedBillingCheckout({
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

  const startAutoCheckout = useEffectEvent(() => {
    void startCheckout();
  });

  useEffect(() => {
    if (
      !autoCheckoutArmed
      || !status.capabilities.billingReady
      || status.messagingSetupRequired
      || pendingAction !== null
    ) {
      return;
    }

    startAutoCheckout();
  }, [autoCheckoutArmed, pendingAction, startAutoCheckout, status.capabilities.billingReady, status.messagingSetupRequired]);

  async function handlePhoneVerified(payload: HostedPrivyCompletionPayload) {
    const nextStatus = resolveInviteStatusAfterPrivyCompletion(status, payload);
    setStatus(nextStatus);
    setAutoCheckoutArmed(
      nextStatus.capabilities.billingReady
      && payload.stage === "checkout"
      && !payload.messagingSetupRequired,
    );
  }

  const eyebrow = resolveJoinInviteEyebrow(status.stage);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div
          className={cn(
            "flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em]",
            eyebrow.tone === "danger" ? "text-destructive" : "text-olive/80",
          )}
        >
          {eyebrow.tone === "danger" ? (
            <AlertCircleIcon className="size-3.5" />
          ) : (
            <span className="size-1 rounded-full bg-olive/70" />
          )}
          <span>{eyebrow.label}</span>
        </div>
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
          authenticated={status.session.authenticated}
          awaitingInviteSessionResolution={awaitingInviteSessionResolution}
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
  resolveInviteStatusAfterPrivyCompletion,
  resolveJoinInviteStatusFromRefresh,
  resolveJoinInviteShareStateFromAccept,
  resolveJoinInviteShareStateFromStatus,
  shouldAwaitHostedInviteSessionResolution,
} from "./join-invite-state";
