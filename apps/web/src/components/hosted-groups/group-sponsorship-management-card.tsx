"use client";

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

import { Spinner } from "@/src/components/ui/spinner";
import { stripSettingsQueryParams } from "@/src/components/settings/hosted-settings-utils";
import {
  HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR,
  parseHostedGroupSponsorshipMonthlyCapMinor,
  type HostedGroupSponsorshipMonthlyCapMinor,
} from "@/src/lib/hosted-groups/group-sponsorship-contract";

import { GroupFundingDial } from "./group-funding-dial";
import {
  GroupFundingError,
  GroupFundingLink,
  GroupFundingPill,
  GroupFundingScreen,
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
    detail: "Automatic refills are on.",
    title: "Payment confirmed.",
  },
  payment_pending: {
    detail:
      "We’ll check this automatically. Refills start again once it’s confirmed.",
    title: "Payment is processing.",
  },
  recheck_required: {
    detail:
      "You don’t need to pay again. Check the status of your last payment.",
    title: "Check your payment.",
  },
} as const satisfies Record<
  GroupSponsorshipRecoveryProgress,
  { detail: string; title: string }
>;

export type GroupSponsorshipManagementConfirmation =
  | {
    currentMonthlyCapMinor: MonthlyCapMinor;
    kind: "increase";
    nextMonthlyCapMinor: MonthlyCapMinor;
    /** This month's limit, when a lower limit is already set for next month. */
    thisMonthCapMinor?: MonthlyCapMinor | null;
  }
  | { kind: "cancel" };

export function GroupSponsorshipManagementCard({
  cancelOnly = false,
  checkoutReturned,
  endpoint,
  groupName,
  inert = false,
  initialSelectedMonthlyCapMinor,
  management: initialManagement,
  periodEndTimeZone,
}: {
  cancelOnly?: boolean;
  /** The payer just returned from a successful Checkout for this sponsorship. */
  checkoutReturned?: boolean;
  endpoint: string;
  groupName: string;
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  const appliedMonthlyCapMinor =
    management.pendingMonthlyCapMinor ?? management.monthlyCapMinor;
  const outcome = canceled
    ? "canceled"
    : `${management.status}:${appliedMonthlyCapMinor}`;
  const focusedOutcomeRef = useRef(outcome);

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

  // An outcome replaces the control the person just used, so focus moves to its
  // headline, which also gets the headline read out.
  useEffect(() => {
    if (recoveryProgress || outcome !== focusedOutcomeRef.current) {
      focusedOutcomeRef.current = outcome;
      headingRef.current?.focus();
    }
  }, [outcome, recoveryProgress]);

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
      // A newer change takes over from the recovery message.
      setRecoveryProgress(null);
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

  const capChanged = selectedMonthlyCapMinor !== appliedMonthlyCapMinor;
  // Measured from the limit the person last chose, which may be next month's.
  const capIncrease = selectedMonthlyCapMinor > appliedMonthlyCapMinor;

  if (canceled) {
    return <GroupSponsorshipCanceledReceipt headingRef={headingRef} />;
  }

  const applyCap = () => {
    if (selectedMonthlyCapMinor === appliedMonthlyCapMinor) {
      return;
    }
    if (capIncrease) {
      setError(null);
      setConfirmation({
        currentMonthlyCapMinor: appliedMonthlyCapMinor,
        kind: "increase",
        nextMonthlyCapMinor: selectedMonthlyCapMinor,
        thisMonthCapMinor:
          management.pendingMonthlyCapMinor !== null &&
          selectedMonthlyCapMinor <= management.monthlyCapMinor
            ? management.monthlyCapMinor
            : null,
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

  const disabled = busy || inert;
  const copy = readManagementCopy({
    cancelOnly,
    groupName,
    management,
    periodEndTimeZone,
    recoveryProgress,
  });
  const showDial = !cancelOnly && management.status === "active";
  const cancelLink = (
    <GroupFundingLink
      disabled={disabled}
      onClick={() => {
        setError(null);
        setConfirmation({ kind: "cancel" });
      }}
    >
      Cancel sponsorship
    </GroupFundingLink>
  );

  return (
    <section
      className="flex flex-1 flex-col"
      data-component="group-sponsorship-management"
    >
      <GroupFundingScreen
        actions={
          <>
            {error && confirmation === null ? (
              <GroupFundingError>{error.message}</GroupFundingError>
            ) : null}
            <GroupSponsorshipActions
              cancelLink={cancelLink}
              capChanged={capChanged}
              capIncrease={capIncrease}
              cancelOnly={cancelOnly}
              disabled={disabled}
              onApplyCap={applyCap}
              onPause={() => void submit({ action: "pause" })}
              onRecheck={() => void recheckRecoveryStatus()}
              onResume={() => void submit({ action: "resume" })}
              onReview={() => void submit({ action: "recover" })}
              recoveryButtonRef={recoveryButtonRef}
              recoveryProgress={recoveryProgress}
              selectedMonthlyCapMinor={selectedMonthlyCapMinor}
              status={management.status}
            />
          </>
        }
        detail={copy.detail}
        headingRef={headingRef}
        title={copy.title}
      >
        {showDial ? (
          <GroupFundingDial
            caption="a month"
            disabled={disabled}
            label="Monthly limit"
            onValueChange={setSelectedMonthlyCapMinor}
            options={MONTHLY_CAP_DIAL_OPTIONS}
            value={selectedMonthlyCapMinor}
          />
        ) : null}
      </GroupFundingScreen>

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

function readManagementCopy(input: {
  cancelOnly: boolean;
  groupName: string;
  management: GroupSponsorshipManagementProjection;
  periodEndTimeZone?: string;
  recoveryProgress: GroupSponsorshipRecoveryProgress | null;
}): { detail: string; title: string } {
  const { management } = input;
  const sponsoring = `You sponsor ${input.groupName}.`;
  if (input.cancelOnly) {
    return {
      detail: "You can’t change billing right now, but you can stop refills.",
      title: sponsoring,
    };
  }
  if (input.recoveryProgress) {
    return GROUP_SPONSORSHIP_RECOVERY_COPY[input.recoveryProgress];
  }
  switch (management.status) {
    case "recovery_required":
      return {
        detail: "Refills are paused until it’s fixed.",
        title: "Your payment needs a look.",
      };
    case "paused":
      return {
        detail: "Murph won’t charge you until you resume.",
        title: "Refills are paused.",
      };
    case "pending_activation":
      return { detail: "Your first $5 is being confirmed.", title: sponsoring };
    case "active":
      return {
        detail: readSponsorshipPeriodSummary(management, input.periodEndTimeZone),
        title: sponsoring,
      };
  }
}

function readSponsorshipPeriodSummary(
  management: GroupSponsorshipManagementProjection,
  periodEndTimeZone?: string,
): string {
  const processing = management.pendingThisPeriodMinor > 0
    ? `, ${formatMoney(management.pendingThisPeriodMinor)} processing`
    : "";
  const nextLimit = management.pendingMonthlyCapMinor === null
    ? ""
    : ` ${formatMoney(management.pendingMonthlyCapMinor)} limit next month.`;
  return `${formatMoney(management.chargedThisPeriodMinor)} so far this month${processing}. Resets ${formatPeriodEnd(management.periodEnd, periodEndTimeZone)}.${nextLimit}`;
}

function GroupSponsorshipActions({
  cancelLink,
  cancelOnly,
  capChanged,
  capIncrease,
  disabled,
  onApplyCap,
  onPause,
  onRecheck,
  onResume,
  onReview,
  recoveryButtonRef,
  recoveryProgress,
  selectedMonthlyCapMinor,
  status,
}: {
  cancelLink: ReactNode;
  cancelOnly: boolean;
  capChanged: boolean;
  capIncrease: boolean;
  disabled: boolean;
  onApplyCap: () => void;
  onPause: () => void;
  onRecheck: () => void;
  onResume: () => void;
  onReview: () => void;
  recoveryButtonRef: Ref<HTMLButtonElement>;
  recoveryProgress: GroupSponsorshipRecoveryProgress | null;
  selectedMonthlyCapMinor: MonthlyCapMinor;
  status: GroupSponsorshipManagementProjection["status"];
}) {
  if (cancelOnly) {
    return cancelLink;
  }
  if (recoveryProgress === "recheck_required") {
    return (
      <>
        <GroupFundingPill disabled={disabled} onClick={onRecheck}>
          Check payment status
        </GroupFundingPill>
        {cancelLink}
      </>
    );
  }
  if (recoveryProgress === "payment_pending") {
    return cancelLink;
  }
  if (status === "recovery_required") {
    return (
      <>
        <GroupFundingPill
          disabled={disabled}
          onClick={onReview}
          ref={recoveryButtonRef}
        >
          Review payment
        </GroupFundingPill>
        {cancelLink}
      </>
    );
  }
  if (status === "paused") {
    return (
      <>
        <GroupFundingPill disabled={disabled} onClick={onResume}>
          Resume refills
        </GroupFundingPill>
        {cancelLink}
      </>
    );
  }
  if (status === "active" && capChanged) {
    return (
      <GroupFundingPill disabled={disabled} onClick={onApplyCap}>
        {`${capIncrease ? "Raise" : "Lower"} limit to ${formatMoney(selectedMonthlyCapMinor)}`}
      </GroupFundingPill>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4">
      {status === "active" ? (
        <GroupFundingLink disabled={disabled} onClick={onPause}>
          Pause refills
        </GroupFundingLink>
      ) : null}
      {cancelLink}
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
  const copy = isIncrease
    ? readLimitIncreaseCopy(confirmation)
    : {
        detail: "Refills stop. Credit you already bought stays with the group.",
        title: "Cancel your sponsorship?",
      };
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
          className="fixed inset-0 isolate z-50 bg-black/60 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          data-slot="alert-dialog-overlay"
        />
        <AlertDialogPrimitive.Popup
          className="fixed inset-x-0 bottom-0 z-50 grid w-auto gap-5 rounded-t-[28px] bg-[#1F1C19] px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-7 text-[#FFFCF6] duration-150 outline-none data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:fade-out-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:pb-7"
          data-component="group-sponsorship-management-confirmation"
          data-slot="alert-dialog-content"
          inert={inert || undefined}
        >
          <header className="grid place-items-start gap-2 text-left">
            <AlertDialogPrimitive.Title className="text-balance font-serif text-[30px] font-semibold leading-[34px] tracking-[-0.01em]">
              {copy.title}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="text-pretty text-base font-medium leading-[22px] text-[#FFFCF6]/60">
              {copy.detail}
            </AlertDialogPrimitive.Description>
          </header>

          {error ? (
            <p className="text-[15px] leading-5 text-[#E27B6E]" role="alert">
              {authoritativeRejection
                ? error.message
                : isIncrease
                ? "We’re not sure whether your limit changed. Check your current setup before trying again."
                : "We’re not sure whether your sponsorship was canceled. Check its status before trying again."}
            </p>
          ) : null}

          <footer className="flex flex-col items-center gap-1.5">
            {authoritativeRejection ? null : (
              <GroupFundingPill
                className={isIncrease ? undefined : "bg-[#2A2622] text-[#E27B6E]"}
                data-slot="alert-dialog-action"
                disabled={busy}
                onClick={onConfirm}
              >
                {busy ? <Spinner className="size-5" /> : null}
                {busy
                  ? isIncrease ? "Updating limit" : "Canceling sponsorship"
                  : isIncrease
                    ? `Raise to ${nextLimit}`
                    : error
                      ? "Check cancellation status"
                      : "Cancel sponsorship"}
              </GroupFundingPill>
            )}
            {indeterminateCancellation ? null : (
              <AlertDialogPrimitive.Close
                disabled={busy}
                render={<GroupFundingLink className="text-base" />}
              >
                {authoritativeRejection
                  ? "Refresh current setup"
                  : error
                    ? "Check current setup"
                    : isIncrease
                      ? `Keep ${currentLimit} limit`
                      : "Keep it"}
              </AlertDialogPrimitive.Close>
            )}
          </footer>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

// With a lower limit set for next month, the server applies a new limit now
// unless it is below what this month has already committed.
function readLimitIncreaseCopy(
  confirmation: Extract<
    GroupSponsorshipManagementConfirmation,
    { kind: "increase" }
  >,
): { detail: string; title: string } {
  const next = formatMoney(confirmation.nextMonthlyCapMinor);
  const charges = `When refills are on, Murph charges $5 at a time as the group uses it, up to ${next} a month instead of ${formatMoney(confirmation.currentMonthlyCapMinor)}`;
  const thisMonth = confirmation.thisMonthCapMinor ?? null;
  if (thisMonth === null) {
    return { detail: `${charges}.`, title: `Raise your limit to ${next}?` };
  }
  return {
    detail: thisMonth > confirmation.nextMonthlyCapMinor
      ? `${charges}, starting next month. This month’s ${formatMoney(thisMonth)} limit also drops to ${next}, unless you’ve already passed that.`
      : `${charges}, starting next month.`,
    title: `Raise next month’s limit to ${next}?`,
  };
}

export function GroupSponsorshipCanceledReceipt({
  headingRef,
}: {
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <section
      className="flex flex-1 flex-col"
      data-component="group-sponsorship-management"
      data-state="canceled"
    >
      <GroupFundingScreen
        detail="Credit you already bought stays with the group."
        headingRef={headingRef}
        title="Sponsorship canceled."
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
