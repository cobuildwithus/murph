"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Spinner } from "@/src/components/ui/spinner";
import type {
  HostedLegacyPulseTrialRetirementReport,
} from "@/src/lib/hosted-onboarding/legacy-pulse-trial-retirement";

interface DryRunResponse {
  operation: "dry-run";
  report: HostedLegacyPulseTrialRetirementReport;
}

interface ApplyResponse {
  converged: boolean;
  operation: "apply";
  report: HostedLegacyPulseTrialRetirementReport;
  verification: HostedLegacyPulseTrialRetirementReport;
}

type PendingOperation = "apply" | "dry-run" | null;

export function LegacyTrialRetirementControl({
  headingId = "legacy-trial-retirement-title",
  initialReport = null,
}: {
  headingId?: string;
  initialReport?: HostedLegacyPulseTrialRetirementReport | null;
}) {
  const [report, setReport] = useState(initialReport);
  const [lastApplyReport, setLastApplyReport] = useState<
    HostedLegacyPulseTrialRetirementReport | null
  >(null);
  const [pending, setPending] = useState<PendingOperation>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const candidateCount = report?.candidateCount ?? 0;

  async function runDryRun(): Promise<void> {
    if (pending) {
      return;
    }
    setPending("dry-run");
    setReport(null);
    setLastApplyReport(null);
    setError(null);
    setNotice(null);
    try {
      const response = await requestRetirement({ operation: "dry-run" });
      if (response.operation !== "dry-run") {
        throw new Error("Legacy trial check returned an unexpected response.");
      }
      setReport(response.report);
      setLastApplyReport(null);
      setNotice(
        response.report.candidateCount === 0
          ? "No legacy Pulse trial candidates remain."
          : `Dry-run found ${formatInteger(response.report.candidateCount)} candidate${response.report.candidateCount === 1 ? "" : "s"}. Review the aggregate provider state before applying.`,
      );
    } catch (requestError) {
      setError(describeRequestError(requestError));
    } finally {
      setPending(null);
    }
  }

  async function applyRetirement(): Promise<void> {
    if (pending || !report || report.candidateCount === 0) {
      return;
    }
    const expectedCandidates = report.candidateCount;
    setPending("apply");
    setError(null);
    setNotice(null);
    try {
      const response = await requestRetirement({
        expectedCandidates,
        operation: "apply",
      });
      if (response.operation !== "apply") {
        throw new Error("Legacy trial apply returned an unexpected response.");
      }
      setReport(response.verification);
      setLastApplyReport(response.report);
      setConfirmationOpen(false);
      if (response.converged) {
        setNotice(
          `${formatInteger(response.report.retiredCount)} retired; ${formatInteger(response.report.alreadyRetiredCount)} already clear. The automatic verification found zero remaining candidates.`,
        );
      } else {
        setError(
          `Apply completed, but the verification found ${formatInteger(response.verification.candidateCount)} remaining candidate${response.verification.candidateCount === 1 ? "" : "s"}. Review the new dry-run before applying again.`,
        );
      }
    } catch (requestError) {
      setReport(null);
      setLastApplyReport(null);
      setError(describeApplyError(requestError));
      setConfirmationOpen(false);
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <section
        aria-busy={pending !== null}
        aria-labelledby={headingId}
        className="rounded-xl border border-border/70 bg-card/90 p-5 sm:p-6"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
              Billing maintenance
            </span>
            <h2
              className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground"
              id={headingId}
            >
              Legacy Pulse trials
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Check obsolete trial bindings against their exact Stripe
              subscription and current Pulse Price. Apply ends only paused,
              canceled, incomplete, incomplete-expired, or trialing objects,
              preserves consumed value in Starter, and refuses paid or
              ambiguous state.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              disabled={pending !== null}
              onClick={() => void runDryRun()}
              type="button"
              variant="outline"
            >
              {pending === "dry-run" ? <Spinner data-icon="inline-start" /> : null}
              {pending === "dry-run" ? "Checking" : "Run dry-run"}
            </Button>
            {report && report.candidateCount > 0 ? (
              <Button
                disabled={pending !== null}
                onClick={() => setConfirmationOpen(true)}
                type="button"
                variant="destructive"
              >
                Retire {formatInteger(report.candidateCount)}
              </Button>
            ) : null}
          </div>
        </div>

        {report ? (
          <RetirementReport
            lastApplyReport={lastApplyReport}
            report={report}
          />
        ) : (
          <p className="mt-5 border-t border-border/70 pt-4 text-sm text-muted-foreground">
            No provider or database changes occur until a dry-run succeeds and
            its exact candidate count is confirmed.
          </p>
        )}

        <div aria-live="polite" className="mt-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : notice ? (
            <Alert>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </section>

      <Dialog
        onOpenChange={(open) => {
          if (pending !== "apply") {
            setConfirmationOpen(open);
          }
        }}
        open={confirmationOpen}
      >
        <DialogContent showCloseButton={pending !== "apply"}>
          <DialogHeader>
            <DialogTitle>
              Retire {formatInteger(candidateCount)} legacy trial{candidateCount === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              The server will rerun the full fail-closed preflight and require
              exactly {formatInteger(candidateCount)} candidates before changing
              anything. It then verifies that zero candidates remain.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-y border-border/70 py-4 text-sm">
            <dt className="text-muted-foreground">Stripe mode</dt>
            <dd className="font-mono text-xs uppercase">
              {report?.stripeMode ?? "Unknown"}
            </dd>
            <dt className="text-muted-foreground">Exact candidate count</dt>
            <dd className="font-serif font-semibold tabular-nums">
              {formatInteger(candidateCount)}
            </dd>
            <dt className="text-muted-foreground">Paid or ambiguous state</dt>
            <dd>Refused</dd>
          </dl>
          <DialogFooter>
            <Button
              disabled={pending === "apply"}
              onClick={() => setConfirmationOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={pending === "apply" || candidateCount === 0}
              onClick={() => void applyRetirement()}
              type="button"
              variant="destructive"
            >
              {pending === "apply" ? <Spinner data-icon="inline-start" /> : null}
              {pending === "apply" ? "Applying" : "Apply and verify zero"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RetirementReport({
  lastApplyReport,
  report,
}: {
  lastApplyReport: HostedLegacyPulseTrialRetirementReport | null;
  report: HostedLegacyPulseTrialRetirementReport;
}) {
  const statusEntries = Object.entries(report.subscriptionStatusCounts);

  return (
    <div className="mt-5 border-t border-border/70 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={report.candidateCount === 0 ? "outline" : "secondary"}>
          {formatInteger(report.candidateCount)} candidate{report.candidateCount === 1 ? "" : "s"}
        </Badge>
        <Badge variant="outline">{report.stripeMode} Stripe</Badge>
        <span className="text-xs text-muted-foreground">
          Aggregate counts only, no member identities
        </span>
      </div>
      <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <ReportFinding
          label="Provider objects found"
          value={formatInteger(
            Math.max(0, report.candidateCount - report.missingProviderCount),
          )}
        />
        <ReportFinding
          label="Provider objects absent"
          value={formatInteger(report.missingProviderCount)}
        />
        {lastApplyReport ? (
          <>
            <ReportFinding
              label="Retired in last apply"
              value={formatInteger(lastApplyReport.retiredCount)}
            />
            <ReportFinding
              label="Already clear in last apply"
              value={formatInteger(lastApplyReport.alreadyRetiredCount)}
            />
            <ReportFinding
              label="Remaining after verification"
              value={formatInteger(report.candidateCount)}
            />
          </>
        ) : null}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Stripe subscription statuses">
        {statusEntries.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            No current Stripe subscription statuses.
          </span>
        ) : statusEntries.map(([status, count]) => (
          <Badge key={status} variant="outline">
            {status}: {formatInteger(count)}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function ReportFinding({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-serif text-xl font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

async function requestRetirement(
  input:
    | { operation: "dry-run" }
    | { expectedCandidates: number; operation: "apply" },
): Promise<ApplyResponse | DryRunResponse> {
  const response = await fetch("/api/ops/legacy-trial-retirement", {
    body: JSON.stringify(input),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Legacy trial retirement returned an unreadable response.");
  }
  if (!response.ok) {
    throw new Error(readResponseErrorMessage(payload));
  }
  if (!isRetirementResponse(payload)) {
    throw new Error("Legacy trial retirement returned an invalid response.");
  }
  return payload;
}

function isRetirementResponse(
  value: unknown,
): value is ApplyResponse | DryRunResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const operation = Reflect.get(value, "operation");
  const report = Reflect.get(value, "report");
  if (!isRetirementReport(report)) {
    return false;
  }
  if (operation === "dry-run") {
    return true;
  }
  return operation === "apply"
    && typeof Reflect.get(value, "converged") === "boolean"
    && isRetirementReport(Reflect.get(value, "verification"));
}

function isRetirementReport(
  value: unknown,
): value is HostedLegacyPulseTrialRetirementReport {
  const statusCounts = value && typeof value === "object"
    ? Reflect.get(value, "subscriptionStatusCounts")
    : null;
  return Boolean(
    value
      && typeof value === "object"
      && Number.isSafeInteger(Reflect.get(value, "candidateCount"))
      && Number.isSafeInteger(Reflect.get(value, "missingProviderCount"))
      && Number.isSafeInteger(Reflect.get(value, "retiredCount"))
      && Number.isSafeInteger(Reflect.get(value, "alreadyRetiredCount"))
      && ["apply", "dry-run"].includes(String(Reflect.get(value, "mode")))
      && ["live", "test"].includes(String(Reflect.get(value, "stripeMode")))
      && statusCounts
      && typeof statusCounts === "object"
      && !Array.isArray(statusCounts)
      && Object.values(statusCounts).every((count) => (
        typeof count === "number"
        && Number.isSafeInteger(count)
        && count >= 0
      ))
  );
}

function readResponseErrorMessage(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const error = Reflect.get(payload, "error");
    if (error && typeof error === "object") {
      const message = Reflect.get(error, "message");
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
  }
  return "Legacy trial retirement could not complete. Run a fresh dry-run.";
}

function describeRequestError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Legacy trial retirement could not complete. Run a fresh dry-run.";
}

function describeApplyError(error: unknown): string {
  const message = describeRequestError(error);
  return /fresh dry-run/iu.test(message)
    ? message
    : `${message} Run a fresh dry-run before retrying.`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
