"use client";

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react";

import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { Textarea } from "@/src/components/ui/textarea";
import type {
  HostedRuntimeRecheckResult,
  HostedRuntimeStalledRecheckOverview,
} from "@/src/lib/hosted-ops/runtime-maintenance";

export type RuntimeRecheckError = {
  kind: "read" | "request";
  message: string;
};

const HOSTED_MEMBER_ID_PATTERN = /^hbm_[A-Za-z0-9_-]+$/u;
const HOSTED_MEMBER_ID_MAX_LENGTH = 128;

export function parseRuntimeRecheckUserIds(value: string): {
  invalidEntries: string[];
  userIds: string[];
} {
  const invalidEntries: string[] = [];
  const userIds: string[] = [];
  const seen = new Set<string>();

  for (const entry of value.split(/[\n,]/u)) {
    const userId = entry.trim();
    if (!userId || seen.has(userId)) {
      continue;
    }
    seen.add(userId);
    if (
      userId.length > HOSTED_MEMBER_ID_MAX_LENGTH
      || !HOSTED_MEMBER_ID_PATTERN.test(userId)
    ) {
      invalidEntries.push(userId);
    } else {
      userIds.push(userId);
    }
  }

  return { invalidEntries, userIds };
}

export function removeSignaledRuntimeRecheckUserIds(
  value: string,
  result: HostedRuntimeRecheckResult,
): string {
  const signaledUserIds = new Set(
    result.results
      .filter((entry) => entry.status === "signaled")
      .map((entry) => entry.userId),
  );
  return parseRuntimeRecheckUserIds(value).userIds
    .filter((userId) => !signaledUserIds.has(userId))
    .join("\n");
}

export function RuntimeRecheckPanel({
  disabled,
  error,
  onInputChange,
  onRecheck,
  onRefresh,
  onUseDetectedCandidates,
  overview,
  pendingAction,
  result,
  userIdsText,
}: {
  disabled: boolean;
  error: RuntimeRecheckError | null;
  onInputChange: (value: string) => void;
  onRecheck: () => void;
  onRefresh: () => void;
  onUseDetectedCandidates: () => void;
  overview: HostedRuntimeStalledRecheckOverview;
  pendingAction: "recheck" | "refresh" | null;
  result: HostedRuntimeRecheckResult | null;
  userIdsText: string;
}) {
  const parsedInput = parseRuntimeRecheckUserIds(userIdsText);
  const hasInvalidInput = parsedInput.invalidEntries.length > 0;
  const queuedCount = parsedInput.userIds.length;
  const nextBatchCount = Math.min(queuedCount, 3);

  return (
    <section
      aria-busy={pendingAction !== null}
      aria-labelledby="runtime-rechecks-title"
      className="overflow-hidden rounded-xl border border-border/70 bg-card/90"
    >
      <div className="flex flex-col gap-4 border-b border-border/70 px-5 py-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
            Runtime recovery
          </span>
          <h2
            className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground"
            id="runtime-rechecks-title"
          >
            Runtime rechecks
          </h2>
          <p className="mt-2 text-pretty text-sm leading-6 text-muted-foreground">
            Signal specific member runtimes to reread their existing canonical work. Rechecks do not add mailbox items, change usage, or prove that recovery completed.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Badge className="tabular-nums" variant="secondary">
              {formatInteger(overview.totalCandidateCount)} detected
            </Badge>
            {overview.candidates.length < overview.totalCandidateCount ? (
              <Badge className="tabular-nums" variant="outline">
                {formatInteger(overview.candidates.length)} shown
              </Badge>
            ) : null}
            <Badge className="tabular-nums" variant="outline">
              Captured {formatDateTime(overview.generatedAt)}
            </Badge>
            {overview.scanTruncated ? (
              <Badge variant="outline">Scan truncated</Badge>
            ) : null}
          </div>
          <Button
            disabled={disabled}
            onClick={onRefresh}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCwIcon data-icon="inline-start" />
            {pendingAction === "refresh" ? "Refreshing..." : "Refresh discovery"}
          </Button>
        </div>
      </div>

      <div className="border-b border-border/70 px-5 py-5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <Label
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
              htmlFor="runtime-recheck-user-ids"
            >
              Member IDs
            </Label>
            <Badge className="tabular-nums" variant={hasInvalidInput ? "destructive" : "outline"}>
              {formatInteger(queuedCount)} queued
            </Badge>
          </div>
          <Textarea
            aria-describedby="runtime-recheck-user-ids-help"
            aria-invalid={hasInvalidInput}
            className="min-h-28 resize-y font-mono text-xs leading-5"
            disabled={disabled}
            id="runtime-recheck-user-ids"
            onChange={(event) => onInputChange(event.currentTarget.value)}
            placeholder={"hbm_member_one, hbm_member_two\nhbm_member_three"}
            rows={4}
            spellCheck={false}
            value={userIdsText}
          />
          <div
            aria-live="polite"
            className={hasInvalidInput
              ? "min-h-5 text-sm text-destructive"
              : "min-h-5 text-sm text-muted-foreground"}
            id="runtime-recheck-user-ids-help"
          >
            {describeQueuedRuntimeIds(parsedInput)}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            disabled={disabled || hasInvalidInput || overview.candidates.length === 0}
            onClick={onUseDetectedCandidates}
            size="sm"
            type="button"
            variant="outline"
          >
            Use detected candidates
          </Button>
          <Button
            disabled={disabled || hasInvalidInput || queuedCount === 0}
            onClick={onRecheck}
            size="sm"
            type="button"
          >
            <PlayIcon data-icon="inline-start" />
            {pendingAction === "recheck"
              ? "Requesting..."
              : `Recheck next ${formatInteger(nextBatchCount)}`}
          </Button>
        </div>

        <div aria-live="polite" className="min-h-5 pt-3 text-sm text-muted-foreground">
          {pendingAction === "refresh"
            ? "Refreshing automatic legacy-stall discovery. The member ID queue is unchanged."
            : pendingAction === "recheck"
              ? `Requesting ${formatInteger(nextBatchCount)} runtime recheck${nextBatchCount === 1 ? "" : "s"}.`
              : ""}
        </div>
      </div>

      {error ? (
        <div className="px-5 pt-4">
          <Alert variant="destructive">
            <AlertCircleIcon data-icon="inline-start" />
            <AlertDescription className="min-w-0 break-words">
              <p>{error.message}</p>
              <p>
                {error.kind === "request"
                  ? "Recheck status is unknown. The member IDs remain queued; verify runtime progress before retrying."
                  : "Automatic discovery could not refresh. The member ID queue is unchanged."}
              </p>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <RuntimeRecheckResultPanel result={result} />
      <RuntimeRecheckDiscovery overview={overview} />
    </section>
  );
}

function RuntimeRecheckResultPanel({
  result,
}: {
  result: HostedRuntimeRecheckResult | null;
}) {
  if (!result) {
    return null;
  }

  const failedCount = result.results.filter(
    (entry) => entry.status === "failed",
  ).length;
  const signaledCount = result.results.length - failedCount;

  return (
    <div className="mx-5 mt-4 rounded-lg border border-border/70 bg-muted/20">
      <div className="flex flex-col gap-2 border-b border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-serif text-base font-semibold tracking-tight text-foreground">
            Recheck result
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Generated {formatDateTime(result.generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="tabular-nums" variant="secondary">
            {formatInteger(signaledCount)} requested
          </Badge>
          {failedCount > 0 ? (
            <Badge className="tabular-nums" variant="destructive">
              {formatInteger(failedCount)} failed
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="divide-y divide-border/70">
        {result.results.map((entry) => (
          <div
            className="grid min-w-0 gap-2 px-4 py-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center"
            key={`${entry.userId}:${entry.status}`}
          >
            <Badge variant={entry.status === "signaled" ? "secondary" : "destructive"}>
              {entry.status === "signaled" ? (
                <CheckCircle2Icon data-icon="inline-start" />
              ) : (
                <AlertCircleIcon data-icon="inline-start" />
              )}
              {entry.status === "signaled" ? "Requested" : "Failed"}
            </Badge>
            <span className="min-w-0 break-all font-mono text-xs text-foreground">
              {entry.userId}
            </span>
            <span className="min-w-0 break-words text-xs text-muted-foreground">
              {entry.status === "signaled"
                ? "Signal acknowledged; removed from queue"
                : entry.errorMessage}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-border/70 px-4 py-3 text-pretty text-xs leading-5 text-muted-foreground">
        Acknowledged IDs are removed from the queue. Failed and unsent IDs remain. A recheck request is not proof of recovery.
      </div>
    </div>
  );
}

function RuntimeRecheckDiscovery({
  overview,
}: {
  overview: HostedRuntimeStalledRecheckOverview;
}) {
  return (
    <div className="pt-5">
      <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
            Automatic discovery
          </span>
          <h3 className="mt-1 font-serif text-lg font-semibold tracking-tight text-foreground">
            Detected legacy device-sync stalls
          </h3>
          <p className="mt-1 max-w-2xl text-pretty text-sm leading-6 text-muted-foreground">
            Active runtimes matching the proven legacy signature: a system mailbox head stuck on a device-sync wake for at least 15 minutes.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          “Use detected candidates” adds this captured list to the queue.
        </span>
      </div>

      {overview.candidates.length > 0 ? (
        <>
          <div className="divide-y divide-border/70 border-t border-border/70 sm:hidden">
            {overview.candidates.map((candidate) => (
              <div className="px-5 py-4" key={candidate.userId}>
                <p className="break-all font-mono text-xs leading-5 text-foreground">
                  {candidate.userId}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                      Pending items
                    </dt>
                    <dd className="mt-1 font-mono text-xs tabular-nums text-foreground">
                      {candidate.pendingItemCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                      Stalled since
                    </dt>
                    <dd className="mt-1 font-mono text-xs text-foreground">
                      {formatDateTime(candidate.stalledSince)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          <div className="hidden sm:block">
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">User</TableHead>
                  <TableHead className="text-right">Pending system items</TableHead>
                  <TableHead className="pr-5">Stalled since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.candidates.map((candidate) => (
                  <TableRow key={candidate.userId}>
                    <TableCell className="max-w-[30rem] whitespace-normal break-all pl-5 font-mono text-xs text-foreground">
                      {candidate.userId}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {candidate.pendingItemCount}
                    </TableCell>
                    <TableCell className="pr-5 font-mono text-xs">
                      {formatDateTime(candidate.stalledSince)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <p className="px-5 pb-7 pt-2 text-pretty text-sm leading-6 text-muted-foreground">
          No active runtimes currently match the legacy stall signature. You can still enter member IDs above.
        </p>
      )}
    </div>
  );
}

function describeQueuedRuntimeIds(input: ReturnType<typeof parseRuntimeRecheckUserIds>): string {
  if (input.invalidEntries.length > 0) {
    return `${formatInteger(input.invalidEntries.length)} invalid member ID${input.invalidEntries.length === 1 ? "" : "s"}. Use hbm_ followed by letters, numbers, underscores, or hyphens (128 characters max).`;
  }
  if (input.userIds.length === 0) {
    return "No member IDs queued. Paste comma- or newline-separated IDs, or use the detected candidates.";
  }

  const nextBatchCount = Math.min(input.userIds.length, 3);
  return `${formatInteger(input.userIds.length)} unique member ID${input.userIds.length === 1 ? "" : "s"} queued. The next request sends ${formatInteger(nextBatchCount)}.`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}
