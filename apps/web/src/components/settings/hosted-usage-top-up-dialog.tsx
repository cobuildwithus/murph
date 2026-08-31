"use client";

import {
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
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

type HostedUsageTopUpController = ReturnType<typeof useHostedUsageTopUpDialog>;
type HostedUsageTopUpScreen = HostedUsageTopUpController["state"]["screen"];
type HostedUsageTopUpPurchaseScreen = Extract<
  HostedUsageTopUpScreen,
  { kind: "purchase" }
>;
type HostedUsageTopUpSelectionScreen = Extract<
  HostedUsageTopUpScreen,
  { kind: "selection" }
>;

interface PurchaseActions {
  canCancel: boolean;
  canCheckAgain: boolean;
  canResume: boolean;
  canRetry: boolean;
}

interface StatusPresentation {
  closeOwnedFulfilledConfirmation: boolean;
  compact: boolean;
  fulfilledConfirmation: boolean;
  needsRecovery: boolean;
  quietSuccessfulReturn: boolean;
  returnNeedsRecovery: boolean;
  showGroupMessagesAction: boolean;
  statusContent: { message: string; title: string } | null;
}

interface SelectionPresentation {
  capacityConflict: boolean;
  hasAttempt: boolean;
  needsRecovery: boolean;
  paymentNeedsRecovery: boolean;
  selectionError: string | null;
}

interface DialogHeaderPresentation {
  description: string | null;
  title: string;
}

function readPurchaseActions(
  purchase: HostedUsageTopUpPurchaseScreen | null,
  returnedFromSuccessfulCheckout: boolean,
): PurchaseActions {
  const canResume =
    !returnedFromSuccessfulCheckout &&
    purchase?.targetConflict !== true &&
    purchase?.status === "checkout_open" &&
    purchase.checkoutUrl !== null;
  const canCancel =
    !returnedFromSuccessfulCheckout &&
    (purchase?.status === "checkout_open" ||
      purchase?.cancelAllowed === true);
  const canRetry =
    purchase !== null &&
    !purchase.targetConflict &&
    purchase.retryOfferCode !== null &&
    (purchase.status === "reconciling" ||
      (purchase.status === "checkout_open" && !canResume) ||
      (purchase.status === "payment_pending" &&
        (purchase.poll.kind === "exhausted" ||
          purchase.poll.kind === "failed")));
  const canCheckAgain = Boolean(
    purchase &&
      !canResume &&
      !canRetry &&
      (purchase.poll.kind === "failed" ||
        (purchase.poll.kind === "exhausted" &&
          (purchase.status === null ||
            shouldPollPurchaseStatus(purchase.status)))),
  );
  return { canCancel, canCheckAgain, canResume, canRetry };
}

function readPurchaseTriggerLabel(
  purchase: HostedUsageTopUpPurchaseScreen | null,
  actions: PurchaseActions,
  returnedFromSuccessfulCheckout: boolean,
  scope: HostedUsageTopUpDialogProps["scope"],
): string | null {
  if (!purchase) {
    return null;
  }
  if (actions.canResume) {
    return "Continue checkout";
  }
  if (actions.canRetry) {
    return purchase.status === "payment_pending" || scope === "group"
      ? "Check payment"
      : "Continue checkout";
  }
  if (purchase.status === "checkout_open" && !returnedFromSuccessfulCheckout) {
    return "Review checkout";
  }
  return purchase.status === null || shouldPollPurchaseStatus(purchase.status)
    ? "Check payment"
    : null;
}

function readTriggerLabel(
  props: HostedUsageTopUpDialogProps,
  groupPaymentMode: "monthly" | "one_time",
  purchaseTriggerLabel: string | null,
): string {
  if (purchaseTriggerLabel !== null) {
    return purchaseTriggerLabel;
  }
  if (props.triggerLabel !== undefined) {
    return props.triggerLabel;
  }
  if (props.scope !== "group") {
    return "Add usage";
  }
  return groupPaymentMode === "one_time"
    ? "Make a one-time contribution"
    : "Sponsor this chat";
}

function readStatusPresentation(input: {
  actions: PurchaseActions;
  familyTarget: string | null;
  props: HostedUsageTopUpDialogProps;
  purchase: HostedUsageTopUpPurchaseScreen | null;
  returnedFromSuccessfulCheckout: boolean;
}): StatusPresentation {
  const { actions, familyTarget, props, purchase, returnedFromSuccessfulCheckout } =
    input;
  const defaultStatusContent = purchase
    ? readStatusContent({
        canResumeCheckout: actions.canResume,
        canRetryCheckout: actions.canRetry,
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
  const needsRecovery = Boolean(
    purchase &&
      (purchase.checkoutError ||
        purchase.selectionConflict ||
        purchase.targetConflict ||
        purchase.status === "expired" ||
        purchase.status === "payment_failed" ||
        purchase.poll.kind === "failed" ||
        (purchase.poll.kind === "exhausted" &&
          (purchase.status === null ||
            shouldPollPurchaseStatus(purchase.status)))),
  );
  return {
    closeOwnedFulfilledConfirmation,
    compact:
      (props.scope !== "group" && needsRecovery) ||
      closeOwnedFulfilledConfirmation,
    fulfilledConfirmation,
    needsRecovery,
    quietSuccessfulReturn,
    returnNeedsRecovery: quietSuccessfulReturn && needsRecovery,
    showGroupMessagesAction,
    statusContent,
  };
}

function readSelectionPresentation(
  selection: HostedUsageTopUpSelectionScreen | null,
): SelectionPresentation {
  const capacityConflict = selection?.capacityConflict === true;
  const hasAttempt = selection !== null && selection.attempt.kind !== "idle";
  const selectionError =
    selection?.attempt.kind === "locked" ? selection.attempt.error : null;
  return {
    capacityConflict,
    hasAttempt,
    needsRecovery: selectionError !== null,
    paymentNeedsRecovery:
      selection?.attempt.kind === "locked" &&
      selection.attempt.requestKey !== null &&
      selectionError !== null,
    selectionError,
  };
}

function readDialogHeader(input: {
  compactStatusPresentation: boolean;
  familyTarget: string | null;
  groupPaymentMode: "monthly" | "one_time";
  props: HostedUsageTopUpDialogProps;
  purchase: HostedUsageTopUpPurchaseScreen | null;
  selectionPresentation: SelectionPresentation;
  showGroupMessagesAction: boolean;
  statusContent: StatusPresentation["statusContent"];
}): DialogHeaderPresentation {
  const {
    compactStatusPresentation,
    familyTarget,
    groupPaymentMode,
    props,
    purchase,
    selectionPresentation,
    showGroupMessagesAction,
    statusContent,
  } = input;
  let title: string;
  if (statusContent) {
    title = `${statusContent.title}${familyTarget && !purchase?.targetConflict ? ` for ${familyTarget}` : ""}`;
  } else if (selectionPresentation.capacityConflict) {
    title = "More credit can’t be added right now";
  } else if (props.offers.length === 0) {
    title = "Usage unavailable";
  } else if (props.scope !== "group") {
    title = familyTarget ? `Add usage for ${familyTarget}` : "Add usage";
  } else {
    title =
      groupPaymentMode === "monthly"
        ? "Sponsor this chat"
        : "Make a one-time contribution";
  }

  if (purchase) {
    if (compactStatusPresentation) {
      return { description: null, title };
    }
    if (showGroupMessagesAction && statusContent) {
      return { description: statusContent.message, title };
    }
    if (purchase.targetConflict) {
      return {
        description:
          "Manage the unfinished checkout before starting one for this usage destination.",
        title,
      };
    }
    if (purchase.selectionConflict) {
      return {
        description:
          purchase.selectionConflict === "sponsorship"
            ? "The sponsor details you just entered were not applied. Review the original purchase below."
            : "The amount you just selected was not started. Review the earlier purchase below.",
        title,
      };
    }
    if (props.scope === "group") {
      return {
        description:
          "We’ll update this group’s credit as soon as payment is complete.",
        title,
      };
    }
    return {
      description: familyTarget
        ? `We’ll update the available usage for ${familyTarget} as soon as payment is complete.`
        : "We’ll update your available usage as soon as payment is complete.",
      title,
    };
  }

  if (selectionPresentation.capacityConflict) {
    return {
      description: HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
      title,
    };
  }
  if (props.offers.length === 0) {
    return {
      description:
        "There isn’t more usage available for this account right now.",
      title,
    };
  }
  if (props.scope !== "group") {
    return { description: null, title };
  }
  return {
    description:
      groupPaymentMode === "monthly"
        ? "Choose your monthly sponsorship limit."
        : "Choose how much usage to add to this chat.",
    title,
  };
}

interface PurchaseScreenContentProps {
  actions: PurchaseActions;
  checkoutInFlight: boolean;
  compact: boolean;
  onCancel: () => void;
  onCheckAgain: () => void;
  onClose: () => void;
  onResume: () => void;
  onRetry: () => void;
  purchase: HostedUsageTopUpPurchaseScreen;
  renderPurchaseDetails: ReactNode;
  scope: HostedUsageTopUpDialogProps["scope"];
  showGroupMessagesAction: boolean;
  statusContent: NonNullable<StatusPresentation["statusContent"]>;
}

function PurchaseScreenContent({
  actions,
  checkoutInFlight,
  compact,
  onCancel,
  onCheckAgain,
  onClose,
  onResume,
  onRetry,
  purchase,
  renderPurchaseDetails,
  scope,
  showGroupMessagesAction,
  statusContent,
}: PurchaseScreenContentProps) {
  return (
    <div className="flex flex-col gap-5">
      {!showGroupMessagesAction ? (
        <div
          className={
            compact
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
      {showGroupMessagesAction || compact ? null : renderPurchaseDetails}
      <FieldError>{purchase.checkoutError}</FieldError>
      <div className="flex flex-col gap-2">
        {showGroupMessagesAction ? (
          <div className="flex flex-col gap-3 pt-1">
            <p className="text-pretty text-sm leading-6 text-muted-foreground">
              Open Messages, then choose this group to keep going.
            </p>
            {/* Messages has no deep link into an existing group thread, so the
                group follow-up can only open the app itself. */}
            <a
              href="sms:"
              className={cn(buttonVariants({ size: "xl" }), "w-full")}
            >
              <MessageCircle data-icon="inline-start" aria-hidden="true" />
              Open Messages
            </a>
          </div>
        ) : null}
        {actions.canResume ? (
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={checkoutInFlight}
            onClick={onResume}
          >
            Resume checkout
          </Button>
        ) : null}
        {actions.canCancel ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            aria-busy={purchase.operation === "canceling_checkout"}
            disabled={checkoutInFlight}
            onClick={onCancel}
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
        {actions.canRetry ? (
          <Button
            type="button"
            size="lg"
            className="w-full"
            aria-busy={purchase.operation === "opening_checkout"}
            disabled={checkoutInFlight}
            onClick={onRetry}
          >
            {purchase.operation === "opening_checkout"
              ? purchase.status === "payment_pending" || scope === "group"
                ? "Continuing payment…"
                : "Opening checkout…"
              : purchase.status === "payment_pending" || scope === "group"
                ? "Retry payment"
                : "Retry checkout"}
          </Button>
        ) : null}
        {actions.canCheckAgain ? (
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={checkoutInFlight}
            onClick={onCheckAgain}
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
            onClick={onClose}
          >
            Close
          </Button>
        )}
      </div>
    </div>
  );
}

function CloseScreenContent({
  capacityConflict,
  onClose,
}: {
  capacityConflict: boolean;
  onClose: () => void;
}) {
  return (
    <div
      data-slot={
        capacityConflict ? "usage-top-up-capacity-conflict" : undefined
      }
    >
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={onClose}
      >
        Close
      </Button>
    </div>
  );
}

interface OfferSelectorProps {
  firstOfferRef: RefObject<HTMLSpanElement | null>;
  hasAttempt: boolean;
  offers: HostedUsageTopUpDialogProps["offers"];
  onSelectOffer: HostedUsageTopUpController["selectOffer"];
  requestIdentityReady: boolean;
  scope: HostedUsageTopUpDialogProps["scope"];
  selectedOfferCode: string | null;
}

function OfferSelector({
  firstOfferRef,
  hasAttempt,
  offers,
  onSelectOffer,
  requestIdentityReady,
  scope,
  selectedOfferCode,
}: OfferSelectorProps) {
  return (
    <FieldSet disabled={hasAttempt || !requestIdentityReady}>
      <FieldLegend className="sr-only">Usage amount</FieldLegend>
      <FieldDescription className="sr-only">
        Choose one usage amount.
      </FieldDescription>
      <RadioGroup
        value={selectedOfferCode ?? ""}
        onValueChange={onSelectOffer}
        className="grid gap-3 sm:grid-cols-3"
      >
        {offers.map((offer, index) => (
          <ChoiceCard
            key={offer.offerCode}
            ref={index === 0 ? firstOfferRef : undefined}
            id={`${scope === "group" ? "group-" : ""}usage-top-up-${index}`}
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
  );
}

function SelectionRecoveryNotice({
  paymentNeedsRecovery,
  selectionError,
}: Pick<
  SelectionPresentation,
  "paymentNeedsRecovery" | "selectionError"
>) {
  return (
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
  );
}

interface SelectionActionsProps {
  checkoutInFlight: boolean;
  groupPaymentMode: "monthly" | "one_time";
  needsRecovery: boolean;
  onChangeAmount: () => void;
  onClose: () => void;
  onStartCheckout: () => void;
  paymentNeedsRecovery: boolean;
  requestIdentityReady: boolean;
  scope: HostedUsageTopUpDialogProps["scope"];
  selectedOffer: HostedUsageTopUpController["selectedOffer"];
}

function SelectionActions({
  checkoutInFlight,
  groupPaymentMode,
  needsRecovery,
  onChangeAmount,
  onClose,
  onStartCheckout,
  paymentNeedsRecovery,
  requestIdentityReady,
  scope,
  selectedOffer,
}: SelectionActionsProps) {
  if (needsRecovery) {
    return (
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
              !requestIdentityReady || !selectedOffer || checkoutInFlight
            }
            aria-busy={checkoutInFlight}
            onClick={onStartCheckout}
          >
            {checkoutInFlight
              ? paymentNeedsRecovery
                ? "Checking payment…"
                : "Opening checkout…"
              : selectedOffer
                ? paymentNeedsRecovery
                  ? `Check payment · ${selectedOffer.amountLabel}`
                  : `Try again · ${selectedOffer.amountLabel}`
                : "Try again"}
          </Button>
          {paymentNeedsRecovery ? null : (
            <Button
              type="button"
              variant="outline"
              size="xl"
              className="w-full"
              onClick={onChangeAmount}
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
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]",
        scope === "group" &&
          "max-md:sticky max-md:bottom-0 max-md:z-20 max-md:-mx-6 max-md:mt-auto max-md:border-t max-md:bg-popover max-md:px-4 max-md:pt-4 max-md:pb-[max(env(safe-area-inset-bottom),1rem)]",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="xl"
        className={cn(
          "w-full sm:w-auto",
          scope === "group" && "max-md:hidden",
        )}
        onClick={onClose}
      >
        Cancel
      </Button>
      <Button
        type="button"
        className="w-full"
        disabled={!requestIdentityReady || !selectedOffer || checkoutInFlight}
        size="xl"
        aria-busy={checkoutInFlight}
        onClick={onStartCheckout}
      >
        {checkoutInFlight
          ? scope === "group"
            ? "Sponsoring chat…"
            : "Adding usage…"
          : selectedOffer
            ? scope === "group"
              ? groupPaymentMode === "monthly"
                ? `Sponsor this chat · ${selectedOffer.amountLabel}`
                : `Contribute ${selectedOffer.amountLabel}`
              : `Add usage · ${selectedOffer.amountLabel}`
            : "Choose an amount"}
      </Button>
    </div>
  );
}

interface SelectionScreenContentProps {
  controller: HostedUsageTopUpController;
  firstOfferRef: RefObject<HTMLSpanElement | null>;
  groupPaymentMode: "monthly" | "one_time";
  onClose: () => void;
  onStartCheckout: () => void;
  presentation: SelectionPresentation;
  props: HostedUsageTopUpDialogProps;
  selection: HostedUsageTopUpSelectionScreen;
}

function SelectionScreenContent({
  controller,
  firstOfferRef,
  groupPaymentMode,
  onClose,
  onStartCheckout,
  presentation,
  props,
  selection,
}: SelectionScreenContentProps) {
  return (
    <div
      data-slot="usage-top-up-selection"
      className={cn(
        "flex flex-col gap-5",
        props.scope === "group" &&
          (groupPaymentMode === "monthly" || !presentation.needsRecovery) &&
          "max-md:min-h-full",
      )}
    >
      {groupPaymentMode === "monthly" ? null : (
        <OfferSelector
          firstOfferRef={firstOfferRef}
          hasAttempt={presentation.hasAttempt}
          offers={props.offers}
          onSelectOffer={controller.selectOffer}
          requestIdentityReady={controller.requestIdentityReady}
          scope={props.scope}
          selectedOfferCode={selection.selectedOfferCode}
        />
      )}
      {props.renderSelectionDetails?.({
        disabled:
          presentation.hasAttempt || !controller.requestIdentityReady,
        mobileStickyActionVisible:
          props.scope === "group" && !presentation.needsRecovery,
        selectedOffer: controller.selectedOffer,
      })}
      <FieldError>{controller.requestIdentityError}</FieldError>
      {presentation.needsRecovery ? (
        <SelectionRecoveryNotice
          paymentNeedsRecovery={presentation.paymentNeedsRecovery}
          selectionError={presentation.selectionError}
        />
      ) : null}
      <SelectionActions
        checkoutInFlight={controller.checkoutInFlight}
        groupPaymentMode={groupPaymentMode}
        needsRecovery={presentation.needsRecovery}
        onChangeAmount={controller.changeAmount}
        onClose={onClose}
        onStartCheckout={onStartCheckout}
        paymentNeedsRecovery={presentation.paymentNeedsRecovery}
        requestIdentityReady={controller.requestIdentityReady}
        scope={props.scope}
        selectedOffer={controller.selectedOffer}
      />
    </div>
  );
}

interface ScreenContentProps {
  controller: HostedUsageTopUpController;
  firstOfferRef: RefObject<HTMLSpanElement | null>;
  groupPaymentMode: "monthly" | "one_time";
  onCancelPurchase: () => void;
  onCheckAgain: () => void;
  onClose: () => void;
  onResumePurchase: () => void;
  onRetryPurchase: () => void;
  onStartCheckout: () => void;
  props: HostedUsageTopUpDialogProps;
  purchase: HostedUsageTopUpPurchaseScreen | null;
  purchaseActions: PurchaseActions;
  selection: HostedUsageTopUpSelectionScreen | null;
  selectionPresentation: SelectionPresentation;
  statusPresentation: StatusPresentation;
}

function ScreenContent({
  controller,
  firstOfferRef,
  groupPaymentMode,
  onCancelPurchase,
  onCheckAgain,
  onClose,
  onResumePurchase,
  onRetryPurchase,
  onStartCheckout,
  props,
  purchase,
  purchaseActions,
  selection,
  selectionPresentation,
  statusPresentation,
}: ScreenContentProps) {
  if (purchase && statusPresentation.statusContent) {
    return (
      <PurchaseScreenContent
        actions={purchaseActions}
        checkoutInFlight={controller.checkoutInFlight}
        compact={statusPresentation.compact}
        onCancel={onCancelPurchase}
        onCheckAgain={onCheckAgain}
        onClose={onClose}
        onResume={onResumePurchase}
        onRetry={onRetryPurchase}
        purchase={purchase}
        renderPurchaseDetails={props.renderPurchaseDetails}
        scope={props.scope}
        showGroupMessagesAction={
          statusPresentation.showGroupMessagesAction
        }
        statusContent={statusPresentation.statusContent}
      />
    );
  }
  if (selectionPresentation.capacityConflict) {
    return <CloseScreenContent capacityConflict onClose={onClose} />;
  }
  if (props.offers.length === 0) {
    return <CloseScreenContent capacityConflict={false} onClose={onClose} />;
  }
  if (selection) {
    return (
      <SelectionScreenContent
        controller={controller}
        firstOfferRef={firstOfferRef}
        groupPaymentMode={groupPaymentMode}
        onClose={onClose}
        onStartCheckout={onStartCheckout}
        presentation={selectionPresentation}
        props={props}
        selection={selection}
      />
    );
  }
  return null;
}

function ConfirmationIndicator({
  show,
  statusContent,
}: {
  show: boolean;
  statusContent: StatusPresentation["statusContent"];
}) {
  if (!show || !statusContent) {
    return null;
  }
  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
      role="status"
      aria-live="polite"
      aria-label={`${statusContent.title}. ${statusContent.message}`}
    >
      <CheckIcon aria-hidden="true" className="size-4 stroke-[2.5]" />
    </div>
  );
}

interface SurfaceProps {
  canShowTrigger: boolean;
  children: ReactNode;
  confirmationIndicator: ReactNode;
  familyTarget: string | null;
  header: DialogHeaderPresentation;
  onOpenChange: HostedUsageTopUpController["handleOpenChange"];
  open: boolean;
  presentedOpen: boolean;
  props: HostedUsageTopUpDialogProps;
  scrollContentRef: RefObject<HTMLDivElement | null>;
  statusPresentation: StatusPresentation;
  titleRef: RefObject<HTMLHeadingElement | null>;
  triggerLabel: string;
}

function MobileTopUpDrawer({
  canShowTrigger,
  children,
  confirmationIndicator,
  familyTarget,
  header,
  onOpenChange,
  open,
  props,
  scrollContentRef,
  statusPresentation,
  titleRef,
  triggerLabel,
}: SurfaceProps) {
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
  return (
    <Drawer handleOnly open={open} onOpenChange={onOpenChange}>
      {canShowTrigger ? (
        <DrawerTrigger asChild>{drawerTriggerButton}</DrawerTrigger>
      ) : null}
      <DrawerContent
        className={cn(
          "border-border data-[vaul-drawer-direction=bottom]:mt-3 data-[vaul-drawer-direction=bottom]:rounded-t-[2rem]",
          !statusPresentation.showGroupMessagesAction &&
            "h-[calc(100dvh-0.75rem)] data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-0.75rem)]",
        )}
        data-inert={props.inert ? "true" : undefined}
        inert={props.inert ? true : undefined}
      >
        <DrawerHeader
          className={cn(
            "relative items-start gap-2 px-6 pb-2 pt-2 text-left",
            statusPresentation.showGroupMessagesAction && "items-center gap-3",
          )}
        >
          {confirmationIndicator}
          <DrawerTitle
            ref={titleRef}
            tabIndex={-1}
            className={cn(
              "pr-10 font-serif text-3xl font-semibold leading-[1.1] tracking-tight text-foreground outline-none",
              statusPresentation.showGroupMessagesAction &&
                "max-w-md pr-0 text-4xl leading-[1.05] tracking-[-0.03em]",
            )}
          >
            {header.title}
          </DrawerTitle>
          <DrawerDescription
            className={cn(
              "max-w-md text-left text-base leading-6",
              statusPresentation.showGroupMessagesAction &&
                "text-muted-foreground",
            )}
          >
            {header.description}
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
            statusPresentation.showGroupMessagesAction
              ? "pb-[max(env(safe-area-inset-bottom),1.5rem)]"
              : "flex-1",
          )}
        >
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function DesktopTopUpDialog({
  canShowTrigger,
  children,
  confirmationIndicator,
  familyTarget,
  header,
  onOpenChange,
  presentedOpen,
  props,
  scrollContentRef,
  statusPresentation,
  titleRef,
  triggerLabel,
}: SurfaceProps) {
  return (
    <>
      {props.quietSuccessfulReturn ? (
        <p
          className="sr-only"
          role="status"
          aria-atomic="true"
          aria-live="polite"
        >
          {statusPresentation.quietSuccessfulReturn &&
          statusPresentation.fulfilledConfirmation &&
          statusPresentation.statusContent
            ? `${statusPresentation.statusContent.title}. ${statusPresentation.statusContent.message}`
            : ""}
        </p>
      ) : null}
      <Dialog open={presentedOpen} onOpenChange={onOpenChange}>
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
            statusPresentation.showGroupMessagesAction && "gap-5 sm:max-w-lg",
            statusPresentation.compact && "sm:max-w-md",
          )}
          initialFocus={titleRef}
        >
          <DialogHeader
            className={cn(
              "pr-10",
              statusPresentation.showGroupMessagesAction && "gap-3",
            )}
          >
            {confirmationIndicator}
            <DialogTitle
              ref={titleRef}
              tabIndex={-1}
              className={cn(
                "text-3xl font-semibold leading-[1.1] tracking-tight outline-none",
                statusPresentation.showGroupMessagesAction &&
                  "max-w-md text-4xl leading-[1.05] tracking-[-0.03em]",
              )}
            >
              {header.title}
            </DialogTitle>
            <DialogDescription
              className={
                header.description
                  ? cn(
                      "max-w-md text-base leading-6",
                      statusPresentation.showGroupMessagesAction &&
                        "text-muted-foreground",
                    )
                  : "sr-only"
              }
            >
              {header.description ??
                statusPresentation.statusContent?.message ??
                "Choose a usage amount."}
            </DialogDescription>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    </>
  );
}

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
      (previousScreen.kind !== "selection" ||
        previousScreen.attempt.kind !== "locked" ||
        previousScreen.attempt.error === null);
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
      (firstOfferRef.current ?? titleRef.current)?.focus({
        preventScroll: true,
      });
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
  const purchaseActions = readPurchaseActions(
    purchase,
    returnedFromSuccessfulCheckout,
  );
  const purchaseTriggerLabel = readPurchaseTriggerLabel(
    purchase,
    purchaseActions,
    returnedFromSuccessfulCheckout,
    props.scope,
  );
  const familyTarget =
    props.scope === "family" && props.targetLabel ? props.targetLabel : null;
  const triggerLabel = readTriggerLabel(
    props,
    groupPaymentMode,
    purchaseTriggerLabel,
  );
  const statusPresentation = readStatusPresentation({
    actions: purchaseActions,
    familyTarget,
    props,
    purchase,
    returnedFromSuccessfulCheckout,
  });
  const presentedOpen =
    controller.state.open &&
    (!statusPresentation.quietSuccessfulReturn ||
      statusPresentation.returnNeedsRecovery);

  useEffect(() => {
    if (
      props.quietSuccessfulReturn === true &&
      controller.state.open &&
      statusPresentation.fulfilledConfirmation
    ) {
      controller.handleOpenChange(false);
    }
  }, [
    controller,
    props.quietSuccessfulReturn,
    statusPresentation.fulfilledConfirmation,
  ]);

  const selectionPresentation = readSelectionPresentation(selection);
  const header = readDialogHeader({
    compactStatusPresentation: statusPresentation.compact,
    familyTarget,
    groupPaymentMode,
    props,
    purchase,
    selectionPresentation,
    showGroupMessagesAction: statusPresentation.showGroupMessagesAction,
    statusContent: statusPresentation.statusContent,
  });
  const handleClose = () => controller.handleOpenChange(false);
  const handleCancelPurchase = () => {
    focusTitleAfterPurchaseActionRef.current = true;
    void controller.cancelRecoveredCheckout();
  };
  const handleRetryPurchase = () => {
    focusTitleAfterPurchaseActionRef.current = true;
    void controller.startCheckout(purchase?.retryOfferCode ?? null);
  };
  const handleCheckAgain = () => {
    focusTitleAfterPurchaseActionRef.current = true;
    controller.retryStatusCheck();
  };
  const handleResumePurchase = () => {
    window.location.assign(purchase?.checkoutUrl ?? "");
  };
  const handleStartCheckout = () => {
    void controller.startCheckout();
  };

  const screenContent = (
    <ScreenContent
      controller={controller}
      firstOfferRef={firstOfferRef}
      groupPaymentMode={groupPaymentMode}
      onCancelPurchase={handleCancelPurchase}
      onCheckAgain={handleCheckAgain}
      onClose={handleClose}
      onResumePurchase={handleResumePurchase}
      onRetryPurchase={handleRetryPurchase}
      onStartCheckout={handleStartCheckout}
      props={props}
      purchase={purchase}
      purchaseActions={purchaseActions}
      selection={selection}
      selectionPresentation={selectionPresentation}
      statusPresentation={statusPresentation}
    />
  );
  const confirmationIndicator = (
    <ConfirmationIndicator
      show={statusPresentation.showGroupMessagesAction}
      statusContent={statusPresentation.statusContent}
    />
  );
  const canShowTrigger =
    statusPresentation.quietSuccessfulReturn &&
    controller.state.open &&
    !statusPresentation.returnNeedsRecovery
      ? false
      : props.offers.length > 0 || purchaseTriggerLabel !== null;
  const surfaceProps: SurfaceProps = {
    canShowTrigger,
    children: screenContent,
    confirmationIndicator,
    familyTarget,
    header,
    onOpenChange: controller.handleOpenChange,
    open: controller.state.open,
    presentedOpen,
    props,
    scrollContentRef,
    statusPresentation,
    titleRef,
    triggerLabel,
  };

  if (isMobile && props.scope === "group") {
    return <MobileTopUpDrawer {...surfaceProps} />;
  }
  return <DesktopTopUpDialog {...surfaceProps} />;
}

export { HostedUsageTopUpDialog };
export type {
  HostedUsageTopUpActivePurchase,
  HostedUsageTopUpDialogProps,
  HostedUsageTopUpOffer,
  HostedUsageTopUpPurchaseStatus,
  HostedUsageTopUpReturn,
} from "./hosted-usage-top-up-contract";
