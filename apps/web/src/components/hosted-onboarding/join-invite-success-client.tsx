"use client";

import { useEffect, useRef, useState } from "react";

import { CheckCircleIcon, LoaderCircleIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { JoinInviteEyebrow } from "./join-invite-eyebrow";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import { isHostedOnboardingPendingStage } from "@/src/lib/hosted-onboarding/stage";

import { JOIN_INVITE_ACTIVATION_PENDING_COPY } from "./join-invite-copy";
import { requestHostedBillingSuccess } from "./client-api";
import { useHostedInviteStatusRefresh } from "./invite-status-client";

interface JoinInviteSuccessClientProps {
  initialStatus: HostedInviteStatusPayload;
  inviteCode: string;
  sessionId: string | null;
  shareCode: string | null;
  preview?: boolean;
}

interface HostedInviteSuccessState {
  buttonLabel: string;
  description: string;
  pending: boolean;
  title: string;
  variant: "active" | "pending" | "terminal";
}

export function JoinInviteSuccessClient({
  initialStatus,
  inviteCode,
  sessionId,
  shareCode,
  preview = false,
}: JoinInviteSuccessClientProps) {
  const [status, setStatus] = useState(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const successSyncStartedRef = useRef(false);
  const shouldPoll = isHostedOnboardingPendingStage(status.stage);

  useHostedInviteStatusRefresh({
    inviteCode,
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to refresh setup status.");
    },
    onStatus: (payload) => {
      setErrorMessage(null);
      setStatus(payload);
    },
    shouldPoll,
    disabled: preview,
  });

  useEffect(() => {
    if (
      preview ||
      successSyncStartedRef.current ||
      !sessionId ||
      !status.session.matchesInvite ||
      !shouldRequestHostedBillingSuccess(status.stage)
    ) {
      return;
    }

    let cancelled = false;
    successSyncStartedRef.current = true;

    void requestHostedBillingSuccess({
      inviteCode,
      sessionId,
    })
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setErrorMessage(null);
        setStatus(payload);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "Unable to refresh setup status.");
      });

    return () => {
      cancelled = true;
    };
  }, [inviteCode, preview, sessionId, status.session.matchesInvite, status.stage]);

  const href = `/join/${encodeURIComponent(inviteCode)}${shareCode ? `?share=${encodeURIComponent(shareCode)}` : ""}`;
  const successState = resolveHostedInviteSuccessState(status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {successState.variant === "terminal" ? (
          <JoinInviteEyebrow label="Something went wrong" tone="danger" />
        ) : (
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-olive/80">
            {successState.variant === "active" ? (
              <CheckCircleIcon className="size-4" />
            ) : (
              <LoaderCircleIcon className="size-4 animate-spin" />
            )}
            <span>{successState.variant === "active" ? "Ready" : "Working on it"}</span>
          </div>
        )}
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#2d3436] md:text-4xl">
          {successState.title}
        </h1>
        <p className="leading-relaxed text-muted-foreground">{successState.description}</p>
      </div>

      {successState.pending ? (
        <div className="rounded-xl border border-olive/20 bg-olive/5 px-5 py-4 text-sm leading-relaxed text-olive">
          We&apos;ll keep checking automatically and your invite page will switch over as soon as setup finishes.
        </div>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to refresh status</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="button" onClick={() => window.location.assign(href)} size="lg" className="w-fit">
        {successState.buttonLabel}
      </Button>
    </div>
  );
}

function shouldRequestHostedBillingSuccess(stage: HostedInviteStatusPayload["stage"]): boolean {
  return stage === "checkout" || stage === "activating" || stage === "active";
}

function resolveHostedInviteSuccessState(status: HostedInviteStatusPayload): HostedInviteSuccessState {
  switch (status.stage) {
    case "active":
      return {
        buttonLabel: "Continue",
        description: "Head back to your invite to start.",
        pending: false,
        title: "You’re all set",
        variant: "active",
      };
    case "activating":
      return {
        buttonLabel: "Back to invite",
        description: JOIN_INVITE_ACTIVATION_PENDING_COPY.successDescription,
        pending: true,
        title: "Finishing your setup",
        variant: "pending",
      };
    case "verify":
      return {
        buttonLabel: "Back to invite",
        description: "Checking your signup status.",
        pending: true,
        title: "Finishing sign-in",
        variant: "pending",
      };
    case "checkout":
      return {
        buttonLabel: "Back to invite",
        description: "Setting up your vault and assistant. This takes about a minute.",
        pending: true,
        title: "Payment received",
        variant: "pending",
      };
    case "expired":
      return {
        buttonLabel: "Back to invite",
        description: "Text Murph again for a fresh link.",
        pending: false,
        title: "Invite expired",
        variant: "terminal",
      };
    case "invalid":
      return {
        buttonLabel: "Back to invite",
        description: "Text Murph again for a fresh link.",
        pending: false,
        title: "Invite not found",
        variant: "terminal",
      };
    case "blocked":
      return {
        buttonLabel: "Back to invite",
        description: "Head back to your invite for next steps.",
        pending: false,
        title: "Account blocked",
        variant: "terminal",
      };
  }
}
