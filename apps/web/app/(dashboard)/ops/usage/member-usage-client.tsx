"use client";

import { RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

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

interface UsageResetMessage {
  text: string;
  tone: "error" | "success";
}

interface UsageResetRuntimeRetry {
  memberId: string;
  resetMode: HostedOpsMemberUsageResetResponse["resetMode"];
}

interface UsageRuntimeRecheckResponse {
  memberId: string;
  runtimeRecheckStatus: "accepted" | "pending";
}

class UsageResetRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "UsageResetRequestError";
  }
}

export function MemberUsageClient({
  dashboard,
}: {
  dashboard: HostedOpsMemberUsageDashboard;
}) {
  const router = useRouter();
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [resettingMemberId, setResettingMemberId] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<UsageResetMessage | null>(null);
  const [runtimeRetry, setRuntimeRetry] =
    useState<UsageResetRuntimeRetry | null>(null);
  const selectedRow = useMemo(
    () => dashboard.rows.find((row) => row.memberId === selectedMemberId)
      ?? null,
    [dashboard.rows, selectedMemberId],
  );
  const isResetting = resettingMemberId !== null;

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

  async function resetUsage(row: HostedOpsMemberUsageRow): Promise<void> {
    if (!row.currentPeriod || isResetting) {
      return;
    }
    setResettingMemberId(row.memberId);
    setMessage(null);
    try {
      if (runtimeRetry?.memberId === row.memberId) {
        const result = await requestRuntimeRecheck(row.memberId);
        if (result.runtimeRecheckStatus === "pending") {
          setMessage({
            text:
              "The runtime still has not accepted its recheck. The committed usage reset is unchanged; retry the runtime wake.",
            tone: "error",
          });
          return;
        }
        setRuntimeRetry(null);
        setSelectedMemberId(null);
        setMessage({
          text: runtimeRetry.resetMode === "starter_allowance"
            ? "The runtime recheck was accepted. The committed Starter allowance reset is unchanged."
            : "The runtime recheck was accepted. The committed usage reset is unchanged.",
          tone: "success",
        });
        router.refresh();
        return;
      }

      const result = await requestUsageReset(row);
      if (result.runtimeRecheckStatus === "pending") {
        setRuntimeRetry({
          memberId: result.memberId,
          resetMode: result.resetMode,
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
      setRuntimeRetry(null);
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
        setRuntimeRetry(null);
        setSelectedMemberId(null);
        router.refresh();
        return;
      }
      if (runtimeRetry?.memberId !== row.memberId) {
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
            immutable usage rows. Rows are ordered by member ID and limited to{" "}
            {dashboard.pagination.pageSize} per page.
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Captured {formatTimestamp(dashboard.capturedAt)}
          </p>
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-border/70 bg-card/90">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member or container</TableHead>
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
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="py-10 text-center text-muted-foreground"
                    colSpan={10}
                  >
                    No hosted members or group containers were found on this page.
                  </TableCell>
                </TableRow>
              ) : (
                dashboard.rows.map((row) => (
                  <UsageRow
                    disabled={isResetting}
                    key={row.memberId}
                    onSelect={() => {
                      setMessage(null);
                      setRuntimeRetry(null);
                      setSelectedMemberId(row.memberId);
                    }}
                    row={row}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
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
      </section>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !isResetting) {
            setRuntimeRetry(null);
            setSelectedMemberId(null);
          }
        }}
        open={selectedRow !== null}
      >
        <DialogContent showCloseButton={!isResetting}>
          <DialogHeader>
            <DialogTitle>
              {runtimeRetry?.memberId === selectedRow?.memberId
                ? "Retry runtime wake?"
                : selectedRow?.resetMode === "starter_allowance"
                  ? "Reset Starter allowance?"
                  : "Reset current included usage?"}
            </DialogTitle>
            <DialogDescription>
              {runtimeRetry?.memberId === selectedRow?.memberId
                ? "The allowance reset is already committed. Retry only the runtime recheck so already-accepted work can continue."
                : selectedRow?.resetMode === "starter_allowance"
                  ? "This grants one fresh $4.50 Starter allowance, clears the blocked state, releases the current quota notice claim, and wakes already-accepted work. Immutable AI usage and purchased-credit balance stay unchanged."
                  : "This sets current-period included spend to $0, clears the blocked state, releases the current quota notice claim, and wakes already-accepted work. Immutable AI usage and purchased-credit balance stay unchanged."}
            </DialogDescription>
          </DialogHeader>
          {runtimeRetry?.memberId === selectedRow?.memberId && message ? (
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
              {runtimeRetry?.memberId !== selectedRow.memberId ? (
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
              disabled={isResetting}
              onClick={() => {
                setRuntimeRetry(null);
                setSelectedMemberId(null);
              }}
              type="button"
              variant="outline"
            >
              {runtimeRetry?.memberId === selectedRow?.memberId
                ? "Close"
                : "Cancel"}
            </Button>
            <Button
              disabled={
                !selectedRow?.currentPeriod
                || (
                  selectedRow.currentPeriod.updatedAt === null
                  && runtimeRetry?.memberId !== selectedRow.memberId
                )
                || isResetting
              }
              onClick={() => {
                if (selectedRow) {
                  void resetUsage(selectedRow);
                }
              }}
              type="button"
              variant="destructive"
            >
              {isResetting ? <Spinner data-icon="inline-start" /> : (
                <RotateCcwIcon data-icon="inline-start" />
              )}
              {isResetting
                ? "Working"
                : runtimeRetry?.memberId === selectedRow?.memberId
                ? "Retry runtime wake"
                : selectedRow?.resetMode === "starter_allowance"
                  ? "Grant $4.50"
                  : "Reset usage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UsageRow(input: {
  disabled: boolean;
  onSelect: () => void;
  row: HostedOpsMemberUsageRow;
}) {
  const period = input.row.currentPeriod;
  const resettable = period !== null
    && input.row.allowanceStatus === "available"
    && input.row.resetMode !== null
    && period.updatedAt !== null;
  const actionLabel = input.row.resetMode === "starter_allowance"
    ? "Reset Starter"
    : "Reset";

  return (
    <TableRow>
      <TableCell>
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
      <TableCell>
        <div className="flex max-w-48 flex-wrap gap-1">
          {input.row.suspended ? (
            <Badge variant="destructive">Suspended</Badge>
          ) : null}
          {period?.blocked ? (
            <Badge variant="destructive">Blocked</Badge>
          ) : null}
          {input.row.resetMode === "starter_allowance" ? (
            <Badge variant="secondary">Starter exhausted</Badge>
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
      </TableCell>
      <TableCell className="text-right">
        <Button
          aria-label={input.row.resetMode === "starter_allowance"
            ? `Reset Starter allowance for ${input.row.memberId}`
            : `Reset usage for ${input.row.memberId}`}
          disabled={input.disabled || !resettable}
          onClick={input.onSelect}
          size="sm"
          type="button"
          variant="outline"
        >
          <RotateCcwIcon data-icon="inline-start" />
          {actionLabel}
        </Button>
      </TableCell>
    </TableRow>
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
