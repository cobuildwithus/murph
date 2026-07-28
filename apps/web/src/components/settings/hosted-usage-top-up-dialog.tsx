"use client";

import { useEffect, useRef } from "react";
import { CircleAlertIcon, MessageCircle } from "lucide-react";

import { MurphContactChannelRows } from "@/src/components/murph/murph-contact-channel-rows";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { Button, buttonVariants } from "@/src/components/ui/button";
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
import { cn } from "@/src/lib/utils";

import {
  readStatusContent,
  shouldPollPurchaseStatus,
  type HostedUsageTopUpDialogProps,
} from "./hosted-usage-top-up-contract";
import { useHostedUsageTopUpDialog } from "./use-hosted-usage-top-up-dialog";

function HostedUsageTopUpDialog(props: HostedUsageTopUpDialogProps) {
  const controller = useHostedUsageTopUpDialog(props);
  const { screen } = controller.state;
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const firstOfferRef = useRef<HTMLSpanElement>(null);
  const focusTitleAfterPurchaseActionRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousScreenRef = useRef(screen);

  useEffect(() => {
    const previousScreen = previousScreenRef.current;
    previousScreenRef.current = screen;
    const enteredSelectionRecovery =
      screen.kind === "selection" &&
      screen.attempt.kind === "locked" &&
      screen.attempt.error !== null &&
      (
        previousScreen.kind !== "selection" ||
        previousScreen.attempt.kind !== "locked" ||
        previousScreen.attempt.error === null
      );
    if (controller.state.open && enteredSelectionRecovery) {
      if (dialogContentRef.current) {
        dialogContentRef.current.scrollTop = 0;
      }
      titleRef.current?.focus({ preventScroll: true });
    } else if (
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
  const returnedFromSuccessfulCheckout =
    purchase !== null &&
    props.purchaseReturn?.kind === "success" &&
    props.purchaseReturn.purchaseId === purchase.purchaseId;
  const canResume =
    !returnedFromSuccessfulCheckout &&
    purchase?.targetConflict !== true &&
    purchase?.status === "checkout_open" &&
    purchase.checkoutUrl !== null;
  const canCancel =
    !returnedFromSuccessfulCheckout &&
    (
      purchase?.status === "checkout_open" ||
      purchase?.cancelAllowed === true
    );
  const canRetry =
    purchase !== null &&
    !purchase.targetConflict &&
    purchase.retryOfferCode !== null &&
    (purchase.status === "reconciling" ||
      (purchase.status === "checkout_open" && !canResume) ||
      (
        purchase.status === "payment_pending" &&
        (purchase.poll.kind === "exhausted" ||
          purchase.poll.kind === "failed")
      ));
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
    ? canResume
      ? "Continue checkout"
      : canRetry
        ? purchase.status === "payment_pending" || props.scope === "group"
          ? "Check payment"
          : "Continue checkout"
      : purchase.status === "checkout_open" && !returnedFromSuccessfulCheckout
        ? "Review checkout"
        : purchase.status === null || shouldPollPurchaseStatus(purchase.status)
          ? "Check payment"
          : null
    : null;
  const familyTarget =
    props.scope === "family" && props.targetLabel ? props.targetLabel : null;
  const triggerLabel =
    purchaseTriggerLabel ??
    (props.scope === "group" ? "Add messages" : "Add usage");
  const statusContent = purchase
    ? readStatusContent({
        canResumeCheckout: canResume,
        canRetryCheckout: canRetry,
        offerConflict: purchase.offerConflict,
        pollKind: purchase.poll.kind,
        returnedFromSuccessfulCheckout,
        scope: props.scope,
        status: purchase.status,
        targetLabel: familyTarget ?? undefined,
        targetConflict: purchase.targetConflict,
      })
    : null;
  const contactOptions = props.contactOptions ?? [];
  const fulfilledConfirmation =
    purchase !== null &&
    purchase.status === "fulfilled" &&
    !purchase.targetConflict;
  const showGroupMessagesAction =
    fulfilledConfirmation && props.scope === "group";
  const showContactAction =
    fulfilledConfirmation &&
    props.scope !== "group" &&
    contactOptions.length > 0;
  const hasAttempt = selection !== null && selection.attempt.kind !== "idle";
  const selectionError =
    selection?.attempt.kind === "locked" ? selection.attempt.error : null;
  const selectionNeedsRecovery = selectionError !== null;
  const paymentNeedsRecovery =
    selection?.attempt.kind === "locked" &&
    selection.attempt.requestKey !== null &&
    selectionError !== null;

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
              size={props.triggerSize ?? (props.scope === "group" ? "xl" : "lg")}
              variant={
                props.triggerVariant ??
                (props.scope === "group" ? "default" : "outline")
              }
              className={cn(
                props.scope === "group" ? "w-full" : undefined,
                props.triggerClassName,
              )}
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
        ref={dialogContentRef}
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
                : props.scope === "group"
                  ? "How many messages?"
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
                  ? "Shared with everyone in the chat. We’ll use your saved card when available. Stripe will ask when card details or verification are needed."
                  : familyTarget
                    ? `Choose a one-time credit amount for ${familyTarget}. We’ll use your saved card when available. Stripe will ask when card details or verification are needed.`
                    : "Choose a one-time credit amount for your account. We’ll use your saved card when available. Stripe will ask when card details or verification are needed."}
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
                    ? purchase.status === "payment_pending"
                      ? "Canceling payment…"
                      : "Canceling checkout…"
                    : purchase.status === "payment_pending"
                      ? "Cancel payment"
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
                    ? purchase.status === "payment_pending" || props.scope === "group"
                      ? "Continuing payment…"
                      : "Opening checkout…"
                    : purchase.status === "payment_pending" || props.scope === "group"
                      ? "Retry payment"
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
              {showGroupMessagesAction ? (
                // Messages has no deep link into an existing group thread, so
                // the group follow-up can only open the app itself.
                <a
                  href="sms:"
                  className={cn(buttonVariants({ size: "lg" }), "w-full")}
                >
                  <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
                  Open Messages
                </a>
              ) : null}
              {showContactAction ? (
                contactOptions.length === 1 ? (
                  <MurphContactLink
                    actionLabel="Text Murph"
                    option={contactOptions[0]}
                    className={cn(buttonVariants({ size: "lg" }), "w-full")}
                  >
                    <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
                    Text Murph
                  </MurphContactLink>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium text-foreground">
                      Text Murph
                    </p>
                    <MurphContactChannelRows
                      actionLabel="Text Murph"
                      options={contactOptions}
                    />
                  </div>
                )
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
                    className="h-24 [&_[data-slot=field-content]]:gap-0.5 [&_[data-slot=field-content]]:justify-center sm:h-28"
                    title={
                      <span className="flex h-8 items-center font-serif text-3xl font-semibold leading-none tabular-nums">
                        <span className="sr-only">About </span>
                        <span aria-hidden="true">~</span>
                        {offer.estimatedMessages}
                      </span>
                    }
                    description={
                      <span className="text-sm font-medium text-muted-foreground">
                        messages ·{" "}
                        <span className="tabular-nums">{offer.amountLabel}</span>
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
                    {paymentNeedsRecovery
                      ? "We couldn’t confirm this payment yet"
                      : "Checkout didn’t open"}
                  </p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {paymentNeedsRecovery
                      ? "Retry the same amount to check or continue it. We won’t start a second payment."
                      : selectionError}
                  </p>
                </div>
              </div>
            ) : null}
            {selectionNeedsRecovery ? (
              <div className="flex flex-col gap-3">
                <div
                  className={cn(
                    "grid gap-3",
                    paymentNeedsRecovery ? undefined : "sm:grid-cols-2",
                  )}
                >
                  <Button
                    type="button"
                    size="xl"
                    className="w-full"
                    disabled={!controller.selectedOffer || controller.checkoutInFlight}
                    aria-busy={controller.checkoutInFlight}
                    onClick={() => void controller.startCheckout()}
                  >
                    {controller.checkoutInFlight
                      ? paymentNeedsRecovery
                        ? "Checking payment…"
                        : "Opening checkout…"
                      : controller.selectedOffer
                        ? paymentNeedsRecovery
                          ? `Retry payment · ${controller.selectedOffer.amountLabel}`
                          : `Try again · ${controller.selectedOffer.amountLabel}`
                        : "Try again"}
                  </Button>
                  {paymentNeedsRecovery ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      size="xl"
                      className="w-full"
                      onClick={controller.changeAmount}
                    >
                      Change amount
                    </Button>
                  )}
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
                    ? props.scope === "group"
                      ? "Adding messages…"
                      : "Adding usage…"
                    : controller.selectedOffer
                      ? props.scope === "group"
                        ? `Add messages · ${controller.selectedOffer.amountLabel}`
                        : `Add usage · ${controller.selectedOffer.amountLabel}`
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
