"use client";

import { AlertCircleIcon, CheckCircle2Icon, PlayIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import type {
  HostedPulseTrialExtensionFailureReason,
  HostedPulseTrialExtensionMode,
  HostedPulseTrialExtensionSkipReason,
  HostedPulseTrialExtensionSummary,
} from "@/src/lib/hosted-ops/pulse-trial-extension";

const SKIP_REASON_LABELS: Record<HostedPulseTrialExtensionSkipReason, string> = {
  local_trial_window_invalid: "Local trial window invalid",
  local_usage_period_missing: "Local usage period missing",
  missing_stripe_refs: "Missing Stripe references",
  stripe_billing_plan_mismatch: "Stripe billing plan mismatch",
  stripe_campaign_marker_conflict: "Stripe campaign marker conflict",
  stripe_checkout_offer_mismatch: "Stripe checkout offer mismatch",
  stripe_customer_mismatch: "Stripe customer mismatch",
  stripe_subscription_id_mismatch: "Stripe subscription ID mismatch",
  stripe_subscription_not_trialing: "Stripe subscription not trialing",
  stripe_trial_end_invalid: "Stripe trial end invalid",
};

const FAILURE_REASON_LABELS: Record<HostedPulseTrialExtensionFailureReason, string> = {
  db_update_failed: "Database update failed",
  stripe_retrieve_failed: "Stripe retrieve failed",
  stripe_update_failed: "Stripe update failed",
  stripe_update_result_invalid: "Stripe update result invalid",
};

export function PulseTrialExtensionClient() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<
    { message: string; mode: HostedPulseTrialExtensionMode } | null
  >(null);
  const [pending, setPending] = useState<HostedPulseTrialExtensionMode | null>(null);
  const [summary, setSummary] = useState<HostedPulseTrialExtensionSummary | null>(null);

  const applyReady = summary !== null &&
    summary.mode === "dry-run" &&
    summary.wouldExtend + summary.wouldReconcile > 0;
  const failureCount = summary === null ? 0 : sumCounts(summary.failures);
  const skipCount = summary === null ? 0 : sumCounts(summary.skipped);

  async function runExtension(mode: HostedPulseTrialExtensionMode): Promise<void> {
    setPending(mode);
    setError(null);
    try {
      setSummary(await requestPulseTrialExtension(mode));
    } catch (requestError) {
      setSummary(null);
      setError({
        message: requestError instanceof Error
          ? requestError.message
          : "Pulse Trial extension request failed.",
        mode,
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border/70 pb-6">
        <div className="max-w-3xl">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
            Ops notebook
          </span>
          <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
            Pulse Trial extension
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            One-time seven-day beta extension for eligible Pulse Trial members. Preview first, then apply.
          </p>
        </div>
      </header>

      <section
        aria-busy={pending !== null}
        aria-labelledby="pulse-trial-extension-run-title"
        className="flex flex-col gap-4"
      >
        <Card>
          <CardHeader>
            <CardTitle id="pulse-trial-extension-run-title">Beta extension</CardTitle>
            <CardDescription>
              Preview counts eligible trials without changing anything. Applying updates Stripe and
              the matching local trial windows. Apply unlocks after a preview finds trials to extend
              or reconcile.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div aria-live="polite" className="min-h-5 text-sm text-muted-foreground" role="status">
              {describeRunStatus(pending, summary)}
            </div>
          </CardContent>
          <CardFooter className="flex-wrap gap-2">
            <Button
              disabled={pending !== null}
              onClick={() => void runExtension("dry-run")}
              type="button"
              variant="outline"
            >
              <SearchIcon data-icon="inline-start" />
              {pending === "dry-run" ? "Previewing..." : "Preview extension"}
            </Button>
            <Button
              disabled={pending !== null || !applyReady}
              onClick={() => setConfirmOpen(true)}
              type="button"
            >
              <PlayIcon data-icon="inline-start" />
              {pending === "apply" ? "Applying..." : "Apply seven-day extension"}
            </Button>
          </CardFooter>
        </Card>

        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon data-icon="inline-start" />
            <AlertTitle>
              {error.mode === "apply" ? "Apply request failed" : "Request failed"}
            </AlertTitle>
            <AlertDescription className="min-w-0 break-words">
              {error.mode === "apply" ? (
                <>
                  <p>{error.message}</p>
                  <p>
                    The apply request did not return a result, so the outcome may be partial.
                    Preview again to reconcile the current state before reapplying. Reapplying is
                    safe: trials already carrying the campaign marker are counted as already
                    extended.
                  </p>
                </>
              ) : (
                error.message
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {summary?.mode === "apply" ? (
          failureCount > 0 ? (
            <Alert variant="destructive">
              <AlertCircleIcon data-icon="inline-start" />
              <AlertTitle>Apply finished with failures</AlertTitle>
              <AlertDescription>
                Some candidates were not fully applied or reconciled. Review the failure counts
                below, then preview again before reapplying: apply stays locked until a new
                preview finds work. Reapplying is safe: trials already carrying the campaign
                marker are counted as already extended.
              </AlertDescription>
            </Alert>
          ) : skipCount > 0 ? (
            <Alert>
              <AlertCircleIcon data-icon="inline-start" />
              <AlertTitle>Applied, with skips to review</AlertTitle>
              <AlertDescription>
                No failures, but some candidates were skipped and left unchanged. Review the skip
                reasons below, then preview again before reapplying if any of them should still be
                extended.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <CheckCircle2Icon data-icon="inline-start" />
              <AlertTitle>Extension applied without failures or skips</AlertTitle>
              <AlertDescription>
                Stripe and local trial windows are updated for the counts below. Rerunning is safe:
                trials already carrying the campaign marker are counted as already extended.
              </AlertDescription>
            </Alert>
          )
        ) : null}

        {summary ? <PulseTrialExtensionSummaryCard summary={summary} /> : null}
      </section>

      <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply seven-day extension?</DialogTitle>
            <DialogDescription>
              This updates Stripe trials and the matching local trial windows for every eligible
              Pulse Trial member. Original trial start dates and recorded usage are preserved. The
              campaign is one-time, so it is safe to retry: trials that were already extended are
              not extended again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                void runExtension("apply");
              }}
              type="button"
            >
              Apply extension
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PulseTrialExtensionSummaryCard({
  summary,
}: {
  summary: HostedPulseTrialExtensionSummary;
}) {
  return (
    <Card>
      <CardHeader>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
          {summary.mode === "dry-run" ? "Preview" : "Apply result"}
        </span>
        <CardTitle>Extension counts</CardTitle>
        <CardDescription>
          Campaign {summary.campaign}, {summary.extensionDays} day extension. Counts only, no
          member detail.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CountTile label="Candidates" value={summary.candidates} />
          <CountTile label="Would extend" value={summary.wouldExtend} />
          <CountTile label="Would reconcile" value={summary.wouldReconcile} />
          <CountTile label="Already extended" value={summary.alreadyExtended} />
          <CountTile label="Skipped" value={sumCounts(summary.skipped)} />
          <CountTile
            label="Failures"
            tone={sumCounts(summary.failures) > 0 ? "warning" : "default"}
            value={sumCounts(summary.failures)}
          />
          <CountTile label="Stripe extended" value={summary.stripeTrialsExtended} />
          <CountTile label="Local windows reconciled" value={summary.localWindowsReconciled} />
        </dl>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ReasonBreakdown counts={summary.skipped} labels={SKIP_REASON_LABELS} title="Skip reasons" />
          <ReasonBreakdown
            counts={summary.failures}
            labels={FAILURE_REASON_LABELS}
            title="Failure reasons"
            tone="warning"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ReasonBreakdown(input: {
  counts: Record<string, number>;
  labels: Record<string, string>;
  title: string;
  tone?: "default" | "warning";
}) {
  const entries = Object.entries(input.counts).filter(([, count]) => count > 0);
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
      <h3 className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.title}
      </h3>
      <dl className="mt-2 flex flex-col gap-1.5">
        {entries.map(([reason, count]) => (
          <div className="flex items-baseline justify-between gap-3 text-sm" key={reason}>
            <dt className="text-muted-foreground">{input.labels[reason] ?? reason}</dt>
            <dd
              className={input.tone === "warning"
                ? "font-medium text-destructive tabular-nums"
                : "font-medium text-foreground tabular-nums"}
            >
              {formatInteger(count)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CountTile(input: {
  label: string;
  tone?: "default" | "warning";
  value: number;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
      <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </dt>
      <dd
        className={input.tone === "warning" && input.value > 0
          ? "mt-2 font-serif text-2xl font-semibold leading-none tracking-tight text-destructive tabular-nums"
          : "mt-2 font-serif text-2xl font-semibold leading-none tracking-tight text-foreground tabular-nums"}
      >
        {formatInteger(input.value)}
      </dd>
    </div>
  );
}

async function requestPulseTrialExtension(
  mode: HostedPulseTrialExtensionMode,
): Promise<HostedPulseTrialExtensionSummary> {
  const response = await fetch("/api/ops/pulse-trial-extension", {
    body: JSON.stringify({ mode }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      readJsonErrorMessage(payload) ?? `Request failed with status ${response.status}.`,
    );
  }

  return payload as HostedPulseTrialExtensionSummary;
}

function readJsonErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }
  const error = payload.error;
  if (!error || typeof error !== "object" || !("message" in error)) {
    return null;
  }
  return typeof error.message === "string" ? error.message : null;
}

function describeRunStatus(
  pending: HostedPulseTrialExtensionMode | null,
  summary: HostedPulseTrialExtensionSummary | null,
): string {
  if (pending === "dry-run") {
    return "Previewing the extension. Nothing is changed.";
  }
  if (pending === "apply") {
    return "Applying the seven-day extension.";
  }
  if (summary?.mode === "dry-run") {
    return `Preview complete: ${formatInteger(summary.wouldExtend)} would extend, ${
      formatInteger(summary.wouldReconcile)
    } would reconcile.`;
  }
  return "";
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
