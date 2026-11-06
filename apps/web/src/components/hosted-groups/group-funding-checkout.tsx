"use client";

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";

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
import { Button, buttonVariants } from "@/src/components/ui/button";
import { SegmentedControl } from "@/src/components/ui/segmented-control";
import { Spinner } from "@/src/components/ui/spinner";
import type {
  HostedGroupSponsorshipMonthlyCapMinor,
} from "@/src/lib/hosted-groups/group-sponsorship-contract";
import {
  HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
} from "@/src/lib/hosted-onboarding/usage-credit-capacity-conflict";
import { cn } from "@/src/lib/utils";

import {
  GroupFundingDial,
  type GroupFundingDialOption,
} from "./group-funding-dial";
import {
  GroupFundingNotice,
  GroupFundingStatusView,
  type GroupFundingStatusTone,
} from "./group-usage-funding-shell";

type GroupFundingMode = "monthly" | "one_time";

interface GroupFundingMonthlyPlan {
  capOptions: readonly GroupFundingMonthlyCapOption[];
  /** The fixed charge behind every activation and refill. */
  offer: HostedUsageTopUpOffer;
}

interface GroupFundingMonthlyCapOption {
  amountLabel: string;
  monthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor;
}

const MODE_OPTIONS = [
  { label: "Monthly", value: "monthly" },
  { label: "One time", value: "one_time" },
] as const;

const GROUP_FUNDING_FAILURE_COPY = {
  not_opened: {
    description: "Nothing was charged. Try again.",
    title: "Checkout didn’t open",
  },
  unconfirmed: {
    description: "Check it first so you aren’t charged twice.",
    title: "We couldn’t confirm your payment",
  },
} as const;

const ENDED_PURCHASE_NOTICES = {
  expired: "Checkout canceled. Nothing was charged.",
  payment_failed: "That payment didn’t go through. Nothing was charged.",
} as const;

type GroupFundingController = ReturnType<typeof useHostedUsageTopUpDialog>;
type GroupFundingScreen = GroupFundingController["state"]["screen"];

function GroupFundingCheckout({
  activePurchase = null,
  checkoutUrl,
  initialMode,
  initialMonthlyCapMinor,
  inert = false,
  monthly = null,
  note,
  oneTimeOffers,
  payerMemberId,
  purchaseReturn = null,
}: {
  activePurchase?: HostedUsageTopUpActivePurchase | null;
  checkoutUrl: string;
  /** The mode of a purchase already in progress, when there is one. */
  initialMode?: GroupFundingMode;
  initialMonthlyCapMinor?: HostedGroupSponsorshipMonthlyCapMinor;
  inert?: boolean;
  monthly?: GroupFundingMonthlyPlan | null;
  note?: ReactNode;
  oneTimeOffers: readonly HostedUsageTopUpOffer[];
  payerMemberId: string;
  purchaseReturn?: HostedUsageTopUpReturn | null;
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
  const statusVisible = screen.kind === "purchase" || screen.capacityConflict;
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
    if (statusVisible) {
      statusHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [statusVisible]);

  useEffect(() => {
    if (endedPurchase) {
      noteRef.current?.focus({ preventScroll: true });
    }
  }, [endedPurchase]);

  if (screen.kind === "purchase") {
    return (
      <GroupFundingPurchaseScreen
        controller={controller}
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
      <GroupFundingStatusView
        headingRef={statusHeadingRef}
        message={HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE}
        title="More credit can’t be added right now"
        tone="attention"
      >
        <Button
          className="w-full"
          onClick={() => {
            controller.changeAmount();
            refresh();
          }}
          size="xl"
          type="button"
        >
          Try again
        </Button>
      </GroupFundingStatusView>
    );
  }

  return (
    <GroupFundingSelectionScreen
      attempt={screen.attempt}
      controller={controller}
      endedPurchase={endedPurchase}
      mode={mode}
      monthly={monthly}
      monthlyCapMinor={monthlyCapMinor}
      note={note}
      noteRef={noteRef}
      onModeChange={setMode}
      onMonthlyCapChange={setMonthlyCapMinor}
      onOneTimeOfferChange={setOneTimeOfferCode}
      oneTimeOfferCode={oneTimeOfferCode}
      oneTimeOffers={oneTimeOffers}
    />
  );
}

function GroupFundingSelectionScreen({
  attempt,
  controller,
  endedPurchase,
  mode,
  monthly,
  monthlyCapMinor,
  note,
  noteRef,
  onModeChange,
  onMonthlyCapChange,
  onOneTimeOfferChange,
  oneTimeOfferCode,
  oneTimeOffers,
}: {
  attempt: HostedUsageTopUpSelectionScreen["attempt"];
  controller: GroupFundingController;
  endedPurchase: HostedUsageTopUpSelectionScreen["endedPurchaseStatus"];
  mode: GroupFundingMode;
  monthly: GroupFundingMonthlyPlan | null;
  monthlyCapMinor: HostedGroupSponsorshipMonthlyCapMinor;
  note: ReactNode;
  noteRef: Ref<HTMLParagraphElement>;
  onModeChange: (mode: GroupFundingMode) => void;
  onMonthlyCapChange: (cap: HostedGroupSponsorshipMonthlyCapMinor) => void;
  onOneTimeOfferChange: (offerCode: string) => void;
  oneTimeOfferCode: string;
  oneTimeOffers: readonly HostedUsageTopUpOffer[];
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
  const selection = {
    busy: controller.checkoutInFlight,
    // Starting is a safe no-op until the request identity loads, so only a tab
    // that truly can't pay shows a disabled button.
    canSubmit: controller.requestIdentityError === null,
    failure: readGroupFundingFailure(failedAttempt),
    locked: attempt.kind !== "idle",
    mode,
    monthlyRefillLabel: monthly?.offer.amountLabel ?? null,
    note:
      controller.requestIdentityError ??
      (endedPurchase ? ENDED_PURCHASE_NOTICES[endedPurchase] : null) ??
      note,
    noteRef,
    onChangeAmount: controller.changeAmount,
    // An unresolved attempt owns its terms, so its recovery must resend them.
    onModeChange:
      monthly && oneTimeOffers.length > 0 && attempt.kind === "idle"
        ? onModeChange
        : null,
    onSubmit: () =>
      void controller.startCheckout(failedAttempt?.offerCode ?? offerCode),
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

function hasOwnPurchaseEnded(screen: GroupFundingScreen): boolean {
  return (
    screen.kind === "purchase" &&
    !screen.targetConflict &&
    !screen.selectionConflict &&
    (screen.status === "expired" || screen.status === "payment_failed")
  );
}

// A request key means the attempt may have reached Stripe, so its outcome is
// unknown rather than failed.
function readGroupFundingFailure(
  failedAttempt: { requestKey: string | null } | null,
): "not_opened" | "unconfirmed" | null {
  if (!failedAttempt) {
    return null;
  }
  return failedAttempt.requestKey !== null ? "unconfirmed" : "not_opened";
}

function GroupFundingPurchaseScreen({
  controller,
  headingRef,
  onStartOver,
  purchase,
  purchaseReturn,
}: {
  controller: GroupFundingController;
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
  failure = null,
  locked = false,
  mode,
  monthlyRefillLabel,
  note,
  noteRef,
  onChangeAmount,
  onModeChange,
  onSubmit,
}: {
  amount: {
    caption: string;
    onValueChange: (value: Value) => void;
    options: readonly GroupFundingDialOption<Value>[];
    value: Value;
  };
  busy?: boolean;
  canSubmit?: boolean;
  /** How the last attempt failed. `unconfirmed` means it may have reached Stripe. */
  failure?: "not_opened" | "unconfirmed" | null;
  locked?: boolean;
  mode: GroupFundingMode;
  monthlyRefillLabel: string | null;
  note?: ReactNode;
  noteRef?: Ref<HTMLParagraphElement>;
  onChangeAmount?: () => void;
  onModeChange?: ((mode: GroupFundingMode) => void) | null;
  onSubmit: () => void;
}) {
  const selectedLabel =
    amount.options.find((option) => option.value === amount.value)
      ?.amountLabel ?? "";
  return (
    <div
      className="flex flex-1 flex-col gap-6"
      data-mode={mode}
      data-slot="group-funding-selection"
    >
      {onModeChange ? (
        <SegmentedControl
          aria-label="How often"
          className="h-11 rounded-xl"
          itemClassName="h-9 rounded-lg"
          onValueChange={onModeChange}
          options={MODE_OPTIONS}
          value={mode}
        />
      ) : null}

      <div className="flex flex-1 items-center">
        <GroupFundingDial
          caption={amount.caption}
          disabled={locked}
          label={mode === "monthly" ? "Monthly amount" : "Amount"}
          onValueChange={amount.onValueChange}
          options={amount.options}
          value={amount.value}
        />
      </div>

      <div className="flex flex-col gap-3">
        {failure ? (
          <GroupFundingNotice
            {...GROUP_FUNDING_FAILURE_COPY[failure]}
            role="alert"
            tone="attention"
          />
        ) : note ? (
          <p
            className="text-center text-sm/5 text-pretty text-foreground outline-none"
            ref={noteRef}
            role="status"
            tabIndex={-1}
          >
            {note}
          </p>
        ) : null}

        <Button
          aria-busy={busy}
          className="w-full"
          disabled={!canSubmit || (failure ? busy : locked)}
          onClick={onSubmit}
          size="xl"
          type="button"
        >
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {readGroupFundingActionLabel({ busy, failure, mode, selectedLabel })}
        </Button>

        {failure === "not_opened" && onChangeAmount ? (
          <Button
            className="w-full"
            onClick={onChangeAmount}
            size="lg"
            type="button"
            variant="ghost"
          >
            Change amount
          </Button>
        ) : failure ? null : (
          <p className="text-center text-sm/5 text-pretty text-muted-foreground">
            {mode === "monthly"
              ? readMonthlyChargeNote({
                  capLabel: selectedLabel,
                  refillLabel: monthlyRefillLabel ?? selectedLabel,
                })
              : "One payment. Nothing repeats."}
          </p>
        )}
      </div>
    </div>
  );
}

function readGroupFundingActionLabel(input: {
  busy: boolean;
  failure: "not_opened" | "unconfirmed" | null;
  mode: GroupFundingMode;
  selectedLabel: string;
}): string {
  if (input.failure === "unconfirmed") {
    return input.busy ? "Checking payment" : "Check payment";
  }
  if (input.busy) {
    return "Opening checkout";
  }
  if (input.failure === "not_opened") {
    return "Try again";
  }
  return input.mode === "monthly"
    ? `Sponsor up to ${input.selectedLabel} a month`
    : `Contribute ${input.selectedLabel}`;
}

function readMonthlyChargeNote(input: {
  capLabel: string;
  refillLabel: string;
}): string {
  return input.capLabel === input.refillLabel
    ? `${input.refillLabel} today, and never more than that in a month. Cancel anytime.`
    : `${input.refillLabel} today, then ${input.refillLabel} at a time as the group uses Murph, up to ${input.capLabel} a month. Cancel anytime.`;
}

interface GroupFundingPurchaseStatusContent {
  message: string;
  /** The primary action once this purchase has nothing left to do. */
  next?: "messages" | "start_over";
  title: string;
  tone: GroupFundingStatusTone;
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
      title: "We couldn’t check your payment",
      tone: "attention",
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
  let message = actions.canResume
    ? "Pick up where you left off, or cancel it to start over."
    : "It can’t be reopened from here. Retry it, or cancel it to start over.";
  if (purchase.targetConflict) {
    message = "It’s for another chat. Finish or cancel it before starting this one.";
  } else if (purchase.selectionConflict) {
    message = "Finish or cancel it before choosing another amount.";
  }
  return { message, title: "You have a checkout open", tone: "attention" };
}

function readStartingCheckoutStatus(
  actions: HostedUsageTopUpPurchaseActions,
): GroupFundingPurchaseStatusContent {
  return actions.canRetry
    ? {
        message: "Nothing was charged. It’s safe to retry.",
        title: "Checkout didn’t open",
        tone: "attention",
      }
    : {
        message:
          "Your payment is still being set up. This usually takes a few seconds.",
        title: "Almost ready",
        tone: "working",
      };
}

function readConfirmingStatus(
  purchase: HostedUsageTopUpPurchaseScreen,
): GroupFundingPurchaseStatusContent {
  return purchase.poll.kind === "exhausted"
    ? {
        message:
          "This is taking longer than usual. It’s safe to leave this page.",
        title: "Still confirming your payment",
        tone: "attention",
      }
    : {
        message: "This usually takes a few seconds.",
        title: isEarlierPurchase(purchase)
          ? "Confirming your earlier payment"
          : "Confirming your payment",
        tone: "working",
      };
}

function readFinishedStatus(
  purchase: HostedUsageTopUpPurchaseScreen,
): GroupFundingPurchaseStatusContent {
  if (!isEarlierPurchase(purchase)) {
    return {
      message: "Open Messages and pick up where you left off.",
      next: "messages",
      title: "This group has more Murph",
      tone: "done",
    };
  }
  return purchase.status === "fulfilled"
    ? {
        message: "It’s finished, so you can start a new one.",
        next: "start_over",
        title: "Your earlier payment went through",
        tone: "done",
      }
    : {
        message: "It’s closed, so you can start a new one.",
        next: "start_over",
        title: "Your earlier checkout ended",
        tone: "done",
      };
}

function GroupFundingPurchaseStatus({
  actions,
  cancelLabel = "Cancel checkout",
  checkoutError,
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
    <GroupFundingStatusView
      error={checkoutError}
      headingRef={headingRef}
      message={status.message}
      title={status.title}
      tone={status.tone}
    >
      {status.next === "messages" ? (
        // Messages has no deep link into an existing group thread, so the group
        // follow-up can only open the app itself.
        <a
          className={cn(buttonVariants({ size: "xl" }), "w-full")}
          href="sms:"
        >
          <MessageCircle aria-hidden="true" data-icon="inline-start" />
          Open Messages
        </a>
      ) : null}
      {status.next === "start_over" ? (
        <Button className="w-full" onClick={onStartOver} size="xl" type="button">
          Start over
        </Button>
      ) : null}
      {actions.canResume ? (
        <Button
          className="w-full"
          disabled={busy}
          onClick={onResume}
          size="xl"
          type="button"
        >
          Continue to payment
        </Button>
      ) : null}
      {actions.canRetry ? (
        <Button
          aria-busy={operation === "opening_checkout"}
          className="w-full"
          disabled={busy}
          onClick={onRetry}
          size="xl"
          type="button"
        >
          {operation === "opening_checkout" ? "Checking payment" : "Retry payment"}
        </Button>
      ) : null}
      {actions.canCheckAgain ? (
        <Button
          className="w-full"
          disabled={busy}
          onClick={onCheckAgain}
          size="xl"
          type="button"
        >
          Check again
        </Button>
      ) : null}
      {actions.canCancel ? (
        <Button
          aria-busy={operation === "canceling_checkout"}
          className="w-full"
          disabled={busy}
          onClick={onCancel}
          size="lg"
          type="button"
          variant="ghost"
        >
          {operation === "canceling_checkout" ? "Canceling" : cancelLabel}
        </Button>
      ) : null}
    </GroupFundingStatusView>
  );
}

export {
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
