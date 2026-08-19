"use client";

import { useEffect, useRef, useState } from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

import { Button } from "@/src/components/ui/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/src/components/ui/alert";
import { ChoiceCard } from "@/src/components/ui/choice-card";
import {
  FieldLegend,
  FieldSet,
} from "@/src/components/ui/field";
import { RadioGroup } from "@/src/components/ui/radio-group";
import { Spinner } from "@/src/components/ui/spinner";

export interface GroupSponsorshipManagementProjection {
  authorizationId: string;
  chargedThisPeriodMinor: number;
  monthlyCapMinor: 500 | 1_000 | 2_000;
  pendingThisPeriodMinor: number;
  pendingMonthlyCapMinor: 500 | 1_000 | 2_000 | null;
  periodEnd: string;
  status: "active" | "paused" | "pending_activation" | "recovery_required";
}

type MonthlyCapMinor = GroupSponsorshipManagementProjection["monthlyCapMinor"];

type GroupSponsorshipManagementError = {
  certainty: "authoritative" | "indeterminate";
  message: string;
};

type GroupSponsorshipRecoveryProgress =
  | "fulfilled"
  | "payment_pending"
  | "recheck_required";

const GROUP_SPONSORSHIP_RECOVERY_POLL_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export type GroupSponsorshipManagementConfirmation =
  | {
    currentMonthlyCapMinor: MonthlyCapMinor;
    kind: "increase";
    nextMonthlyCapMinor: MonthlyCapMinor;
  }
  | { kind: "cancel" };

export function GroupSponsorshipManagementCard({
  cancelOnly = false,
  endpoint,
  inert = false,
  initialSelectedMonthlyCapMinor,
  management: initialManagement,
}: {
  cancelOnly?: boolean;
  endpoint: string;
  inert?: boolean;
  initialSelectedMonthlyCapMinor?: MonthlyCapMinor;
  management: GroupSponsorshipManagementProjection;
}) {
  const [management, setManagement] = useState(initialManagement);
  const [selectedMonthlyCapMinor, setSelectedMonthlyCapMinor] = useState(
    initialSelectedMonthlyCapMinor ??
      initialManagement.pendingMonthlyCapMinor ??
      initialManagement.monthlyCapMinor,
  );
  const [busy, setBusy] = useState(false);
  const [canceled, setCanceled] = useState(false);
  const [error, setError] = useState<GroupSponsorshipManagementError | null>(null);
  const [recoveryProgress, setRecoveryProgress] = useState<
    GroupSponsorshipRecoveryProgress | null
  >(null);
  const [confirmation, setConfirmation] = useState<
    GroupSponsorshipManagementConfirmation | null
  >(null);
  const recoveryButtonRef = useRef<HTMLButtonElement>(null);
  const recoveryStatusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      !busy &&
      error?.certainty === "indeterminate" &&
      management.status === "recovery_required" &&
      recoveryProgress === null
    ) {
      recoveryButtonRef.current?.focus();
    }
  }, [busy, error, management.status, recoveryProgress]);

  useEffect(() => {
    if (recoveryProgress) {
      recoveryStatusRef.current?.focus();
    }
  }, [recoveryProgress]);

  useEffect(() => {
    if (recoveryProgress !== "payment_pending") {
      return;
    }
    let canceled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = (attempt: number) => {
      timer = setTimeout(() => {
        void (async () => {
          try {
            const next = await readCurrentGroupSponsorshipManagement({
              authorizationId: initialManagement.authorizationId,
              endpoint,
            });
            if (canceled) {
              return;
            }
            if (next) {
              setManagement(next);
              setSelectedMonthlyCapMinor(
                next.pendingMonthlyCapMinor ?? next.monthlyCapMinor,
              );
              if (next.status === "active") {
                setRecoveryProgress("fulfilled");
                return;
              }
            }
          } catch {
            // A bounded retry below owns temporary read failures.
          }
          if (canceled) {
            return;
          }
          const nextAttempt = attempt + 1;
          if (nextAttempt >= GROUP_SPONSORSHIP_RECOVERY_POLL_DELAYS_MS.length) {
            setRecoveryProgress("recheck_required");
            return;
          }
          poll(nextAttempt);
        })();
      }, GROUP_SPONSORSHIP_RECOVERY_POLL_DELAYS_MS[attempt]);
    };
    poll(0);
    return () => {
      canceled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [endpoint, initialManagement.authorizationId, recoveryProgress]);

  const submit = async (body: Record<string, unknown>): Promise<boolean> => {
    if (inert || busy) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          ...body,
          authorizationId: management.authorizationId,
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const value: unknown = await response.json();
      if (
        !response.ok &&
        response.status >= 400 &&
        response.status < 500
      ) {
        setError({
          certainty: "authoritative",
          message: readManagementErrorMessage(value),
        });
        return false;
      }
      if (!response.ok || !isRecord(value)) {
        throw new Error("That change didn’t go through. Try again.");
      }
      if (isRecord(value.checkout)) {
        const checkoutUrl = typeof value.checkout.url === "string"
          ? readHttpsUrl(value.checkout.url)
          : null;
        if (checkoutUrl) {
          window.location.assign(checkoutUrl);
          return true;
        }
        const checkoutStatus = value.checkout.status;
        if (
          checkoutStatus === "payment_pending" || checkoutStatus === "fulfilled"
        ) {
          const next = readManagementProjection(value.management);
          if (next) {
            setManagement(next);
            setSelectedMonthlyCapMinor(
              next.pendingMonthlyCapMinor ?? next.monthlyCapMinor,
            );
          }
          setRecoveryProgress(checkoutStatus);
          return true;
        }
        throw new Error("Payment review couldn’t open. Try again.");
      }
      if (value.management === null) {
        if (body.action === "cancel") {
          setCanceled(true);
          return true;
        }
        window.location.reload();
        return true;
      }
      const next = readManagementProjection(value.management);
      if (!next) {
        throw new Error("That change couldn’t be confirmed. Refresh and try again.");
      }
      setManagement(next);
      setSelectedMonthlyCapMinor(
        next.pendingMonthlyCapMinor ?? next.monthlyCapMinor,
      );
      return true;
    } catch (cause) {
      setError({
        certainty: "indeterminate",
        message: cause instanceof Error
          ? cause.message
          : "That change didn’t go through. Try again.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const appliedMonthlyCapMinor =
    management.pendingMonthlyCapMinor ?? management.monthlyCapMinor;
  const capChanged = selectedMonthlyCapMinor !== appliedMonthlyCapMinor;
  const capIncrease = selectedMonthlyCapMinor > management.monthlyCapMinor;

  if (canceled) {
    return <GroupSponsorshipCanceledReceipt />;
  }

  const applyCap = () => {
    if (selectedMonthlyCapMinor === appliedMonthlyCapMinor) {
      return;
    }
    if (selectedMonthlyCapMinor > management.monthlyCapMinor) {
      setError(null);
      setConfirmation({
        currentMonthlyCapMinor: management.monthlyCapMinor,
        kind: "increase",
        nextMonthlyCapMinor: selectedMonthlyCapMinor,
      });
      return;
    }
    void submit({
      action: "change_cap",
      confirmed: true,
      monthlyCapMinor: selectedMonthlyCapMinor,
    });
  };

  const confirmAction = async () => {
    if (!confirmation) {
      return;
    }
    const succeeded = confirmation.kind === "increase"
      ? await submit({
        action: "change_cap",
        confirmed: true,
        monthlyCapMinor: confirmation.nextMonthlyCapMinor,
      })
      : await submit({ action: "cancel" });
    if (succeeded) {
      setConfirmation(null);
    }
  };

  const recheckRecoveryStatus = async () => {
    if (inert || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await readCurrentGroupSponsorshipManagement({
        authorizationId: initialManagement.authorizationId,
        endpoint,
      });
      if (!next) {
        throw new Error("Payment status couldn’t be checked. Try again.");
      }
      setManagement(next);
      setSelectedMonthlyCapMinor(
        next.pendingMonthlyCapMinor ?? next.monthlyCapMinor,
      );
      setRecoveryProgress(
        next.status === "active" ? "fulfilled" : "recheck_required",
      );
    } catch (cause) {
      setError({
        certainty: "indeterminate",
        message: cause instanceof Error
          ? cause.message
          : "Payment status couldn’t be checked. Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="space-y-7"
      data-component="group-sponsorship-management"
    >
      <div className="space-y-2">
        <h2 className="font-serif text-xl font-semibold tracking-normal">
          Monthly sponsorship
        </h2>
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
          Private to you
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 border-y border-border py-5 sm:grid-cols-3">
        <div>
          <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            This month
          </dt>
          <dd className="mt-1 font-serif text-2xl font-semibold tabular-nums">
            {formatMoney(management.chargedThisPeriodMinor)}
          </dd>
          {management.pendingThisPeriodMinor > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              +{formatMoney(management.pendingThisPeriodMinor)} processing
            </p>
          ) : null}
        </div>
        <div>
          <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Monthly limit
          </dt>
          <dd className="mt-1 font-serif text-2xl font-semibold tabular-nums">
            {formatMoney(management.monthlyCapMinor)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Resets
          </dt>
          <dd className="mt-2 text-sm font-medium">
            {formatPeriodEnd(management.periodEnd)}
          </dd>
        </div>
      </dl>

      {cancelOnly ? (
        <p className="text-sm leading-6 text-muted-foreground">
          Billing changes are unavailable, but you can still stop future automatic refills.
        </p>
      ) : recoveryProgress ? (
        <div
          className="rounded-2xl border border-border bg-muted/40 p-4"
          role="status"
          ref={recoveryStatusRef}
          tabIndex={-1}
        >
          <p className="font-medium">
            {recoveryProgress === "payment_pending"
              ? "Payment is processing"
              : recoveryProgress === "fulfilled"
                ? "Payment confirmed"
                : "Check payment status"}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {recoveryProgress === "payment_pending"
              ? "We’ll check this payment automatically. Automatic refills will resume after it is confirmed."
              : recoveryProgress === "fulfilled"
                ? "Automatic refills are ready to resume."
                : "No new payment is needed. Recheck the existing payment before trying anything else."}
          </p>
          {recoveryProgress === "recheck_required" ? (
            <Button
              type="button"
              className="mt-3"
              disabled={busy || inert}
              onClick={() => void recheckRecoveryStatus()}
              size="sm"
            >
              Check payment status
            </Button>
          ) : null}
        </div>
      ) : management.status === "recovery_required" ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium">Payment needs attention</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Automatic refills are paused until payment is fixed.
          </p>
          <Button
            type="button"
            className="mt-3"
            disabled={busy || inert}
            ref={recoveryButtonRef}
            size="sm"
            onClick={() => void submit({ action: "recover" })}
          >
            Review payment
          </Button>
        </div>
      ) : null}

      {!cancelOnly && management.status !== "pending_activation" ? (
        <FieldSet className="space-y-3" disabled={busy || inert}>
          <FieldLegend>Monthly limit</FieldLegend>
          <RadioGroup
            value={String(selectedMonthlyCapMinor)}
            onValueChange={(value) => {
              const parsed = Number(value);
              if (parsed === 500 || parsed === 1_000 || parsed === 2_000) {
                setSelectedMonthlyCapMinor(parsed);
              }
            }}
            className="grid grid-cols-3 gap-2"
          >
            {([500, 1_000, 2_000] as const).map((monthlyCapMinor) => (
              <ChoiceCard
                className="[&>[data-slot=field]]:gap-1 [&>[data-slot=field]]:p-2 [&_[data-slot=field-content]]:gap-1 min-[360px]:[&>[data-slot=field]]:gap-1.5 min-[360px]:[&>[data-slot=field]]:p-3"
                key={monthlyCapMinor}
                id={`managed-group-sponsorship-cap-${monthlyCapMinor}`}
                value={String(monthlyCapMinor)}
                disabled={busy || inert}
                title={(
                  <span className="font-serif text-lg font-semibold leading-none tabular-nums min-[360px]:text-xl sm:text-2xl">
                    {formatMoney(monthlyCapMinor)}
                  </span>
                )}
                description={(
                  <span className="hidden text-xs font-medium text-muted-foreground min-[360px]:inline">
                    per month
                  </span>
                )}
              />
            ))}
          </RadioGroup>
          {capChanged || management.pendingMonthlyCapMinor !== null ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {capChanged ? (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  disabled={busy || inert}
                  onClick={applyCap}
                  size="lg"
                >
                  {capIncrease
                    ? `Review ${formatMoney(selectedMonthlyCapMinor)} limit`
                    : `Save ${formatMoney(selectedMonthlyCapMinor)} limit`}
                </Button>
              ) : null}
              {management.pendingMonthlyCapMinor !== null ? (
                <p className="text-sm text-muted-foreground">
                  {formatMoney(management.pendingMonthlyCapMinor)} starts next
                  month.
                </p>
              ) : null}
            </div>
          ) : null}
        </FieldSet>
      ) : !cancelOnly ? (
        <p className="text-sm leading-6 text-muted-foreground">
          The $5 activation is being confirmed.
        </p>
      ) : null}

      {error && confirmation === null ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {!cancelOnly && management.status === "active" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || inert}
            onClick={() => void submit({ action: "pause" })}
          >
            Pause automatic refills
          </Button>
        ) : !cancelOnly && management.status === "paused" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || inert}
            onClick={() => void submit({ action: "resume" })}
          >
            Resume automatic refills
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || inert}
          onClick={() => {
            setError(null);
            setConfirmation({ kind: "cancel" });
          }}
        >
          Cancel sponsorship
        </Button>
      </div>

      <GroupSponsorshipManagementConfirmationDialog
        busy={busy}
        confirmation={confirmation}
        error={error}
        inert={inert}
        onConfirm={() => void confirmAction()}
        onOpenChange={(open) => {
          if (!open && !busy) {
            if (error) {
              if (
                confirmation?.kind === "cancel" &&
                error.certainty === "indeterminate"
              ) {
                return;
              }
              window.location.reload();
              return;
            }
            setConfirmation(null);
          }
        }}
      />
    </section>
  );
}

export function GroupSponsorshipManagementConfirmationDialog({
  busy,
  confirmation,
  error = null,
  inert = false,
  onConfirm,
  onOpenChange,
}: {
  busy: boolean;
  confirmation: GroupSponsorshipManagementConfirmation | null;
  error?: GroupSponsorshipManagementError | null;
  inert?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const isIncrease = confirmation?.kind === "increase";
  const currentLimit = isIncrease
    ? formatMoney(confirmation.currentMonthlyCapMinor)
    : null;
  const nextLimit = isIncrease
    ? formatMoney(confirmation.nextMonthlyCapMinor)
    : null;
  const authoritativeRejection = error?.certainty === "authoritative";
  const indeterminateCancellation =
    error?.certainty === "indeterminate" && !isIncrease;

  return (
    <AlertDialogPrimitive.Root
      open={confirmation !== null}
      onOpenChange={onOpenChange}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Backdrop
          className="fixed inset-0 isolate z-50 bg-foreground/25 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          data-slot="alert-dialog-overlay"
        />
        <AlertDialogPrimitive.Popup
          className="fixed bottom-[max(env(safe-area-inset-bottom),0.75rem)] left-3 right-3 z-50 grid w-auto gap-5 rounded-2xl bg-popover p-5 text-popover-foreground ring-1 ring-border duration-150 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2"
          data-component="group-sponsorship-management-confirmation"
          data-slot="alert-dialog-content"
          inert={inert || undefined}
        >
          <header className="grid place-items-start gap-2 text-left">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
              {isIncrease ? "Monthly limit" : "Monthly sponsorship"}
            </p>
            <AlertDialogPrimitive.Title className="font-serif text-2xl/7 font-semibold text-balance tracking-normal">
              {isIncrease
                ? `Increase your limit to ${nextLimit}?`
                : "Cancel your monthly sponsorship?"}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="max-w-[48ch] text-sm/6 text-pretty text-muted-foreground">
              {isIncrease
                ? `Your monthly limit will change from ${currentLimit} to ${nextLimit}. When automatic refills are on, Murph may charge $5 at a time for more usage credit.`
                : "Automatic refills will stop. Any usage credit already purchased will stay with the group."}
            </AlertDialogPrimitive.Description>
          </header>

          {error ? (
            <p role="alert" className="text-sm/6 text-destructive">
              {authoritativeRejection
                ? error.message
                : isIncrease
                ? "We’re not sure whether your limit changed. Check your current setup before trying again."
                : "We’re not sure whether your sponsorship was canceled. Check its status before trying again."}
            </p>
          ) : null}

          <footer className="-mx-5 -mb-5 flex flex-col-reverse gap-2 rounded-b-2xl border-t border-border bg-muted/50 p-5 sm:flex-row sm:justify-end">
            {indeterminateCancellation ? null : (
              <AlertDialogPrimitive.Close
                disabled={busy}
                render={<Button size="lg" variant="outline" />}
              >
                {authoritativeRejection
                  ? "Refresh current setup"
                  : error
                    ? "Check current setup"
                    : isIncrease
                      ? `Keep ${currentLimit} limit`
                      : "Keep sponsorship"}
              </AlertDialogPrimitive.Close>
            )}
            {authoritativeRejection ? null : (
              <Button
                data-slot="alert-dialog-action"
                disabled={busy}
                onClick={onConfirm}
                size="lg"
                variant={isIncrease ? "default" : "destructive"}
              >
                {busy ? <Spinner data-icon="inline-start" /> : null}
                {busy
                  ? isIncrease ? "Updating limit" : "Canceling sponsorship"
                  : isIncrease
                    ? `Increase to ${nextLimit}`
                    : error
                      ? "Check cancellation status"
                      : "Cancel sponsorship"}
              </Button>
            )}
          </footer>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export function GroupSponsorshipCanceledReceipt() {
  return (
    <Alert
      data-component="group-sponsorship-management"
      data-state="canceled"
      role="status"
    >
      <AlertTitle>
        Monthly sponsorship canceled
      </AlertTitle>
      <AlertDescription>
        Future automatic refills are stopped. Usage credit already purchased stays with the group.
      </AlertDescription>
    </Alert>
  );
}

function readManagementProjection(
  value: unknown,
): GroupSponsorshipManagementProjection | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = value.status;
  const monthlyCapMinor = readCap(value.monthlyCapMinor);
  const pendingMonthlyCapMinor = value.pendingMonthlyCapMinor === null
    ? null
    : readCap(value.pendingMonthlyCapMinor);
  if (
    typeof value.authorizationId !== "string" ||
    !isNonNegativeInteger(value.chargedThisPeriodMinor) ||
    !isNonNegativeInteger(value.pendingThisPeriodMinor) ||
    monthlyCapMinor === null ||
    (value.pendingMonthlyCapMinor !== null && pendingMonthlyCapMinor === null) ||
    typeof value.periodEnd !== "string" ||
    !isCanonicalTimestamp(value.periodEnd) ||
    (status !== "active" &&
      status !== "paused" &&
      status !== "pending_activation" &&
      status !== "recovery_required")
  ) {
    return null;
  }
  return {
    authorizationId: value.authorizationId,
    chargedThisPeriodMinor: value.chargedThisPeriodMinor,
    monthlyCapMinor,
    pendingThisPeriodMinor: value.pendingThisPeriodMinor,
    pendingMonthlyCapMinor,
    periodEnd: value.periodEnd,
    status,
  };
}

async function readCurrentGroupSponsorshipManagement(input: {
  authorizationId: string;
  endpoint: string;
}): Promise<GroupSponsorshipManagementProjection | null> {
  const response = await fetch(input.endpoint, {
    cache: "no-store",
    credentials: "same-origin",
    method: "GET",
  });
  const value: unknown = await response.json();
  if (!response.ok || !isRecord(value)) {
    throw new Error("Payment status couldn’t be checked. Try again.");
  }
  const management = readManagementProjection(value.management);
  return management?.authorizationId === input.authorizationId
    ? management
    : null;
}

function readManagementErrorMessage(value: unknown): string {
  const fallback =
    "That change was not accepted. Refresh your current setup and try again.";
  if (!isRecord(value) || !isRecord(value.error)) {
    return fallback;
  }
  const message = value.error.message;
  if (typeof message !== "string") {
    return fallback;
  }
  const trimmed = message.trim();
  return trimmed.length > 0 && trimmed.length <= 240 ? trimmed : fallback;
}

function readCap(value: unknown): MonthlyCapMinor | null {
  return value === 500 || value === 1_000 || value === 2_000 ? value : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function formatMoney(minor: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(minor / 100);
}

function formatPeriodEnd(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date)
    : value;
}

function readHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isCanonicalTimestamp(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
