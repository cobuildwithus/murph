"use client";

import { AlertCircleIcon, CalendarPlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import type { HostedPulseTrialExtensionSummary } from "@/src/lib/hosted-ops/pulse-trial-extension";

type TrialExtensionScope = "all" | "member";
type TrialExtensionPendingAction = "apply" | "preview" | null;
type TrialExtensionPreview = {
  summary: HostedPulseTrialExtensionSummary;
  targetMemberId: string | null;
};

export function TrialExtensionClient() {
  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border/70 pb-6">
        <div className="max-w-3xl">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
            Ops notebook
          </span>
          <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
            Trials
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Give Pulse Trial members 7 more days. Preview shows what would change
            without touching anything; applying asks you to type the run key from
            the preview. Retries are safe: already extended trials are not
            extended again, and unfinished local records can still be reconciled.
          </p>
        </div>
      </header>

      <TrialExtensionSection
        description="Adds 7 days to active Pulse Trials. Each run is capped at four candidates; if more qualify, preview stops before changing anything so you can use one-member runs below."
        scope="all"
        title="Every active trial"
      />
      <TrialExtensionSection
        description="Adds 7 days to one member's active Pulse Trial."
        scope="member"
        title="One member"
      />
    </div>
  );
}

function TrialExtensionSection({
  description,
  scope,
  title,
}: {
  description: string;
  scope: TrialExtensionScope;
  title: string;
}) {
  const [memberId, setMemberId] = useState("");
  const [preview, setPreview] = useState<TrialExtensionPreview | null>(null);
  const [applied, setApplied] = useState<HostedPulseTrialExtensionSummary | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState<TrialExtensionPendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const appliedResultRef = useRef<HTMLDivElement>(null);

  const targetMemberId = scope === "member" ? memberId.trim() : null;
  const missingMemberId = scope === "member" && targetMemberId === "";
  const confirmationMatches =
    preview !== null && confirmation.trim() === preview.summary.campaign;
  const sectionId = `trial-extension-${scope}`;

  useEffect(() => {
    if (applied) {
      appliedResultRef.current?.focus();
    }
  }, [applied]);

  async function previewExtension(): Promise<void> {
    const requestedMemberId = scope === "member" ? memberId.trim() : null;
    if (scope === "member" && !requestedMemberId) {
      return;
    }

    setPending("preview");
    setError(null);
    setPreview(null);
    setApplied(null);
    setConfirmation("");
    try {
      const summary = await requestTrialExtension({
        campaign: null,
        memberId: requestedMemberId,
        mode: "dry-run",
      });
      setPreview({ summary, targetMemberId: requestedMemberId });
    } catch (requestError) {
      setError(readRequestErrorMessage(requestError));
    } finally {
      setPending(null);
    }
  }

  async function applyExtension(): Promise<void> {
    if (!preview || confirmation.trim() !== preview.summary.campaign) {
      return;
    }

    setPending("apply");
    setError(null);
    try {
      const summary = await requestTrialExtension({
        campaign: preview.summary.campaign,
        memberId: preview.targetMemberId,
        mode: "apply",
      });
      setApplied(summary);
      if (!hasTrialExtensionFailures(summary)) {
        setPreview(null);
        setConfirmation("");
      }
    } catch (requestError) {
      setError(readRequestErrorMessage(requestError));
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      aria-busy={pending !== null}
      aria-labelledby={`${sectionId}-title`}
      className="rounded-xl border border-border/70 bg-card/90 p-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
            7 more days
          </span>
          <h2
            className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground"
            id={`${sectionId}-title`}
          >
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        {scope === "member" ? (
          <div className="flex max-w-sm flex-col gap-2">
            <Label
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
              htmlFor={`${sectionId}-member-id`}
            >
              Member id
            </Label>
            <Input
              autoComplete="off"
              id={`${sectionId}-member-id`}
              onChange={(event) => {
                setMemberId(event.target.value);
                setPreview(null);
                setApplied(null);
                setConfirmation("");
                setError(null);
              }}
              disabled={pending !== null}
              placeholder="member_..."
              spellCheck={false}
              value={memberId}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={pending !== null || missingMemberId}
            onClick={() => void previewExtension()}
            size="sm"
            type="button"
            variant="outline"
          >
            <SearchIcon data-icon="inline-start" />
            {pending === "preview" ? "Previewing..." : "Preview"}
          </Button>
        </div>

        {preview ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 p-4">
            <div aria-live="polite" role="status">
              <TrialExtensionSummaryPanel scope={scope} summary={preview.summary} />
            </div>
            {preview.summary.wouldExtend > 0 || preview.summary.wouldReconcile > 0 ? (
              <div className="flex flex-col gap-3 border-t border-border/70 pt-4">
                <div className="flex max-w-sm flex-col gap-2">
                  <Label
                    className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                    htmlFor={`${sectionId}-confirmation`}
                  >
                    Type {preview.summary.campaign} to confirm
                  </Label>
                  <Input
                    autoComplete="off"
                    disabled={pending !== null}
                    id={`${sectionId}-confirmation`}
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder={preview.summary.campaign}
                    spellCheck={false}
                    value={confirmation}
                  />
                </div>
                <div>
                  <Button
                    disabled={pending !== null || !confirmationMatches}
                    onClick={() => void applyExtension()}
                    size="sm"
                    type="button"
                  >
                    <CalendarPlusIcon data-icon="inline-start" />
                    {pending === "apply" ? "Extending..." : "Add 7 days"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="border-t border-border/70 pt-4 text-sm text-muted-foreground">
                Nothing to change right now.
              </p>
            )}
          </div>
        ) : null}

        {applied ? (
          <div
            aria-live="polite"
            className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 p-4"
            ref={appliedResultRef}
            role="status"
            tabIndex={-1}
          >
            <TrialExtensionSummaryPanel scope={scope} summary={applied} />
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon data-icon="inline-start" />
            <AlertDescription className="min-w-0 break-words">{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </section>
  );
}

function TrialExtensionSummaryPanel({
  scope,
  summary,
}: {
  scope: TrialExtensionScope;
  summary: HostedPulseTrialExtensionSummary;
}) {
  const isPreview = summary.mode === "dry-run";
  const skippedEntries = Object.entries(summary.skipped).filter(([, count]) => count > 0);
  const failureEntries = Object.entries(summary.failures).filter(([, count]) => count > 0);
  const hasFailures = failureEntries.length > 0;
  const defaultBadgeLabel = isPreview ? "Preview" : "Applied";
  const defaultBadgeVariant = isPreview ? "outline" : "secondary";
  const failureBadgeLabel = isPreview ? "Preview incomplete" : "Needs retry";
  const badgeLabel = hasFailures ? failureBadgeLabel : defaultBadgeLabel;
  const badgeVariant = hasFailures ? "destructive" : defaultBadgeVariant;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        <span className="font-mono text-[11px] text-muted-foreground">
          Run key {summary.campaign}
        </span>
      </div>

      {scope === "member" && summary.candidates === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active Pulse Trial found for that member id.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TrialExtensionMetricTile label="Trials checked" value={summary.candidates} />
          {isPreview ? (
            <>
              <TrialExtensionMetricTile label="Would get 7 days" value={summary.wouldExtend} />
              <TrialExtensionMetricTile label="Would fix records" value={summary.wouldReconcile} />
            </>
          ) : (
            <>
              <TrialExtensionMetricTile label="Got 7 days" value={summary.stripeTrialsExtended} />
              <TrialExtensionMetricTile label="Records updated" value={summary.localWindowsReconciled} />
            </>
          )}
          <TrialExtensionMetricTile
            label="Already extended"
            value={summary.alreadyExtended}
          />
        </div>
      )}

      {skippedEntries.length > 0 ? (
        <TrialExtensionReasonList label="Skipped" entries={skippedEntries} />
      ) : null}
      {failureEntries.length > 0 ? (
        <Alert variant="destructive">
          <AlertCircleIcon data-icon="inline-start" />
          <AlertDescription className="min-w-0 break-words">
            {failureEntries
              .map(([reason, count]) => `${reason}: ${count}`)
              .join(", ")}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function TrialExtensionMetricTile({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/90 px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 font-serif text-2xl font-semibold leading-none tracking-tight text-foreground tabular-nums">
        {new Intl.NumberFormat("en-US").format(value)}
      </div>
    </div>
  );
}

function TrialExtensionReasonList({
  entries,
  label,
}: {
  entries: Array<[string, number]>;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {entries.map(([reason, count]) => (
          <span
            className="rounded-md border border-border/70 bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground"
            key={reason}
          >
            {reason} ({count})
          </span>
        ))}
      </div>
    </div>
  );
}

function hasTrialExtensionFailures(
  summary: HostedPulseTrialExtensionSummary,
): boolean {
  return Object.values(summary.failures).some((count) => count > 0);
}

function readRequestErrorMessage(requestError: unknown): string {
  return requestError instanceof Error
    ? requestError.message
    : "The trial extension request failed.";
}

async function requestTrialExtension(input: {
  campaign: string | null;
  memberId: string | null;
  mode: "apply" | "dry-run";
}): Promise<HostedPulseTrialExtensionSummary> {
  const response = await fetch("/api/ops/pulse-trial-extension", {
    body: JSON.stringify({
      ...(input.campaign ? { campaign: input.campaign } : {}),
      ...(input.memberId ? { memberId: input.memberId } : {}),
      mode: input.mode,
    }),
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
