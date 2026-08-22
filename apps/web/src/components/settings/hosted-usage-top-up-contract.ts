import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import type { buttonVariants } from "@/src/components/ui/button";
import type {
  HostedUsageCreditCapacityConflictCode,
} from "@/src/lib/hosted-onboarding/usage-credit-capacity-conflict";

const PURCHASE_STATUSES = [
  "checkout_open",
  "payment_pending",
  "fulfilled",
  "expired",
  "payment_failed",
  "reconciling",
] as const;

type HostedUsageTopUpPurchaseStatus = (typeof PURCHASE_STATUSES)[number];
type HostedUsageTopUpSelectionConflict = "offer" | "sponsorship";

interface HostedUsageTopUpOffer {
  offerCode: string;
  amountLabel: string;
}

interface HostedUsageTopUpActivePurchase {
  cancelAllowed?: true;
  offerCode: string;
  purchaseId: string;
  restartAt?: string;
  retryAllowed: boolean;
  status: HostedUsageTopUpPurchaseStatus;
  targetConflict?: true;
  url?: string;
}

interface HostedUsageTopUpReturn {
  purchaseId: string;
  kind: "success" | "cancel";
}

interface HostedUsageTopUpDialogProps {
  activePurchase?: HostedUsageTopUpActivePurchase | null;
  buildCheckoutPayload?: (input: {
    clientRequestKey: string;
    offerCode: string;
  }) => Record<string, unknown>;
  checkoutUrl?: string;
  deferTerminalRefreshUntilClose?: boolean;
  groupPaymentMode?: "monthly" | "one_time";
  initialCheckoutErrorCode?: HostedUsageCreditCapacityConflictCode;
  initialOpen?: boolean;
  inert?: boolean;
  offers: readonly HostedUsageTopUpOffer[];
  payerMemberId: string;
  purchaseReturn?: HostedUsageTopUpReturn | null;
  quietSuccessfulReturn?: boolean;
  renderPurchaseDetails?: ReactNode;
  renderSelectionDetails?: (input: {
    disabled: boolean;
    mobileStickyActionVisible: boolean;
    selectedOffer: HostedUsageTopUpOffer | null;
  }) => ReactNode;
  scope?: "family" | "group" | "personal";
  targetLabel?: string;
  triggerClassName?: string;
  triggerLabel?: string;
  triggerSize?: VariantProps<typeof buttonVariants>["size"];
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
}

interface HostedUsageTopUpPurchaseResponse {
  cancelAllowed: boolean;
  purchaseId: string;
  recovered: boolean;
  requestKeyMatched: boolean;
  restartAt: string | null;
  retryAllowed: boolean;
  selectionConflict: HostedUsageTopUpSelectionConflict | null;
  status: HostedUsageTopUpPurchaseStatus;
  targetConflict: boolean;
  url: string | null;
}

interface HostedUsageTopUpRecoveryMissResponse {
  recoveryMiss: true;
}

type HostedUsageTopUpCheckoutAttemptResponse =
  | HostedUsageTopUpPurchaseResponse
  | HostedUsageTopUpRecoveryMissResponse;

function readCheckoutAttemptResponse(
  value: unknown,
): HostedUsageTopUpCheckoutAttemptResponse {
  if (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    value.recoveryMiss === true
  ) {
    return { recoveryMiss: true };
  }
  return readPurchaseResponse(value);
}

function readPurchaseResponse(value: unknown): HostedUsageTopUpPurchaseResponse {
  if (
    !isRecord(value) ||
    typeof value.purchaseId !== "string" ||
    value.purchaseId.trim().length === 0 ||
    value.purchaseId.length > 200 ||
    !isPurchaseStatus(value.status) ||
    (value.cancelAllowed !== undefined && value.cancelAllowed !== true) ||
    (value.selectionConflict !== undefined
      && !isSelectionConflict(value.selectionConflict)) ||
    (value.recovered !== undefined && value.recovered !== true) ||
    (value.requestKeyMatched !== undefined &&
      value.requestKeyMatched !== true) ||
    (value.restartAt !== undefined &&
      (value.status !== "reconciling" ||
        !isCanonicalIsoTimestamp(value.restartAt))) ||
    (value.retryAllowed !== undefined && value.retryAllowed !== true) ||
    (value.targetConflict !== undefined && value.targetConflict !== true) ||
    (value.url !== undefined &&
      value.url !== null &&
      typeof value.url !== "string") ||
    (isSelectionConflict(value.selectionConflict) &&
      (value.retryAllowed === true ||
        value.targetConflict === true ||
        typeof value.url === "string"))
  ) {
    throw new Error("Checkout didn’t open. Try again.");
  }

  return {
    cancelAllowed: value.cancelAllowed === true,
    purchaseId: value.purchaseId,
    recovered: value.recovered === true,
    requestKeyMatched: value.requestKeyMatched === true,
    restartAt: typeof value.restartAt === "string" ? value.restartAt : null,
    retryAllowed: value.retryAllowed === true,
    selectionConflict: isSelectionConflict(value.selectionConflict)
      ? value.selectionConflict
      : null,
    status: value.status,
    targetConflict: value.targetConflict === true,
    url:
      typeof value.url === "string" && value.url.length > 0 ? value.url : null,
  };
}

function readCheckoutUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      throw new Error("Checkout must use HTTPS.");
    }
    return url.toString();
  } catch {
    throw new Error("Checkout didn’t open. Try again.");
  }
}

function readOptionalCheckoutUrl(value: string): string | null {
  try {
    return readCheckoutUrl(value);
  } catch {
    return null;
  }
}

function readOptionalRestartAt(value: string | undefined): string | null {
  return isCanonicalIsoTimestamp(value) ? value : null;
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function readStatusContent(input: {
  canResumeCheckout: boolean;
  canRetryCheckout: boolean;
  pollKind: "dormant" | "checking" | "exhausted" | "failed";
  returnedFromSuccessfulCheckout: boolean;
  scope?: "family" | "group" | "personal";
  selectionConflict?: HostedUsageTopUpSelectionConflict | null;
  status: HostedUsageTopUpPurchaseStatus | null;
  targetLabel?: string;
  targetConflict?: boolean;
}): { message: string; title: string } {
  if (input.selectionConflict) {
    return readSelectionConflictStatusContent({
      kind: input.selectionConflict,
      pollKind: input.pollKind,
      status: input.status,
    });
  }

  if (input.targetConflict) {
    if (input.pollKind === "failed") {
      return content(
        "Couldn't check the other checkout",
        "We couldn't check the unfinished checkout right now. Try again.",
      );
    }
    if (input.status === "checkout_open") {
      return content(
        "Another checkout is already open",
        input.canResumeCheckout
          ? "Resume or cancel the unfinished checkout for the other usage destination before starting this one."
          : "Cancel the unfinished checkout for the other usage destination before starting this one.",
      );
    }
    if (
      input.pollKind === "exhausted"
      && (!input.status || shouldPollPurchaseStatus(input.status))
    ) {
      return content(
        "Other checkout still processing",
        "The unfinished checkout for the other usage destination is still being confirmed.",
      );
    }
    switch (input.status) {
      case "fulfilled":
        return content(
          "Other checkout completed",
          "The other usage destination received its credit. Close this dialog and try again.",
        );
      case "expired":
        return content(
          "Other checkout canceled",
          "The unfinished checkout was canceled. Close this dialog and try again.",
        );
      case "payment_failed":
        return content(
          "Other payment not completed",
          "The other payment did not complete. Close this dialog and try again.",
        );
      case "payment_pending":
      case "reconciling":
      case null:
        return content(
          "Checking another checkout",
          "Murph is checking the unfinished checkout for the other usage destination.",
        );
    }
  }

  if (input.pollKind === "failed") {
    return content(
      "Couldn't check payment",
      "We couldn't check this payment right now. Try again.",
    );
  }

  // After a successful Stripe return the webhook may not have landed yet, so
  // the purchase can still read checkout_open; that must present as payment
  // confirmation, not as a resumable checkout.
  if (input.status === "checkout_open" && !input.returnedFromSuccessfulCheckout) {
    return content(
      "Checkout already open",
      input.canResumeCheckout
        ? "You already have a usage-credit checkout in progress. Resume it or cancel it before starting a new one."
        : input.canRetryCheckout
          ? "Checkout is open, but the payment page isn’t available here. Retry to recover it or cancel the checkout."
          : "An existing usage-credit checkout is open, but it can’t be resumed from this account right now. You can cancel it.",
    );
  }

  if (
    input.status === "reconciling" &&
    !input.returnedFromSuccessfulCheckout
  ) {
    return content(
      "Checkout not open yet",
      input.canRetryCheckout
        ? `The payment page ${input.pollKind === "exhausted" ? "still " : ""}hasn’t opened. You can safely retry with the same purchase.`
        : "This purchase is still being reconciled. Checkout is not available right now.",
    );
  }

  if (
    input.pollKind === "exhausted" &&
    (!input.status || shouldPollPurchaseStatus(input.status))
  ) {
    return content(
      "Payment confirmation pending",
      "Your payment is still being confirmed. You can safely leave this page.",
    );
  }

  switch (input.status) {
    case "fulfilled":
      return input.scope === "group"
        ? content(
            "This group has more Murph",
            "Your contribution is ready.",
          )
        : content(
            "Usage added",
            input.scope === "family" && input.targetLabel
              ? `The available usage for ${input.targetLabel} has been updated.`
              : "Your available usage has been updated.",
          );
    case "expired":
      return content("Checkout canceled", "Checkout canceled. No usage was added.");
    case "payment_failed":
      return content(
        "Payment not completed",
        "The payment did not complete. No usage was added.",
      );
    case "checkout_open":
    case "payment_pending":
      return content("Confirming payment", "Payment submitted. We’re confirming it.");
    case null:
    case "reconciling":
      return content("Confirming payment", "We’re confirming your payment…");
  }
}

function readSelectionConflictStatusContent(input: {
  kind: HostedUsageTopUpSelectionConflict;
  pollKind: "dormant" | "checking" | "exhausted" | "failed";
  status: HostedUsageTopUpPurchaseStatus | null;
}): { message: string; title: string } {
  if (input.kind === "sponsorship") {
    const message =
      "The sponsor details you just entered were not applied. The original purchase is shown below.";
    switch (input.status) {
      case "fulfilled":
        return content("Original sponsorship completed", message);
      case "expired":
        return content("Original sponsorship canceled", message);
      case "payment_failed":
        return content("Original sponsorship not completed", message);
      case "checkout_open":
      case "payment_pending":
      case "reconciling":
      case null:
        return content("Original sponsorship found", message);
    }
  }

  if (input.pollKind === "failed") {
    return content(
      "Couldn't check the earlier amount",
      "The amount you just selected was not started. We couldn't check the earlier purchase right now. Try again.",
    );
  }

  switch (input.status) {
    case "checkout_open":
      return content(
        "Earlier amount already in progress",
        "The amount you just selected was not started. Cancel the earlier checkout before choosing another amount.",
      );
    case "reconciling":
      return content(
        "Earlier amount still starting",
        "The amount you just selected was not started. The earlier purchase is still being prepared.",
      );
    case "payment_pending":
      return content(
        "Earlier payment being confirmed",
        "The amount you just selected was not started. The earlier payment is still being confirmed.",
      );
    case "fulfilled":
      return content(
        "Earlier amount added",
        "The amount you just selected was not started. The earlier purchase completed and its usage was added.",
      );
    case "expired":
      return content(
        "Earlier checkout canceled",
        "The amount you just selected was not started. The earlier checkout was canceled.",
      );
    case "payment_failed":
      return content(
        "Earlier payment not completed",
        "The amount you just selected was not started. The earlier payment did not complete.",
      );
    case null:
      return content(
        "Checking the earlier amount",
        "The amount you just selected was not started. We're checking the earlier purchase.",
      );
  }
}

function content(title: string, message: string) {
  return { message, title };
}

function isSelectionConflict(
  value: unknown,
): value is HostedUsageTopUpSelectionConflict {
  return value === "offer" || value === "sponsorship";
}

function shouldPollPurchaseStatus(
  status: HostedUsageTopUpPurchaseStatus,
): boolean {
  return (
    status === "checkout_open" ||
    status === "payment_pending" ||
    status === "reconciling"
  );
}

function isPurchaseStatus(
  value: unknown,
): value is HostedUsageTopUpPurchaseStatus {
  return (
    typeof value === "string" &&
    PURCHASE_STATUSES.some((status) => status === value)
  );
}

function readReturnKey(
  purchaseReturn: HostedUsageTopUpReturn | null,
): string | null {
  return purchaseReturn
    ? `${purchaseReturn.purchaseId}:${purchaseReturn.kind}`
    : null;
}

function createClientRequestKey(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("Checkout didn’t open. Try again.");
  }
  return globalThis.crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export {
  createClientRequestKey,
  readCheckoutAttemptResponse,
  readCheckoutUrl,
  readOptionalCheckoutUrl,
  readOptionalRestartAt,
  readPurchaseResponse,
  readReturnKey,
  readStatusContent,
  shouldPollPurchaseStatus,
};
export type {
  HostedUsageTopUpActivePurchase,
  HostedUsageTopUpCheckoutAttemptResponse,
  HostedUsageTopUpDialogProps,
  HostedUsageTopUpOffer,
  HostedUsageTopUpPurchaseResponse,
  HostedUsageTopUpPurchaseStatus,
  HostedUsageTopUpReturn,
};
