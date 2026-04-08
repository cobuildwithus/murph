"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useState } from "react";

import { AlertCircleIcon, CheckCircleIcon, LoaderCircleIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

import { useHostedInviteStatusRefresh } from "./invite-status-client";

interface JoinInviteSuccessClientProps {
  initialStatus: HostedInviteStatusPayload;
  inviteCode: string;
  shareCode: string | null;
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
  shareCode,
}: JoinInviteSuccessClientProps) {
  const { authenticated, ready } = usePrivy();
  const [status, setStatus] = useState(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useHostedInviteStatusRefresh({
    authenticated,
    inviteCode,
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to refresh activation status.");
    },
    onStatus: (payload) => {
      setErrorMessage(null);
      setStatus(payload);
    },
    ready,
    sessionAuthenticated: status.session.authenticated,
    shouldPoll: status.stage === "verify" || status.stage === "checkout" || status.stage === "activating",
  });

  const href = `/join/${encodeURIComponent(inviteCode)}${shareCode ? `?share=${encodeURIComponent(shareCode)}` : ""}`;
  const successState = resolveHostedInviteSuccessState(status);

  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <Card className="w-full max-w-xl shadow-sm">
        <CardHeader className="gap-5">
          <div className="flex h-12 w-12 items-center justify-center rounded bg-olive/10">
            {successState.variant === "active" ? (
              <CheckCircleIcon className="h-6 w-6 text-olive" />
            ) : successState.variant === "pending" ? (
              <LoaderCircleIcon className="h-6 w-6 animate-spin text-olive" />
            ) : (
              <AlertCircleIcon className="h-6 w-6 text-olive" />
            )}
          </div>
          <div className="space-y-5">
            <CardTitle className="text-4xl font-bold tracking-tight text-stone-900 md:text-5xl">
              {successState.title}
            </CardTitle>
            <CardDescription className="leading-relaxed text-stone-500">{successState.description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
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

          <Button render={<Link href={href} />} nativeButton={false} size="lg">
            {successState.buttonLabel}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function resolveHostedInviteSuccessState(status: HostedInviteStatusPayload): HostedInviteSuccessState {
  switch (status.stage) {
    case "active":
      return {
        buttonLabel: "Continue",
        description: "Murph finished your hosted activation. Head back to your invite page to continue.",
        pending: false,
        title: "Your account is ready",
        variant: "active",
      };
    case "verify":
      return {
        buttonLabel: "Back to invite",
        description: "We’re finishing sign-in and checking your hosted activation status now.",
        pending: true,
        title: "Finishing sign-in",
        variant: "pending",
      };
    case "checkout":
    case "activating":
      return {
        buttonLabel: "Back to invite",
        description:
          "We’re confirming your subscription and finishing hosted activation now. This usually takes under a minute.",
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
        description: "We couldn’t finish activation automatically. Head back to your invite page for the latest status.",
        pending: false,
        title: "Unable to continue",
        variant: "terminal",
      };
  }
}
