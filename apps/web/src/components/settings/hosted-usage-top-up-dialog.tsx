"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/src/components/ui/button";
import { ChoiceCard } from "@/src/components/ui/choice-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";
import {
  FieldDescription,
  FieldError,
  FieldLegend,
  FieldSet,
} from "@/src/components/ui/field";
import { RadioGroup } from "@/src/components/ui/radio-group";

import {
  readStatusContent,
  shouldPollPurchaseStatus,
  type HostedUsageTopUpDialogProps,
} from "./hosted-usage-top-up-contract";
import { useHostedUsageTopUpDialog } from "./use-hosted-usage-top-up-dialog";

function HostedUsageTopUpDialog(props: HostedUsageTopUpDialogProps) {
  const controller = useHostedUsageTopUpDialog(props);
  const { screen } = controller.state;
  const firstOfferRef = useRef<HTMLSpanElement>(null);
  const focusTitleAfterPurchaseActionRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousScreenRef = useRef(screen);

  useEffect(() => {
    const previousScreen = previousScreenRef.current;
    previousScreenRef.current = screen;
    if (
      controller.state.open &&
      previousScreen.kind === "selection" &&
      screen.kind === "purchase"
    ) {
      titleRef.current?.focus({ preventScroll: true });
    } else if (
      controller.state.open &&
      screen.kind === "selection" &&
      (previousScreen.kind === "purchase" ||
        (previousScreen.attempt.kind === "locked" &&
          screen.attempt.kind === "idle"))
    ) {
      (firstOfferRef.current ?? titleRef.current)?.focus({ preventScroll: true });
    }
    if (
      focusTitleAfterPurchaseActionRef.current &&
      screen.kind === "purchase" &&
      screen.operation === "idle"
    ) {
      focusTitleAfterPurchaseActionRef.current = false;
      if (controller.state.open && screen.checkoutError === null) {
        titleRef.current?.focus({ preventScroll: true });
      }
    }
  }, [controller.state.open, screen]);

  const purchase = screen.kind === "purchase" ? screen : null;
  const selection = screen.kind === "selection" ? screen : null;
  const canResume =
    purchase?.targetConflict !== true &&
    purchase?.status === "checkout_open" &&
    purchase.checkoutUrl !== null;
  const canCancel = purchase?.status === "checkout_open";
  const canRetry =
    purchase !== null &&
    !purchase.targetConflict &&
    purchase.retryOfferCode !== null &&
    (purchase.status === "reconciling" ||
      (purchase.status === "checkout_open" && !canResume));
  const canCheckAgain = Boolean(
    purchase &&
      !canResume &&
      !canRetry &&
      (purchase.poll.kind === "failed" ||
        (purchase.poll.kind === "exhausted" &&
          (purchase.status === null ||
            shouldPollPurchaseStatus(purchase.status)))),
  );
  const purchaseTriggerLabel = purchase
    ? canResume || canRetry
      ? "Continue checkout"
      : purchase.status === "checkout_open"
        ? "Review checkout"
        : purchase.status === null || shouldPollPurchaseStatus(purchase.status)
          ? "Check payment"
          : null
    : null;
  const familyTarget =
    props.scope === "family" && props.targetLabel ? props.targetLabel : null;
  const triggerLabel =
    purchaseTriggerLabel ??
    (props.scope === "group" ? "Add group usage" : "Add usage");
  const statusContent = purchase
    ? readStatusContent({
        canResumeCheckout: canResume,
        canRetryCheckout: canRetry,
        pollKind: purchase.poll.kind,
        returnedFromSuccessfulCheckout:
          props.purchaseReturn?.kind === "success" &&
          props.purchaseReturn.purchaseId === purchase.purchaseId,
        scope: props.scope,
        status: purchase.status,
        targetLabel: familyTarget ?? undefined,
        targetConflict: purchase.targetConflict,
      })
    : null;
  const hasAttempt = selection !== null && selection.attempt.kind !== "idle";
  const selectionError =
    selection?.attempt.kind === "locked" ? selection.attempt.error : null;

  return (
    <Dialog
      open={controller.state.open}
      onOpenChange={controller.handleOpenChange}
    >
      {props.offers.length > 0 || purchaseTriggerLabel ? (
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="lg"
              aria-label={
                familyTarget ? `${triggerLabel} for ${familyTarget}` : undefined
              }
            />
          }
        >
          {triggerLabel}
        </DialogTrigger>
      ) : null}
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto border border-border bg-popover p-5 sm:max-w-lg sm:p-6"
        initialFocus={titleRef}
      >
        <DialogHeader className="pr-10">
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="text-xl font-semibold leading-tight outline-none"
          >
            {statusContent
              ? `${statusContent.title}${familyTarget && !purchase?.targetConflict ? ` for ${familyTarget}` : ""}`
              : props.offers.length === 0
                ? "Usage credit unavailable"
                : props.scope === "group"
                  ? "Add group usage"
                  : familyTarget
                    ? `Add usage for ${familyTarget}`
                    : "Add usage"}
          </DialogTitle>
          <DialogDescription>
            {purchase
              ? purchase.targetConflict
                ? "Manage the unfinished checkout before starting one for this usage destination."
                : props.scope === "group"
                  ? "Murph checks Stripe before changing this group's available usage."
                  : familyTarget
                    ? `Murph checks Stripe before changing the available usage for ${familyTarget}.`
                    : "Murph checks Stripe before changing your available usage."
              : props.offers.length === 0
                ? "There isn’t a usage-credit offer available for this account right now."
                : props.scope === "group"
                  ? "Choose how much usage credit to add to this group in a one-time payment. Stripe confirms the payment before Murph adds it."
                  : familyTarget
                    ? `Choose how much usage credit to add for ${familyTarget} in a one-time payment. Stripe confirms the payment before Murph adds it.`
                    : "Choose how much usage credit to add in a one-time payment. Stripe confirms the payment before Murph adds it."}
          </DialogDescription>
        </DialogHeader>

        {purchase && statusContent ? (
          <div className="flex flex-col gap-5">
            <div
              className="rounded-2xl border border-border bg-muted/30 p-5"
              role="status"
              aria-live="polite"
            >
              <p className="text-pretty text-sm leading-6 text-foreground">
                {statusContent.message}
              </p>
            </div>
            <FieldError>{purchase.checkoutError}</FieldError>
            <div className="flex flex-col gap-2">
              {canResume ? (
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  disabled={controller.checkoutInFlight}
                  onClick={() =>
                    window.location.assign(purchase.checkoutUrl ?? "")
                  }
                >
                  Resume checkout
                </Button>
              ) : null}
              {canCancel ? (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full"
                  aria-busy={purchase.operation === "canceling_checkout"}
                  disabled={controller.checkoutInFlight}
                  onClick={() => {
                    focusTitleAfterPurchaseActionRef.current = true;
                    void controller.cancelRecoveredCheckout();
                  }}
                >
                  {purchase.operation === "canceling_checkout"
                    ? "Canceling checkout…"
                    : "Cancel checkout"}
                </Button>
              ) : null}
              {canRetry ? (
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  aria-busy={purchase.operation === "opening_checkout"}
                  disabled={controller.checkoutInFlight}
                  onClick={() => {
                    focusTitleAfterPurchaseActionRef.current = true;
                    void controller.startCheckout(purchase.retryOfferCode);
                  }}
                >
                  {purchase.operation === "opening_checkout"
                    ? "Opening Stripe…"
                    : "Retry checkout"}
                </Button>
              ) : null}
              {canCheckAgain ? (
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  disabled={controller.checkoutInFlight}
                  onClick={() => {
                    focusTitleAfterPurchaseActionRef.current = true;
                    controller.retryStatusCheck();
                  }}
                >
                  Check again
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="w-full"
                onClick={() => controller.handleOpenChange(false)}
              >
                Close
              </Button>
            </div>
          </div>
        ) : props.offers.length === 0 ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => controller.handleOpenChange(false)}
            >
              Close
            </Button>
          </div>
        ) : selection ? (
          <div className="flex flex-col gap-5">
            <FieldSet disabled={hasAttempt}>
              <FieldLegend className="sr-only">Usage credit amount</FieldLegend>
              <FieldDescription className="sr-only">
                Choose one usage credit amount.
              </FieldDescription>
              <RadioGroup
                value={selection.selectedOfferCode ?? ""}
                onValueChange={controller.selectOffer}
                className="grid gap-3 sm:grid-cols-3"
              >
                {props.offers.map((offer, index) => (
                  <ChoiceCard
                    key={offer.offerCode}
                    ref={index === 0 ? firstOfferRef : undefined}
                    id={`${props.scope === "group" ? "group-" : ""}usage-top-up-${index}`}
                    value={offer.offerCode}
                    disabled={hasAttempt}
                    title={
                      <span className="font-serif text-xl font-semibold tabular-nums">
                        {offer.amountLabel}
                      </span>
                    }
                    description={
                      <span className="sr-only">
                        {props.scope === "group" ? "Group usage credit" : "Usage credit"}
                      </span>
                    }
                  />
                ))}
              </RadioGroup>
            </FieldSet>
            <FieldError>{selectionError}</FieldError>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="w-full"
                disabled={!controller.selectedOffer || controller.checkoutInFlight}
                size="lg"
                aria-busy={controller.checkoutInFlight}
                onClick={() => void controller.startCheckout()}
              >
                {controller.checkoutInFlight
                  ? "Opening Stripe…"
                  : controller.selectedOffer
                    ? `Continue to checkout · ${controller.selectedOffer.amountLabel}`
                    : "Choose an amount"}
              </Button>
              {selection.attempt.kind === "locked" && selection.attempt.error ? (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full"
                  onClick={controller.changeAmount}
                >
                  Choose a different amount
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="w-full"
                onClick={() => controller.handleOpenChange(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export { HostedUsageTopUpDialog };
export type {
  HostedUsageTopUpActivePurchase,
  HostedUsageTopUpDialogProps,
  HostedUsageTopUpOffer,
  HostedUsageTopUpPurchaseStatus,
  HostedUsageTopUpReturn,
} from "./hosted-usage-top-up-contract";
