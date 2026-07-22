"use client";

import { useEffect, useRef } from "react";
import { CircleAlertIcon } from "lucide-react";

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
    (props.scope === "group" ? "Choose amount" : "Add usage");
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
  const selectionNeedsRecovery = selectionError !== null;

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
              size={props.scope === "group" ? "xl" : "lg"}
              variant={props.scope === "group" ? "default" : "outline"}
              className={props.scope === "group" ? "w-full" : undefined}
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
        className="max-h-[calc(100dvh-2rem)] gap-7 overflow-y-auto border border-border bg-popover p-6 sm:max-w-xl sm:p-8"
        initialFocus={titleRef}
      >
        <DialogHeader className="pr-10">
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="text-3xl font-semibold leading-[1.1] tracking-tight outline-none"
          >
            {statusContent
              ? `${statusContent.title}${familyTarget && !purchase?.targetConflict ? ` for ${familyTarget}` : ""}`
              : props.offers.length === 0
                ? "Usage credit unavailable"
                : familyTarget
                  ? `Choose an amount for ${familyTarget}`
                  : "Choose an amount"}
          </DialogTitle>
          <DialogDescription className="max-w-md text-base leading-6">
            {purchase
              ? purchase.targetConflict
                ? "Manage the unfinished checkout before starting one for this usage destination."
                : props.scope === "group"
                  ? "We’ll update this group’s credit as soon as payment is complete."
                  : familyTarget
                    ? `We’ll update the available credit for ${familyTarget} as soon as payment is complete.`
                    : "We’ll update your credit as soon as payment is complete."
              : props.offers.length === 0
                ? "There isn’t a usage-credit offer available for this account right now."
                : props.scope === "group"
                  ? "Choose a one-time credit amount for this group."
                  : familyTarget
                    ? `Choose a one-time credit amount for ${familyTarget}.`
                    : "Choose a one-time credit amount for your account."}
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
                    ? "Opening checkout…"
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
                    className="h-20 [&_[data-slot=field-content]]:gap-0 [&_[data-slot=field-content]]:justify-center sm:h-24"
                    title={
                      <span className="flex h-5 items-center font-serif text-3xl font-semibold leading-none tabular-nums">
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
            {selectionNeedsRecovery ? (
              <div
                className="flex gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-4"
                role="alert"
              >
                <CircleAlertIcon
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-destructive"
                />
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">
                    Checkout didn’t open
                  </p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {selectionError}
                  </p>
                </div>
              </div>
            ) : null}
            {selectionNeedsRecovery ? (
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    type="button"
                    size="xl"
                    className="w-full"
                    disabled={!controller.selectedOffer || controller.checkoutInFlight}
                    aria-busy={controller.checkoutInFlight}
                    onClick={() => void controller.startCheckout()}
                  >
                    {controller.checkoutInFlight
                      ? "Opening checkout…"
                      : controller.selectedOffer
                        ? `Try again · ${controller.selectedOffer.amountLabel}`
                        : "Try again"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xl"
                    className="w-full"
                    onClick={controller.changeAmount}
                  >
                    Change amount
                  </Button>
                </div>
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
            ) : (
              <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                <Button
                  type="button"
                  variant="ghost"
                  size="xl"
                  className="w-full sm:w-auto"
                  onClick={() => controller.handleOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="w-full"
                  disabled={!controller.selectedOffer || controller.checkoutInFlight}
                  size="xl"
                  aria-busy={controller.checkoutInFlight}
                  onClick={() => void controller.startCheckout()}
                >
                  {controller.checkoutInFlight
                    ? "Opening checkout…"
                    : controller.selectedOffer
                      ? `Continue to checkout · ${controller.selectedOffer.amountLabel}`
                      : "Choose an amount"}
                </Button>
              </div>
            )}
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
