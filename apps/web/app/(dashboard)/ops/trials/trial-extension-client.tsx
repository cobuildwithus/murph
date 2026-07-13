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
  targetBatchIndex: number;
  targetContinuationToken: string | null;
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
            Recover unfinished provider trials, reconcile local records, and give
            eligible Pulse Trial members 7 more days. Preview shows what would
            change without touching anything; applying asks you to type the run
            key from the preview. Retries are safe: already extended trials are
            not extended again.
          </p>
        </div>
      </header>

      <TrialExtensionSection
        description="Closes the fixed Pulse Trial cohort started or redeemed before July 14 UTC, recovers and extends unfinished provider trials in one Apply, and cleans up obsolete provider trials without disturbing paid billing. Process the bounded provider phase and ordered batches of up to four members. After the July 14 UTC cutoff has passed, restart at Batch 1 and Preview every batch again. Retire the campaign only when that full pass shows zero trials to recover, clean up, extend, or reconcile."
        scope="all"
        title="Fixed campaign cohort"
      />
      <TrialExtensionSection
        description="Recovers and extends an unfinished provider trial in one Apply, or cleans up an obsolete one while preserving current billing."
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
  const [batchIndex, setBatchIndex] = useState(0);
  const [continuationHistory, setContinuationHistory] = useState<Array<string | null>>([
    null,
  ]);
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

  function resetToFirstBatch(): void {
    setBatchIndex(0);
    setContinuationHistory([null]);
    setPreview(null);
    setApplied(null);
    setConfirmation("");
  }

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

  async function previewExtension(
    requestedContinuationToken = continuationHistory[batchIndex] ?? null,
    requestedBatchIndex = batchIndex,
  ): Promise<void> {
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
        continuationToken: requestedContinuationToken,
        memberId: requestedMemberId,
        mode: "dry-run",
      });
      if (!summary.candidateSnapshotDigest) {
        throw new Error("Preview could not be verified. Preview again.");
      }
      setBatchIndex(requestedBatchIndex);
      setPreview({
        summary,
        targetBatchIndex: requestedBatchIndex,
        targetContinuationToken: requestedContinuationToken,
        targetMemberId: requestedMemberId,
      });
    } catch (requestError) {
      if (isTrialExtensionContinuationInvalidError(requestError)) {
        resetToFirstBatch();
        setError(`${readRequestErrorMessage(requestError)} Batch 1 is ready to Preview.`);
      } else {
        setError(readRequestErrorMessage(requestError));
      }
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
        continuationToken: preview.targetContinuationToken,
        memberId: preview.targetMemberId,
        mode: "apply",
      });
      setApplied(summary);
      if (
        !hasTrialExtensionFailures(summary) ||
        summary.localWindowsReconciled > 0 ||
        summary.failures.preview_state_changed > 0 ||
        summary.providerTrialsCleanedUp > 0 ||
        summary.providerTrialsRecovered > 0 ||
        summary.stripeTrialsExtended > 0 ||
        summary.skipped.local_candidate_changed > 0
      ) {
        setPreview(null);
        setConfirmation("");
      }
    } catch (requestError) {
      if (isTrialExtensionContinuationInvalidError(requestError)) {
        resetToFirstBatch();
        setError(`${readRequestErrorMessage(requestError)} Batch 1 is ready to Preview.`);
      } else {
        if (isTrialExtensionPreviewStaleError(requestError)) {
          setPreview(null);
          setConfirmation("");
        }
        setError(readRequestErrorMessage(requestError));
      }
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
                setBatchIndex(0);
                setContinuationHistory([null]);
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
          <div
            className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 p-4"
            ref={previewResultRef}
            tabIndex={-1}
          >
            <div aria-live="polite" role="status">
              <TrialExtensionSummaryPanel
                batchNumber={preview.targetBatchIndex + 1}
                scope={scope}
                summary={preview.summary}
              />
            </div>
            {!hasCompleteTrialExtensionPreviewProof(preview.summary) ? (
              <p className="border-t border-border/70 pt-4 text-sm text-muted-foreground">
                Apply is unavailable until Preview completes without failures.
              </p>
            ) : preview.summary.wouldExtend > 0 ||
              preview.summary.wouldRecoverProviderTrial > 0 ||
              preview.summary.wouldCleanupProviderTrial > 0 ||
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
                  ? "Nothing to change in this batch. This is complete only after every batch in a fresh pass shows zero provider trials to recover or clean up, zero trials to extend, and zero records to reconcile."
                  : hasTrialExtensionFailures(preview.summary)
                    ? "Retry this batch before continuing the member search."
                  : preview.summary.hasMoreCandidates
                    ? "Nothing to change in this batch. Preview the next batch to continue the member search."
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
            <TrialExtensionSummaryPanel
              batchNumber={batchIndex + 1}
              scope={scope}
              summary={applied}
            />
            {applied.providerTrialsCleanedUp > 0 ? (
              <p className="border-t border-border/70 pt-4 text-sm text-muted-foreground">
                Obsolete provider trial cleaned up. Current billing was left unchanged.
              </p>
            ) : null}
          </div>
        ) : null}

        {displayedSummary || batchIndex > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
            {batchIndex > 0 ? (
              <Button
                disabled={pending !== null}
                onClick={() => {
                  resetToFirstBatch();
                  void previewExtension(null, 0);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Restart at Batch 1
              </Button>
            ) : null}
            <Button
              disabled={pending !== null || batchIndex === 0}
              onClick={() => {
                const previousBatchIndex = batchIndex - 1;
                void previewExtension(
                  continuationHistory[previousBatchIndex] ?? null,
                  previousBatchIndex,
                );
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Previous batch
            </Button>
            {displayedSummary ? (
              <Button
                disabled={
                  pending !== null ||
                  hasTrialExtensionFailures(displayedSummary) ||
                  !displayedSummary.hasMoreCandidates ||
                  !displayedSummary.nextContinuationToken
                }
                onClick={() => {
                  const nextContinuationToken = displayedSummary.nextContinuationToken;
                  if (!nextContinuationToken) {
                    return;
                  }
                  const nextBatchIndex = batchIndex + 1;
                  setContinuationHistory((current) => [
                    ...current.slice(0, nextBatchIndex),
                    nextContinuationToken,
                  ]);
                  void previewExtension(nextContinuationToken, nextBatchIndex);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Preview next batch
              </Button>
            ) : null}
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
  batchNumber,
  scope,
  summary,
}: {
  batchNumber: number;
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
        {scope === "all" || summary.hasMoreCandidates || batchNumber > 1 ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            Batch {batchNumber}
            {summary.hasMoreCandidates ? " · more batches" : " · final batch"}
          </span>
        ) : null}
      </div>

      {scope === "member" && summary.candidates === 0 ? (
        <p className="text-sm text-muted-foreground">
          {hasFailures
            ? "Retry this batch before continuing the member search."
            : summary.hasMoreCandidates
            ? "No eligible campaign trial in this batch. Preview the next batch to continue the member search."
            : batchNumber > 1
              ? "Member search complete. No additional eligible campaign trial was found."
              : "No eligible campaign trial found for that member id."}
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
              <TrialExtensionMetricTile
                label="Would clean up trial"
                value={summary.wouldCleanupProviderTrial}
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
              <TrialExtensionMetricTile
                label="Provider trials cleaned up"
                value={summary.providerTrialsCleanedUp}
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
            {formatTrialExtensionReason(reason)} ({count})
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

function isTrialExtensionContinuationInvalidError(requestError: unknown): boolean {
  return (
    requestError instanceof TrialExtensionRequestError &&
    requestError.code === "HOSTED_OPS_PULSE_TRIAL_EXTENSION_CONTINUATION_INVALID"
  );
}

function formatTrialExtensionReason(reason: string): string {
  return reason === "provider_trial_ended"
    ? "Provider trial already ended — no action needed"
    : reason;
}

async function requestTrialExtension(input: {
  campaign: string | null;
  candidatePreviewTokens: readonly string[] | null;
  candidateSnapshotDigest: string | null;
  continuationToken: string | null;
  memberId: string | null;
  mode: "apply" | "dry-run";
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
      ...(input.continuationToken
        ? { continuationToken: input.continuationToken }
        : {}),
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
