"use client";

import { useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { LinkPageSheet } from "@/src/components/link-page/link-page-sheet";
import {
  LINK_PAGE_PILL_CLASS,
  LinkPageError,
  LinkPageLink,
  LinkPagePill,
} from "@/src/components/link-page/link-page-shell";
import {
  ACTION_APPROVAL_DENIED_DESCRIPTION,
  ACTION_APPROVAL_RECORDED_DESCRIPTION,
  ActionApprovalScreen,
  readActionApprovalFileName,
} from "@/src/components/sensitive-actions/action-approval-screen";
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
      const getChallenge = () => requestHostedOnboardingJson<SensitiveActionChallengeResponse>({
        method: "POST",
        url: `${endpointBase}/challenge`,
      });
      const signed = await authorization.signChallenge(await getChallenge(), undefined, getChallenge);
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
  const returningDecision = submission === "returning-approved"
    ? "approved"
    : submission === "returning-denied"
      ? "denied"
      : null;
  const busyStatus = (submission === "approving"
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
  const fileName = readActionApprovalFileName(approval.presentation.body);
  const status = busyStatus ? (
    <p aria-live="polite" className="sr-only" role="status">
      {busyStatus}
    </p>
  ) : null;

  if (returningDecision) {
    const approved = returningDecision === "approved";
    return (
      <ActionApprovalScreen
        actions={
          <>
            {redirectTo ? (
              <a className={LINK_PAGE_PILL_CLASS} href={redirectTo}>
                Return to Murph
              </a>
            ) : null}
            {status}
          </>
        }
        body={approved ? ACTION_APPROVAL_RECORDED_DESCRIPTION : ACTION_APPROVAL_DENIED_DESCRIPTION}
        title={approved ? "Approved." : "Denied."}
      >
        <LinkPageSheet name={fileName} stamp={approved ? "Approved" : "Denied"} />
        {redirectTo ? null : (
          <p className="pt-6 text-center text-base font-medium leading-[22px] text-[#FFFCF6]/60">
            Return to the Murph conversation where this request started.
          </p>
        )}
      </ActionApprovalScreen>
    );
  }

  return (
    <ActionApprovalScreen
      actions={
        <div aria-busy={busy} className="flex w-full flex-col items-center gap-1">
          {error ? <LinkPageError>{error}</LinkPageError> : null}
          <LinkPagePill disabled={busy} onClick={approve}>
            {submission === "approving" ? "Verifying approval…" : "Approve with passkey"}
          </LinkPagePill>
          <LinkPageLink disabled={busy} onClick={deny}>
            {submission === "denying" ? "Denying…" : "Deny"}
          </LinkPageLink>
          {status}
        </div>
      }
      body={<span className="break-words">{approval.presentation.body}</span>}
      title={approval.presentation.title}
    >
      <LinkPageSheet name={fileName} />
    </ActionApprovalScreen>
  );
}

function readErrorMessage(value: unknown): string {
  return value instanceof Error
    ? value.message
    : "Secure approval could not be completed. Try again.";
}
