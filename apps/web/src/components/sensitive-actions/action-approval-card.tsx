"use client";

import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { Button, buttonVariants } from "@/src/components/ui/button";
import type {
  HostedActionApprovalDecisionResponse,
  HostedActionApprovalView,
} from "@/src/lib/action-approvals-shared";
import type { SensitiveActionChallengeResponse } from "@/src/lib/sensitive-actions/shared";
import { cn } from "@/src/lib/utils";

import { useSensitiveActionAuthorization } from "./use-sensitive-action-authorization";

type Submission = "approving" | "denying" | "returning" | null;

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

  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6">
      <section className="mx-auto flex min-h-[78vh] max-w-xl flex-col justify-center">
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          </span>
          <p className="mt-6 font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Secure approval
          </p>
          <h1 className="mt-3 font-serif text-3xl leading-tight text-balance">
            {approval.presentation.title}
          </h1>
          <p className="mt-4 break-words text-sm leading-6 text-muted-foreground text-pretty">
            {approval.presentation.body}
          </p>

          <p className="mt-5 text-xs leading-5 text-muted-foreground">
            This approval is bound to this exact request. Murph must ask again if the action changes.
          </p>

          {error || authorization.setup.error ? (
            <p className="mt-5 text-sm text-destructive" role="alert">
              {error ?? authorization.setup.error}
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
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
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
              <XCircle className="h-4 w-4" aria-hidden="true" />
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
        </div>
      </section>
    </main>
  );
}

function readErrorMessage(value: unknown): string {
  return value instanceof Error
    ? value.message
    : "Secure approval could not be completed. Try again.";
}
