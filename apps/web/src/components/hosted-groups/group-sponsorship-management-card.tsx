"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

import { Button } from "@/src/components/ui/button";
import { Spinner } from "@/src/components/ui/spinner";
import { stripSettingsQueryParams } from "@/src/components/settings/hosted-settings-utils";
import {
  HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR,
  parseHostedGroupSponsorshipMonthlyCapMinor,
  type HostedGroupSponsorshipMonthlyCapMinor,
} from "@/src/lib/hosted-groups/group-sponsorship-contract";
import { cn } from "@/src/lib/utils";

import { GroupFundingDial } from "./group-funding-dial";
import {
  GroupFundingNotice,
  GroupFundingStatusView,
} from "./group-usage-funding-shell";

const MONTHLY_CAP_DIAL_OPTIONS = HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR.map(
  (monthlyCapMinor) => ({
    amountLabel: formatMoney(monthlyCapMinor),
    value: monthlyCapMinor,
  }),
);

export interface GroupSponsorshipManagementProjection {
  authorizationId: string;
  chargedThisPeriodMinor: number;
  monthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor;
  pendingThisPeriodMinor: number;
  pendingMonthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor | null;
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

const GROUP_SPONSORSHIP_RECOVERY_COPY = {
  fulfilled: {
    description: "Automatic refills are on.",
    title: "Payment confirmed",
  },
  payment_pending: {
    description:
      "We’ll check this automatically. Refills start again once it’s confirmed.",
    title: "Payment is processing",
  },
  recheck_required: {
    description:
      "You don’t need to pay again. Check the status of your last payment.",
    title: "Check payment status",
  },
} as const satisfies Record<
  GroupSponsorshipRecoveryProgress,
  { description: string; title: string }
>;

export type GroupSponsorshipManagementConfirmation =
  | {
    currentMonthlyCapMinor: MonthlyCapMinor;
    kind: "increase";
    nextMonthlyCapMinor: MonthlyCapMinor;
  }
  | { kind: "cancel" };

export function GroupSponsorshipManagementCard({
  cancelOnly = false,
  checkoutReturned,
  endpoint,
  inert = false,
  initialSelectedMonthlyCapMinor,
  management: initialManagement,
  periodEndTimeZone,
}: {
  cancelOnly?: boolean;
  /** The payer just returned from a successful Checkout for this sponsorship. */
  checkoutReturned?: boolean;
  endpoint: string;
  inert?: boolean;
  initialSelectedMonthlyCapMinor?: MonthlyCapMinor;
  management: GroupSponsorshipManagementProjection;
  periodEndTimeZone?: string;
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
  >(readCheckoutReturnProgress(checkoutReturned, initialManagement.status));
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
    if (checkoutReturned) {
      stripSettingsQueryParams(["usageCheckout", "usagePurchase"]);
    }
  }, [checkoutReturned]);

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
      className="flex flex-1 flex-col gap-6"
      data-component="group-sponsorship-management"
    >
      {cancelOnly ? null : (
        <GroupSponsorshipStatusNotice
          disabled={busy || inert}
          onRecheck={() => void recheckRecoveryStatus()}
          onReview={() => void submit({ action: "recover" })}
          recoveryButtonRef={recoveryButtonRef}
          recoveryProgress={recoveryProgress}
          recoveryStatusRef={recoveryStatusRef}
          status={management.status}
        />
      )}

      {!cancelOnly && management.status !== "pending_activation" ? (
        <div className="flex flex-1 items-center">
          <GroupFundingDial
            caption="a month"
            disabled={busy || inert}
            label="Monthly limit"
            onValueChange={setSelectedMonthlyCapMinor}
            options={MONTHLY_CAP_DIAL_OPTIONS}
            value={selectedMonthlyCapMinor}
          />
        </div>
      ) : null}

      <div
        className={cn(
          "flex flex-col gap-3",
          (cancelOnly || management.status === "pending_activation") &&
            "flex-1 justify-center",
        )}
      >
        <p className="text-center text-sm/5 text-pretty text-muted-foreground">
          {formatMoney(management.chargedThisPeriodMinor)} charged this month
          {management.pendingThisPeriodMinor > 0
            ? ` (+${formatMoney(management.pendingThisPeriodMinor)} processing)`
            : null}
          <span className="block">
            Resets {formatPeriodEnd(management.periodEnd, periodEndTimeZone)}
          </span>
        </p>

        {cancelOnly ? (
          <p className="text-center text-sm/5 text-pretty text-muted-foreground">
            You can’t change billing right now, but you can stop future refills.
          </p>
        ) : management.status === "pending_activation" ? (
          <p className="text-center text-sm/5 text-pretty text-muted-foreground">
            Your first $5 is being confirmed.
          </p>
        ) : management.pendingMonthlyCapMinor !== null && !capChanged ? (
          <p className="text-center text-sm/5 text-pretty text-muted-foreground">
            {formatMoney(management.pendingMonthlyCapMinor)} starts next month.
          </p>
        ) : null}

        {!cancelOnly && capChanged ? (
          <Button
            className="w-full"
            disabled={busy || inert}
            onClick={applyCap}
            size="xl"
            type="button"
          >
            {capIncrease
              ? `Review ${formatMoney(selectedMonthlyCapMinor)} limit`
              : `Save ${formatMoney(selectedMonthlyCapMinor)} limit`}
          </Button>
        ) : null}

        {error && confirmation === null ? (
          <p className="text-center text-sm/5 text-destructive" role="alert">
            {error.message}
          </p>
        ) : null}
      </div>

      <GroupSponsorshipLinks
        disabled={busy || inert}
        onCancel={() => {
          setError(null);
          setConfirmation({ kind: "cancel" });
        }}
        onPause={() => void submit({ action: "pause" })}
        onResume={() => void submit({ action: "resume" })}
        status={cancelOnly ? null : management.status}
      />

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

function GroupSponsorshipStatusNotice({
  disabled,
  onRecheck,
  onReview,
  recoveryButtonRef,
  recoveryProgress,
  recoveryStatusRef,
  status,
}: {
  disabled: boolean;
  onRecheck: () => void;
  onReview: () => void;
  recoveryButtonRef: Ref<HTMLButtonElement>;
  recoveryProgress: GroupSponsorshipRecoveryProgress | null;
  recoveryStatusRef: Ref<HTMLDivElement>;
  status: GroupSponsorshipManagementProjection["status"];
}) {
  if (recoveryProgress) {
    const copy = GROUP_SPONSORSHIP_RECOVERY_COPY[recoveryProgress];
    return (
      <GroupFundingNotice
        action={
          recoveryProgress === "recheck_required" ? (
            <Button
              className="w-full"
              disabled={disabled}
              onClick={onRecheck}
              size="lg"
              type="button"
            >
              Check payment status
            </Button>
          ) : null
        }
        description={copy.description}
        ref={recoveryStatusRef}
        role="status"
        title={copy.title}
      />
    );
  }
  if (status === "recovery_required") {
    return (
      <GroupFundingNotice
        action={
          <Button
            className="w-full"
            disabled={disabled}
            onClick={onReview}
            ref={recoveryButtonRef}
            size="lg"
            type="button"
          >
            Review payment
          </Button>
        }
        description="Automatic refills are paused until payment is fixed."
        title="Payment needs attention"
        tone="attention"
      />
    );
  }
  return status === "paused" ? (
    <GroupFundingNotice
      description="Murph won’t charge you until you resume."
      title="Automatic refills are paused"
    />
  ) : null;
}

function GroupSponsorshipLinks({
  disabled,
  onCancel,
  onPause,
  onResume,
  status,
}: {
  disabled: boolean;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  /** Null when billing changes are unavailable, leaving only cancellation. */
  status: GroupSponsorshipManagementProjection["status"] | null;
}) {
  const quietLink = "h-11 px-0 text-muted-foreground";
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
      {status === "active" || status === "paused" ? (
        <Button
          className={`${quietLink} hover:text-foreground`}
          disabled={disabled}
          onClick={status === "active" ? onPause : onResume}
          type="button"
          variant="link"
        >
          {status === "active"
            ? "Pause automatic refills"
            : "Resume automatic refills"}
        </Button>
      ) : null}
      <Button
        className={`${quietLink} hover:text-destructive`}
        disabled={disabled}
        onClick={onCancel}
        type="button"
        variant="link"
      >
        Cancel sponsorship
      </Button>
    </div>
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
            <AlertDialogPrimitive.Title className="font-serif text-2xl/7 font-semibold text-balance tracking-normal">
              {isIncrease
                ? `Increase your limit to ${nextLimit}?`
                : "Cancel your monthly sponsorship?"}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="max-w-[48ch] text-sm/6 text-pretty text-muted-foreground">
              {isIncrease
                ? `When refills are on, Murph charges $5 at a time as the group uses it, up to ${nextLimit} a month instead of ${currentLimit}.`
                : "Automatic refills will stop. Credit you already bought stays with the group."}
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

          <footer className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
    <section
      className="flex flex-1 flex-col"
      data-component="group-sponsorship-management"
      data-state="canceled"
    >
      <GroupFundingStatusView
        message="Automatic refills have stopped. Credit you already bought stays with the group."
        title="Sponsorship canceled"
        tone="done"
      />
    </section>
  );
}

// A Checkout return is confirmed once the sponsorship is active again;
// otherwise the existing bounded poll waits for the payment to settle.
function readCheckoutReturnProgress(
  checkoutReturned: boolean | undefined,
  status: GroupSponsorshipManagementProjection["status"],
): GroupSponsorshipRecoveryProgress | null {
  if (!checkoutReturned) {
    return null;
  }
  return status === "active" ? "fulfilled" : "payment_pending";
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
  return parseHostedGroupSponsorshipMonthlyCapMinor(value);
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

function formatPeriodEnd(value: string, timeZone?: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone,
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
