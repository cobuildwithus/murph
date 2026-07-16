"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import {
  stripSettingsQueryParams,
  toErrorMessage,
} from "@/src/components/settings/hosted-settings-utils";
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

const CHECKOUT_URL = "/api/settings/billing/usage-credit/checkout";
const CHECKOUT_REQUEST_TIMEOUT_MS = 20_000;
const MAX_STATUS_READS = 10;
const STATUS_CHECK_ATTEMPT_TIMEOUT_MS = 30_000;
const STATUS_POLL_INTERVAL_MS = 1_250;

const PURCHASE_STATUSES = [
  "checkout_open",
  "payment_pending",
  "fulfilled",
  "expired",
  "payment_failed",
  "reconciling",
] as const;

type HostedUsageTopUpPurchaseStatus = (typeof PURCHASE_STATUSES)[number];

interface HostedUsageTopUpOffer {
  offerCode: string;
  amountUsdCents: number;
  amountLabel: string;
}

interface HostedUsageTopUpReturn {
  purchaseId: string;
  kind: "success" | "cancel";
}

interface HostedUsageTopUpDialogProps {
  initialOpen?: boolean;
  offers: readonly HostedUsageTopUpOffer[];
  purchaseReturn?: HostedUsageTopUpReturn | null;
}

interface HostedUsageTopUpPurchaseResponse {
  purchaseId: string;
  status: HostedUsageTopUpPurchaseStatus;
  url: string | null;
}

function HostedUsageTopUpDialog({
  initialOpen = false,
  offers,
  purchaseReturn = null,
}: HostedUsageTopUpDialogProps) {
  const { refresh } = useRouter();
  const initialPurchaseId = purchaseReturn?.purchaseId ?? null;
  const [open, setOpen] = useState(
    purchaseReturn !== null || (initialOpen && offers.length > 0),
  );
  const [selectedOfferCode, setSelectedOfferCode] = useState<string | null>(null);
  const [hasCheckoutAttempt, setHasCheckoutAttempt] = useState(false);
  const [checkoutInFlight, setCheckoutInFlight] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [activePurchaseId, setActivePurchaseId] = useState<string | null>(
    initialPurchaseId,
  );
  const [purchaseStatus, setPurchaseStatus] =
    useState<HostedUsageTopUpPurchaseStatus | null>(null);
  const [pollExhausted, setPollExhausted] = useState(false);
  const [statusCheckFailed, setStatusCheckFailed] = useState(false);
  const [statusCheckAttempt, setStatusCheckAttempt] = useState(0);
  const clientRequestKeyRef = useRef<string | null>(null);
  const checkoutControllerRef = useRef<AbortController | null>(null);
  const purchaseStatusRef = useRef<HostedUsageTopUpPurchaseStatus | null>(null);
  const refreshedPurchaseIdsRef = useRef(new Set<string>());
  const handledReturnKeyRef = useRef(readReturnKey(purchaseReturn));
  const cleanedQueryKeyRef = useRef<string | null>(null);

  const selectedOffer = useMemo(
    () => offers.find((offer) => offer.offerCode === selectedOfferCode) ?? null,
    [offers, selectedOfferCode],
  );
  const returnKey = readReturnKey(purchaseReturn);
  const cancelReturnPurchaseId =
    purchaseReturn?.kind === "cancel" ? purchaseReturn.purchaseId : null;

  useEffect(() => {
    const queryKeys = [
      ...(initialOpen ? ["addUsage"] : []),
      ...(purchaseReturn ? ["usagePurchase", "usageCheckout"] : []),
    ];
    const cleanupKey = `${queryKeys.join(":")}:${returnKey ?? ""}`;

    if (queryKeys.length === 0 || cleanedQueryKeyRef.current === cleanupKey) {
      return;
    }

    cleanedQueryKeyRef.current = cleanupKey;
    stripSettingsQueryParams(queryKeys);
  }, [initialOpen, purchaseReturn, returnKey]);

  useEffect(() => {
    if (!purchaseReturn) {
      handledReturnKeyRef.current = null;
      return;
    }

    if (handledReturnKeyRef.current === returnKey) {
      return;
    }

    handledReturnKeyRef.current = returnKey;
    purchaseStatusRef.current = null;
    setPurchaseStatus(null);
    setPollExhausted(false);
    setStatusCheckFailed(false);
    setActivePurchaseId(purchaseReturn.purchaseId);
    setOpen(true);
  }, [purchaseReturn, returnKey]);

  useEffect(() => () => {
    checkoutControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!activePurchaseId) {
      return;
    }

    const purchaseId = activePurchaseId;
    const initialStatus = purchaseStatusRef.current;
    if (initialStatus && !shouldPollPurchaseStatus(initialStatus)) {
      if (initialStatus === "fulfilled") {
        refreshPurchaseOnce(purchaseId, refreshedPurchaseIdsRef.current, refresh);
      }
      return;
    }

    const controller = new AbortController();
    let receivedStatus = false;
    const timeout = setTimeout(() => {
      setPollExhausted(false);
      setStatusCheckFailed(true);
      controller.abort();
    }, STATUS_CHECK_ATTEMPT_TIMEOUT_MS);

    function applyPurchaseStatus(response: HostedUsageTopUpPurchaseResponse) {
      receivedStatus = true;
      purchaseStatusRef.current = response.status;
      setPurchaseStatus(response.status);
      setPollExhausted(false);
      setStatusCheckFailed(false);

      if (response.status === "fulfilled") {
        refreshPurchaseOnce(
          purchaseId,
          refreshedPurchaseIdsRef.current,
          refresh,
        );
      }
    }

    async function reconcileReturnedPurchase() {
      if (cancelReturnPurchaseId === purchaseId) {
        try {
          const value = await requestHostedOnboardingJson<unknown>({
            credentials: "same-origin",
            headers: {
              accept: "application/json",
            },
            method: "POST",
            signal: controller.signal,
            url: `/api/settings/billing/usage-credit/purchases/${encodeURIComponent(purchaseId)}/expire`,
          });
          const response = readPurchaseResponse(value);

          if (response.purchaseId === purchaseId && !controller.signal.aborted) {
            applyPurchaseStatus(response);
            if (!shouldPollPurchaseStatus(response.status)) {
              return;
            }
          }
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) {
            return;
          }
        }
      }

      for (let readIndex = 0; readIndex < MAX_STATUS_READS; readIndex += 1) {
        if (readIndex > 0) {
          await waitForNextStatusRead(controller.signal);
        }

        if (controller.signal.aborted) {
          return;
        }

        try {
          const value = await requestHostedOnboardingJson<unknown>({
            method: "GET",
            signal: controller.signal,
            url: `/api/settings/billing/usage-credit/purchases/${encodeURIComponent(purchaseId)}`,
          });
          const response = readPurchaseResponse(value);

          if (response.purchaseId !== purchaseId || controller.signal.aborted) {
            continue;
          }

          applyPurchaseStatus(response);

          if (!shouldPollPurchaseStatus(response.status)) {
            return;
          }
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) {
            return;
          }
        }
      }

      if (!controller.signal.aborted) {
        if (receivedStatus || purchaseStatusRef.current !== null) {
          setPollExhausted(true);
        } else {
          setStatusCheckFailed(true);
        }
      }
    }

    void reconcileReturnedPurchase().finally(() => {
      clearTimeout(timeout);
    });

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [activePurchaseId, cancelReturnPurchaseId, refresh, statusCheckAttempt]);

  function resetForNewAttempt() {
    clientRequestKeyRef.current = null;
    purchaseStatusRef.current = null;
    setSelectedOfferCode(null);
    setHasCheckoutAttempt(false);
    setCheckoutInFlight(false);
    setCheckoutError(null);
    setActivePurchaseId(null);
    setPurchaseStatus(null);
    setPollExhausted(false);
    setStatusCheckFailed(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && checkoutInFlight) {
      return;
    }

    if (nextOpen && !open) {
      const activeStatus = purchaseStatusRef.current;
      const shouldResumePurchase =
        activePurchaseId !== null &&
        (activeStatus === null || shouldPollPurchaseStatus(activeStatus));

      if (!shouldResumePurchase) {
        resetForNewAttempt();
      }
    }

    setOpen(nextOpen);
  }

  async function startCheckout() {
    if (!selectedOffer || checkoutInFlight) {
      return;
    }

    setHasCheckoutAttempt(true);
    setCheckoutInFlight(true);
    setCheckoutError(null);

    let controller: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    try {
      const clientRequestKey =
        clientRequestKeyRef.current ?? createClientRequestKey();
      clientRequestKeyRef.current = clientRequestKey;
      controller = new AbortController();
      checkoutControllerRef.current = controller;
      timeout = setTimeout(() => {
        controller?.abort();
      }, CHECKOUT_REQUEST_TIMEOUT_MS);

      const value = await requestHostedOnboardingJson<unknown>({
        method: "POST",
        payload: {
          offerCode: selectedOffer.offerCode,
          clientRequestKey,
        },
        signal: controller.signal,
        url: CHECKOUT_URL,
      });
      const response = readPurchaseResponse(value);

      if (response.url) {
        window.location.assign(readCheckoutUrl(response.url));
        return;
      }

      purchaseStatusRef.current = response.status;
      setPurchaseStatus(response.status);
      setPollExhausted(false);
      setStatusCheckFailed(false);
      setActivePurchaseId(response.purchaseId);
    } catch (error) {
      setCheckoutError(
        isAbortError(error)
          ? "Checkout took too long to open. Try again."
          : toErrorMessage(error, "Could not open Stripe right now. Try again."),
      );
    } finally {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      if (controller !== null && checkoutControllerRef.current === controller) {
        checkoutControllerRef.current = null;
      }
      setCheckoutInFlight(false);
    }
  }

  const showingPurchaseStatus = activePurchaseId !== null;
  const statusContent = readStatusContent(
    purchaseStatus,
    pollExhausted,
    statusCheckFailed,
  );
  const canRetryStatusCheck =
    statusCheckFailed ||
    (pollExhausted &&
      (purchaseStatus === null || shouldPollPurchaseStatus(purchaseStatus)));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {offers.length > 0 ? (
        <DialogTrigger render={<Button type="button" variant="outline" size="lg" />}>
          Add usage
        </DialogTrigger>
      ) : null}

      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto border border-border bg-popover p-5 sm:max-w-lg sm:p-6"
        showCloseButton={!checkoutInFlight}
      >
        <DialogHeader className="pr-10">
          <DialogTitle className="text-2xl leading-tight">
            {showingPurchaseStatus ? statusContent.title : "Add usage"}
          </DialogTitle>
          <DialogDescription>
            {showingPurchaseStatus
              ? "Murph checks Stripe before changing your available usage."
              : "Choose how much usage credit to add. Stripe confirms the payment before Murph adds it."}
          </DialogDescription>
        </DialogHeader>

        {showingPurchaseStatus ? (
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
            <div className="flex flex-col gap-2">
              {canRetryStatusCheck ? (
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={() => {
                    setPollExhausted(false);
                    setStatusCheckFailed(false);
                    setStatusCheckAttempt((attempt) => attempt + 1);
                  }}
                >
                  Check again
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
                onClick={() => handleOpenChange(false)}
              >
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <FieldSet disabled={hasCheckoutAttempt}>
              <FieldLegend className="sr-only">Usage credit amount</FieldLegend>
              <FieldDescription className="sr-only">
                Choose one usage credit amount.
              </FieldDescription>
              <RadioGroup
                value={selectedOfferCode ?? ""}
                onValueChange={(offerCode) => {
                  if (offers.some((offer) => offer.offerCode === offerCode)) {
                    setSelectedOfferCode(offerCode);
                  }
                }}
                className="grid gap-3 sm:grid-cols-3"
              >
                {offers.map((offer, index) => (
                  <ChoiceCard
                    key={offer.offerCode}
                    id={`usage-top-up-${index}-${sanitizeIdPart(offer.offerCode)}`}
                    value={offer.offerCode}
                    disabled={hasCheckoutAttempt}
                    title={
                      <span className="font-serif text-xl font-semibold tabular-nums">
                        {offer.amountLabel}
                      </span>
                    }
                    description="Usage credit"
                    meta="One-time payment"
                  />
                ))}
              </RadioGroup>
            </FieldSet>

            <FieldError>{checkoutError}</FieldError>

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="w-full"
                disabled={!selectedOffer || checkoutInFlight}
                size="lg"
                aria-busy={checkoutInFlight}
                onClick={() => {
                  void startCheckout();
                }}
              >
                {checkoutInFlight
                  ? "Opening Stripe…"
                  : selectedOffer
                    ? `Continue to checkout · ${selectedOffer.amountLabel}`
                    : "Choose an amount"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="w-full"
                disabled={checkoutInFlight}
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function readPurchaseResponse(value: unknown): HostedUsageTopUpPurchaseResponse {
  if (
    !isRecord(value) ||
    typeof value.purchaseId !== "string" ||
    value.purchaseId.trim().length === 0 ||
    value.purchaseId.length > 200 ||
    !isPurchaseStatus(value.status) ||
    (value.url !== undefined && value.url !== null && typeof value.url !== "string")
  ) {
    throw new Error("Could not open Stripe right now. Try again.");
  }

  return {
    purchaseId: value.purchaseId,
    status: value.status,
    url: typeof value.url === "string" && value.url.length > 0 ? value.url : null,
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
    throw new Error("Could not open Stripe right now. Try again.");
  }
}

function readStatusContent(
  status: HostedUsageTopUpPurchaseStatus | null,
  pollExhausted: boolean,
  statusCheckFailed: boolean,
): { message: string; title: string } {
  if (statusCheckFailed) {
    return {
      title: "Couldn't check payment",
      message: "We couldn't check this payment right now. Try again.",
    };
  }

  if (pollExhausted && (!status || shouldPollPurchaseStatus(status))) {
    return {
      title: "Payment confirmation pending",
      message:
        "Your payment is still being confirmed. You can safely leave this page.",
    };
  }

  switch (status) {
    case "fulfilled":
      return {
        title: "Usage added",
        message: "Usage added.",
      };
    case "expired":
      return {
        title: "Checkout canceled",
        message: "Checkout canceled. No usage was added.",
      };
    case "payment_failed":
      return {
        title: "Payment not completed",
        message: "The payment did not complete. No usage was added.",
      };
    case "payment_pending":
      return {
        title: "Confirming payment",
        message: "Payment submitted. Stripe is confirming it.",
      };
    case "checkout_open":
    case "reconciling":
    case null:
      return {
        title: "Confirming payment",
        message: "Confirming your payment with Stripe…",
      };
  }
}

function shouldPollPurchaseStatus(status: HostedUsageTopUpPurchaseStatus): boolean {
  return (
    status === "checkout_open" ||
    status === "payment_pending" ||
    status === "reconciling"
  );
}

function isPurchaseStatus(value: unknown): value is HostedUsageTopUpPurchaseStatus {
  return (
    typeof value === "string" &&
    PURCHASE_STATUSES.some((status) => status === value)
  );
}

function readReturnKey(purchaseReturn: HostedUsageTopUpReturn | null): string | null {
  return purchaseReturn
    ? `${purchaseReturn.purchaseId}:${purchaseReturn.kind}`
    : null;
}

function createClientRequestKey(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("Could not open Stripe right now. Try again.");
  }

  return globalThis.crypto.randomUUID();
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "-");
}

function waitForNextStatusRead(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    function handleAbort() {
      clearTimeout(timeout);
      resolve();
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, STATUS_POLL_INTERVAL_MS);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function refreshPurchaseOnce(
  purchaseId: string,
  refreshedPurchaseIds: Set<string>,
  refresh: () => void,
) {
  if (refreshedPurchaseIds.has(purchaseId)) {
    return;
  }

  refreshedPurchaseIds.add(purchaseId);
  refresh();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { HostedUsageTopUpDialog };
export type {
  HostedUsageTopUpDialogProps,
  HostedUsageTopUpOffer,
  HostedUsageTopUpPurchaseStatus,
  HostedUsageTopUpReturn,
};
