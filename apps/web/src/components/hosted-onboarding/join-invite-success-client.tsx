"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AlertCircleIcon, CheckCircleIcon, LoaderCircleIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

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
  const shouldPoll = status.stage === "verify" || status.stage === "checkout" || status.activationPending;

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
      status.stage !== "checkout"
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
  }, [inviteCode, sessionId, status.session.matchesInvite, status.stage]);

  const href = `/join/${encodeURIComponent(inviteCode)}${shareCode ? `?share=${encodeURIComponent(shareCode)}` : ""}`;
  const successState = resolveHostedInviteSuccessState(status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-olive/80">
          {successState.variant === "active" ? (
            <CheckCircleIcon className="size-4" />
          ) : successState.variant === "pending" ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <AlertCircleIcon className="size-4" />
          )}
          <span>
            {successState.variant === "active"
              ? "Ready"
              : successState.variant === "pending"
              ? "Working on it"
              : "Something went wrong"}
          </span>
        </div>
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

      <Button render={<Link href={href} />} nativeButton={false} size="lg" className="w-fit">
        {successState.buttonLabel}
      </Button>
    </div>
  );
}

function resolveHostedInviteSuccessState(status: HostedInviteStatusPayload): HostedInviteSuccessState {
  switch (status.stage) {
    case "active":
      return {
        buttonLabel: "Continue",
        description: status.activationPending
          ? JOIN_INVITE_ACTIVATION_PENDING_COPY.successDescription
          : "Murph finished setting things up. Head back to your invite page to continue.",
        pending: false,
        title: "Your account is ready",
        variant: "active",
      };
    case "verify":
      return {
        buttonLabel: "Back to invite",
        description: "We’re finishing sign-in and checking your setup status now.",
        pending: true,
        title: "Finishing sign-in",
        variant: "pending",
      };
    case "checkout":
      return {
        buttonLabel: "Back to invite",
        description: "We’re confirming your subscription and setting up your encrypted vault and assistant now.",
        pending: true,
        title: "Payment received",
        variant: "pending",
      };
    case "expired":
      return {
        buttonLabel: "Back to invite",
        description: "This invite link expired. Return to the original invite message for a fresh link.",
        pending: false,
        title: "Invite expired",
        variant: "terminal",
      };
    case "invalid":
      return {
        buttonLabel: "Back to invite",
        description: "This invite link is no longer valid. Return to the original invite message for a fresh link.",
        pending: false,
        title: "Invite not found",
        variant: "terminal",
      };
    case "blocked":
      return {
        buttonLabel: "Back to invite",
        description: "We couldn’t finish setup automatically. Head back to your invite page for the latest status.",
        pending: false,
        title: "Unable to continue",
        variant: "terminal",
      };
  }
}
