"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { ActionApprovalScreen } from "@/src/components/sensitive-actions/action-approval-screen";
import { Button } from "@/src/components/ui/button";
import type {
  HostedActionApprovalDecisionResponse,
  HostedActionApprovalView,
} from "@/src/lib/action-approvals-shared";
import type { SensitiveActionChallengeResponse } from "@/src/lib/sensitive-actions/shared";

import { useSensitiveActionAuthorization } from "./use-sensitive-action-authorization";

type Submission = "approving" | "denying" | "returning" | null;

const APPROVAL_CAVEAT =
  "Murph must ask again if the file, destination, or any other detail changes.";

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

    if (typeof response.redirectTo !== "string" || response.redirectTo.length === 0) {
      throw new Error("The approval was saved. Return to your Murph thread to continue.");
    }

    setRedirectTo(response.redirectTo);
    setSubmission("returning");
    window.location.assign(response.redirectTo);
  }

  const busy = submission !== null;
  const primaryLabel = authorization.setup.pendingLabel
    ?? (submission === "approving" ? "Verifying approval…" : "Approve with passkey");
  const surfacedError = error ?? authorization.setup.error;

  return (
    <ActionApprovalScreen
      badgeIcon={ShieldCheck}
      body={<p className="break-words">{approval.presentation.body}</p>}
      caveat={APPROVAL_CAVEAT}
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={approve}
            size="lg"
            type="button"
          >
            {primaryLabel}
          </Button>
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

        {submission === "returning" && redirectTo ? (
          <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Redirecting…{" "}
            <a className="text-[#5a6e32] underline-offset-4 hover:underline" href={redirectTo}>
              Return to Murph
            </a>
          </p>
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
