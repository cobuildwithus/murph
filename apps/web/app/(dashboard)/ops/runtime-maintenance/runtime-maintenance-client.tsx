"use client";

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  PlayIcon,
  RefreshCwIcon,
  WrenchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import type {
  HostedRuntimeManagedAutomationRepairResult,
  HostedRuntimeMaintenanceOverview,
  HostedRuntimeMaintenanceWakeResult,
  HostedRuntimeMaintenanceWorkspace,
} from "@/src/lib/hosted-ops/runtime-maintenance";

interface RuntimeMaintenanceClientProps {
  initialOverview: HostedRuntimeMaintenanceOverview;
}

type PendingAction =
  | { kind: "refresh" }
  | { kind: "seed-batch"; limit: number }
  | { kind: "seed-user"; userId: string }
  | { kind: "wake-batch"; limit: number }
  | { kind: "wake-user"; userId: string };

export function RuntimeMaintenanceClient({
  initialOverview,
}: RuntimeMaintenanceClientProps) {
  const [overview, setOverview] = useState(initialOverview);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [repairResult, setRepairResult] =
    useState<HostedRuntimeManagedAutomationRepairResult | null>(null);
  const [repairUserId, setRepairUserId] = useState("");
  const [wakeResult, setWakeResult] = useState<HostedRuntimeMaintenanceWakeResult | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generatedAt = useMemo(
    () => formatDateTime(overview.generatedAt),
    [overview.generatedAt],
  );
  const pendingLabel = describePendingAction(pending);

  async function refreshOverview(cursor = overview.nextCursor): Promise<void> {
    setPending({ kind: "refresh" });
    setError(null);
    try {
      setOverview(await fetchOverview({
        cursor,
        limit: overview.limit,
      }));
      setCurrentCursor(cursor);
    } catch (refreshError) {
      setError(describeClientError(refreshError));
    } finally {
      setPending(null);
    }
  }

  async function wakeBatch(limit: number): Promise<void> {
    setPending({ kind: "wake-batch", limit });
    setError(null);
    try {
      setWakeResult(await requestJson<HostedRuntimeMaintenanceWakeResult>(
        "/api/ops/runtime-maintenance",
        {
          body: JSON.stringify({
            action: "wake-maintenance",
            cursor: currentCursor,
            limit,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      ));
      setOverview(await fetchOverview({
        cursor: currentCursor,
        limit: overview.limit,
      }));
    } catch (wakeError) {
      setError(describeClientError(wakeError));
    } finally {
      setPending(null);
    }
  }

  async function wakeUser(userId: string): Promise<void> {
    setPending({ kind: "wake-user", userId });
    setError(null);
    try {
      setWakeResult(await requestJson<HostedRuntimeMaintenanceWakeResult>(
        "/api/ops/runtime-maintenance",
        {
          body: JSON.stringify({
            action: "wake-maintenance",
            userId,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      ));
      setOverview(await fetchOverview({
        cursor: currentCursor,
        limit: overview.limit,
      }));
    } catch (wakeError) {
      setError(describeClientError(wakeError));
    } finally {
      setPending(null);
    }
  }

  async function seedBatch(limit: number): Promise<void> {
    setPending({ kind: "seed-batch", limit });
    setError(null);
    try {
      setRepairResult(await requestJson<HostedRuntimeManagedAutomationRepairResult>(
        "/api/ops/runtime-maintenance",
        {
          body: JSON.stringify({
            action: "seed-managed-automations",
            cursor: currentCursor,
            limit,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      ));
      setOverview(await fetchOverview({
        cursor: currentCursor,
        limit: overview.limit,
      }));
    } catch (seedError) {
      setError(describeClientError(seedError));
    } finally {
      setPending(null);
    }
  }

  async function seedUser(userId: string): Promise<void> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      setError("Enter a hosted user id to seed.");
      return;
    }

    setPending({ kind: "seed-user", userId: normalizedUserId });
    setError(null);
    try {
      setRepairResult(await requestJson<HostedRuntimeManagedAutomationRepairResult>(
        "/api/ops/runtime-maintenance",
        {
          body: JSON.stringify({
            action: "seed-managed-automations",
            userId: normalizedUserId,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      ));
      setOverview(await fetchOverview({
        cursor: currentCursor,
        limit: overview.limit,
      }));
    } catch (seedError) {
      setError(describeClientError(seedError));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border/70 pb-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
              Ops notebook
            </span>
            <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
              Runtime maintenance
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Wake active hosted workspaces that already have a checkpoint snapshot so runtime idle maintenance can run.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SummaryChip label="Candidates" value={formatInteger(overview.totalCandidateCount)} />
            <SummaryChip label="Page size" value={formatInteger(overview.limit)} />
            <SummaryChip label="Generated" value={generatedAt} />
          </div>
        </div>
      </header>

      <section
        aria-busy={pending !== null}
        aria-labelledby="runtime-maintenance-actions-title"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              className="font-serif text-xl font-semibold tracking-tight text-foreground"
              id="runtime-maintenance-actions-title"
            >
              Maintenance wakes
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Wakes append one durable system mailbox item per workspace, then signal the existing hosted runtime workflow.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending !== null}
              onClick={() => refreshOverview(null)}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCwIcon data-icon="inline-start" />
              {pending?.kind === "refresh" ? "Refreshing..." : "Refresh"}
            </Button>
            <Button
              disabled={pending !== null}
              onClick={() => wakeBatch(1)}
              size="sm"
              type="button"
            >
              <PlayIcon data-icon="inline-start" />
              {isBatchWakePending(pending, 1) ? "Waking..." : "Wake 1"}
            </Button>
            <Button
              disabled={pending !== null}
              onClick={() => wakeBatch(3)}
              size="sm"
              type="button"
              variant="secondary"
            >
              <PlayIcon data-icon="inline-start" />
              {isBatchWakePending(pending, 3) ? "Waking..." : "Wake 3"}
            </Button>
            <Button
              disabled={pending !== null}
              onClick={() => seedBatch(1)}
              size="sm"
              type="button"
              variant="outline"
            >
              <WrenchIcon data-icon="inline-start" />
              {isBatchSeedPending(pending, 1) ? "Seeding..." : "Seed 1"}
            </Button>
            <Button
              disabled={pending !== null}
              onClick={() => seedBatch(3)}
              size="sm"
              type="button"
              variant="secondary"
            >
              <WrenchIcon data-icon="inline-start" />
              {isBatchSeedPending(pending, 3) ? "Seeding..." : "Seed 3"}
            </Button>
          </div>
        </div>
        <form
          className="flex max-w-2xl flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void seedUser(repairUserId);
          }}
        >
          <Input
            aria-label="Hosted user id"
            className="font-mono text-xs"
            disabled={pending !== null}
            onChange={(event) => setRepairUserId(event.target.value)}
            placeholder="hbm_..."
            value={repairUserId}
          />
          <Button
            className="shrink-0"
            disabled={pending !== null}
            size="sm"
            type="submit"
            variant="outline"
          >
            <WrenchIcon data-icon="inline-start" />
            Seed user
          </Button>
        </form>
        <div aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
          {pendingLabel}
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon data-icon="inline-start" />
            <AlertDescription className="min-w-0 break-words">{error}</AlertDescription>
          </Alert>
        ) : null}

        {wakeResult ? (
          <WakeResultPanel result={wakeResult} />
        ) : null}

        {repairResult ? (
          <RepairResultPanel result={repairResult} />
        ) : null}
      </section>

      <section
        aria-labelledby="runtime-maintenance-candidates-title"
        className="overflow-hidden rounded-xl border border-border/70 bg-card/90"
      >
        <div className="flex flex-col gap-2 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
              Candidates
            </span>
            <h2
              className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground"
              id="runtime-maintenance-candidates-title"
            >
              Active checkpointed workspaces
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {overview.nextCursor ? (
              <Button
                disabled={pending !== null}
                onClick={() => refreshOverview(overview.nextCursor)}
                size="sm"
                type="button"
                variant="outline"
              >
                <RefreshCwIcon data-icon="inline-start" />
                Next page
              </Button>
            ) : null}
          </div>
        </div>
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Checkpointed</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.candidates.length > 0
              ? overview.candidates.map((workspace) => (
                  <WorkspaceRow
                    key={workspace.userId}
                    disabled={pending !== null}
                    onSeed={() => seedUser(workspace.userId)}
                    onWake={() => wakeUser(workspace.userId)}
                    seedPending={isUserSeedPending(pending, workspace.userId)}
                    wakePending={isUserWakePending(pending, workspace.userId)}
                    workspace={workspace}
                  />
                ))
              : (
                  <TableRow>
                    <TableCell className="px-5 py-8 text-sm text-muted-foreground" colSpan={5}>
                      No active checkpointed workspaces found.
                    </TableCell>
                  </TableRow>
                )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function WakeResultPanel({
  result,
}: {
  result: HostedRuntimeMaintenanceWakeResult;
}) {
  const signaledCount = result.results.filter((entry) => entry.status === "signaled").length;
  const failedCount = result.results.length - signaledCount;

  return (
    <div className="rounded-xl border border-border/70 bg-card/90">
      <div className="flex flex-col gap-2 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Wake result
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Generated {formatDateTime(result.generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{formatInteger(signaledCount)} signaled</Badge>
          {failedCount > 0 ? (
            <Badge variant="destructive">{formatInteger(failedCount)} failed</Badge>
          ) : null}
        </div>
      </div>
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.results.map((entry) => (
            <TableRow key={entry.userId}>
              <TableCell>
                {entry.status === "signaled" ? (
                  <Badge variant="secondary">
                    <CheckCircle2Icon data-icon="inline-start" />
                    Signaled
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <AlertCircleIcon data-icon="inline-start" />
                    Failed
                  </Badge>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs text-foreground">{entry.userId}</TableCell>
              <TableCell className="font-mono text-xs">{entry.version}</TableCell>
              <TableCell className="max-w-[32rem] whitespace-normal break-words text-sm text-muted-foreground">
                <span title={entry.status === "signaled" ? entry.workflowId : entry.errorMessage}>
                  {entry.status === "signaled" ? entry.workflowId : entry.errorMessage}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RepairResultPanel({
  result,
}: {
  result: HostedRuntimeManagedAutomationRepairResult;
}) {
  const enqueuedCount = result.results.filter((entry) => entry.status === "enqueued").length;
  const routeMissingCount =
    result.results.filter((entry) => entry.status === "route_missing").length;
  const failedCount = result.results.filter((entry) => entry.status === "failed").length;

  return (
    <div className="rounded-xl border border-border/70 bg-card/90">
      <div className="flex flex-col gap-2 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Seed result
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Generated {formatDateTime(result.generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{formatInteger(enqueuedCount)} enqueued</Badge>
          {routeMissingCount > 0 ? (
            <Badge variant="outline">{formatInteger(routeMissingCount)} no route</Badge>
          ) : null}
          {failedCount > 0 ? (
            <Badge variant="destructive">{formatInteger(failedCount)} failed</Badge>
          ) : null}
        </div>
      </div>
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.results.map((entry) => (
            <TableRow key={entry.userId}>
              <TableCell>
                {entry.status === "enqueued" ? (
                  <Badge variant="secondary">
                    <CheckCircle2Icon data-icon="inline-start" />
                    Enqueued
                  </Badge>
                ) : entry.status === "route_missing" ? (
                  <Badge variant="outline">
                    <AlertCircleIcon data-icon="inline-start" />
                    No route
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <AlertCircleIcon data-icon="inline-start" />
                    Failed
                  </Badge>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs text-foreground">{entry.userId}</TableCell>
              <TableCell className="font-mono text-xs">{entry.version}</TableCell>
              <TableCell className="max-w-[32rem] whitespace-normal break-words text-sm text-muted-foreground">
                {renderRepairResultDetail(entry)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function WorkspaceRow({
  disabled,
  onSeed,
  onWake,
  seedPending,
  wakePending,
  workspace,
}: {
  disabled: boolean;
  onSeed: () => void;
  onWake: () => void;
  seedPending: boolean;
  wakePending: boolean;
  workspace: HostedRuntimeMaintenanceWorkspace;
}) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs text-foreground">{workspace.userId}</TableCell>
      <TableCell className="font-mono text-xs">{workspace.version}</TableCell>
      <TableCell className="font-mono text-xs">
        {workspace.checkpointedAt ? formatDateTime(workspace.checkpointedAt) : "-"}
      </TableCell>
      <TableCell className="font-mono text-xs">{formatDateTime(workspace.updatedAt)}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            disabled={disabled}
            onClick={onSeed}
            size="sm"
            type="button"
            variant="outline"
          >
            <WrenchIcon data-icon="inline-start" />
            {seedPending ? "Seeding..." : "Seed"}
          </Button>
          <Button
            disabled={disabled}
            onClick={onWake}
            size="sm"
            type="button"
            variant="outline"
          >
            <PlayIcon data-icon="inline-start" />
            {wakePending ? "Waking..." : "Wake"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function SummaryChip(input: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-1 font-mono text-[11px] font-medium text-foreground">
        {input.value}
      </div>
    </div>
  );
}

async function requestJson<TResponse>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readJsonErrorMessage(payload) ?? `Request failed with status ${response.status}.`);
  }

  return payload as TResponse;
}

async function fetchOverview(input: {
  cursor: string | null;
  limit: number;
}): Promise<HostedRuntimeMaintenanceOverview> {
  const params = new URLSearchParams({
    limit: String(input.limit),
  });
  if (input.cursor) {
    params.set("cursor", input.cursor);
  }

  return requestJson<HostedRuntimeMaintenanceOverview>(
    `/api/ops/runtime-maintenance?${params.toString()}`,
  );
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

function describeClientError(error: unknown): string {
  return error instanceof Error ? error.message : "Runtime maintenance request failed.";
}

function describePendingAction(pending: PendingAction | null): string {
  if (!pending) {
    return "";
  }
  if (pending.kind === "refresh") {
    return "Refreshing maintenance candidates.";
  }
  if (pending.kind === "wake-batch") {
    return `Waking ${formatInteger(pending.limit)} workspace${pending.limit === 1 ? "" : "s"}.`;
  }
  if (pending.kind === "wake-user") {
    return `Waking ${pending.userId}.`;
  }
  if (pending.kind === "seed-batch") {
    return `Seeding ${formatInteger(pending.limit)} workspace${pending.limit === 1 ? "" : "s"}.`;
  }
  return `Seeding ${pending.userId}.`;
}

function isBatchSeedPending(pending: PendingAction | null, limit: number): boolean {
  return pending?.kind === "seed-batch" && pending.limit === limit;
}

function isBatchWakePending(pending: PendingAction | null, limit: number): boolean {
  return pending?.kind === "wake-batch" && pending.limit === limit;
}

function isUserSeedPending(pending: PendingAction | null, userId: string): boolean {
  return pending?.kind === "seed-user" && pending.userId === userId;
}

function isUserWakePending(pending: PendingAction | null, userId: string): boolean {
  return pending?.kind === "wake-user" && pending.userId === userId;
}

function renderRepairResultDetail(
  entry: HostedRuntimeManagedAutomationRepairResult["results"][number],
): string {
  if (entry.status === "enqueued") {
    return `${entry.workflowId} / ${entry.inserted ? "inserted" : "deduped"} / ${entry.mailboxItemId}`;
  }
  if (entry.status === "route_missing") {
    return "No hosted delivery route could be resolved.";
  }
  return entry.errorMessage;
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
