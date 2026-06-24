"use client";

import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { ActionApprovalScreen } from "@/src/components/sensitive-actions/action-approval-screen";
import { Button, buttonVariants } from "@/src/components/ui/button";
import type {
  HostedActionApprovalDecisionResponse,
  HostedActionApprovalView,
} from "@/src/lib/action-approvals-shared";
import type { SensitiveActionChallengeResponse } from "@/src/lib/sensitive-actions/shared";
import { cn } from "@/src/lib/utils";

import { useSensitiveActionAuthorization } from "./use-sensitive-action-authorization";

type Submission = "approving" | "denying" | "returning" | null;

const APPROVAL_CAVEAT =
  "This approval is bound to this exact request. Murph must ask again if the action changes.";

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
      body={
        <p className="break-words text-sm leading-6 text-muted-foreground text-pretty">
          {approval.presentation.body}
        </p>
      }
      caveat={APPROVAL_CAVEAT}
      title={approval.presentation.title}
    >
      {surfacedError ? (
        <p className="mt-5 text-sm text-destructive" role="alert">
          {surfacedError}
        </p>
      ) : null}

      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <Button
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={approve}
          size="lg"
          type="button"
        >
          <CheckCircle2 aria-hidden="true" />
          {primaryLabel}
        </Button>
        <Button
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={deny}
          size="lg"
          type="button"
          variant="outline"
        >
          <XCircle aria-hidden="true" />
          {submission === "denying" ? "Denying…" : "Deny"}
        </Button>
      </div>

      {submission === "returning" && redirectTo ? (
        <a
          className={cn(buttonVariants({ size: "lg", variant: "outline" }), "mt-4 w-full sm:w-auto")}
          href={redirectTo}
        >
          Return to Murph
        </a>
      ) : null}
    </ActionApprovalScreen>
  );
}

function readErrorMessage(value: unknown): string {
  return value instanceof Error
    ? value.message
    : "Secure approval could not be completed. Try again.";
}
