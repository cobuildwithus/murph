"use client";

import { useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import {
  ActionApprovalDecisionMessage,
  ActionApprovalPresentationBody,
  ActionApprovalRequestScreen,
} from "@/src/components/sensitive-actions/action-approval-screen";
import { AuthButton } from "@/src/components/ui/auth-button";
import { Button } from "@/src/components/ui/button";
import type {
  HostedActionApprovalDecisionResponse,
  HostedActionApprovalView,
} from "@/src/lib/action-approvals-shared";
import type { SensitiveActionChallengeResponse } from "@/src/lib/sensitive-actions/shared";

import { useSensitiveActionAuthorization } from "./use-sensitive-action-authorization";

type Submission = "approving" | "denying" | null;
type TerminalDecision = "approved" | "denied";

export function ActionApprovalCard({
  approval,
}: {
  approval: HostedActionApprovalView;
}) {
  const authorization = useSensitiveActionAuthorization();
  const [submission, setSubmission] = useState<Submission>(null);
  const [terminalDecision, setTerminalDecision] =
    useState<TerminalDecision | null>(null);
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

  async function submitDecision(payload: {
    authorization?: unknown;
    decision: TerminalDecision;
  }) {
    const response = await requestHostedOnboardingJson<HostedActionApprovalDecisionResponse>({
      method: "POST",
      payload,
      url: `${endpointBase}/decision`,
    });
    if (response.status !== payload.decision) {
      throw new Error("Secure approval returned an unexpected decision.");
    }

    const nextRedirectTo =
      typeof response.redirectTo === "string" && response.redirectTo.length > 0
        ? response.redirectTo
        : null;
    setRedirectTo(nextRedirectTo);
    setTerminalDecision(response.status);
    setSubmission(null);
    if (nextRedirectTo) {
      window.location.assign(nextRedirectTo);
    }
  }

  const busy = submission !== null || terminalDecision !== null;
  const clientAuthenticationRequired =
    authorization.setup.ready && !authorization.setup.clientAuthenticated;
  const primaryLabel = clientAuthenticationRequired
    ? "Sign in to approve"
    : authorization.setup.pendingLabel
    ?? (submission === "approving" ? "Verifying approval…" : "Approve with passkey");
  const busyStatus = authorization.setup.pendingLabel
    ?? readBusyStatus({
      continuation: approval.continuation,
      redirectTo,
      submission,
      terminalDecision,
    });
  const surfacedError = error ?? authorization.setup.error;

  return (
    <ActionApprovalRequestScreen
      body={<ActionApprovalPresentationBody body={approval.presentation.body} />}
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

        {terminalDecision !== null ? (
          <div className="mt-5">
            <ActionApprovalDecisionMessage
              continuation={approval.continuation}
              redirectTo={redirectTo}
              status={terminalDecision}
            />
          </div>
        ) : null}
      </div>
    </ActionApprovalRequestScreen>
  );
}

function readBusyStatus(input: {
  continuation: HostedActionApprovalView["continuation"];
  redirectTo: string | null;
  submission: Submission;
  terminalDecision: TerminalDecision | null;
}): string | null {
  if (input.submission === "approving") {
    return "Verifying approval…";
  }
  if (input.submission === "denying") {
    return "Denying…";
  }
  if (input.terminalDecision === "denied") {
    return input.redirectTo
      ? "Request denied. Returning to Murph…"
      : "Request denied. Murph will not continue this action.";
  }
  if (input.terminalDecision !== "approved") {
    return null;
  }
  if (input.continuation === "return-to-conversation") {
    return "Approval saved. Return to Murph and ask to continue.";
  }
  return input.redirectTo
    ? "Approval saved. Returning to Murph…"
    : "Approval saved. Murph can continue this action.";
}

function readErrorMessage(value: unknown): string {
  return value instanceof Error
    ? value.message
    : "Secure approval could not be completed. Try again.";
}
