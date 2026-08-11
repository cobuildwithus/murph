"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import {
  ActionApprovalDecisionFallback,
  ActionApprovalScreen,
} from "@/src/components/sensitive-actions/action-approval-screen";
import { AuthButton } from "@/src/components/ui/auth-button";
import { Button } from "@/src/components/ui/button";
import type {
  HostedActionApprovalDecisionResponse,
  HostedActionApprovalView,
} from "@/src/lib/action-approvals-shared";
import type { SensitiveActionChallengeResponse } from "@/src/lib/sensitive-actions/shared";

import { useSensitiveActionAuthorization } from "./use-sensitive-action-authorization";

type Submission =
  | "approving"
  | "denying"
  | "returning-approved"
  | "returning-denied"
  | null;

export function ActionApprovalCard({
  approval,
}: {
  approval: HostedActionApprovalView;
}) {
  const authorization = useSensitiveActionAuthorization();
  const [submission, setSubmission] = useState<Submission>(null);
  const [error, setError] = useState<string | null>(null);
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  const endpointBase = `/api/action-approvals/${encodeURIComponent(approval.approvalId)}`;

  async function approve() {
    setError(null);
    setSubmission("approving");
    try {
      const challenge = await requestHostedOnboardingJson<SensitiveActionChallengeResponse>({
        method: "POST",
        url: `${endpointBase}/challenge`,
      });
      const signed = await authorization.signChallenge(challenge);
      await submitDecision({
        authorization: signed,
        decision: "approved",
      });
    } catch (caught) {
      setError(readErrorMessage(caught));
      setSubmission(null);
    }
  }

  async function deny() {
    setError(null);
    setSubmission("denying");
    try {
      await submitDecision({ decision: "denied" });
    } catch (caught) {
      setError(readErrorMessage(caught));
      setSubmission(null);
    }
  }

  async function submitDecision(payload: Record<string, unknown>) {
    const response = await requestHostedOnboardingJson<HostedActionApprovalDecisionResponse>({
      method: "POST",
      payload,
      url: `${endpointBase}/decision`,
    });

    const nextRedirectTo =
      typeof response.redirectTo === "string" && response.redirectTo.length > 0
        ? response.redirectTo
        : null;
    const returningSubmission = response.status === "approved"
      ? "returning-approved"
      : response.status === "denied"
        ? "returning-denied"
        : null;
    if (!returningSubmission) {
      throw new Error("Secure approval returned an unsupported decision.");
    }
    setRedirectTo(nextRedirectTo);
    setSubmission(returningSubmission);
    if (nextRedirectTo) {
      window.location.assign(nextRedirectTo);
    }
  }

  const busy = submission !== null;
  const clientAuthenticationRequired =
    authorization.setup.ready && !authorization.setup.clientAuthenticated;
  const primaryLabel = clientAuthenticationRequired
    ? "Sign in to approve"
    : authorization.setup.pendingLabel
    ?? (submission === "approving" ? "Verifying approval…" : "Approve with passkey");
  const returningDecision = submission === "returning-approved"
    ? "approved"
    : submission === "returning-denied"
      ? "denied"
      : null;
  const busyStatus = authorization.setup.pendingLabel
    ?? (submission === "approving"
      ? "Verifying approval…"
      : submission === "denying"
        ? "Denying…"
        : returningDecision === "approved"
          ? redirectTo
            ? "Approval recorded. Returning to Murph…"
            : "Approval recorded."
          : returningDecision === "denied"
            ? redirectTo
              ? "Denied. Returning to Murph…"
              : "Denied."
          : null);
  const surfacedError = error ?? authorization.setup.error;

  return (
    <ActionApprovalScreen
      badgeIcon={ShieldCheck}
      body={<p className="break-words">{approval.presentation.body}</p>}
      title={approval.presentation.title}
    >
      {surfacedError ? (
        <p
          className="mt-6 rounded-lg border border-[#8b5d3f]/30 bg-[#8b5d3f]/[0.06] px-4 py-3 text-[13px] leading-[1.5] text-[#8b5d3f]"
          role="alert"
        >
          {surfacedError}
        </p>
      ) : null}

      <div className="mt-7 border-t border-[#c4a882]/25 pt-6">
        <div
          aria-busy={busy}
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <AuthButton
            authSatisfied={!clientAuthenticationRequired}
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={approve}
            size="lg"
            type="button"
          >
            {primaryLabel}
          </AuthButton>
          <Button
            className="w-full sm:w-auto sm:px-5"
            disabled={busy}
            onClick={deny}
            size="lg"
            type="button"
            variant="ghost"
          >
            {submission === "denying" ? "Denying…" : "Deny"}
          </Button>
        </div>

        {busyStatus ? (
          <p aria-live="polite" className="sr-only" role="status">
            {busyStatus}
          </p>
        ) : null}

        {returningDecision ? (
          redirectTo ? (
            <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Redirecting…{" "}
              <a className="text-[#5a6e32] underline-offset-4 hover:underline" href={redirectTo}>
                Return to Murph
              </a>
            </p>
          ) : (
            <ActionApprovalDecisionFallback decision={returningDecision} />
          )
        ) : null}
      </div>
    </ActionApprovalScreen>
  );
}

function readErrorMessage(value: unknown): string {
  return value instanceof Error
    ? value.message
    : "Secure approval could not be completed. Try again.";
}
