"use client";

import { useEffect, useState, type ReactNode } from "react";
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
type GroupFundingEndedPurchase = "expired" | "payment_failed";

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

const ENDED_PURCHASE_NOTICES: Record<GroupFundingEndedPurchase, string> = {
  expired: "Checkout canceled. Nothing was charged.",
  payment_failed: "That payment didn’t go through. Nothing was charged.",
};

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
  const [endedPurchase, setEndedPurchase] =
    useState<GroupFundingEndedPurchase | null>(null);
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
  const purchase = screen.kind === "purchase" ? screen : null;
  const purchaseEnded =
    purchase &&
    !purchase.targetConflict &&
    !purchase.selectionConflict &&
    (purchase.status === "expired" || purchase.status === "payment_failed")
      ? purchase.status
      : null;

  // A canceled or failed checkout has nothing left to resolve, so the person
  // lands back on the page with a short note instead of a dead end.
  useEffect(() => {
    if (purchaseEnded) {
      setEndedPurchase(purchaseEnded);
      controller.handleOpenChange(true);
      refresh();
    }
    // Only the transition into an ended purchase should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseEnded]);

  if (screen.kind === "purchase") {
    const returnedFromSuccessfulCheckout =
      purchaseReturn?.kind === "success" &&
      purchaseReturn.purchaseId === screen.purchaseId;
    const actions = readHostedUsageTopUpPurchaseActions(
      screen,
      returnedFromSuccessfulCheckout,
    );
    return (
      <GroupFundingPurchaseStatus
        actions={actions}
        checkoutError={screen.checkoutError}
        operation={screen.operation}
        onCancel={() => void controller.cancelRecoveredCheckout()}
        onCheckAgain={controller.retryStatusCheck}
        onResume={() => window.location.assign(screen.checkoutUrl ?? "")}
        onRetry={() =>
          void controller.startCheckout(screen.retryOfferCode ?? undefined)
        }
        onStartOver={() => {
          controller.handleOpenChange(true);
          refresh();
        }}
        status={readGroupFundingPurchaseStatus({
          actions,
          purchase: screen,
          returnedFromSuccessfulCheckout,
        })}
      />
    );
  }

  if (screen.capacityConflict) {
    return (
      <GroupFundingStatusView
        message={HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE}
        title="More credit can’t be added right now"
        tone="attention"
      />
    );
  }

  const attempt = screen.attempt;
  const failedAttempt =
    attempt.kind === "locked" && attempt.error !== null ? attempt : null;
  const oneTimeOffer =
    oneTimeOffers.find((offer) => offer.offerCode === oneTimeOfferCode) ??
    oneTimeOffers[0];
  const offerCode =
    monthly && mode === "monthly" ? monthly.offer.offerCode : oneTimeOffer?.offerCode;
  if (!offerCode) {
    return null;
  }

  const selection = {
    busy: controller.checkoutInFlight,
    canSubmit: controller.requestIdentityReady,
    failure: failedAttempt
      ? failedAttempt.requestKey !== null
        ? ("unconfirmed" as const)
        : ("not_opened" as const)
      : null,
    locked: attempt.kind !== "idle",
    mode,
    monthlyRefillLabel: monthly?.offer.amountLabel ?? null,
    note:
      controller.requestIdentityError ??
      (endedPurchase ? ENDED_PURCHASE_NOTICES[endedPurchase] : null) ??
      note,
    onChangeAmount: controller.changeAmount,
    onModeChange: monthly && oneTimeOffers.length > 0 ? setMode : null,
    onSubmit: () => {
      setEndedPurchase(null);
      void controller.startCheckout(failedAttempt?.offerCode ?? offerCode);
    },
  };

  return monthly && mode === "monthly" ? (
    <GroupFundingSelection
      {...selection}
      amount={{
        caption: "a month",
        onValueChange: setMonthlyCapMinor,
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
        onValueChange: setOneTimeOfferCode,
        options: oneTimeOffers.map((offer) => ({
          amountLabel: offer.amountLabel,
          value: offer.offerCode,
        })),
        value: offerCode,
      }}
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
            description={
              failure === "unconfirmed"
                ? "Check it first so you aren’t charged twice."
                : "Nothing was charged. Try again."
            }
            title={
              failure === "unconfirmed"
                ? "We couldn’t confirm your payment"
                : "Checkout didn’t open"
            }
            tone="attention"
          />
        ) : note ? (
          <p
            className="text-center text-sm/5 text-pretty text-foreground"
            role="status"
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
          {busy
            ? failure === "unconfirmed"
              ? "Checking payment"
              : "Opening checkout"
            : failure === "unconfirmed"
              ? "Check payment"
              : failure === "not_opened"
                ? "Try again"
                : mode === "monthly"
                  ? `Sponsor up to ${selectedLabel} a month`
                  : `Contribute ${selectedLabel}`}
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
  const { poll, selectionConflict, status, targetConflict } = purchase;
  const pending = status === null || shouldPollPurchaseStatus(status);
  const earlier = targetConflict || selectionConflict !== null;

  if (poll.kind === "failed") {
    return {
      message: "You won’t be charged again. Try checking once more.",
      title: "We couldn’t check your payment",
      tone: "attention",
    };
  }
  if (status === "checkout_open" && !returnedFromSuccessfulCheckout) {
    return {
      message: targetConflict
        ? "It’s for another chat. Finish or cancel it before starting this one."
        : selectionConflict
          ? "Finish or cancel it before choosing another amount."
          : actions.canResume
            ? "Pick up where you left off, or cancel it to start over."
            : "It can’t be reopened from here. Retry it, or cancel it to start over.",
      title: "You have a checkout open",
      tone: "attention",
    };
  }
  if (status === "reconciling" && !returnedFromSuccessfulCheckout) {
    return {
      message: actions.canRetry
        ? "Nothing was charged. It’s safe to retry."
        : "Your payment is still being set up. This usually takes a few seconds.",
      title: actions.canRetry ? "Checkout didn’t open" : "Almost ready",
      tone: actions.canRetry ? "attention" : "working",
    };
  }
  if (pending) {
    return poll.kind === "exhausted"
      ? {
          message:
            "This is taking longer than usual. It’s safe to leave this page.",
          title: "Still confirming your payment",
          tone: "attention",
        }
      : {
          message: "This usually takes a few seconds.",
          title: earlier
            ? "Confirming your earlier payment"
            : "Confirming your payment",
          tone: "working",
        };
  }
  if (earlier) {
    return status === "fulfilled"
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
  return {
    message: "Open Messages and pick up where you left off.",
    next: "messages",
    title: "This group has more Murph",
    tone: "done",
  };
}

function GroupFundingPurchaseStatus({
  actions,
  checkoutError,
  onCancel,
  onCheckAgain,
  onResume,
  onRetry,
  onStartOver,
  operation,
  status,
}: {
  actions: HostedUsageTopUpPurchaseActions;
  checkoutError?: string | null;
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
          {operation === "canceling_checkout" ? "Canceling" : "Cancel checkout"}
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
