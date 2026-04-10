"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HostedSharePreview } from "@/src/lib/hosted-share/service";
import type {
  HostedInviteStatusPayload,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";

import { requestHostedOnboardingJson } from "./client-api";
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
  initialStatus: HostedInviteStatusPayload;
  inviteCode: string;
  shareCode: string | null;
  sharePreview: HostedSharePreview | null;
}

export function JoinInviteClient({
  initialStatus,
  inviteCode,
  shareCode,
  sharePreview,
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
    shouldPoll: status.stage === "verify" || status.stage === "checkout" || status.stage === "activating",
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
      const payload = await requestHostedOnboardingJson<{ alreadyActive: boolean; url: string | null }>({
        payload: {
          inviteCode,
          shareCode,
        },
        url: "/api/hosted-onboarding/billing/checkout",
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
    if (!autoCheckoutArmed || !status.capabilities.billingReady || pendingAction !== null) {
      return;
    }

    startAutoCheckout();
  }, [autoCheckoutArmed, pendingAction, status.capabilities.billingReady]);

  async function handlePhoneVerified(payload: HostedPrivyCompletionPayload) {
    const nextStatus = resolveInviteStatusAfterPrivyCompletion(status, payload);
    setStatus(nextStatus);
    setAutoCheckoutArmed(nextStatus.capabilities.billingReady && payload.stage === "checkout");
  }

  return (
    <div className="space-y-5">
      <Card className="shadow-sm">
        <CardHeader className="gap-3">
          <Badge variant="secondary" className="w-fit">
            Text signup
          </Badge>
          <div className="space-y-3">
            <CardTitle className="text-4xl font-bold tracking-tight text-stone-900 md:text-5xl">
              {resolveJoinInviteTitle(status)}
            </CardTitle>
            <CardDescription className="max-w-lg text-lg leading-relaxed text-stone-500">
              {resolveJoinInviteSubtitle(status)}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
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
            checkoutPending={checkoutPending}
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
        </CardContent>
      </Card>
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
