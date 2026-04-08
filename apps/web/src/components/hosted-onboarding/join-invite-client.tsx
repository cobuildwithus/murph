"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";

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
  resolveHostedInviteStatusAuthMode,
  useHostedInviteStatusRefresh,
} from "./invite-status-client";
import {
  resolveInviteStatusAfterPrivyCompletion,
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
  const { authenticated, logout, ready } = usePrivy();
  const [status, setStatus] = useState(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"checkout" | "logout" | "share" | null>(null);
  const [statusRefreshErrorMessage, setStatusRefreshErrorMessage] = useState<string | null>(null);
  const [statusRefreshRetryPending, setStatusRefreshRetryPending] = useState(false);

  const awaitingInviteSessionResolution = shouldAwaitHostedInviteSessionResolution({
    authenticated,
    ready,
    status,
  });
  const { handleAcceptShare, shareImportState } = useJoinInviteShareImport({
    inviteCode,
    onErrorMessage: setErrorMessage,
    onPendingAction: setPendingAction,
    shareCode,
    statusStage: status.stage,
  });

  useHostedInviteStatusRefresh({
    authenticated,
    inviteCode,
    onError: (error: unknown) => {
      setStatusRefreshErrorMessage(
        error instanceof Error ? error.message : "We could not refresh your signup state.",
      );
    },
    onStatus: (payload) => {
      setStatus(payload);
      setStatusRefreshErrorMessage(null);
    },
    ready,
    sessionAuthenticated: status.session.authenticated,
    shouldPoll: status.stage === "activating",
  });

  async function refreshStatus(): Promise<HostedInviteStatusPayload> {
    const payload = await fetchHostedInviteStatus(
      inviteCode,
      resolveHostedInviteStatusAuthMode(authenticated),
    );
    setStatus(payload);
    setStatusRefreshErrorMessage(null);
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

  async function handleCheckout() {
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

  async function handleSignOut() {
    setErrorMessage(null);
    setPendingAction("logout");

    try {
      if (authenticated) {
        await logout();
      }
      await refreshStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      throw error;
    } finally {
      setPendingAction(null);
    }
  }

  async function handlePhoneVerified(payload: HostedPrivyCompletionPayload) {
    const nextStatus = resolveInviteStatusAfterPrivyCompletion(status, payload);
    setStatus(nextStatus);

    if (payload.stage === "checkout" && nextStatus.capabilities.billingReady) {
      await handleCheckout();
    }
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
            inviteCode={inviteCode}
            pendingAction={pendingAction}
            shareImportState={shareImportState}
            sharePreview={sharePreview}
            status={status}
            statusRefreshErrorMessage={statusRefreshErrorMessage}
            statusRefreshRetryPending={statusRefreshRetryPending}
            onAcceptShare={handleAcceptShare}
            onCheckout={handleCheckout}
            onPhoneVerified={handlePhoneVerified}
            onRefreshStatus={refreshStatus}
            onRetryStatusRefresh={handleRetryStatusRefresh}
            onSignOut={handleSignOut}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export {
  resolveInviteStatusAfterPrivyCompletion,
  resolveJoinInviteShareStateFromAccept,
  resolveJoinInviteShareStateFromStatus,
  shouldAwaitHostedInviteSessionResolution,
} from "./join-invite-state";
