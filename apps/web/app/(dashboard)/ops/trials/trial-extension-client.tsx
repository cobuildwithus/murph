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
  targetPage: number;
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
            Recover unfinished provider trials, reconcile local records, and give
            eligible Pulse Trial members 7 more days. Preview shows what would
            change without touching anything; applying asks you to type the run
            key from the preview. Retries are safe: already extended trials are
            not extended again.
          </p>
        </div>
      </header>

      <TrialExtensionSection
        description="Closes the fixed pre-July 10 reservation cohort, recovers any provider trial that did not finish local enrollment, then adds 7 days to eligible Pulse Trials in ordered batches of up to four. A recovered provider trial needs a fresh Preview before extension. After applying every batch, restart at Batch 1 and Preview every batch again. Retire the campaign only when every batch shows zero trials to recover, extend, or reconcile."
        scope="all"
        title="Fixed campaign cohort"
      />
      <TrialExtensionSection
        description="Recovers an unfinished provider trial when needed, then adds 7 days to one member's active Pulse Trial. A recovered trial needs a fresh Preview before extension."
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
  const [page, setPage] = useState(0);
  const previewResultRef = useRef<HTMLDivElement>(null);
  const appliedResultRef = useRef<HTMLDivElement>(null);

  const targetMemberId = scope === "member" ? memberId.trim() : null;
  const missingMemberId = scope === "member" && targetMemberId === "";
  const confirmationMatches =
    preview !== null &&
    preview.summary.candidateSnapshotDigest !== null &&
    hasCompleteTrialExtensionPreviewProof(preview.summary) &&
    confirmation.trim() === preview.summary.campaign;
  const sectionId = `trial-extension-${scope}`;
  const displayedSummary = applied ?? preview?.summary ?? null;

  useEffect(() => {
    if (applied) {
      appliedResultRef.current?.focus();
    }
  }, [applied]);

  useEffect(() => {
    if (preview) {
      previewResultRef.current?.focus();
    }
  }, [preview]);

  async function previewExtension(requestedPage = page): Promise<void> {
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
        candidatePreviewTokens: null,
        candidateSnapshotDigest: null,
        memberId: requestedMemberId,
        mode: "dry-run",
        page: scope === "all" ? requestedPage : 0,
      });
      if (!summary.candidateSnapshotDigest) {
        throw new Error("Preview could not be verified. Preview again.");
      }
      setPage(summary.page);
      setPreview({
        summary,
        targetMemberId: requestedMemberId,
        targetPage: summary.page,
      });
    } catch (requestError) {
      setError(readRequestErrorMessage(requestError));
    } finally {
      setPending(null);
    }
  }

  async function applyExtension(): Promise<void> {
    if (
      !preview?.summary.candidateSnapshotDigest ||
      !hasCompleteTrialExtensionPreviewProof(preview.summary) ||
      confirmation.trim() !== preview.summary.campaign
    ) {
      return;
    }

    setPending("apply");
    setError(null);
    try {
      const summary = await requestTrialExtension({
        campaign: preview.summary.campaign,
        candidatePreviewTokens: preview.summary.candidatePreviewTokens,
        candidateSnapshotDigest: preview.summary.candidateSnapshotDigest,
        memberId: preview.targetMemberId,
        mode: "apply",
        page: preview.targetPage,
      });
      setApplied(summary);
      if (
        !hasTrialExtensionFailures(summary) ||
        summary.localWindowsReconciled > 0 ||
        summary.failures.preview_state_changed > 0 ||
        summary.providerTrialsRecovered > 0 ||
        summary.stripeTrialsExtended > 0 ||
        summary.skipped.local_candidate_changed > 0
      ) {
        setPreview(null);
        setConfirmation("");
      }
    } catch (requestError) {
      if (isTrialExtensionPreviewStaleError(requestError)) {
        setPreview(null);
        setConfirmation("");
      }
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
                setPage(0);
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
            onClick={() => void previewExtension(page)}
            size="sm"
            type="button"
            variant="outline"
          >
            <SearchIcon data-icon="inline-start" />
            {pending === "preview" ? "Previewing..." : "Preview"}
          </Button>
        </div>

        {preview ? (
          <div
            className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 p-4"
            ref={previewResultRef}
            tabIndex={-1}
          >
            <div aria-live="polite" role="status">
              <TrialExtensionSummaryPanel scope={scope} summary={preview.summary} />
            </div>
            {!hasCompleteTrialExtensionPreviewProof(preview.summary) ? (
              <p className="border-t border-border/70 pt-4 text-sm text-muted-foreground">
                Apply is unavailable until Preview completes without failures.
              </p>
            ) : preview.summary.wouldExtend > 0 ||
              preview.summary.wouldRecoverProviderTrial > 0 ||
              preview.summary.wouldReconcile > 0 ? (
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
                    {pending === "apply" ? "Applying..." : "Apply batch"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="border-t border-border/70 pt-4 text-sm text-muted-foreground">
                {scope === "all"
                  ? "Nothing to change in this batch. This is complete only after every batch in a fresh pass shows zero provider trials to recover, zero trials to extend, and zero records to reconcile."
                  : "Nothing to change right now."}
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
            {applied.providerTrialsRecovered > 0 ? (
              <p className="border-t border-border/70 pt-4 text-sm text-muted-foreground">
                Trial recovered. Preview {scope === "member" ? "this member" : "this batch"}
                {" "}again to add the 7-day extension.
              </p>
            ) : null}
          </div>
        ) : null}

        {scope === "all" && displayedSummary ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
            <Button
              disabled={pending !== null || displayedSummary.page === 0}
              onClick={() => void previewExtension(displayedSummary.page - 1)}
              size="sm"
              type="button"
              variant="outline"
            >
              Previous batch
            </Button>
            <Button
              disabled={pending !== null || !displayedSummary.hasMoreCandidates}
              onClick={() => void previewExtension(displayedSummary.page + 1)}
              size="sm"
              type="button"
              variant="outline"
            >
              Preview next batch
            </Button>
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
        {scope === "all" ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            Batch {summary.page + 1}
            {summary.hasMoreCandidates ? " · more batches" : " · final batch"}
          </span>
        ) : null}
      </div>

      {scope === "member" && summary.candidates === 0 ? (
        <p className="text-sm text-muted-foreground">
          No eligible campaign trial found for that member id.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TrialExtensionMetricTile label="Trials checked" value={summary.candidates} />
          {isPreview ? (
            <>
              <TrialExtensionMetricTile label="Would get 7 days" value={summary.wouldExtend} />
              <TrialExtensionMetricTile
                label="Would recover trial"
                value={summary.wouldRecoverProviderTrial}
              />
              <TrialExtensionMetricTile label="Would fix records" value={summary.wouldReconcile} />
            </>
          ) : (
            <>
              <TrialExtensionMetricTile
                label="Got 7 days"
                value={summary.stripeTrialsExtended}
              />
              <TrialExtensionMetricTile
                label="Records updated"
                value={summary.localWindowsReconciled}
              />
              <TrialExtensionMetricTile
                label="Provider trials recovered"
                value={summary.providerTrialsRecovered}
              />
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

function hasCompleteTrialExtensionPreviewProof(
  summary: HostedPulseTrialExtensionSummary,
): boolean {
  return (
    summary.mode === "dry-run" &&
    summary.candidatePreviewTokens !== null &&
    summary.candidatePreviewTokens.length === summary.candidates &&
    summary.candidatePreviewTokens.every((token) => token.length > 0) &&
    !hasTrialExtensionFailures(summary)
  );
}

function readRequestErrorMessage(requestError: unknown): string {
  return requestError instanceof Error
    ? requestError.message
    : "The trial extension request failed.";
}

class TrialExtensionRequestError extends Error {
  readonly code: string | null;

  constructor(input: { code: string | null; message: string }) {
    super(input.message);
    this.name = "TrialExtensionRequestError";
    this.code = input.code;
  }
}

function isTrialExtensionPreviewStaleError(requestError: unknown): boolean {
  return (
    requestError instanceof TrialExtensionRequestError &&
    requestError.code === "HOSTED_OPS_PULSE_TRIAL_EXTENSION_PREVIEW_STALE"
  );
}

async function requestTrialExtension(input: {
  campaign: string | null;
  candidatePreviewTokens: readonly string[] | null;
  candidateSnapshotDigest: string | null;
  memberId: string | null;
  mode: "apply" | "dry-run";
  page: number;
}): Promise<HostedPulseTrialExtensionSummary> {
  const response = await fetch("/api/ops/pulse-trial-extension", {
    body: JSON.stringify({
      ...(input.campaign ? { campaign: input.campaign } : {}),
      ...(input.candidatePreviewTokens
        ? { candidatePreviewTokens: input.candidatePreviewTokens }
        : {}),
      ...(input.candidateSnapshotDigest
        ? { candidateSnapshotDigest: input.candidateSnapshotDigest }
        : {}),
      ...(input.memberId ? { memberId: input.memberId } : {}),
      mode: input.mode,
      page: input.page,
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new TrialExtensionRequestError({
      code: readJsonErrorCode(payload),
      message:
        readJsonErrorMessage(payload) ?? `Request failed with status ${response.status}.`,
    });
  }

  return payload as HostedPulseTrialExtensionSummary;
}

function readJsonErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
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
