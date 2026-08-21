"use client";

import { RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/src/components/ui/field";
import { Input } from "@/src/components/ui/input";
import { Spinner } from "@/src/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import type {
  HostedOpsMemberUsageDashboard,
  HostedOpsMemberUsageResetResponse,
  HostedOpsMemberUsageRow,
} from "@/src/lib/hosted-ops/member-usage";
import {
  HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
  type HostedOpsMemberUsageResetAllBatchResponse,
  type HostedOpsMemberUsageResetAllCounts,
  type HostedOpsMemberUsageResetAllWakeBatchResponse,
} from "@/src/lib/hosted-ops/member-usage-contract";

interface UsageResetMessage {
  text: string;
  tone: "error" | "success";
}

interface UsagePostCommit {
  dashboardCapturedAt: string;
  memberId: string;
  resetMode: HostedOpsMemberUsageResetResponse["resetMode"];
  runtimeRecheckStatus: "accepted" | "pending";
}

interface UsageRowRecovery {
  postCommitStatus: UsagePostCommit["runtimeRecheckStatus"] | null;
  resetMode: HostedOpsMemberUsageResetResponse["resetMode"] | null;
  runtimeRecheckAvailable: boolean;
}

interface UsageRuntimeRecheckResponse {
  memberId: string;
  runtimeRecheckStatus: "accepted" | "pending";
}

export type MemberUsageClientDesignState =
  | "row_stale_error"
  | "search_loading"
  | "reset_all_abandonment"
  | "reset_all_complete"
  | "reset_all_confirmation"
  | "reset_all_partial_failure"
  | "reset_all_progress"
  | "reset_all_wake_recovery";

interface UsageResetAllFailureState {
  ambiguous: boolean;
  memberId: string | null;
  message: string;
}

interface UsageResetAllState {
  counts: HostedOpsMemberUsageResetAllCounts;
  failure: UsageResetAllFailureState | null;
  lastAcknowledgedCursor: string | null;
  phase:
    | "abandoning"
    | "complete"
    | "confirming"
    | "idle"
    | "paused"
    | "recovering_wakes"
    | "running";
}

type UsageResetAllRunMode = "recover_wakes" | "resume" | "start";

const EMPTY_RESET_ALL_COUNTS: HostedOpsMemberUsageResetAllCounts = {
  failed: 0,
  pendingWake: 0,
  processed: 0,
  reset: 0,
  skipped: 0,
  unchanged: 0,
};

class UsageResetRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "UsageResetRequestError";
  }
}

interface MemberUsageClientProps {
  dashboard: HostedOpsMemberUsageDashboard;
  designResetAllInline?: boolean;
  designState?: MemberUsageClientDesignState;
}

export function MemberUsageClient(props: MemberUsageClientProps) {
  return (
    <MemberUsageClientSurface
      key={props.dashboard.search.query ?? ""}
      {...props}
    />
  );
}

function MemberUsageClientSurface({
  dashboard,
  designResetAllInline = false,
  designState,
}: MemberUsageClientProps) {
  const router = useRouter();
  const resetAllAcknowledgedCursors = useRef<Set<string>>(new Set());
  const resetAllOperationId = useRef<string | null>(null);
  const resetAllPageActive = useRef(true);
  const resetAllRunInFlight = useRef(false);
  const initialResetAllState = createInitialResetAllState(designState);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [resettingMemberId, setResettingMemberId] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<UsageResetMessage | null>(
    designState === "row_stale_error"
      ? {
          text:
            "Usage changed after this table loaded. Refresh and review the current row before resetting it.",
          tone: "error",
        }
      : null,
  );
  const [postCommit, setPostCommit] = useState<UsagePostCommit | null>(null);
  const [searchQuery, setSearchQuery] = useState(
    dashboard.search.query ?? "",
  );
  const [searchNavigationPending, setSearchNavigationPending] = useState(
    designState === "search_loading",
  );
  const [resetAllOpen, setResetAllOpen] = useState(
    initialResetAllState.phase !== "idle",
  );
  const [resetAllConfirmation, setResetAllConfirmation] = useState(
    designState === "reset_all_confirmation"
      ? HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION
      : "",
  );
  const [resetAllState, setResetAllState] = useState(initialResetAllState);
  const selectedRow = useMemo(
    () => dashboard.rows.find((row) => row.memberId === selectedMemberId)
      ?? null,
    [dashboard.rows, selectedMemberId],
  );
  const isResetting = resettingMemberId !== null;
  const preservedResetAllOperation = !resetAllOpen
    && resetAllState.phase === "paused"
    && resetAllOperationId.current !== null;
  const globalResetActive = resetAllOpen || preservedResetAllOperation;
  const phoneSearchRequiresExactLookup =
    dashboard.search.kind === "phone_last_four"
    && (dashboard.search.capped || dashboard.search.resultCount !== 1);
  const selectedRecovery = selectedRow
    ? readUsageRowRecovery(dashboard.capturedAt, postCommit, selectedRow)
    : null;
  const selectedRuntimeRecheck =
    selectedRecovery?.runtimeRecheckAvailable ?? false;

  useEffect(() => {
    resetAllPageActive.current = true;
    return () => {
      resetAllPageActive.current = false;
    };
  }, []);

  function openPage(
    direction: "after" | "before",
    cursor: string | null,
  ): void {
    if (!cursor) {
      return;
    }
    const params = new URLSearchParams({ [direction]: cursor });
    router.push(`/ops/usage?${params.toString()}`);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (searchNavigationPending || globalResetActive) {
      return;
    }
    const query = searchQuery.trim();
    if (query === (dashboard.search.query ?? "")) {
      return;
    }
    const targetQuery = query.length > 0 ? query : null;
    setSearchNavigationPending(true);
    router.push(targetQuery
      ? `/ops/usage?${new URLSearchParams({ q: targetQuery }).toString()}`
      : "/ops/usage");
  }

  function openResetAllDialog(): void {
    if (isResetting) {
      return;
    }
    setSelectedMemberId(null);
    setMessage(null);
    if (
      resetAllOperationId.current
      && resetAllState.phase === "paused"
    ) {
      setResetAllOpen(true);
      return;
    }
    resetAllAcknowledgedCursors.current.clear();
    resetAllOperationId.current = null;
    setResetAllConfirmation("");
    setResetAllState(createInitialResetAllState("reset_all_confirmation"));
    setResetAllOpen(true);
  }

  function closeResetAllDialog(): void {
    if (
      resetAllRunInFlight.current
      || resetAllState.phase === "running"
      || resetAllState.phase === "recovering_wakes"
    ) {
      return;
    }
    if (
      resetAllOperationId.current
      && (
        resetAllState.phase === "paused"
        || resetAllState.phase === "abandoning"
      )
    ) {
      setResetAllState({ ...resetAllState, phase: "paused" });
      setResetAllOpen(false);
      return;
    }
    clearResetAllOperation();
  }

  function clearResetAllOperation(): void {
    setResetAllOpen(false);
    resetAllAcknowledgedCursors.current.clear();
    resetAllOperationId.current = null;
    setResetAllConfirmation("");
    setResetAllState(createInitialResetAllState(undefined));
  }

  function requestResetAllAbandonment(): void {
    if (
      resetAllOperationId.current
      && resetAllState.phase === "paused"
    ) {
      setResetAllState({ ...resetAllState, phase: "abandoning" });
    }
  }

  function keepResetAllOperation(): void {
    setResetAllState({ ...resetAllState, phase: "paused" });
  }

  async function runResetAll(input: { mode: UsageResetAllRunMode }): Promise<void> {
    if (resetAllRunInFlight.current) {
      return;
    }
    resetAllRunInFlight.current = true;
    try {
      if (input.mode === "recover_wakes") {
        const operationId = resetAllOperationId.current;
        if (!operationId) {
          setResetAllState({
            ...resetAllState,
            failure: {
              ambiguous: false,
              memberId: null,
              message:
                "This reset operation is no longer available. Close and start Reset everyone again.",
            },
            phase: "recovering_wakes",
          });
          return;
        }
        await runResetAllWakeRecovery(operationId);
        return;
      }
      if (input.mode !== "resume") {
        resetAllAcknowledgedCursors.current.clear();
      } else if (resetAllState.lastAcknowledgedCursor) {
        resetAllAcknowledgedCursors.current.add(
          resetAllState.lastAcknowledgedCursor,
        );
      }
      const startingCounts = input.mode !== "resume"
        ? { ...EMPTY_RESET_ALL_COUNTS }
        : { ...resetAllState.counts, failed: 0 };
      let counts = startingCounts;
      let lastAcknowledgedCursor = input.mode !== "resume"
        ? null
        : resetAllState.lastAcknowledgedCursor;
      let operationId = resetAllOperationId.current;
      if (!operationId) {
        try {
          operationId = createResetAllOperationId();
          resetAllOperationId.current = operationId;
        } catch (error) {
          if (resetAllPageActive.current) {
            setResetAllState({
              counts,
              failure: {
                ambiguous: false,
                memberId: null,
                message: error instanceof Error
                  ? error.message
                  : "This browser cannot start Reset everyone safely.",
              },
              lastAcknowledgedCursor,
              phase: "paused",
            });
          }
          return;
        }
      }
      setResetAllState({
        counts,
        failure: null,
        lastAcknowledgedCursor,
        phase: "running",
      });

      while (resetAllPageActive.current) {
        const previousCursor = lastAcknowledgedCursor;
        let batch: HostedOpsMemberUsageResetAllBatchResponse;
        try {
          batch = await requestResetAllBatch(
            lastAcknowledgedCursor,
            operationId,
          );
        } catch (error) {
          if (!resetAllPageActive.current) {
            return;
          }
          setResetAllState({
            counts,
            failure: {
              ambiguous: true,
              memberId: null,
              message: error instanceof Error
                ? error.message
                : "The batch response was ambiguous. Resume from the last acknowledged cursor.",
            },
            lastAcknowledgedCursor,
            phase: "paused",
          });
          return;
        }
        if (!resetAllPageActive.current) {
          return;
        }

        const acknowledgedCursor = batch.lastAcknowledgedCursor;
        const cursorAcknowledgesBatch = batch.counts.processed === 0
          ? acknowledgedCursor === previousCursor
          : acknowledgedCursor !== null
            && acknowledgedCursor !== previousCursor
            && !resetAllAcknowledgedCursors.current.has(acknowledgedCursor);
        if (
          !cursorAcknowledgesBatch
          || (
            batch.counts.processed === 0
            && batch.failure === null
            && !batch.done
          )
        ) {
          setResetAllState({
            counts,
            failure: {
              ambiguous: true,
              memberId: null,
              message:
                "The server did not acknowledge forward progress. Resume from the last acknowledged cursor.",
            },
            lastAcknowledgedCursor,
            phase: "paused",
          });
          return;
        }

        counts = addResetAllCounts(counts, batch.counts);
        lastAcknowledgedCursor = acknowledgedCursor;
        if (acknowledgedCursor) {
          resetAllAcknowledgedCursors.current.add(acknowledgedCursor);
        }
        if (batch.failure) {
          setResetAllState({
            counts,
            failure: {
              ambiguous: false,
              memberId: batch.failure.memberId,
              message: batch.failure.message,
            },
            lastAcknowledgedCursor,
            phase: "paused",
          });
          return;
        }
        if (batch.done) {
          if (counts.pendingWake > 0) {
            setResetAllState({
              counts,
              failure: null,
              lastAcknowledgedCursor,
              phase: "recovering_wakes",
            });
            return;
          }
          setResetAllState({
            counts,
            failure: null,
            lastAcknowledgedCursor,
            phase: "complete",
          });
          router.refresh();
          return;
        }
        setResetAllState({
          counts,
          failure: null,
          lastAcknowledgedCursor,
          phase: "running",
        });
      }
    } finally {
      resetAllRunInFlight.current = false;
    }
  }

  async function runResetAllWakeRecovery(operationId: string): Promise<void> {
    const wakeAcknowledgedCursors = new Set<string>();
    let wakeCursor: string | null = null;
    let counts = {
      ...resetAllState.counts,
      failed: 0,
      pendingWake: 0,
    };
    setResetAllState({
      counts,
      failure: null,
      lastAcknowledgedCursor: resetAllState.lastAcknowledgedCursor,
      phase: "recovering_wakes",
    });

    while (resetAllPageActive.current) {
      const previousWakeCursor = wakeCursor;
      let batch: HostedOpsMemberUsageResetAllWakeBatchResponse;
      try {
        batch = await requestResetAllWakeBatch(wakeCursor, operationId);
      } catch (error) {
        if (!resetAllPageActive.current) {
          return;
        }
        setResetAllState({
          counts,
          failure: {
            ambiguous: true,
            memberId: null,
            message: error instanceof Error
              ? error.message
              : "Runtime wake recovery returned an ambiguous response. Retry the wake-only pass.",
          },
          lastAcknowledgedCursor: resetAllState.lastAcknowledgedCursor,
          phase: "recovering_wakes",
        });
        return;
      }
      if (!resetAllPageActive.current) {
        return;
      }

      const acknowledgedWakeCursor = batch.lastAcknowledgedCursor;
      const cursorAcknowledgesBatch = batch.attempted === 0
        ? acknowledgedWakeCursor === previousWakeCursor
        : acknowledgedWakeCursor !== null
          && acknowledgedWakeCursor !== previousWakeCursor
          && !wakeAcknowledgedCursors.has(acknowledgedWakeCursor);
      if (
        !cursorAcknowledgesBatch
        || (batch.attempted === 0 && !batch.done)
      ) {
        setResetAllState({
          counts,
          failure: {
            ambiguous: true,
            memberId: null,
            message:
              "The server did not acknowledge wake-recovery progress. Retry the wake-only pass.",
          },
          lastAcknowledgedCursor: resetAllState.lastAcknowledgedCursor,
          phase: "recovering_wakes",
        });
        return;
      }

      counts = {
        ...counts,
        pendingWake: counts.pendingWake + batch.pendingWake,
      };
      wakeCursor = acknowledgedWakeCursor;
      if (acknowledgedWakeCursor) {
        wakeAcknowledgedCursors.add(acknowledgedWakeCursor);
      }
      if (batch.done) {
        if (counts.pendingWake > 0) {
          setResetAllState({
            counts,
            failure: null,
            lastAcknowledgedCursor: resetAllState.lastAcknowledgedCursor,
            phase: "recovering_wakes",
          });
          return;
        }
        setResetAllState({
          counts,
          failure: null,
          lastAcknowledgedCursor: resetAllState.lastAcknowledgedCursor,
          phase: "complete",
        });
        router.refresh();
        return;
      }
      setResetAllState({
        counts,
        failure: null,
        lastAcknowledgedCursor: resetAllState.lastAcknowledgedCursor,
        phase: "recovering_wakes",
      });
    }
  }

  async function resetUsage(row: HostedOpsMemberUsageRow): Promise<void> {
    if (!row.currentPeriod || isResetting || globalResetActive) {
      return;
    }
    setResettingMemberId(row.memberId);
    setMessage(null);
    const recovery = readUsageRowRecovery(
      dashboard.capturedAt,
      postCommit,
      row,
    );
    const runtimeRecheckOnly = recovery.runtimeRecheckAvailable;
    try {
      if (runtimeRecheckOnly) {
        const result = await requestRuntimeRecheck(row.memberId);
        const completedResetMode = recovery.resetMode ?? "starter_allowance";
        if (result.runtimeRecheckStatus === "pending") {
          setPostCommit({
            dashboardCapturedAt: dashboard.capturedAt,
            memberId: row.memberId,
            resetMode: completedResetMode,
            runtimeRecheckStatus: "pending",
          });
          setMessage({
            text:
              "The runtime still has not accepted its recheck. The committed usage reset is unchanged; retry the runtime wake.",
            tone: "error",
          });
          return;
        }
        setPostCommit({
          dashboardCapturedAt: dashboard.capturedAt,
          memberId: row.memberId,
          resetMode: completedResetMode,
          runtimeRecheckStatus: "accepted",
        });
        setSelectedMemberId(null);
        setMessage({
          text: completedResetMode === "starter_allowance"
            ? "The runtime recheck was accepted. The committed Starter allowance reset is unchanged."
            : "The runtime recheck was accepted. The committed usage reset is unchanged.",
          tone: "success",
        });
        router.refresh();
        return;
      }

      const result = await requestUsageReset(row);
      if (result.runtimeRecheckStatus === "pending") {
        setPostCommit({
          dashboardCapturedAt: dashboard.capturedAt,
          memberId: result.memberId,
          resetMode: result.resetMode,
          runtimeRecheckStatus: "pending",
        });
        setMessage({
          text: result.resetMode === "starter_allowance"
            ? "The Starter allowance was reset, but the runtime did not accept its recheck yet. Retry only the runtime wake; another allowance will not be granted."
            : "Usage was reset, but the runtime did not accept its recheck yet. Retry the runtime wake; usage and credits will not be reset again.",
          tone: "error",
        });
        router.refresh();
        return;
      }
      setPostCommit({
        dashboardCapturedAt: dashboard.capturedAt,
        memberId: result.memberId,
        resetMode: result.resetMode,
        runtimeRecheckStatus: "accepted",
      });
      setSelectedMemberId(null);
      setMessage({
        text: result.resetMode === "starter_allowance"
          ? result.noticeClaimReleased
            ? `Starter allowance was reset to ${formatUsdMicros(result.usageCreditGrantedUsdMicros)}, the quota notice claim was released, and the runtime recheck was accepted.`
            : `Starter allowance was reset to ${formatUsdMicros(result.usageCreditGrantedUsdMicros)} and the runtime recheck was accepted.`
          : result.noticeClaimReleased
            ? "Current included usage was reset, the quota notice claim was released, and the runtime recheck was accepted."
            : "Current included usage is clear and the runtime recheck was accepted.",
        tone: "success",
      });
      router.refresh();
    } catch (error) {
      setMessage({
        text: error instanceof Error
          ? error.message
          : "Usage could not be reset. Refresh and try again.",
        tone: "error",
      });
      if (
        error instanceof UsageResetRequestError
        && error.code === "HOSTED_OPS_USAGE_RESET_STALE"
      ) {
        setSelectedMemberId(null);
        router.refresh();
        return;
      }
      if (!runtimeRecheckOnly) {
        setSelectedMemberId(null);
      }
    } finally {
      setResettingMemberId(null);
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
            Usage
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Whole-population usage totals with a bounded, ID-ordered view of
            hosted members and synthetic group containers. Reset clears current
            included usage or restores one fresh Starter allowance without
            changing immutable usage history or purchased credits.
          </p>
        </div>
      </header>

      <section
        aria-label="Usage summary"
        className="grid border-y border-border/70 sm:grid-cols-2 lg:grid-cols-4"
      >
        <SummaryFinding
          label="Members"
          value={formatInteger(dashboard.summary.members)}
        />
        <SummaryFinding
          label="Group containers"
          value={formatInteger(dashboard.summary.groupContainers)}
        />
        <SummaryFinding
          label="Active in 7 days"
          value={formatInteger(dashboard.summary.activeEntitiesLast7Days)}
        />
        <SummaryFinding
          label="All-time counted AI usage"
          value={formatUsdMicros(
            dashboard.summary.totalAllTimeUsageUsdMicros,
          )}
        />
      </section>

      <section
        aria-label="Usage controls"
        className="grid gap-4 rounded-xl border border-border/70 bg-card/70 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)] lg:items-end"
      >
        <form onSubmit={submitSearch}>
          <FieldGroup className="gap-2">
            <Field>
              <FieldLabel htmlFor="ops-usage-search">
                Search members and containers
              </FieldLabel>
              <FieldDescription className="text-xs leading-5">
                Enter a complete hosted ID, an exact verified email, or the
                final four phone digits. Email lookup uses only blind indexes;
                email values are never decrypted for this surface.
              </FieldDescription>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  autoComplete="off"
                  disabled={globalResetActive || searchNavigationPending}
                  id="ops-usage-search"
                  maxLength={256}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                  }}
                  placeholder="hbm_… · verified email · 1234"
                  value={searchQuery}
                />
                <Button
                  disabled={searchNavigationPending || globalResetActive}
                  type="submit"
                  variant="outline"
                >
                  {searchNavigationPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  {searchNavigationPending ? "Searching" : "Search"}
                </Button>
                {dashboard.search.query !== null ? (
                  <Button
                    disabled={searchNavigationPending || globalResetActive}
                    onClick={() => {
                      setSearchQuery("");
                      setSearchNavigationPending(true);
                      router.push("/ops/usage");
                    }}
                    type="button"
                    variant="ghost"
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </Field>
          </FieldGroup>
        </form>
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-serif text-lg font-semibold text-foreground">
            Population recovery
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Reset everyone runs small ID-ordered batches and explicitly ignores
            any active search filter. It is bounded and non-atomic.
          </p>
          <Button
            className="mt-3 w-full sm:w-auto lg:w-full"
            disabled={
              isResetting || resetAllOpen || searchNavigationPending
            }
            onClick={openResetAllDialog}
            type="button"
            variant="destructive"
          >
            <RotateCcwIcon data-icon="inline-start" />
            {preservedResetAllOperation
              ? "Resume reset operation"
              : "Reset everyone"}
          </Button>
        </div>
      </section>

      {dashboard.search.error ? (
        <Alert variant="destructive">
          <AlertDescription>{dashboard.search.error}</AlertDescription>
        </Alert>
      ) : null}

      {dashboard.search.query !== null && !dashboard.search.error ? (
        <Alert
          variant={
            dashboard.search.capped || phoneSearchRequiresExactLookup
              ? "destructive"
              : "default"
          }
        >
          <AlertDescription>
            {phoneSearchRequiresExactLookup
              ? `Showing ${formatInteger(dashboard.search.resultCount)} phone-suffix ${dashboard.search.capped ? `candidates (safety cap ${formatInteger(dashboard.search.cap)}; more exist)` : dashboard.search.resultCount === 1 ? "candidate" : "candidates"}. Reset controls are locked until you search by the exact hosted ID or exact verified email.`
              : dashboard.search.capped
              ? `Showing ${formatInteger(dashboard.search.resultCount)} ID-ordered matches (safety cap ${formatInteger(dashboard.search.cap)}). More matches exist; narrow the search to see a complete set.`
              : `${formatInteger(dashboard.search.resultCount)} complete search ${dashboard.search.resultCount === 1 ? "result" : "results"}.`}
          </AlertDescription>
        </Alert>
      ) : null}

      {message ? (
        <Alert variant={message.tone === "error" ? "destructive" : "default"}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="member-usage-table-title">
        <div className="flex flex-col gap-1">
          <h2
            className="font-serif text-xl font-semibold tracking-tight text-foreground"
            id="member-usage-table-title"
          >
            Members and containers
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Retained inbound messages cover the canonical {dashboard.messageRetentionDays}-day
            mailbox window. Last 7 days and daily average use the trailing seven
            24-hour periods. AI usage is all-time counted priced cost from
            immutable usage rows. Rows are ordered by member ID. {dashboard.search.query !== null
              ? `Search returns the complete matching set up to the documented ${formatInteger(dashboard.search.cap)}-row safety cap.`
              : `The ordinary list remains limited to ${formatInteger(dashboard.pagination.pageSize)} rows per page.`}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Captured {formatTimestamp(dashboard.capturedAt)}
          </p>
        </div>

        <div className="mt-5 grid gap-3 xl:hidden">
          {dashboard.rows.length === 0 ? (
            <div className="rounded-xl border border-border/70 bg-card/90 px-4 py-10 text-center text-sm text-muted-foreground">
              {readEmptyUsageMessage(dashboard)}
            </div>
          ) : (
            dashboard.rows.map((row) => (
              <UsageCompactRow
                disabled={
                  isResetting
                  || globalResetActive
                  || phoneSearchRequiresExactLookup
                }
                key={row.memberId}
                onSelect={() => {
                  setMessage(null);
                  setSelectedMemberId(row.memberId);
                }}
                recovery={readUsageRowRecovery(
                  dashboard.capturedAt,
                  postCommit,
                  row,
                )}
                row={row}
              />
            ))
          )}
        </div>

        <div className="mt-5 hidden overflow-hidden rounded-xl border border-border/70 bg-card/90 xl:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-20 bg-card">
                  Member or container
                </TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">
                  Inbound, {dashboard.messageRetentionDays} days
                </TableHead>
                <TableHead className="text-right">Inbound, 7 days</TableHead>
                <TableHead className="text-right">Avg per day</TableHead>
                <TableHead className="text-right">
                  All-time counted AI usage
                </TableHead>
                <TableHead className="text-right">Current period</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead className="sticky right-0 z-20 border-l border-border/70 bg-card text-right">
                  Status and action
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="py-10 text-center text-muted-foreground"
                    colSpan={9}
                  >
                    {readEmptyUsageMessage(dashboard)}
                  </TableCell>
                </TableRow>
              ) : (
                dashboard.rows.map((row) => (
                  <UsageRow
                    disabled={
                      isResetting
                      || globalResetActive
                      || phoneSearchRequiresExactLookup
                    }
                    key={row.memberId}
                    onSelect={() => {
                      setMessage(null);
                      setSelectedMemberId(row.memberId);
                    }}
                    recovery={readUsageRowRecovery(
                      dashboard.capturedAt,
                      postCommit,
                      row,
                    )}
                    row={row}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {dashboard.search.query === null ? (
          <nav
            aria-label="Member usage pages"
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-xs text-muted-foreground">
              {formatInteger(dashboard.rows.length)} rows shown · {formatInteger(
                dashboard.pagination.pageSize,
              )} rows per page
            </p>
            <div className="flex items-center gap-2">
              <Button
                disabled={dashboard.pagination.previousCursor === null}
                onClick={() => {
                  openPage("before", dashboard.pagination.previousCursor);
                }}
                type="button"
                variant="outline"
              >
                Previous
              </Button>
              <Button
                disabled={dashboard.pagination.nextCursor === null}
                onClick={() => {
                  openPage("after", dashboard.pagination.nextCursor);
                }}
                type="button"
                variant="outline"
              >
                Next
              </Button>
            </div>
          </nav>
        ) : null}
      </section>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !isResetting) {
            setSelectedMemberId(null);
          }
        }}
        open={selectedRow !== null}
      >
        <DialogContent showCloseButton={!isResetting}>
          <DialogHeader>
            <DialogTitle>
              {selectedRuntimeRecheck
                ? "Retry runtime wake?"
                : selectedRow?.resetMode === "starter_allowance"
                  ? "Reset Starter allowance?"
                  : "Reset current included usage?"}
            </DialogTitle>
            <DialogDescription>
              {selectedRuntimeRecheck
                ? "The allowance reset is already committed. Retry only the runtime recheck so already-accepted work can continue."
                : selectedRow?.resetMode === "starter_allowance"
                  ? "This grants one fresh $4.50 Starter allowance, clears the blocked state, releases the current quota notice claim, and wakes already-accepted work. Immutable AI usage and purchased-credit balance stay unchanged."
                  : "This sets current-period included spend to $0, clears the blocked state, releases the current quota notice claim, and wakes already-accepted work. Immutable AI usage and purchased-credit balance stay unchanged."}
            </DialogDescription>
          </DialogHeader>
          {selectedRuntimeRecheck && message ? (
            <Alert variant="destructive">
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          ) : null}
          {selectedRow?.currentPeriod ? (
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-y border-border/70 py-4 text-sm">
              <dt className="text-muted-foreground">Target</dt>
              <dd className="max-w-56 break-all text-right font-mono text-xs">
                {selectedRow.memberId}
              </dd>
              {!selectedRuntimeRecheck ? (
                <>
                  <dt className="text-muted-foreground">Current spend</dt>
                  <dd className="font-serif font-semibold">
                    {formatUsdMicros(selectedRow.currentPeriod.spentUsdMicros)}
                  </dd>
                  {selectedRow.resetMode === "starter_allowance" ? (
                    <>
                      <dt className="text-muted-foreground">Allowance added</dt>
                      <dd className="font-serif font-semibold">$4.50</dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">Notice claim</dt>
                  <dd>
                    {selectedRow.currentPeriod.idempotencyClaimStatus
                      ? "Will be released"
                      : "None"}
                  </dd>
                </>
              ) : null}
            </dl>
          ) : null}
          <DialogFooter>
            <Button
              disabled={isResetting || globalResetActive}
              onClick={() => {
                setSelectedMemberId(null);
              }}
              type="button"
              variant="outline"
            >
              {selectedRuntimeRecheck
                ? "Close"
                : "Cancel"}
            </Button>
            <Button
              disabled={
                !selectedRow?.currentPeriod
                || (
                  selectedRow.currentPeriod.updatedAt === null
                  && !selectedRuntimeRecheck
                )
                || isResetting
              }
              onClick={() => {
                if (selectedRow) {
                  void resetUsage(selectedRow);
                }
              }}
              type="button"
              variant={selectedRuntimeRecheck ? "default" : "destructive"}
            >
              {isResetting ? <Spinner data-icon="inline-start" /> : (
                <RotateCcwIcon data-icon="inline-start" />
              )}
              {isResetting
                ? "Working"
                : selectedRuntimeRecheck
                ? "Retry runtime wake"
                : selectedRow?.resetMode === "starter_allowance"
                  ? "Grant $4.50"
                  : "Reset usage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {designResetAllInline && resetAllOpen ? (
        <div
          className="mx-auto grid w-full max-w-sm gap-4 rounded-3xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10"
          data-design-state={designState}
        >
          <UsageResetAllSurface
            confirmation={resetAllConfirmation}
            dashboard={dashboard}
            inline
            onAbandon={clearResetAllOperation}
            onClose={closeResetAllDialog}
            onConfirmationChange={setResetAllConfirmation}
            onKeep={keepResetAllOperation}
            onRequestAbandon={requestResetAllAbandonment}
            onRun={(mode) => {
              void runResetAll({ mode });
            }}
            state={resetAllState}
          />
        </div>
      ) : null}

      {!designResetAllInline ? (
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              closeResetAllDialog();
            }
          }}
          open={resetAllOpen}
        >
          <DialogContent
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
            showCloseButton={
              resetAllState.phase !== "running"
              && resetAllState.phase !== "recovering_wakes"
            }
          >
            <UsageResetAllSurface
              confirmation={resetAllConfirmation}
              dashboard={dashboard}
              onAbandon={clearResetAllOperation}
              onClose={closeResetAllDialog}
              onConfirmationChange={setResetAllConfirmation}
              onKeep={keepResetAllOperation}
              onRequestAbandon={requestResetAllAbandonment}
              onRun={(mode) => {
                void runResetAll({ mode });
              }}
              state={resetAllState}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function UsageResetAllSurface(input: {
  confirmation: string;
  dashboard: HostedOpsMemberUsageDashboard;
  inline?: boolean;
  onAbandon: () => void;
  onClose: () => void;
  onConfirmationChange: (value: string) => void;
  onKeep: () => void;
  onRequestAbandon: () => void;
  onRun: (mode: UsageResetAllRunMode) => void;
  state: UsageResetAllState;
}) {
  const state = input.state;
  const title = state.phase === "abandoning"
    ? "Abandon reset operation?"
    : state.phase === "confirming"
      ? "Reset everyone?"
      : state.phase === "running"
        ? "Resetting everyone"
        : state.phase === "complete"
          ? "Reset everyone complete"
          : state.phase === "recovering_wakes"
            ? "Population reset complete; runtime recovery remains"
            : "Reset everyone paused";
  const description = (
    <>
      This operation ignores the active search filter and walks the hosted
      population in fixed, small ID-ordered batches. It is not atomic, does not
      capture a population snapshot, and does not pause ongoing usage. Each
      member commits independently before any runtime recheck.
    </>
  );
  return (
    <>
      <DialogHeader>
        {input.inline ? (
          <h2 className="font-serif text-base leading-none font-medium text-balance">
            {title}
          </h2>
        ) : (
          <DialogTitle>{title}</DialogTitle>
        )}
        {input.inline ? (
          <p className="text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        ) : (
          <DialogDescription>{description}</DialogDescription>
        )}
      </DialogHeader>

      {state.phase === "confirming" ? (
        <div className="grid gap-4">
          <Alert variant="destructive">
            <AlertDescription>
              Paid, Family-sponsored, and group-container rows clear current
              included spend and blocking. Exhausted direct Starter rows get the
              existing one-policy allowance recovery. Immutable usage history,
              purchased credits, and referral credits remain unchanged. {input.dashboard.search.query !== null
                ? "The active search filter will be ignored."
                : "No search filter is active."}
            </AlertDescription>
          </Alert>
          <Field>
            <FieldLabel htmlFor="ops-usage-reset-all-confirmation">
              Type {HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION} to continue
            </FieldLabel>
            <Input
              autoComplete="off"
              id="ops-usage-reset-all-confirmation"
              onChange={(event) => {
                input.onConfirmationChange(event.target.value);
              }}
              value={input.confirmation}
            />
          </Field>
        </div>
      ) : state.phase === "abandoning" ? (
        <div className="grid gap-4">
          <Alert variant="destructive">
            <AlertDescription>
              Already committed member resets will remain. Abandoning forgets
              this browser&apos;s operation ID, cursor, and progress. Starting
              Reset everyone later creates a new operation that can process
              those members again from their then-current state.
            </AlertDescription>
          </Alert>
          <UsageResetAllProgress state={state} />
        </div>
      ) : (
        <UsageResetAllProgress state={state} />
      )}

      <DialogFooter>
        {state.phase === "abandoning" ? (
          <>
            <Button onClick={input.onKeep} type="button" variant="outline">
              Keep operation
            </Button>
            <Button
              onClick={input.onAbandon}
              type="button"
              variant="destructive"
            >
              Abandon operation
            </Button>
          </>
        ) : state.phase === "confirming" ? (
          <>
            <Button onClick={input.onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              aria-label="Confirm reset everyone"
              disabled={
                input.confirmation !== HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION
              }
              onClick={() => {
                input.onRun("start");
              }}
              type="button"
              variant="destructive"
            >
              <RotateCcwIcon data-icon="inline-start" />
              Reset everyone
            </Button>
          </>
        ) : state.phase === "running" ? (
          <Button disabled type="button" variant="destructive">
            <Spinner data-icon="inline-start" />
            Processing bounded batches
          </Button>
        ) : state.phase === "paused" ? (
          <>
            <Button onClick={input.onClose} type="button" variant="outline">
              Hide for now
            </Button>
            <Button
              onClick={input.onRequestAbandon}
              type="button"
              variant="outline"
            >
              Abandon operation
            </Button>
            <Button
              onClick={() => {
                input.onRun("resume");
              }}
              type="button"
              variant="destructive"
            >
              Resume
            </Button>
          </>
        ) : state.phase === "recovering_wakes" ? (
          <Button
            onClick={() => {
              input.onRun("recover_wakes");
            }}
            type="button"
            variant="destructive"
          >
            Retry pending runtime wakes
          </Button>
        ) : (
          <Button onClick={input.onClose} type="button" variant="outline">
            Close
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function UsageResetAllProgress(input: { state: UsageResetAllState }) {
  const state = input.state;
  return (
    <div aria-live="polite" className="grid gap-4">
      {state.phase === "complete" ? (
        <Alert>
          <AlertDescription>
            Every ID returned by the live ID-ordered walk was acknowledged.
            This was not an atomic snapshot; members could continue using Murph
            throughout the operation.
          </AlertDescription>
        </Alert>
      ) : null}
      {state.phase === "recovering_wakes" ? (
        <Alert variant="destructive">
          <AlertDescription>
            Every population row was acknowledged, but one or more runtimes did
            not accept their recheck. Retry the wake recovery before closing.
            Recovery pages only this operation&apos;s existing wake-required
            receipts; it cannot admit a later member or enter a reset
            transaction again.
          </AlertDescription>
        </Alert>
      ) : null}
      {state.failure ? (
        <Alert variant="destructive">
          <AlertDescription>
            {state.failure.message} {state.failure.memberId
              ? `The unacknowledged member is ${state.failure.memberId}.`
              : null} {state.failure.ambiguous
              ? "No unacknowledged outcome was added to the totals below."
              : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {state.phase === "running" ? (
        <p className="text-sm leading-6 text-muted-foreground">
          The page is continuing one bounded request at a time. Per-row reset
          controls remain disabled until this operation stops or completes.
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <UsageResetAllMetric label="Processed" value={state.counts.processed} />
        <UsageResetAllMetric label="Reset" value={state.counts.reset} />
        <UsageResetAllMetric label="Unchanged" value={state.counts.unchanged} />
        <UsageResetAllMetric label="Skipped" value={state.counts.skipped} />
        <UsageResetAllMetric
          label="Wake pending"
          value={state.counts.pendingWake}
        />
        <UsageResetAllMetric label="Failed" value={state.counts.failed} />
      </dl>
      <p className="break-all font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        Last acknowledged cursor: {state.lastAcknowledgedCursor ?? "start"}
      </p>
      {state.counts.pendingWake > 0 ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Pending-wake rows already committed their usage reset. Recovery
          replays the existing per-member operation receipts and retries only
          the runtime wake.
        </p>
      ) : null}
    </div>
  );
}

function UsageResetAllMetric(input: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card px-3 py-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {input.label}
      </dt>
      <dd className="mt-1 font-serif text-xl font-semibold tabular-nums text-foreground">
        {formatInteger(input.value)}
      </dd>
    </div>
  );
}

function createInitialResetAllState(
  designState: MemberUsageClientDesignState | undefined,
): UsageResetAllState {
  if (designState === "reset_all_progress") {
    return {
      counts: {
        failed: 0,
        pendingWake: 1,
        processed: 20,
        reset: 8,
        skipped: 3,
        unchanged: 9,
      },
      failure: null,
      lastAcknowledgedCursor: "hbm_design_020",
      phase: "running",
    };
  }
  if (designState === "reset_all_abandonment") {
    return {
      counts: {
        failed: 1,
        pendingWake: 0,
        processed: 24,
        reset: 10,
        skipped: 4,
        unchanged: 10,
      },
      failure: null,
      lastAcknowledgedCursor: "hbm_design_024",
      phase: "abandoning",
    };
  }
  if (designState === "reset_all_complete") {
    return {
      counts: {
        failed: 0,
        pendingWake: 0,
        processed: 47,
        reset: 19,
        skipped: 8,
        unchanged: 20,
      },
      failure: null,
      lastAcknowledgedCursor: "hbm_design_047",
      phase: "complete",
    };
  }
  if (designState === "reset_all_wake_recovery") {
    return {
      counts: {
        failed: 0,
        pendingWake: 2,
        processed: 47,
        reset: 19,
        skipped: 8,
        unchanged: 20,
      },
      failure: null,
      lastAcknowledgedCursor: "hbm_design_047",
      phase: "recovering_wakes",
    };
  }
  if (designState === "reset_all_partial_failure") {
    return {
      counts: {
        failed: 1,
        pendingWake: 1,
        processed: 24,
        reset: 10,
        skipped: 4,
        unchanged: 10,
      },
      failure: {
        ambiguous: false,
        memberId: "hbm_design_025",
        message:
          "A usage-limit notice is currently being sent. Retry from the last acknowledged member after that dispatch settles.",
      },
      lastAcknowledgedCursor: "hbm_design_024",
      phase: "paused",
    };
  }
  if (designState === "reset_all_confirmation") {
    return {
      counts: { ...EMPTY_RESET_ALL_COUNTS },
      failure: null,
      lastAcknowledgedCursor: null,
      phase: "confirming",
    };
  }
  return {
    counts: { ...EMPTY_RESET_ALL_COUNTS },
    failure: null,
    lastAcknowledgedCursor: null,
    phase: "idle",
  };
}

function addResetAllCounts(
  left: HostedOpsMemberUsageResetAllCounts,
  right: HostedOpsMemberUsageResetAllCounts,
): HostedOpsMemberUsageResetAllCounts {
  return {
    failed: left.failed + right.failed,
    pendingWake: left.pendingWake + right.pendingWake,
    processed: left.processed + right.processed,
    reset: left.reset + right.reset,
    skipped: left.skipped + right.skipped,
    unchanged: left.unchanged + right.unchanged,
  };
}

function readEmptyUsageMessage(
  dashboard: HostedOpsMemberUsageDashboard,
): string {
  if (dashboard.search.error) {
    return "No rows are shown until the search is corrected.";
  }
  if (dashboard.search.query !== null) {
    return "No hosted members or group containers matched this search.";
  }
  return "No hosted members or group containers were found on this page.";
}

interface UsageRowControlInput {
  disabled: boolean;
  onSelect: () => void;
  recovery: UsageRowRecovery;
  row: HostedOpsMemberUsageRow;
}

function UsageCompactRow(input: UsageRowControlInput) {
  const period = input.row.currentPeriod;

  return (
    <article className="grid gap-4 rounded-xl border border-border/70 bg-card/90 p-4 md:grid-cols-[minmax(12rem,1fr)_minmax(20rem,2fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="truncate font-mono text-xs text-foreground"
            title={input.row.memberId}
          >
            {input.row.memberId}
          </span>
          <Badge variant="outline">
            {input.row.memberKind === "group_container" ? "Group" : "Member"}
          </Badge>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {readEntitySecondaryLabel(input.row)}
        </p>
      </div>
      <div className="min-w-0">
        <UsageStatusBadges
          postCommitStatus={input.recovery.postCommitStatus}
          row={input.row}
          runtimeRecheckAvailable={input.recovery.runtimeRecheckAvailable}
        />
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <UsageCompactMetric
            label="Current period"
            value={period
              ? `${formatUsdMicros(period.spentUsdMicros)} / ${
                formatUsdMicros(period.limitUsdMicros)
              }`
              : "No period"}
          />
          <UsageCompactMetric
            label="Remaining"
            value={period
              ? formatUsdMicros(period.remainingUsdMicros)
              : "Not available"}
          />
          <UsageCompactMetric
            label="All-time AI"
            value={formatUsdMicros(input.row.allTimeUsageUsdMicros)}
          />
          <UsageCompactMetric
            label="Inbound, 7 days"
            value={formatInteger(input.row.messagesLast7Days)}
          />
        </dl>
      </div>
      <UsageActionButton {...input} className="w-full md:w-auto" />
    </article>
  );
}

function UsageRow(input: UsageRowControlInput) {
  const period = input.row.currentPeriod;

  return (
    <TableRow>
      <TableCell className="sticky left-0 z-10 bg-card">
        <div className="flex max-w-64 flex-col gap-1">
          <span
            className="truncate font-mono text-xs text-foreground"
            title={input.row.memberId}
          >
            {input.row.memberId}
          </span>
          <span className="text-xs text-muted-foreground">
            {readEntitySecondaryLabel(input.row)}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">
          {input.row.memberKind === "group_container" ? "Group" : "Member"}
        </Badge>
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {formatInteger(input.row.messagesRetained)}
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {formatInteger(input.row.messagesLast7Days)}
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {input.row.messagesDailyAverage7Days.toFixed(1)}
      </TableCell>
      <TableCell className="text-right font-serif font-semibold tabular-nums">
        {formatUsdMicros(input.row.allTimeUsageUsdMicros)}
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {period
          ? `${formatUsdMicros(period.spentUsdMicros)} / ${
            formatUsdMicros(period.limitUsdMicros)
          }`
          : "No period"}
      </TableCell>
      <TableCell className="text-right font-serif font-semibold tabular-nums">
        {period ? formatUsdMicros(period.remainingUsdMicros) : "Not available"}
      </TableCell>
      <TableCell className="sticky right-0 z-10 border-l border-border/70 bg-card text-right">
        <div className="flex min-w-56 flex-col items-end gap-2">
          <UsageStatusBadges
            postCommitStatus={input.recovery.postCommitStatus}
            row={input.row}
            runtimeRecheckAvailable={input.recovery.runtimeRecheckAvailable}
          />
          <UsageActionButton {...input} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function UsageStatusBadges(input: {
  postCommitStatus: UsageRowRecovery["postCommitStatus"];
  row: HostedOpsMemberUsageRow;
  runtimeRecheckAvailable: boolean;
}) {
  const period = input.row.currentPeriod;
  if (input.postCommitStatus !== null) {
    return (
      <div className="flex flex-wrap gap-1">
        <Badge variant="outline">
          {input.postCommitStatus === "pending"
            ? "Committed · Wake pending"
            : "Committed · refreshing"}
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {input.row.suspended ? (
        <Badge variant="destructive">Suspended</Badge>
      ) : null}
      {period?.blocked ? (
        <Badge variant="destructive">Blocked</Badge>
      ) : null}
      {input.row.resetMode === "starter_allowance" ? (
        <Badge variant="secondary">Starter exhausted</Badge>
      ) : null}
      {input.runtimeRecheckAvailable ? (
        <Badge variant="secondary">Wake pending</Badge>
      ) : null}
      {period?.idempotencyClaimStatus ? (
        <Badge variant="secondary">Notice claimed</Badge>
      ) : null}
      {input.row.allowanceStatus === "unavailable" ? (
        <Badge variant="secondary">Unavailable</Badge>
      ) : null}
      {input.row.allowanceStatus === "available"
          && period
          && !input.row.suspended
          && !period.blocked ? (
        <Badge variant="outline">Available</Badge>
      ) : null}
    </div>
  );
}

function UsageActionButton(
  input: UsageRowControlInput & { className?: string },
) {
  const period = input.row.currentPeriod;
  const resettable = input.recovery.postCommitStatus !== "accepted"
    && period !== null
    && input.row.allowanceStatus === "available"
    && (
      input.row.resetMode !== null
      || input.recovery.runtimeRecheckAvailable
    )
    && period.updatedAt !== null;
  const actionLabel = input.recovery.postCommitStatus === "accepted"
    ? "Refreshing"
    : input.recovery.runtimeRecheckAvailable
      ? "Recheck runtime"
      : input.row.resetMode === "starter_allowance"
        ? "Reset Starter"
        : "Reset";

  return (
    <Button
      aria-label={input.recovery.postCommitStatus === "accepted"
        ? `Committed update refreshing for ${input.row.memberId}`
        : input.recovery.runtimeRecheckAvailable
          ? `Recheck runtime for ${input.row.memberId}`
          : input.row.resetMode === "starter_allowance"
            ? `Reset Starter allowance for ${input.row.memberId}`
            : `Reset usage for ${input.row.memberId}`}
      className={input.className}
      disabled={input.disabled || !resettable}
      onClick={input.onSelect}
      size="sm"
      type="button"
      variant="outline"
    >
      {input.recovery.postCommitStatus === "accepted" ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <RotateCcwIcon data-icon="inline-start" />
      )}
      {actionLabel}
    </Button>
  );
}

function readUsageRowRecovery(
  dashboardCapturedAt: string,
  postCommit: UsagePostCommit | null,
  row: HostedOpsMemberUsageRow,
): UsageRowRecovery {
  const activePostCommit = postCommit?.dashboardCapturedAt === dashboardCapturedAt
      && postCommit.memberId === row.memberId
    ? postCommit
    : null;
  return {
    postCommitStatus: activePostCommit?.runtimeRecheckStatus ?? null,
    resetMode: activePostCommit?.resetMode ?? null,
    runtimeRecheckAvailable:
      activePostCommit?.runtimeRecheckStatus === "pending"
      || (activePostCommit === null && row.runtimeRecheckAvailable),
  };
}

function UsageCompactMetric(input: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {input.label}
      </dt>
      <dd className="mt-0.5 truncate font-medium tabular-nums text-foreground">
        {input.value}
      </dd>
    </div>
  );
}

function SummaryFinding(input: { label: string; value: string }) {
  return (
    <div className="border-border/70 px-4 py-4 sm:odd:border-r lg:not-last:border-r">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-2 font-serif text-2xl font-semibold tabular-nums text-foreground">
        {input.value}
      </div>
    </div>
  );
}

function readEntitySecondaryLabel(row: HostedOpsMemberUsageRow): string {
  if (row.memberKind === "group_container") {
    const participantLabel = row.participantCount === null
      ? "Participants unavailable"
      : `${formatInteger(row.participantCount)} participants`;
    return row.containerOwnerMemberId
      ? `${participantLabel}, owner ${row.containerOwnerMemberId}`
      : participantLabel;
  }
  return row.maskedPhoneNumberHint ?? `Created ${formatDate(row.createdAt)}`;
}

function createResetAllOperationId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID !== "function") {
    throw new Error(
      "This browser cannot start Reset everyone safely. Reload in a supported browser.",
    );
  }
  return randomUUID.call(globalThis.crypto);
}

async function requestResetAllBatch(
  afterMemberId: string | null,
  operationId: string,
): Promise<HostedOpsMemberUsageResetAllBatchResponse> {
  const response = await fetch("/api/ops/usage-reset", {
    body: JSON.stringify({
      afterMemberId,
      confirmation: HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
      operation: "reset_all_batch",
      operationId,
    }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      "Reset everyone returned an unreadable response. Resume from the last acknowledged cursor.",
    );
  }
  if (!response.ok) {
    throw new UsageResetRequestError(
      readResponseErrorMessage(payload),
      readResponseErrorCode(payload),
    );
  }
  if (!isHostedOpsMemberUsageResetAllBatchResponse(payload)) {
    throw new Error(
      "Reset everyone returned an invalid response. Resume from the last acknowledged cursor.",
    );
  }
  return payload;
}

async function requestResetAllWakeBatch(
  afterMemberId: string | null,
  operationId: string,
): Promise<HostedOpsMemberUsageResetAllWakeBatchResponse> {
  const response = await fetch("/api/ops/usage-reset", {
    body: JSON.stringify({
      afterMemberId,
      confirmation: HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
      operation: "recover_reset_all_wakes",
      operationId,
    }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      "Runtime wake recovery returned an unreadable response. Retry the wake-only pass.",
    );
  }
  if (!response.ok) {
    throw new UsageResetRequestError(
      readResponseErrorMessage(payload),
      readResponseErrorCode(payload),
    );
  }
  if (!isHostedOpsMemberUsageResetAllWakeBatchResponse(payload)) {
    throw new Error(
      "Runtime wake recovery returned an invalid response. Retry the wake-only pass.",
    );
  }
  return payload;
}

async function requestUsageReset(
  row: HostedOpsMemberUsageRow,
): Promise<HostedOpsMemberUsageResetResponse> {
  const period = row.currentPeriod;
  const expectedPeriodUpdatedAt = period?.updatedAt ?? null;
  if (!period || !expectedPeriodUpdatedAt) {
    throw new Error("This row has no persisted current usage to reset.");
  }
  const response = await fetch("/api/ops/usage-reset", {
    body: JSON.stringify({
      expectedPeriodUpdatedAt,
      expectedUsageCreditLedgerVersion: period.usageCreditLedgerVersion,
      memberId: row.memberId,
      periodStart: period.periodStart,
    }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Usage reset returned an unreadable response.");
  }
  if (!response.ok) {
    throw new UsageResetRequestError(
      readResponseErrorMessage(payload),
      readResponseErrorCode(payload),
    );
  }
  if (!isHostedOpsMemberUsageResetResult(payload)) {
    throw new Error("Usage reset returned an invalid response.");
  }
  return payload;
}

async function requestRuntimeRecheck(
  memberId: string,
): Promise<UsageRuntimeRecheckResponse> {
  const response = await fetch("/api/ops/usage-reset", {
    body: JSON.stringify({
      memberId,
      operation: "runtime_recheck",
    }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Runtime recheck returned an unreadable response.");
  }
  if (!response.ok) {
    throw new UsageResetRequestError(
      readResponseErrorMessage(payload),
      readResponseErrorCode(payload),
    );
  }
  if (!isUsageRuntimeRecheckResponse(payload)) {
    throw new Error("Runtime recheck returned an invalid response.");
  }
  return payload;
}

function isHostedOpsMemberUsageResetAllBatchResponse(
  value: unknown,
): value is HostedOpsMemberUsageResetAllBatchResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const counts = Reflect.get(value, "counts");
  if (!counts || typeof counts !== "object") {
    return false;
  }
  const processed = Reflect.get(counts, "processed");
  const reset = Reflect.get(counts, "reset");
  const unchanged = Reflect.get(counts, "unchanged");
  const skipped = Reflect.get(counts, "skipped");
  const pendingWake = Reflect.get(counts, "pendingWake");
  const failed = Reflect.get(counts, "failed");
  if (
    !isNonNegativeInteger(processed)
    || !isNonNegativeInteger(reset)
    || !isNonNegativeInteger(unchanged)
    || !isNonNegativeInteger(skipped)
    || !isNonNegativeInteger(pendingWake)
    || !isNonNegativeInteger(failed)
    || processed !== reset + unchanged + skipped
    || pendingWake > reset + unchanged
  ) {
    return false;
  }
  const cursor = Reflect.get(value, "lastAcknowledgedCursor");
  if (cursor !== null && typeof cursor !== "string") {
    return false;
  }
  const done = Reflect.get(value, "done");
  if (typeof done !== "boolean") {
    return false;
  }
  const failure = Reflect.get(value, "failure");
  if (failure === null) {
    return failed === 0;
  }
  return failed === 1
    && done === false
    && typeof failure === "object"
    && typeof Reflect.get(failure, "code") === "string"
    && typeof Reflect.get(failure, "memberId") === "string"
    && typeof Reflect.get(failure, "message") === "string"
    && typeof Reflect.get(failure, "retryable") === "boolean";
}

function isHostedOpsMemberUsageResetAllWakeBatchResponse(
  value: unknown,
): value is HostedOpsMemberUsageResetAllWakeBatchResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const attempted = Reflect.get(value, "attempted");
  const pendingWake = Reflect.get(value, "pendingWake");
  const cursor = Reflect.get(value, "lastAcknowledgedCursor");
  return isNonNegativeInteger(attempted)
    && isNonNegativeInteger(pendingWake)
    && pendingWake <= attempted
    && (cursor === null || typeof cursor === "string")
    && typeof Reflect.get(value, "done") === "boolean";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isHostedOpsMemberUsageResetResult(
  value: unknown,
): value is HostedOpsMemberUsageResetResponse {
  return Boolean(
    value
      && typeof value === "object"
      && typeof Reflect.get(value, "memberId") === "string"
      && typeof Reflect.get(value, "noticeClaimReleased") === "boolean"
      && typeof Reflect.get(value, "outcome") === "string"
      && typeof Reflect.get(value, "resetAt") === "string"
      && ["included_usage", "starter_allowance"].includes(
        String(Reflect.get(value, "resetMode")),
      )
      && typeof Reflect.get(value, "usageCreditGrantedUsdMicros") === "string"
      && ["accepted", "pending"].includes(
        String(Reflect.get(value, "runtimeRecheckStatus")),
      )
  );
}

function isUsageRuntimeRecheckResponse(
  value: unknown,
): value is UsageRuntimeRecheckResponse {
  return Boolean(
    value
      && typeof value === "object"
      && typeof Reflect.get(value, "memberId") === "string"
      && ["accepted", "pending"].includes(
        String(Reflect.get(value, "runtimeRecheckStatus")),
      )
  );
}

function readResponseErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Usage could not be reset. Refresh and try again.";
  }
  const error = Reflect.get(payload, "error");
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return "Usage could not be reset. Refresh and try again.";
}

function readResponseErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const error = Reflect.get(payload, "error");
  if (!error || typeof error !== "object") {
    return null;
  }
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatUsdMicros(value: string): string {
  const cents = (BigInt(value) + 5_000n) / 10_000n;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(Number(cents) / 100);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(value));
}
