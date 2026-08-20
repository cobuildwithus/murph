"use client";

import { useEffect, useRef } from "react";
import { CheckIcon, CircleAlertIcon, MessageCircle, XIcon } from "lucide-react";

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
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/src/components/ui/drawer";
import {
  FieldDescription,
  FieldError,
  FieldLegend,
  FieldSet,
} from "@/src/components/ui/field";
import { RadioGroup } from "@/src/components/ui/radio-group";
import { useIsMobile } from "@/src/hooks/use-mobile";
import {
  HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
} from "@/src/lib/hosted-onboarding/usage-credit-capacity-conflict";
import { cn } from "@/src/lib/utils";

import {
  readStatusContent,
  shouldPollPurchaseStatus,
  type HostedUsageTopUpDialogProps,
} from "./hosted-usage-top-up-contract";
import { useHostedUsageTopUpDialog } from "./use-hosted-usage-top-up-dialog";

function HostedUsageTopUpDialog(props: HostedUsageTopUpDialogProps) {
  const isMobile = useIsMobile();
  const groupPaymentMode = props.groupPaymentMode ?? "one_time";
  const controller = useHostedUsageTopUpDialog({
    ...props,
    groupPaymentMode,
  });
  const { screen } = controller.state;
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const firstOfferRef = useRef<HTMLSpanElement>(null);
  const focusTitleAfterPurchaseActionRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousScreenRef = useRef(screen);

  useEffect(() => {
    const previousScreen = previousScreenRef.current;
    previousScreenRef.current = screen;
    const enteredCapacityConflict =
      screen.kind === "selection" &&
      screen.capacityConflict &&
      (previousScreen.kind !== "selection" ||
        !previousScreen.capacityConflict);
    const enteredSelectionRecovery =
      screen.kind === "selection" &&
      screen.attempt.kind === "locked" &&
      screen.attempt.error !== null &&
      (
        previousScreen.kind !== "selection" ||
        previousScreen.attempt.kind !== "locked" ||
        previousScreen.attempt.error === null
      );
    if (
      controller.state.open &&
      (enteredCapacityConflict || enteredSelectionRecovery)
    ) {
      if (scrollContentRef.current) {
        scrollContentRef.current.scrollTop = 0;
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
    props.triggerLabel ??
    (props.scope === "group"
      ? groupPaymentMode === "one_time"
        ? "Make a one-time contribution"
        : "Sponsor this chat"
      : "Add usage");
  const defaultStatusContent = purchase
    ? readStatusContent({
        canResumeCheckout: canResume,
        canRetryCheckout: canRetry,
        pollKind: purchase.poll.kind,
        returnedFromSuccessfulCheckout,
        scope: props.scope,
        selectionConflict: purchase.selectionConflict,
        status: purchase.status,
        targetLabel: familyTarget ?? undefined,
        targetConflict: purchase.targetConflict,
      })
    : null;
  const fulfilledConfirmation =
    purchase !== null &&
    purchase.status === "fulfilled" &&
    !purchase.selectionConflict &&
    !purchase.targetConflict;
  const closeOwnedFulfilledConfirmation =
    fulfilledConfirmation &&
    props.scope !== "group" &&
    props.deferTerminalRefreshUntilClose === true;
  const statusContent = closeOwnedFulfilledConfirmation
    ? {
        message:
          props.scope === "family" && props.targetLabel
            ? `Usage credit was added for ${props.targetLabel}.`
            : "Your usage credit was added to your account.",
        title: "Usage added",
      }
    : defaultStatusContent;
  const showGroupMessagesAction =
    fulfilledConfirmation && props.scope === "group";
  const quietSuccessfulReturn =
    props.quietSuccessfulReturn === true &&
    (returnedFromSuccessfulCheckout || fulfilledConfirmation);
  const purchaseNeedsRecovery = Boolean(
    purchase &&
    (purchase.checkoutError ||
      purchase.selectionConflict ||
      purchase.targetConflict ||
      purchase.status === "expired" ||
      purchase.status === "payment_failed" ||
      purchase.poll.kind === "failed" ||
      (purchase.poll.kind === "exhausted" &&
        (purchase.status === null || shouldPollPurchaseStatus(purchase.status)))),
  );
  const returnNeedsRecovery = quietSuccessfulReturn && purchaseNeedsRecovery;
  const presentedOpen =
    controller.state.open &&
    (!quietSuccessfulReturn || returnNeedsRecovery);

  useEffect(() => {
    if (
      props.quietSuccessfulReturn === true &&
      controller.state.open &&
      fulfilledConfirmation
    ) {
      controller.handleOpenChange(false);
    }
  }, [controller, fulfilledConfirmation, props.quietSuccessfulReturn]);

  const compactStatusPresentation =
    (props.scope !== "group" && purchaseNeedsRecovery) ||
    closeOwnedFulfilledConfirmation;
  const capacityConflict = selection?.capacityConflict === true;
  const hasAttempt = selection !== null && selection.attempt.kind !== "idle";
  const selectionError =
    selection?.attempt.kind === "locked" ? selection.attempt.error : null;
  const selectionNeedsRecovery = selectionError !== null;
  const paymentNeedsRecovery =
    selection?.attempt.kind === "locked" &&
    selection.attempt.requestKey !== null &&
    selectionError !== null;
  const headerTitle = statusContent
    ? `${statusContent.title}${familyTarget && !purchase?.targetConflict ? ` for ${familyTarget}` : ""}`
    : capacityConflict
      ? "More credit can’t be added right now"
      : props.offers.length === 0
        ? "Usage unavailable"
        : props.scope === "group"
          ? groupPaymentMode === "monthly"
            ? "Sponsor this chat"
            : "Make a one-time contribution"
          : familyTarget
            ? `Add usage for ${familyTarget}`
            : "Add usage";
  const headerDescription = purchase
    ? compactStatusPresentation
      ? null
      : showGroupMessagesAction && statusContent
      ? statusContent.message
      : purchase.targetConflict
        ? "Manage the unfinished checkout before starting one for this usage destination."
        : purchase.selectionConflict
          ? purchase.selectionConflict === "sponsorship"
            ? "The sponsor details you just entered were not applied. Review the original purchase below."
            : "The amount you just selected was not started. Review the earlier purchase below."
          : props.scope === "group"
            ? "We’ll update this group’s credit as soon as payment is complete."
            : familyTarget
              ? `We’ll update the available usage for ${familyTarget} as soon as payment is complete.`
              : "We’ll update your available usage as soon as payment is complete."
    : capacityConflict
      ? HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE
      : props.offers.length === 0
        ? "There isn’t more usage available for this account right now."
        : props.scope === "group"
          ? groupPaymentMode === "monthly"
            ? "Choose your monthly sponsorship limit."
            : "Choose how much usage to add to this chat."
          : null;
  const confirmationIndicator =
    showGroupMessagesAction && statusContent ? (
      <div
        className="flex size-10 shrink-0 self-center items-center justify-center rounded-full bg-primary/10 text-primary sm:self-auto"
        role="status"
        aria-live="polite"
        aria-label={`${statusContent.title}. ${statusContent.message}`}
      >
        <CheckIcon aria-hidden="true" className="size-4 stroke-[2.5]" />
      </div>
    ) : null;
  const screenContent = (
    <>
      {purchase && statusContent ? (
        <div className="flex flex-col gap-5">
          {!showGroupMessagesAction ? (
            <div
              className={
                compactStatusPresentation
                  ? undefined
                  : "rounded-2xl border border-border bg-muted/30 p-5"
              }
              role="status"
              aria-live="polite"
            >
              <p className="text-pretty text-sm leading-6 text-foreground">
                {statusContent.message}
              </p>
            </div>
          ) : null}
          {showGroupMessagesAction || compactStatusPresentation
            ? null
            : props.renderPurchaseDetails}
          <FieldError>{purchase.checkoutError}</FieldError>
          <div className="flex flex-col gap-2">
            {showGroupMessagesAction ? (
              <div className="flex flex-col gap-3 pt-1">
                <p className="text-pretty text-sm leading-6 text-muted-foreground">
                  Open Messages, then choose this group to keep going.
                </p>
                {/* Messages has no deep link into an existing group thread, so
                  the group follow-up can only open the app itself. */}
                <a
                  href="sms:"
                  className={cn(
                    buttonVariants({ size: "xl" }),
                    "w-full",
                  )}
                >
                  <MessageCircle
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                  Open Messages
                </a>
              </div>
            ) : null}
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
                  ? purchase.status === "payment_pending" ||
                    props.scope === "group"
                    ? "Continuing payment…"
                    : "Opening checkout…"
                  : purchase.status === "payment_pending" ||
                      props.scope === "group"
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
            {showGroupMessagesAction ? null : (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="w-full"
                onClick={() => controller.handleOpenChange(false)}
              >
                Close
              </Button>
            )}
          </div>
        </div>
        ) : capacityConflict ? (
          <div data-slot="usage-top-up-capacity-conflict">
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
          <div
            data-slot="usage-top-up-selection"
            className={cn(
              "flex flex-col gap-5",
              props.scope === "group" &&
                (groupPaymentMode === "monthly" || !selectionNeedsRecovery) &&
                "max-md:min-h-full",
            )}
          >
            {groupPaymentMode === "monthly" ? null : (
              <FieldSet disabled={hasAttempt || !controller.requestIdentityReady}>
                <FieldLegend className="sr-only">Usage amount</FieldLegend>
                <FieldDescription className="sr-only">
                  Choose one usage amount.
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
                          {offer.amountLabel}
                        </span>
                      }
                      description={
                        <span className="text-sm font-medium text-muted-foreground">
                          usage
                        </span>
                      }
                    />
                  ))}
                </RadioGroup>
              </FieldSet>
            )}
            {props.renderSelectionDetails?.({
              disabled: hasAttempt || !controller.requestIdentityReady,
              mobileStickyActionVisible:
                props.scope === "group" &&
                !selectionNeedsRecovery,
              selectedOffer: controller.selectedOffer,
            })}
            <FieldError>{controller.requestIdentityError}</FieldError>
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
                      ? "Check the same amount to recover any payment already in progress. This check can’t start a new payment."
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
                    disabled={
                      !controller.requestIdentityReady ||
                      !controller.selectedOffer ||
                      controller.checkoutInFlight
                    }
                    aria-busy={controller.checkoutInFlight}
                    onClick={() => void controller.startCheckout()}
                  >
                    {controller.checkoutInFlight
                      ? paymentNeedsRecovery
                        ? "Checking payment…"
                        : "Opening checkout…"
                      : controller.selectedOffer
                        ? paymentNeedsRecovery
                          ? `Check payment · ${controller.selectedOffer.amountLabel}`
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
              <div
                className={cn(
                  "grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]",
                  props.scope === "group" &&
                    "max-md:sticky max-md:bottom-0 max-md:z-20 max-md:-mx-6 max-md:mt-auto max-md:border-t max-md:bg-popover max-md:px-4 max-md:pt-4 max-md:pb-[max(env(safe-area-inset-bottom),1rem)]",
                )}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="xl"
                  className={cn(
                    "w-full sm:w-auto",
                    props.scope === "group" &&
                      "max-md:hidden",
                  )}
                  onClick={() => controller.handleOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="w-full"
                  disabled={
                    !controller.requestIdentityReady ||
                    !controller.selectedOffer ||
                    controller.checkoutInFlight
                  }
                  size="xl"
                  aria-busy={controller.checkoutInFlight}
                  onClick={() => void controller.startCheckout()}
                >
                  {controller.checkoutInFlight
                    ? props.scope === "group"
                      ? "Sponsoring chat…"
                      : "Adding usage…"
                    : controller.selectedOffer
                      ? props.scope === "group"
                        ? groupPaymentMode === "monthly"
                          ? `Sponsor this chat · ${controller.selectedOffer.amountLabel}`
                          : `Contribute ${controller.selectedOffer.amountLabel}`
                        : `Add usage · ${controller.selectedOffer.amountLabel}`
                      : "Choose an amount"}
                </Button>
              </div>
            )}
          </div>
        ) : null}
    </>
  );
  const canShowTrigger =
    quietSuccessfulReturn && controller.state.open && !returnNeedsRecovery
      ? false
      : props.offers.length > 0 || purchaseTriggerLabel;
  const drawerTriggerButton = (
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
    >
      {triggerLabel}
    </Button>
  );
  const useMobileDrawer = isMobile && props.scope === "group";

  if (useMobileDrawer) {
    return (
      <Drawer
        handleOnly
        open={controller.state.open}
        onOpenChange={controller.handleOpenChange}
      >
        {canShowTrigger ? (
          <DrawerTrigger asChild>{drawerTriggerButton}</DrawerTrigger>
        ) : null}
        <DrawerContent
          className={cn(
            "border-border data-[vaul-drawer-direction=bottom]:mt-3 data-[vaul-drawer-direction=bottom]:rounded-t-[2rem]",
            !showGroupMessagesAction &&
              "h-[calc(100dvh-0.75rem)] data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-0.75rem)]",
          )}
          data-inert={props.inert ? "true" : undefined}
          inert={props.inert ? true : undefined}
        >
          <DrawerHeader
            className={cn(
              "relative items-start gap-2 px-6 pb-2 pt-2 text-left",
              showGroupMessagesAction && "gap-3",
            )}
          >
            {confirmationIndicator}
            <DrawerTitle
              ref={titleRef}
              tabIndex={-1}
              className={cn(
                "pr-10 font-serif text-3xl font-semibold leading-[1.1] tracking-tight text-foreground outline-none",
                showGroupMessagesAction &&
                  "max-w-md text-4xl leading-[1.05] tracking-[-0.03em]",
              )}
            >
              {headerTitle}
            </DrawerTitle>
            <DrawerDescription
              className={cn(
                "max-w-md text-left text-base leading-6",
                showGroupMessagesAction &&
                  "text-muted-foreground",
              )}
            >
              {headerDescription}
            </DrawerDescription>
            <DrawerClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-4 top-0"
              >
                <XIcon aria-hidden="true" />
                <span className="sr-only">Close</span>
              </Button>
            </DrawerClose>
          </DrawerHeader>
          <div
            ref={scrollContentRef}
            className={cn(
              "min-h-0 overflow-y-auto overscroll-contain px-6 pt-4",
              showGroupMessagesAction
                ? "pb-[max(env(safe-area-inset-bottom),1.5rem)]"
                : "flex-1",
            )}
          >
            {screenContent}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <>
      {props.quietSuccessfulReturn ? (
        <p
          className="sr-only"
          role="status"
          aria-atomic="true"
          aria-live="polite"
        >
          {quietSuccessfulReturn && fulfilledConfirmation && statusContent
            ? `${statusContent.title}. ${statusContent.message}`
            : ""}
        </p>
      ) : null}
      <Dialog
        open={presentedOpen}
        onOpenChange={controller.handleOpenChange}
      >
        {canShowTrigger ? (
          <DialogTrigger
            render={
              <Button
                type="button"
                size={
                  props.triggerSize ??
                  (props.scope === "group" ? "xl" : "lg")
                }
                variant={
                  props.triggerVariant ??
                  (props.scope === "group" ? "default" : "outline")
                }
                className={cn(
                  props.scope === "group" ? "w-full" : undefined,
                  props.triggerClassName,
                )}
                aria-label={
                  familyTarget
                    ? `${triggerLabel} for ${familyTarget}`
                    : undefined
                }
              />
            }
          >
            {triggerLabel}
          </DialogTrigger>
        ) : null}
        <DialogContent
          ref={scrollContentRef}
          data-inert={props.inert ? "true" : undefined}
          inert={props.inert ? true : undefined}
          className={cn(
            "max-h-[calc(100dvh-2rem)] gap-7 overflow-y-auto border border-border bg-popover p-6 sm:max-w-xl sm:p-8",
            showGroupMessagesAction && "gap-5 sm:max-w-lg",
            compactStatusPresentation && "sm:max-w-md",
          )}
          initialFocus={titleRef}
        >
          <DialogHeader
            className={cn("pr-10", showGroupMessagesAction && "gap-3")}
          >
            {confirmationIndicator}
            <DialogTitle
              ref={titleRef}
              tabIndex={-1}
              className={cn(
                "text-3xl font-semibold leading-[1.1] tracking-tight outline-none",
                showGroupMessagesAction &&
                  "max-w-md text-4xl leading-[1.05] tracking-[-0.03em]",
              )}
            >
              {headerTitle}
            </DialogTitle>
            <DialogDescription
              className={
                headerDescription
                  ? cn(
                      "max-w-md text-base leading-6",
                      showGroupMessagesAction &&
                        "text-muted-foreground",
                    )
                  : "sr-only"
              }
            >
              {headerDescription ??
                statusContent?.message ??
                "Choose a usage amount."}
            </DialogDescription>
          </DialogHeader>
          {screenContent}
        </DialogContent>
      </Dialog>
    </>
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
