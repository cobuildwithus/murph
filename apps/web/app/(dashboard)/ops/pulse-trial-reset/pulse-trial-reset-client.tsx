"use client";

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Checkbox } from "@/src/components/ui/checkbox";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import type {
  HostedPulseTrialResetMode,
  HostedPulseTrialResetSerializedSummary,
} from "@/src/lib/hosted-ops/pulse-trial-reset";

type PendingAction = HostedPulseTrialResetMode | null;

export function PulseTrialResetClient() {
  const [batchSize, setBatchSize] = useState("100");
  const [confirmedApply, setConfirmedApply] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [summary, setSummary] = useState<HostedPulseTrialResetSerializedSummary | null>(null);
  const generatedWindow = useMemo(() => (
    summary
      ? `${formatDateTime(summary.resetWindow.trialStartedAt)} to ${formatDateTime(summary.resetWindow.trialEndsAt)}`
      : null
  ), [summary]);

  async function runReset(mode: HostedPulseTrialResetMode): Promise<void> {
    setPending(mode);
    setError(null);
    try {
      const nextSummary = await requestJson<HostedPulseTrialResetSerializedSummary>(
        "/api/ops/pulse-trial-reset",
        {
          body: JSON.stringify({
            batchSize,
            mode,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      setSummary(nextSummary);
      if (mode === "apply") {
        setConfirmedApply(false);
      }
    } catch (resetError) {
      setError(describeClientError(resetError));
    } finally {
      setPending(null);
    }
  }

  const hasFailures = summary ? hasCount(summary.failures) : false;
  const hasSkipped = summary ? hasCount(summary.skipped) : false;

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border/70 pb-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
              Ops notebook
            </span>
            <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
              Pulse Trial reset
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Reset active launch-plan Pulse Trials to a fresh 10-day window from the hosted server environment.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SummaryChip label="Trial window" value="10 days" />
            <SummaryChip label="Default mode" value="Dry-run" />
          </div>
        </div>
      </header>

      <section
        aria-busy={pending !== null}
        aria-labelledby="pulse-trial-reset-action-title"
        className="rounded-xl border border-border/70 bg-card/90 p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
              Billing
            </span>
            <h2
              className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground"
              id="pulse-trial-reset-action-title"
            >
              Reset eligible trials
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Scans active hosted members on the Pulse Trial offer, confirms Stripe still has a trialing subscription, then updates Stripe before the local billing row.
            </p>
          </div>
          {summary ? (
            <Badge variant={hasFailures ? "destructive" : "secondary"}>
              {hasFailures ? (
                <AlertCircleIcon data-icon="inline-start" />
              ) : (
                <CheckCircle2Icon data-icon="inline-start" />
              )}
              {summary.mode === "apply" ? "Apply complete" : "Dry-run complete"}
            </Badge>
          ) : null}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,14rem)_1fr]">
          <div className="flex min-w-0 flex-col gap-2">
            <Label
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
              htmlFor="pulse-trial-reset-batch-size"
            >
              Batch size
            </Label>
            <Input
              autoComplete="off"
              id="pulse-trial-reset-batch-size"
              inputMode="numeric"
              max={500}
              min={1}
              onChange={(event) => setBatchSize(event.currentTarget.value)}
              value={batchSize}
              type="number"
            />
          </div>

          <div className="flex flex-col gap-3 md:justify-end">
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending !== null}
                onClick={() => {
                  void runReset("dry-run");
                }}
                type="button"
                variant="outline"
              >
                <RefreshCwIcon data-icon="inline-start" />
                {pending === "dry-run" ? "Running..." : "Run dry-run"}
              </Button>
              <Button
                disabled={pending !== null || !confirmedApply}
                onClick={() => {
                  void runReset("apply");
                }}
                type="button"
                variant="destructive"
              >
                <RotateCcwIcon data-icon="inline-start" />
                {pending === "apply" ? "Applying..." : "Apply reset"}
              </Button>
            </div>
            <label className="flex max-w-2xl items-start gap-3 text-sm leading-6 text-muted-foreground">
              <Checkbox
                checked={confirmedApply}
                disabled={pending !== null}
                onCheckedChange={(checked) => {
                  setConfirmedApply(checked === true);
                }}
              />
              <span>
                Apply only after reviewing a dry-run. This updates eligible Stripe subscriptions and local billing rows.
              </span>
            </label>
          </div>
        </div>

        <div aria-live="polite" className="mt-4 min-h-5 text-sm text-muted-foreground">
          {pending === "dry-run" ? "Scanning eligible Pulse Trials." : null}
          {pending === "apply" ? "Applying Pulse Trial reset." : null}
        </div>

        {error ? (
          <Alert className="mt-4" variant="destructive">
            <AlertCircleIcon data-icon="inline-start" />
            <AlertDescription className="min-w-0 break-words">{error}</AlertDescription>
          </Alert>
        ) : null}
      </section>

      {summary ? (
        <section
          aria-labelledby="pulse-trial-reset-summary-title"
          className="rounded-xl border border-border/70 bg-card/90 p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
                Result
              </span>
              <h2
                className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground"
                id="pulse-trial-reset-summary-title"
              >
                {summary.mode === "apply" ? "Applied reset" : "Dry-run result"}
              </h2>
            </div>
            {generatedWindow ? (
              <div className="min-w-0 rounded-lg border border-border/70 bg-card px-3 py-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Window
                </div>
                <div className="mt-1 break-words text-sm font-medium text-foreground">
                  {generatedWindow}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile label="Candidates" value={formatInteger(summary.candidates)} />
            <MetricTile label="Would reset" value={formatInteger(summary.wouldReset)} />
            <MetricTile label="Reset" value={formatInteger(summary.reset)} />
            <MetricTile label="Failures" value={formatInteger(totalCount(summary.failures))} />
          </div>

          {hasSkipped || hasFailures ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <CountPanel
                counts={summary.skipped}
                emptyLabel="No skipped candidates."
                title="Skipped"
              />
              <CountPanel
                counts={summary.failures}
                emptyLabel="No failures."
                title="Failures"
                tone={hasFailures ? "destructive" : "default"}
              />
            </div>
          ) : (
            <Alert className="mt-5">
              <CheckCircle2Icon data-icon="inline-start" />
              <AlertTitle>No skips or failures</AlertTitle>
              <AlertDescription>
                Every candidate scanned in this run was eligible for the requested mode.
              </AlertDescription>
            </Alert>
          )}
        </section>
      ) : null}
    </div>
  );
}

function SummaryChip({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function MetricTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function CountPanel({
  counts,
  emptyLabel,
  title,
  tone = "default",
}: {
  counts: Record<string, number>;
  emptyLabel: string;
  title: string;
  tone?: "default" | "destructive";
}) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
      <h3 className="font-serif text-base font-semibold tracking-tight text-foreground">
        {title}
      </h3>
      {entries.length > 0 ? (
        <dl className="mt-3 flex flex-col gap-2">
          {entries.map(([reason, count]) => (
            <div
              className="flex min-w-0 items-center justify-between gap-4 rounded-lg bg-card/80 px-3 py-2"
              key={reason}
            >
              <dt className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {reason}
              </dt>
              <dd className="font-mono text-sm font-semibold tabular-nums text-foreground">
                {formatInteger(count)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{emptyLabel}</p>
      )}
      {tone === "destructive" && entries.length > 0 ? (
        <p className="mt-3 text-sm text-destructive">
          Retry only after checking the failed category.
        </p>
      ) : null}
    </div>
  );
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(readJsonErrorMessage(payload) ?? `Request failed with ${response.status}.`);
  }

  return payload as T;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readJsonErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const error = Reflect.get(payload, "error");
  if (!error || typeof error !== "object") {
    return null;
  }
  const message = Reflect.get(error, "message");
  return typeof message === "string" && message.trim().length > 0 ? message : null;
}

function describeClientError(error: unknown): string {
  return error instanceof Error ? error.message : "Pulse Trial reset request failed.";
}

function hasCount(counts: Record<string, number>): boolean {
  return Object.values(counts).some((count) => count > 0);
}

function totalCount(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
