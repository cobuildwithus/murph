"use client";

import {
  ActivityIcon,
  AlertCircleIcon,
  CheckCircle2Icon,
  Link2Icon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import type {
  HostedRuntimeMaintenanceOverview,
  HostedRuntimeMaintenanceWakeResult,
  HostedRuntimeMaintenanceWorkspace,
} from "@/src/lib/hosted-ops/runtime-maintenance";
import type { HostedOpsJunctionDiagnosticResult } from "@/src/lib/hosted-ops/device-sync-diagnostic-types";

interface RuntimeMaintenanceClientProps {
  initialOverview: HostedRuntimeMaintenanceOverview;
}

interface HostedOpsLinqThreadRouteEnsureResult {
  activationEventId: string | null;
  activationMailboxItemId: string | null;
  containerMemberId: string;
  created: boolean;
}

type PendingAction =
  | { kind: "ensure-thread-route" }
  | { kind: "junction-diagnostic" }
  | { kind: "refresh" }
  | { kind: "wake-batch"; limit: number }
  | { kind: "wake-user"; userId: string };

export function RuntimeMaintenanceClient({
  initialOverview,
}: RuntimeMaintenanceClientProps) {
  const [overview, setOverview] = useState(initialOverview);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [wakeResult, setWakeResult] = useState<HostedRuntimeMaintenanceWakeResult | null>(null);
  const [junctionDiagnosticResult, setJunctionDiagnosticResult] =
    useState<HostedOpsJunctionDiagnosticResult | null>(null);
  const [threadRouteResult, setThreadRouteResult] =
    useState<HostedOpsLinqThreadRouteEnsureResult | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [junctionDiagnosticError, setJunctionDiagnosticError] = useState<string | null>(null);
  const [threadRouteError, setThreadRouteError] = useState<string | null>(null);
  const generatedAt = useMemo(
    () => formatDateTime(overview.generatedAt),
    [overview.generatedAt],
  );
  const pendingLabel = describeMaintenancePendingAction(pending);

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
          body: JSON.stringify({ userId }),
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

  async function ensureThreadRoute(formData: FormData): Promise<void> {
    setPending({ kind: "ensure-thread-route" });
    setThreadRouteError(null);
    setThreadRouteResult(null);
    try {
      const result = await requestJson<HostedOpsLinqThreadRouteEnsureResult>(
        "/api/ops/thread-routes",
        {
          body: JSON.stringify({
            containerMemberId: readFormDataString(formData, "containerMemberId"),
            linqAccountPhoneNumber: readFormDataString(formData, "linqAccountPhoneNumber"),
            linqChatId: readFormDataString(formData, "linqChatId"),
            ownerMemberId: readFormDataString(formData, "ownerMemberId"),
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      setThreadRouteResult(result);
    } catch (routeError) {
      setThreadRouteError(describeClientError(routeError));
    } finally {
      setPending(null);
    }
  }

  async function runJunctionDiagnostic(formData: FormData): Promise<void> {
    setPending({ kind: "junction-diagnostic" });
    setJunctionDiagnosticError(null);
    setJunctionDiagnosticResult(null);
    try {
      const result = await requestJson<HostedOpsJunctionDiagnosticResult>(
        "/api/ops/device-sync/junction-diagnostics",
        {
          body: JSON.stringify({
            connectionId: readFormDataString(formData, "connectionId"),
            lookbackDays: readFormDataString(formData, "lookbackDays"),
            memberId: readFormDataString(formData, "memberId"),
            sourceProvider: readFormDataString(formData, "sourceProvider"),
            timeseriesDays: readFormDataString(formData, "timeseriesDays"),
            windowEnd: readFormDataString(formData, "windowEnd"),
            windowStart: readFormDataString(formData, "windowStart"),
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      setJunctionDiagnosticResult(result);
    } catch (diagnosticError) {
      setJunctionDiagnosticError(describeClientError(diagnosticError));
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
        aria-busy={pending?.kind === "ensure-thread-route"}
        aria-labelledby="runtime-thread-routes-title"
        className="rounded-xl border border-border/70 bg-card/90 p-5"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
              External threads
            </span>
            <h2
              className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground"
              id="runtime-thread-routes-title"
            >
              Add Linq groupchat route
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Creates or reuses a thread-container runtime for one Linq chat. Uses the default monthly cap.
            </p>
          </div>
          {threadRouteResult ? (
            <Badge variant={threadRouteResult.created ? "secondary" : "outline"}>
              <CheckCircle2Icon data-icon="inline-start" />
              {threadRouteResult.created ? "Created" : "Already routed"}
            </Badge>
          ) : null}
        </div>

        <form
          className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          onSubmit={(event) => {
            event.preventDefault();
            void ensureThreadRoute(new FormData(event.currentTarget));
          }}
        >
          <Field label="Owner member id" htmlFor="thread-route-owner-member-id">
            <Input
              autoComplete="off"
              id="thread-route-owner-member-id"
              name="ownerMemberId"
              placeholder="member_..."
              required
              spellCheck={false}
            />
          </Field>
          <Field label="Linq recipient phone" htmlFor="thread-route-linq-account-phone">
            <Input
              autoComplete="off"
              id="thread-route-linq-account-phone"
              inputMode="tel"
              name="linqAccountPhoneNumber"
              placeholder="+15550000000"
              required
              spellCheck={false}
            />
          </Field>
          <Field label="Linq chat id" htmlFor="thread-route-linq-chat-id">
            <Input
              autoComplete="off"
              id="thread-route-linq-chat-id"
              name="linqChatId"
              placeholder="chat_..."
              required
              spellCheck={false}
            />
          </Field>
          <Field label="Container member id" htmlFor="thread-route-container-member-id" optional>
            <Input
              autoComplete="off"
              id="thread-route-container-member-id"
              name="containerMemberId"
              placeholder="Auto-generate"
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-col gap-3 lg:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <div aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
              {pending?.kind === "ensure-thread-route" ? "Ensuring Linq thread route." : ""}
            </div>
            <Button
              disabled={pending !== null}
              type="submit"
            >
              <Link2Icon data-icon="inline-start" />
              {pending?.kind === "ensure-thread-route" ? "Ensuring..." : "Ensure route"}
            </Button>
          </div>
        </form>

        {threadRouteError ? (
          <Alert className="mt-4" variant="destructive">
            <AlertCircleIcon data-icon="inline-start" />
            <AlertDescription className="min-w-0 break-words">{threadRouteError}</AlertDescription>
          </Alert>
        ) : null}

        {threadRouteResult ? (
          <ThreadRouteResultPanel result={threadRouteResult} />
        ) : null}
      </section>

      <section
        aria-busy={pending?.kind === "junction-diagnostic"}
        aria-labelledby="runtime-junction-diagnostic-title"
        className="rounded-xl border border-border/70 bg-card/90 p-5"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
              Device sync
            </span>
            <h2
              className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground"
              id="runtime-junction-diagnostic-title"
            >
              Junction source diagnostic
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Runs the Junction matrix probe for one hosted member and selected source provider, then returns counts, status, and window metadata.
            </p>
          </div>
          {junctionDiagnosticResult ? (
            <Badge variant="secondary">
              <CheckCircle2Icon data-icon="inline-start" />
              Generated {formatDateTime(junctionDiagnosticResult.generatedAt)}
            </Badge>
          ) : null}
        </div>

        <form
          className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            void runJunctionDiagnostic(new FormData(event.currentTarget));
          }}
        >
          <Field label="Member id" htmlFor="junction-diagnostic-member-id">
            <Input
              autoComplete="off"
              id="junction-diagnostic-member-id"
              name="memberId"
              placeholder="member_..."
              required
              spellCheck={false}
            />
          </Field>
          <Field label="Source provider" htmlFor="junction-diagnostic-source-provider">
            <Input
              autoComplete="off"
              id="junction-diagnostic-source-provider"
              name="sourceProvider"
              placeholder="garmin, whoop_v2, oura"
              required
              spellCheck={false}
            />
          </Field>
          <Field label="Connection id" htmlFor="junction-diagnostic-connection-id" optional>
            <Input
              autoComplete="off"
              id="junction-diagnostic-connection-id"
              name="connectionId"
              placeholder="Only if ambiguous"
              spellCheck={false}
            />
          </Field>
          <Field label="Lookback days" htmlFor="junction-diagnostic-lookback-days">
            <Input
              autoComplete="off"
              id="junction-diagnostic-lookback-days"
              inputMode="numeric"
              max={180}
              min={1}
              name="lookbackDays"
              placeholder="180"
              spellCheck={false}
              type="number"
            />
          </Field>
          <Field label="Timeseries probe days" htmlFor="junction-diagnostic-timeseries-days">
            <Input
              autoComplete="off"
              id="junction-diagnostic-timeseries-days"
              inputMode="numeric"
              max={31}
              min={1}
              name="timeseriesDays"
              placeholder="7"
              spellCheck={false}
              type="number"
            />
          </Field>
          <Field label="Window start" htmlFor="junction-diagnostic-window-start" optional>
            <Input
              autoComplete="off"
              id="junction-diagnostic-window-start"
              name="windowStart"
              placeholder="Auto from lookback"
              spellCheck={false}
            />
          </Field>
          <Field label="Window end" htmlFor="junction-diagnostic-window-end" optional>
            <Input
              autoComplete="off"
              id="junction-diagnostic-window-end"
              name="windowEnd"
              placeholder="Now"
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-col gap-3 lg:col-span-2 xl:col-span-4 sm:flex-row sm:items-center sm:justify-between">
            <div aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
              {pending?.kind === "junction-diagnostic" ? "Running Junction diagnostic." : ""}
            </div>
            <Button
              disabled={pending !== null}
              type="submit"
            >
              <ActivityIcon data-icon="inline-start" />
              {pending?.kind === "junction-diagnostic" ? "Running..." : "Run diagnostic"}
            </Button>
          </div>
        </form>

        {junctionDiagnosticError ? (
          <Alert className="mt-4" variant="destructive">
            <AlertCircleIcon data-icon="inline-start" />
            <AlertDescription className="min-w-0 break-words">{junctionDiagnosticError}</AlertDescription>
          </Alert>
        ) : null}

        {junctionDiagnosticResult ? (
          <JunctionDiagnosticResultPanel result={junctionDiagnosticResult} />
        ) : null}
      </section>

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
          </div>
        </div>
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
                    onWake={() => wakeUser(workspace.userId)}
                    pending={isUserWakePending(pending, workspace.userId)}
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

function Field({
  children,
  htmlFor,
  label,
  optional = false,
}: {
  children: ReactNode;
  htmlFor: string;
  label: string;
  optional?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
          htmlFor={htmlFor}
        >
          {label}
        </Label>
        {optional ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Optional
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function ThreadRouteResultPanel({
  result,
}: {
  result: HostedOpsLinqThreadRouteEnsureResult;
}) {
  return (
    <div className="mt-4 rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Container member
      </div>
      <div className="mt-1 break-all font-mono text-xs text-foreground">
        {result.containerMemberId}
      </div>
      {result.activationMailboxItemId ? (
        <div className="mt-3 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
          <ResultValue label="Activation item" value={result.activationMailboxItemId} />
          <ResultValue label="Activation event" value={result.activationEventId ?? "-"} />
        </div>
      ) : null}
    </div>
  );
}

function JunctionDiagnosticResultPanel({
  result,
}: {
  result: HostedOpsJunctionDiagnosticResult;
}) {
  const matrix = result.matrix;
  const filteredHistoricalPull = matrix?.historicalPull.find((entry) => entry.scope === "selected_source") ?? null;
  const filteredIntrospection = matrix?.introspection.find((entry) => entry.scope === "selected_source") ?? null;
  const matrixRecordCount = matrix?.reads.reduce((total, entry) => total + (entry.recordCount ?? 0), 0) ?? 0;

  return (
    <div className="mt-5 flex flex-col gap-4 rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricTile label="Connection" value={result.selectedConnection.status} />
        <MetricTile
          label="Sources"
          value={formatInteger(result.webSourceProjection.sourceCount)}
        />
        <MetricTile
          label="Resources"
          value={formatNullableInteger(filteredIntrospection?.resourceCount ?? matrix?.resourceCount ?? null)}
        />
        <MetricTile
          label="Matrix records"
          value={formatInteger(matrixRecordCount)}
        />
      </div>

      <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-3">
        <ResultValue label="Member" value={result.memberId} />
        <ResultValue label="Source provider" value={result.sourceProvider} />
        <ResultValue label="Window start" value={formatDateTime(result.window.windowStart)} />
        <ResultValue label="Window end" value={formatDateTime(result.window.windowEnd)} />
        <ResultValue label="Last sync start" value={formatNullableDateTime(result.selectedConnection.lastSyncStartedAt)} />
        <ResultValue label="Last sync done" value={formatNullableDateTime(result.selectedConnection.lastSyncCompletedAt)} />
        <ResultValue label="Next reconcile" value={formatNullableDateTime(result.selectedConnection.nextReconcileAt)} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <StatusTile
          label="Connection backfill"
          value={formatBooleanStatus(result.backfill.hasUsefulHistoricalRecords)}
        />
        <StatusTile
          label="Historical pulled"
          value={formatNullableInteger(filteredHistoricalPull?.pulledCount ?? null)}
        />
        <StatusTile
          label="Historical not pulled"
          tone={(filteredHistoricalPull?.notPulledCount ?? 0) > 0 ? "warning" : "default"}
          value={formatNullableInteger(filteredHistoricalPull?.notPulledCount ?? null)}
        />
      </div>

      {filteredHistoricalPull?.pulled.length ? (
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card/90">
          <div className="border-b border-border/70 px-4 py-3">
            <h3 className="font-serif text-base font-semibold tracking-tight text-foreground">
              Historical pull
            </h3>
          </div>
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead>Resource</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Range</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredHistoricalPull.pulled.map((entry) => (
                <TableRow key={entry.resource}>
                  <TableCell className="font-mono text-xs text-foreground">{entry.resource}</TableCell>
                  <TableCell>
                    <Badge variant={entry.hasErrorDetails ? "destructive" : "outline"}>
                      {entry.status ?? "-"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatNullableInteger(entry.daysWithData)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatDateRange(entry.rangeStart, entry.rangeEnd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {matrix?.reads.length ? (
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card/90">
          <div className="border-b border-border/70 px-4 py-3">
            <h3 className="font-serif text-base font-semibold tracking-tight text-foreground">
              Matrix reads
            </h3>
          </div>
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead>Resource</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.reads.map((entry, index) => (
                <TableRow key={`${entry.resource ?? "resource"}:${entry.sourceFiltered}:${index}`}>
                  <TableCell className="font-mono text-xs text-foreground">{entry.resource ?? "-"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.sourceFiltered ? result.sourceProvider : "All"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{entry.resourceCategory ?? "-"}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatNullableInteger(entry.recordCount)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={entry.ok === false ? "destructive" : "outline"}>
                      {entry.errorCode ?? (entry.ok === false ? "Failed" : "OK")}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function MetricTile(input: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/90 px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-2 font-serif text-2xl font-semibold leading-none tracking-tight text-foreground tabular-nums">
        {input.value}
      </div>
    </div>
  );
}

function StatusTile(input: {
  label: string;
  tone?: "default" | "warning";
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/90 px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </div>
      <div className={input.tone === "warning"
        ? "mt-2 font-mono text-sm font-medium text-chart-5"
        : "mt-2 font-mono text-sm font-medium text-foreground"}
      >
        {input.value}
      </div>
    </div>
  );
}

function ResultValue(input: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em]">
        {input.label}
      </div>
      <div className="mt-1 break-all font-mono text-[11px] text-foreground">
        {input.value}
      </div>
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

function WorkspaceRow({
  disabled,
  onWake,
  pending,
  workspace,
}: {
  disabled: boolean;
  onWake: () => void;
  pending: boolean;
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
        <Button
          disabled={disabled}
          onClick={onWake}
          size="sm"
          type="button"
          variant="outline"
        >
          <PlayIcon data-icon="inline-start" />
          {pending ? "Waking..." : "Wake"}
        </Button>
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

function describeMaintenancePendingAction(pending: PendingAction | null): string {
  if (!pending) {
    return "";
  }
  if (pending.kind === "refresh") {
    return "Refreshing maintenance candidates.";
  }
  if (pending.kind === "ensure-thread-route") {
    return "";
  }
  if (pending.kind === "wake-batch") {
    return `Waking ${formatInteger(pending.limit)} workspace${pending.limit === 1 ? "" : "s"}.`;
  }
  if (pending.kind === "junction-diagnostic") {
    return "";
  }
  return `Waking ${pending.userId}.`;
}

function readFormDataString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isBatchWakePending(pending: PendingAction | null, limit: number): boolean {
  return pending?.kind === "wake-batch" && pending.limit === limit;
}

function isUserWakePending(pending: PendingAction | null, userId: string): boolean {
  return pending?.kind === "wake-user" && pending.userId === userId;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatNullableInteger(value: number | null): string {
  return value === null ? "-" : formatInteger(value);
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

function formatNullableDateTime(value: string | null): string {
  return value ? formatDateTime(value) : "-";
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) {
    return "-";
  }

  return `${start ?? "-"} to ${end ?? "-"}`;
}

function formatBooleanStatus(value: boolean | null): string {
  if (value === true) {
    return "Yes";
  }

  if (value === false) {
    return "No";
  }

  return "-";
}
