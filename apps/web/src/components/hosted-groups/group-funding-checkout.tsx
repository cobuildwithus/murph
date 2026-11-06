"use client";

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { useRouter } from "next/navigation";

import {
  type HostedUsageTopUpActivePurchase,
  type HostedUsageTopUpOffer,
  type HostedUsageTopUpReturn,
  shouldPollPurchaseStatus,
} from "@/src/components/settings/hosted-usage-top-up-contract";
import {
  readHostedUsageTopUpPurchaseActions,
  type HostedUsageTopUpPurchaseActions,
  type HostedUsageTopUpPurchaseScreen,
  type HostedUsageTopUpSelectionScreen,
} from "@/src/components/settings/hosted-usage-top-up-state";
import { useHostedUsageTopUpDialog } from "@/src/components/settings/use-hosted-usage-top-up-dialog";
import { Spinner } from "@/src/components/ui/spinner";
import type {
  HostedGroupSponsorshipMonthlyCapMinor,
} from "@/src/lib/hosted-groups/group-sponsorship-contract";

import {
  GroupFundingDial,
  type GroupFundingDialOption,
} from "./group-funding-dial";
import { GroupFundingOpenMessages } from "./group-funding-open-messages";
import {
  LinkPageError,
  LinkPageLink,
  LinkPagePill,
  LinkPageScreen,
  LinkPageTicket,
} from "@/src/components/link-page/link-page-shell";

type GroupFundingMode = "monthly" | "one_time";
type GroupFundingFailure = "not_opened" | "unconfirmed";

interface GroupFundingMonthlyPlan {
  capOptions: readonly GroupFundingMonthlyCapOption[];
  /** The fixed charge behind every activation and refill. */
  offer: HostedUsageTopUpOffer;
}

interface GroupFundingMonthlyCapOption {
  amountLabel: string;
  monthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor;
}

const MODE_SWITCH_LABELS: Record<GroupFundingMode, string> = {
  monthly: "Give once instead",
  one_time: "Sponsor monthly instead",
};

const ENDED_PURCHASE_NOTICES = {
  expired: "Checkout canceled. Nothing was charged.",
  payment_failed: "That payment didn’t go through. Nothing was charged.",
} as const;

const GROUP_FUNDING_FAILURE_COPY = {
  not_opened: {
    detail: "Nothing was charged. Try again.",
    title: "Checkout didn’t open.",
  },
  unconfirmed: {
    detail: "Check it first so you aren’t charged twice.",
    title: "We couldn’t confirm that payment.",
  },
} as const;

type GroupFundingController = ReturnType<typeof useHostedUsageTopUpDialog>;
type GroupFundingScreenState = GroupFundingController["state"]["screen"];

function GroupFundingCheckout({
  activePurchase = null,
  checkoutUrl,
  groupName,
  initialMode,
  initialMonthlyCapMinor,
  inert = false,
  monthly = null,
  oneTimeOffers,
  payerMemberId,
  purchaseReturn = null,
  sponsoredByAnother = false,
}: {
  activePurchase?: HostedUsageTopUpActivePurchase | null;
  checkoutUrl: string;
  groupName: string;
  /** The mode of a purchase already in progress, when there is one. */
  initialMode?: GroupFundingMode;
  initialMonthlyCapMinor?: HostedGroupSponsorshipMonthlyCapMinor;
  inert?: boolean;
  monthly?: GroupFundingMonthlyPlan | null;
  oneTimeOffers: readonly HostedUsageTopUpOffer[];
  payerMemberId: string;
  purchaseReturn?: HostedUsageTopUpReturn | null;
  sponsoredByAnother?: boolean;
}) {
  const { refresh } = useRouter();
  const [requestedMode, setMode] = useState<GroupFundingMode>(
    initialMode ?? "monthly",
  );
  const mode = monthly ? requestedMode : "one_time";
  const [monthlyCapMinor, setMonthlyCapMinor] = useState(
    initialMonthlyCapMinor ?? monthly?.capOptions[0]?.monthlyCapMinor ?? 500,
  );
  const [oneTimeOfferCode, setOneTimeOfferCode] = useState(
    oneTimeOffers[0]?.offerCode ?? "",
  );
  const controller = useHostedUsageTopUpDialog({
    activePurchase,
    buildCheckoutPayload: ({ clientRequestKey, offerCode }) => ({
      clientRequestKey,
      offerCode,
      ...(mode === "monthly"
        ? { monthlyCapMinor, sponsorshipKind: "monthly" }
        : { sponsorshipKind: "one_time" }),
    }),
    checkoutUrl,
    inert,
    initialOpen: true,
    offers: monthly && mode === "monthly" ? [monthly.offer] : oneTimeOffers,
    payerMemberId,
    purchaseReturn,
  });
  const { screen } = controller.state;
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const statusKey = readStatusKey(screen);
  const purchaseEnded = hasOwnPurchaseEnded(screen);
  // The note only explains the page the person landed on. Starting again
  // replaces it.
  const endedPurchase =
    screen.kind === "selection" && screen.attempt.kind === "idle"
      ? screen.endedPurchaseStatus
      : null;

  // A canceled or failed checkout has nothing left to resolve, so the person
  // lands back on the page with a short note instead of a dead end.
  useEffect(() => {
    if (purchaseEnded) {
      controller.handleOpenChange(true);
      refresh();
    }
    // Only the transition into an ended purchase should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseEnded]);

  // Each outcome replaces the control the person just used, so focus moves with
  // it. This also gets the new state read out, which a live region alone can
  // miss when it mounts with its content.
  useEffect(() => {
    if (statusKey) {
      statusHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [statusKey]);

  useEffect(() => {
    if (endedPurchase) {
      noteRef.current?.focus({ preventScroll: true });
    }
  }, [endedPurchase]);

  if (screen.kind === "purchase") {
    return (
      <GroupFundingPurchaseScreen
        controller={controller}
        groupName={groupName}
        headingRef={statusHeadingRef}
        onStartOver={() => {
          controller.handleOpenChange(true);
          refresh();
        }}
        purchase={screen}
        purchaseReturn={purchaseReturn}
      />
    );
  }

  if (screen.capacityConflict) {
    return (
      <GroupFundingCapacityConflict
        headingRef={statusHeadingRef}
        onTryAgain={() => {
          controller.changeAmount();
          refresh();
        }}
      />
    );
  }

  return (
    <GroupFundingSelectionScreen
      attempt={screen.attempt}
      controller={controller}
      endedPurchase={endedPurchase}
      groupName={groupName}
      headingRef={statusHeadingRef}
      mode={mode}
      monthly={monthly}
      monthlyCapMinor={monthlyCapMinor}
      noteRef={noteRef}
      onModeChange={setMode}
      onMonthlyCapChange={setMonthlyCapMinor}
      onOneTimeOfferChange={setOneTimeOfferCode}
      oneTimeOfferCode={oneTimeOfferCode}
      oneTimeOffers={oneTimeOffers}
      sponsoredByAnother={sponsoredByAnother}
    />
  );
}

function GroupFundingCapacityConflict({
  headingRef,
  onTryAgain,
}: {
  headingRef?: Ref<HTMLHeadingElement>;
  onTryAgain?: () => void;
}) {
  return (
    <LinkPageScreen
      actions={<LinkPagePill onClick={onTryAgain}>Try again</LinkPagePill>}
      detail="Try again once the group has used some of it."
      headingRef={headingRef}
      title="The group’s topped up for now."
    />
  );
}

function GroupFundingSelectionScreen({
  attempt,
  controller,
  endedPurchase,
  groupName,
  headingRef,
  mode,
  monthly,
  monthlyCapMinor,
  noteRef,
  onModeChange,
  onMonthlyCapChange,
  onOneTimeOfferChange,
  oneTimeOfferCode,
  oneTimeOffers,
  sponsoredByAnother,
}: {
  attempt: HostedUsageTopUpSelectionScreen["attempt"];
  controller: GroupFundingController;
  endedPurchase: HostedUsageTopUpSelectionScreen["endedPurchaseStatus"];
  groupName: string;
  headingRef: Ref<HTMLHeadingElement>;
  mode: GroupFundingMode;
  monthly: GroupFundingMonthlyPlan | null;
  monthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor;
  noteRef: Ref<HTMLParagraphElement>;
  onModeChange: (mode: GroupFundingMode) => void;
  onMonthlyCapChange: (cap: HostedGroupSponsorshipMonthlyCapMinor) => void;
  onOneTimeOfferChange: (offerCode: string) => void;
  oneTimeOfferCode: string;
  oneTimeOffers: readonly HostedUsageTopUpOffer[];
  sponsoredByAnother: boolean;
}) {
  const oneTimeOffer =
    oneTimeOffers.find((offer) => offer.offerCode === oneTimeOfferCode) ??
    oneTimeOffers[0];
  const offerCode =
    monthly && mode === "monthly"
      ? monthly.offer.offerCode
      : oneTimeOffer?.offerCode;
  if (!offerCode) {
    return null;
  }

  const failedAttempt =
    attempt.kind === "locked" && attempt.error !== null ? attempt : null;
  if (failedAttempt) {
    return (
      <GroupFundingAttemptFailure
        blockedReason={controller.requestIdentityError}
        busy={controller.checkoutInFlight}
        failure={readGroupFundingFailure(failedAttempt)}
        headingRef={headingRef}
        onChangeAmount={controller.changeAmount}
        onRetry={() => void controller.startCheckout(failedAttempt.offerCode)}
      />
    );
  }

  const selection = {
    busy: controller.checkoutInFlight,
    // Starting is a safe no-op until the request identity loads, so only a tab
    // that truly can't pay shows a disabled button.
    canSubmit: controller.requestIdentityError === null,
    detail:
      controller.requestIdentityError ??
      (endedPurchase ? ENDED_PURCHASE_NOTICES[endedPurchase] : null) ??
      (sponsoredByAnother ? "You can still chip in." : null),
    detailRef: noteRef,
    headingRef,
    locked: attempt.kind !== "idle",
    mode,
    // An unresolved attempt owns its terms, so its recovery must resend them.
    onModeChange:
      monthly && oneTimeOffers.length > 0 && attempt.kind === "idle"
        ? onModeChange
        : null,
    onSubmit: () => void controller.startCheckout(offerCode),
    title: sponsoredByAnother
      ? `${capitalizeFirst(groupName)} is sponsored.`
      : `Keep Murph in ${groupName}.`,
  };

  return monthly && mode === "monthly" ? (
    <GroupFundingSelection
      {...selection}
      amount={{
        caption: "a month",
        onValueChange: onMonthlyCapChange,
        options: monthly.capOptions.map((option) => ({
          amountLabel: option.amountLabel,
          value: option.monthlyCapMinor,
        })),
        value: monthlyCapMinor,
      }}
    />
  ) : (
    <GroupFundingSelection
      {...selection}
      amount={{
        caption: "one time",
        onValueChange: onOneTimeOfferChange,
        options: oneTimeOffers.map((offer) => ({
          amountLabel: offer.amountLabel,
          value: offer.offerCode,
        })),
        value: offerCode,
      }}
    />
  );
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Changes whenever a new outcome takes over the page.
function readStatusKey(screen: GroupFundingScreenState): string | null {
  if (screen.kind === "purchase") {
    const { kind } = screen.poll;
    const stopped = kind === "exhausted" || kind === "failed";
    return `${screen.status}:${stopped ? kind : "polling"}`;
  }
  if (screen.capacityConflict) {
    return "capacity";
  }
  return screen.attempt.kind === "locked" && screen.attempt.error !== null
    ? "attempt"
    : null;
}

function hasOwnPurchaseEnded(screen: GroupFundingScreenState): boolean {
  return (
    screen.kind === "purchase" &&
    !screen.targetConflict &&
    !screen.selectionConflict &&
    (screen.status === "expired" || screen.status === "payment_failed")
  );
}

// A request key means the attempt may have reached Stripe, so its outcome is
// unknown rather than failed.
function readGroupFundingFailure(failedAttempt: {
  requestKey: string | null;
}): GroupFundingFailure {
  return failedAttempt.requestKey !== null ? "unconfirmed" : "not_opened";
}

function GroupFundingAttemptFailure({
  blockedReason = null,
  busy = false,
  failure,
  headingRef,
  onChangeAmount,
  onRetry,
}: {
  /** Why this tab can't retry, when it can't. */
  blockedReason?: string | null;
  busy?: boolean;
  failure: GroupFundingFailure;
  headingRef?: Ref<HTMLHeadingElement>;
  onChangeAmount?: () => void;
  onRetry?: () => void;
}) {
  const unconfirmed = failure === "unconfirmed";
  return (
    <LinkPageScreen
      actions={
        <>
          <LinkPagePill
            aria-busy={busy}
            disabled={busy || blockedReason !== null}
            onClick={onRetry}
          >
            {busy ? <Spinner className="size-5" /> : null}
            {unconfirmed
              ? busy
                ? "Checking payment"
                : "Check payment"
              : busy
                ? "Opening checkout"
                : "Try again"}
          </LinkPagePill>
          {unconfirmed ? null : (
            <LinkPageLink onClick={onChangeAmount}>
              Change amount
            </LinkPageLink>
          )}
        </>
      }
      detail={blockedReason ?? GROUP_FUNDING_FAILURE_COPY[failure].detail}
      headingRef={headingRef}
      title={GROUP_FUNDING_FAILURE_COPY[failure].title}
    />
  );
}

function GroupFundingPurchaseScreen({
  controller,
  groupName,
  headingRef,
  onStartOver,
  purchase,
  purchaseReturn,
}: {
  controller: GroupFundingController;
  groupName: string;
  headingRef: Ref<HTMLHeadingElement>;
  onStartOver: () => void;
  purchase: HostedUsageTopUpPurchaseScreen;
  purchaseReturn: HostedUsageTopUpReturn | null;
}) {
  const returnedFromSuccessfulCheckout =
    purchaseReturn?.kind === "success" &&
    purchaseReturn.purchaseId === purchase.purchaseId;
  const actions = readHostedUsageTopUpPurchaseActions(
    purchase,
    returnedFromSuccessfulCheckout,
  );
  return (
    <GroupFundingPurchaseStatus
      actions={actions}
      cancelLabel={
        purchase.status === "payment_pending"
          ? "Cancel payment"
          : "Cancel checkout"
      }
      checkoutError={purchase.checkoutError}
      groupName={groupName}
      headingRef={headingRef}
      operation={purchase.operation}
      onCancel={() => void controller.cancelRecoveredCheckout()}
      onCheckAgain={controller.retryStatusCheck}
      onResume={() => window.location.assign(purchase.checkoutUrl ?? "")}
      onRetry={() =>
        void controller.startCheckout(purchase.retryOfferCode ?? undefined)
      }
      onStartOver={onStartOver}
      status={readGroupFundingPurchaseStatus({
        actions,
        purchase,
        returnedFromSuccessfulCheckout,
      })}
    />
  );
}

function GroupFundingSelection<Value extends number | string>({
  amount,
  busy = false,
  canSubmit = true,
  detail,
  detailRef,
  headingRef,
  locked = false,
  mode,
  onModeChange,
  onSubmit,
  title,
}: {
  amount: {
    caption: string;
    onValueChange: (value: Value) => void;
    options: readonly GroupFundingDialOption<Value>[];
    value: Value;
  };
  busy?: boolean;
  canSubmit?: boolean;
  detail?: ReactNode;
  detailRef?: Ref<HTMLParagraphElement>;
  headingRef?: Ref<HTMLHeadingElement>;
  locked?: boolean;
  mode: GroupFundingMode;
  onModeChange?: ((mode: GroupFundingMode) => void) | null;
  onSubmit: () => void;
  title: string;
}) {
  const selectedLabel =
    amount.options.find((option) => option.value === amount.value)
      ?.amountLabel ?? "";
  return (
    <LinkPageScreen
      actions={
        <>
          <LinkPagePill
            aria-busy={busy}
            disabled={!canSubmit || locked}
            onClick={onSubmit}
          >
            {busy ? <Spinner className="size-5" /> : null}
            {readGroupFundingActionLabel({ busy, mode, selectedLabel })}
          </LinkPagePill>
          {onModeChange ? (
            <LinkPageLink
              onClick={() =>
                onModeChange(mode === "monthly" ? "one_time" : "monthly")
              }
            >
              {MODE_SWITCH_LABELS[mode]}
            </LinkPageLink>
          ) : null}
        </>
      }
      detail={detail}
      detailRef={detailRef}
      headingRef={headingRef}
      title={title}
    >
      <GroupFundingDial
        caption={amount.caption}
        disabled={locked}
        label={mode === "monthly" ? "Monthly amount" : "Amount"}
        onValueChange={amount.onValueChange}
        options={amount.options}
        value={amount.value}
      />
    </LinkPageScreen>
  );
}

function readGroupFundingActionLabel(input: {
  busy: boolean;
  mode: GroupFundingMode;
  selectedLabel: string;
}): string {
  if (input.busy) {
    return "Opening checkout";
  }
  return input.mode === "monthly"
    ? `Sponsor up to ${input.selectedLabel} a month`
    : `Give ${input.selectedLabel}`;
}

interface GroupFundingPurchaseStatusContent {
  message: string;
  /** The primary action once this purchase has nothing left to do. */
  next?: "messages" | "start_over";
  title: string;
  working?: true;
}

function readGroupFundingPurchaseStatus({
  actions,
  purchase,
  returnedFromSuccessfulCheckout,
}: {
  actions: HostedUsageTopUpPurchaseActions;
  purchase: HostedUsageTopUpPurchaseScreen;
  returnedFromSuccessfulCheckout: boolean;
}): GroupFundingPurchaseStatusContent {
  const { poll, status } = purchase;
  if (poll.kind === "failed") {
    return {
      message: "You won’t be charged again. Try checking once more.",
      title: "We couldn’t check your payment.",
    };
  }
  if (status === "checkout_open" && !returnedFromSuccessfulCheckout) {
    return readOpenCheckoutStatus(actions, purchase);
  }
  if (status === "reconciling" && !returnedFromSuccessfulCheckout) {
    return readStartingCheckoutStatus(actions);
  }
  if (status === null || shouldPollPurchaseStatus(status)) {
    return readConfirmingStatus(purchase);
  }
  return readFinishedStatus(purchase);
}

function isEarlierPurchase(purchase: HostedUsageTopUpPurchaseScreen): boolean {
  return purchase.targetConflict || purchase.selectionConflict !== null;
}

function readOpenCheckoutStatus(
  actions: HostedUsageTopUpPurchaseActions,
  purchase: HostedUsageTopUpPurchaseScreen,
): GroupFundingPurchaseStatusContent {
  if (purchase.targetConflict) {
    return {
      message: "It’s for another chat. Finish or cancel it before starting this one.",
      title: "You have a checkout open.",
    };
  }
  if (purchase.selectionConflict) {
    return {
      message: "Finish or cancel it before choosing another amount.",
      title: "You have a checkout open.",
    };
  }
  return {
    message: actions.canResume
      ? "Pick up where you left off, or cancel to start over."
      : "It can’t be reopened from here. Retry it, or cancel to start over.",
    title: "You left checkout open.",
  };
}

function readStartingCheckoutStatus(
  actions: HostedUsageTopUpPurchaseActions,
): GroupFundingPurchaseStatusContent {
  return actions.canRetry
    ? {
        message: "Nothing was charged. It’s safe to retry.",
        title: "Checkout didn’t open.",
      }
    : {
        message:
          "Your payment is still being set up. This usually takes a few seconds.",
        title: "Almost ready.",
        working: true,
      };
}

function readConfirmingStatus(
  purchase: HostedUsageTopUpPurchaseScreen,
): GroupFundingPurchaseStatusContent {
  return purchase.poll.kind === "exhausted"
    ? {
        message:
          "This is taking longer than usual. It’s safe to leave this page.",
        title: "Still confirming your payment.",
      }
    : {
        message: "This usually takes a few seconds.",
        title: isEarlierPurchase(purchase)
          ? "Confirming your earlier payment."
          : "Confirming your payment.",
        working: true,
      };
}

function readFinishedStatus(
  purchase: HostedUsageTopUpPurchaseScreen,
): GroupFundingPurchaseStatusContent {
  if (!isEarlierPurchase(purchase)) {
    return {
      message: "Open Messages and pick up where you left off.",
      next: "messages",
      title: "This group has more Murph.",
    };
  }
  return purchase.status === "fulfilled"
    ? {
        message: "It’s finished, so you can start a new one.",
        next: "start_over",
        title: "Your earlier payment went through.",
      }
    : {
        message: "It’s closed, so you can start a new one.",
        next: "start_over",
        title: "Your earlier checkout ended.",
      };
}

function GroupFundingPurchaseStatus({
  actions,
  cancelLabel = "Cancel checkout",
  checkoutError,
  groupName,
  headingRef,
  onCancel,
  onCheckAgain,
  onResume,
  onRetry,
  onStartOver,
  operation,
  status,
}: {
  actions: HostedUsageTopUpPurchaseActions;
  cancelLabel?: string;
  checkoutError?: string | null;
  groupName: string;
  headingRef?: Ref<HTMLHeadingElement>;
  onCancel?: () => void;
  onCheckAgain?: () => void;
  onResume?: () => void;
  onRetry?: () => void;
  onStartOver?: () => void;
  operation: HostedUsageTopUpPurchaseScreen["operation"];
  status: GroupFundingPurchaseStatusContent;
}) {
  const busy = operation !== "idle";
  return (
    <LinkPageScreen
      actions={
        <>
          {checkoutError ? (
            <LinkPageError>{checkoutError}</LinkPageError>
          ) : null}
          {status.next === "messages" ? <GroupFundingOpenMessages /> : null}
          {status.next === "start_over" ? (
            <LinkPagePill onClick={onStartOver}>Start over</LinkPagePill>
          ) : null}
          {actions.canResume ? (
            <LinkPagePill disabled={busy} onClick={onResume}>
              Keep going
            </LinkPagePill>
          ) : null}
          {actions.canRetry ? (
            <LinkPagePill
              aria-busy={operation === "opening_checkout"}
              disabled={busy}
              onClick={onRetry}
            >
              {operation === "opening_checkout"
                ? "Checking payment"
                : "Retry payment"}
            </LinkPagePill>
          ) : null}
          {actions.canCheckAgain ? (
            <LinkPagePill disabled={busy} onClick={onCheckAgain}>
              Check again
            </LinkPagePill>
          ) : null}
          {actions.canCancel ? (
            <LinkPageLink
              aria-busy={operation === "canceling_checkout"}
              disabled={busy}
              onClick={onCancel}
            >
              {operation === "canceling_checkout" ? "Canceling" : cancelLabel}
            </LinkPageLink>
          ) : null}
        </>
      }
      below={
        status.working ? (
          <Spinner className="mt-[22px] size-6 text-[#EBD18B]" />
        ) : status.next === "messages" ? (
          <LinkPageTicket kicker={`For ${groupName}`} title="More Murph" />
        ) : null
      }
      detail={status.message}
      headingRef={headingRef}
      title={status.title}
    />
  );
}

export {
  GroupFundingAttemptFailure,
  GroupFundingCapacityConflict,
  GroupFundingCheckout,
  GroupFundingPurchaseStatus,
  GroupFundingSelection,
  readGroupFundingPurchaseStatus,
};
export type {
  GroupFundingMode,
  GroupFundingMonthlyCapOption,
  GroupFundingMonthlyPlan,
  GroupFundingPurchaseStatusContent,
};
