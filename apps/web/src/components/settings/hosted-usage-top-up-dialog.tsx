"use client";

import {
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
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
  HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
} from "@/src/lib/hosted-onboarding/usage-credit-capacity-conflict";
import { LINK_PAGE_NIGHT_TOKENS } from "@/src/components/link-page/link-page-shell";
import { cn } from "@/src/lib/utils";

import {
  readStatusContent,
  shouldPollPurchaseStatus,
  type HostedUsageTopUpDialogProps,
} from "./hosted-usage-top-up-contract";
import {
  readHostedUsageTopUpPurchaseActions,
  type HostedUsageTopUpPurchaseActions,
} from "./hosted-usage-top-up-state";
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

interface StatusPresentation {
  closeOwnedFulfilledConfirmation: boolean;
  compact: boolean;
  fulfilledConfirmation: boolean;
  needsRecovery: boolean;
  quietSuccessfulReturn: boolean;
  returnNeedsRecovery: boolean;
  statusContent: { message: string; title: string } | null;
}

interface SelectionPresentation {
  capacityConflict: boolean;
  hasAttempt: boolean;
  needsRecovery: boolean;
  paymentNeedsRecovery: boolean;
  selectionError: string | null;
}

// A link from Murph opens this as a full night page. The purchase is the same,
// and the amount stays unselected: the button can charge a saved card at once.
const USAGE_LINK_PAGE_CLASS =
  "left-0 top-0 h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 content-start rounded-none border-0 bg-[#1C1915] px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-14 text-[#FFFCF6] sm:max-w-none sm:rounded-none sm:px-[max(1.5rem,calc(50vw-13rem))] [&_[data-slot=usage-top-up-actions]]:flex [&_[data-slot=usage-top-up-actions]]:flex-col-reverse [&_button[data-slot=button]]:rounded-full";

interface DialogHeaderPresentation {
  description: string | null;
  title: string;
}

function readPurchaseTriggerLabel(
  purchase: HostedUsageTopUpPurchaseScreen | null,
  actions: HostedUsageTopUpPurchaseActions,
  returnedFromSuccessfulCheckout: boolean,
): string | null {
  if (!purchase) {
    return null;
  }
  if (actions.canResume) {
    return "Continue checkout";
  }
  if (actions.canRetry) {
    return purchase.status === "payment_pending"
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
  purchaseTriggerLabel: string | null,
): string {
  return purchaseTriggerLabel ?? props.triggerLabel ?? "Add usage";
}

function readStatusPresentation(input: {
  actions: HostedUsageTopUpPurchaseActions;
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
    fulfilledConfirmation && props.deferTerminalRefreshUntilClose === true;
  const statusContent = closeOwnedFulfilledConfirmation
    ? {
        message:
          props.scope === "family" && props.targetLabel
            ? `Usage credit was added for ${props.targetLabel}.`
            : "Your usage credit was added to your account.",
        title: "Usage added",
      }
    : defaultStatusContent;
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
    compact: needsRecovery || closeOwnedFulfilledConfirmation,
    fulfilledConfirmation,
    needsRecovery,
    quietSuccessfulReturn,
    returnNeedsRecovery: quietSuccessfulReturn && needsRecovery,
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
  props: HostedUsageTopUpDialogProps;
  purchase: HostedUsageTopUpPurchaseScreen | null;
  selectionPresentation: SelectionPresentation;
  statusContent: StatusPresentation["statusContent"];
}): DialogHeaderPresentation {
  const {
    compactStatusPresentation,
    familyTarget,
    props,
    purchase,
    selectionPresentation,
    statusContent,
  } = input;
  let title: string;
  if (statusContent) {
    title = `${statusContent.title}${familyTarget && !purchase?.targetConflict ? ` for ${familyTarget}` : ""}`;
  } else if (selectionPresentation.capacityConflict) {
    title = "More credit can’t be added right now";
  } else if (props.offers.length === 0) {
    title = "Usage unavailable";
  } else {
    title = familyTarget ? `Add usage for ${familyTarget}` : "Add usage";
  }

  if (purchase) {
    if (compactStatusPresentation) {
      return { description: null, title };
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
          "The amount you just selected was not started. Review the earlier purchase below.",
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
  return {
    description: props.linkPage ? "One payment. Nothing repeats." : null,
    title,
  };
}

interface PurchaseScreenContentProps {
  actions: HostedUsageTopUpPurchaseActions;
  checkoutInFlight: boolean;
  compact: boolean;
  onCancel: () => void;
  onCheckAgain: () => void;
  onClose: () => void;
  onResume: () => void;
  onRetry: () => void;
  purchase: HostedUsageTopUpPurchaseScreen;
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
  statusContent,
}: PurchaseScreenContentProps) {
  return (
    <div className="flex flex-col gap-5">
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
      <FieldError>{purchase.checkoutError}</FieldError>
      <div className="flex flex-col gap-2">
        {actions.canResume ? (
          <Button
            type="button"
            size="xl"
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
            size="xl"
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
            size="xl"
            className="w-full"
            aria-busy={purchase.operation === "opening_checkout"}
            disabled={checkoutInFlight}
            onClick={onRetry}
          >
            {purchase.operation === "opening_checkout"
              ? purchase.status === "payment_pending"
                ? "Continuing payment…"
                : "Opening checkout…"
              : purchase.status === "payment_pending"
                ? "Retry payment"
                : "Retry checkout"}
          </Button>
        ) : null}
        {actions.canCheckAgain ? (
          <Button
            type="button"
            size="xl"
            className="w-full"
            disabled={checkoutInFlight}
            onClick={onCheckAgain}
          >
            Check again
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="xl"
          className="w-full"
          onClick={onClose}
        >
          Close
        </Button>
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
        size="xl"
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
  selectedOfferCode: string | null;
}

function OfferSelector({
  firstOfferRef,
  hasAttempt,
  offers,
  onSelectOffer,
  requestIdentityReady,
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
            id={`usage-top-up-${index}`}
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
  needsRecovery: boolean;
  onChangeAmount: () => void;
  onClose: () => void;
  onStartCheckout: () => void;
  paymentNeedsRecovery: boolean;
  requestIdentityReady: boolean;
  selectedOffer: HostedUsageTopUpController["selectedOffer"];
}

function SelectionActions({
  checkoutInFlight,
  needsRecovery,
  onChangeAmount,
  onClose,
  onStartCheckout,
  paymentNeedsRecovery,
  requestIdentityReady,
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
          size="xl"
          className="w-full"
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]" data-slot="usage-top-up-actions">
      <Button
        type="button"
        variant="ghost"
        size="xl"
        className="w-full sm:w-auto"
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
          ? "Adding usage…"
          : selectedOffer
            ? `Add usage · ${selectedOffer.amountLabel}`
            : "Choose an amount"}
      </Button>
    </div>
  );
}

interface SelectionScreenContentProps {
  controller: HostedUsageTopUpController;
  firstOfferRef: RefObject<HTMLSpanElement | null>;
  onClose: () => void;
  onStartCheckout: () => void;
  presentation: SelectionPresentation;
  props: HostedUsageTopUpDialogProps;
  selection: HostedUsageTopUpSelectionScreen;
}

function SelectionScreenContent({
  controller,
  firstOfferRef,
  onClose,
  onStartCheckout,
  presentation,
  props,
  selection,
}: SelectionScreenContentProps) {
  return (
    <div data-slot="usage-top-up-selection" className="flex flex-col gap-5">
      <OfferSelector
        firstOfferRef={firstOfferRef}
        hasAttempt={presentation.hasAttempt}
        offers={props.offers}
        onSelectOffer={controller.selectOffer}
        requestIdentityReady={controller.requestIdentityReady}
        selectedOfferCode={selection.selectedOfferCode}
      />
      <FieldError>{controller.requestIdentityError}</FieldError>
      {presentation.needsRecovery ? (
        <SelectionRecoveryNotice
          paymentNeedsRecovery={presentation.paymentNeedsRecovery}
          selectionError={presentation.selectionError}
        />
      ) : null}
      <SelectionActions
        checkoutInFlight={controller.checkoutInFlight}
        needsRecovery={presentation.needsRecovery}
        onChangeAmount={controller.changeAmount}
        onClose={onClose}
        onStartCheckout={onStartCheckout}
        paymentNeedsRecovery={presentation.paymentNeedsRecovery}
        requestIdentityReady={controller.requestIdentityReady}
        selectedOffer={controller.selectedOffer}
      />
    </div>
  );
}

interface ScreenContentProps {
  controller: HostedUsageTopUpController;
  firstOfferRef: RefObject<HTMLSpanElement | null>;
  onCancelPurchase: () => void;
  onCheckAgain: () => void;
  onClose: () => void;
  onResumePurchase: () => void;
  onRetryPurchase: () => void;
  onStartCheckout: () => void;
  props: HostedUsageTopUpDialogProps;
  purchase: HostedUsageTopUpPurchaseScreen | null;
  purchaseActions: HostedUsageTopUpPurchaseActions;
  selection: HostedUsageTopUpSelectionScreen | null;
  selectionPresentation: SelectionPresentation;
  statusPresentation: StatusPresentation;
}

function ScreenContent({
  controller,
  firstOfferRef,
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

interface SurfaceProps {
  canShowTrigger: boolean;
  children: ReactNode;
  familyTarget: string | null;
  header: DialogHeaderPresentation;
  onOpenChange: HostedUsageTopUpController["handleOpenChange"];
  presentedOpen: boolean;
  props: HostedUsageTopUpDialogProps;
  scrollContentRef: RefObject<HTMLDivElement | null>;
  statusPresentation: StatusPresentation;
  titleRef: RefObject<HTMLHeadingElement | null>;
  triggerLabel: string;
}

function HostedUsageTopUpSurface({
  canShowTrigger,
  children,
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
                size={props.triggerSize ?? "lg"}
                variant={props.triggerVariant ?? "outline"}
                className={props.triggerClassName}
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
            statusPresentation.compact && "sm:max-w-md",
            props.linkPage && USAGE_LINK_PAGE_CLASS,
          )}
          style={props.linkPage ? LINK_PAGE_NIGHT_TOKENS : undefined}
          initialFocus={titleRef}
        >
          <DialogHeader className="pr-10">
            <DialogTitle
              ref={titleRef}
              tabIndex={-1}
              className={cn(
                "text-3xl font-semibold leading-[1.1] tracking-tight outline-none",
                props.linkPage && "text-[40px] leading-[44px] tracking-[-0.02em]",
              )}
            >
              {header.title}
            </DialogTitle>
            <DialogDescription
              className={
                header.description ? "max-w-md text-base leading-6" : "sr-only"
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
  const controller = useHostedUsageTopUpDialog(props);
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
  const purchaseActions = readHostedUsageTopUpPurchaseActions(
    purchase,
    returnedFromSuccessfulCheckout,
  );
  const purchaseTriggerLabel = readPurchaseTriggerLabel(
    purchase,
    purchaseActions,
    returnedFromSuccessfulCheckout,
  );
  const familyTarget =
    props.scope === "family" && props.targetLabel ? props.targetLabel : null;
  const triggerLabel = readTriggerLabel(props, purchaseTriggerLabel);
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
    props,
    purchase,
    selectionPresentation,
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
  const canShowTrigger =
    statusPresentation.quietSuccessfulReturn &&
    controller.state.open &&
    !statusPresentation.returnNeedsRecovery
      ? false
      : props.offers.length > 0 || purchaseTriggerLabel !== null;
  const surfaceProps: SurfaceProps = {
    canShowTrigger,
    children: screenContent,
    familyTarget,
    header,
    onOpenChange: controller.handleOpenChange,
    presentedOpen,
    props,
    scrollContentRef,
    statusPresentation,
    titleRef,
    triggerLabel,
  };

  return <HostedUsageTopUpSurface {...surfaceProps} />;
}

export { HostedUsageTopUpDialog };
export type {
  HostedUsageTopUpActivePurchase,
  HostedUsageTopUpDialogProps,
  HostedUsageTopUpOffer,
  HostedUsageTopUpPurchaseStatus,
  HostedUsageTopUpReturn,
} from "./hosted-usage-top-up-contract";
