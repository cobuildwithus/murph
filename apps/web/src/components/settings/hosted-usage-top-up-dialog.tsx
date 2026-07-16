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
  amountLabel: string;
}

interface HostedUsageTopUpActivePurchase {
  offerCode: string;
  purchaseId: string;
  restartAt?: string;
  retryAllowed: boolean;
  status: HostedUsageTopUpPurchaseStatus;
  url?: string;
}

interface HostedUsageTopUpReturn {
  purchaseId: string;
  kind: "success" | "cancel";
}

interface HostedUsageTopUpDialogProps {
  activePurchase?: HostedUsageTopUpActivePurchase | null;
  initialOpen?: boolean;
  offers: readonly HostedUsageTopUpOffer[];
  purchaseReturn?: HostedUsageTopUpReturn | null;
}

interface HostedUsageTopUpPurchaseResponse {
  purchaseId: string;
  recovered: boolean;
  restartAt: string | null;
  retryAllowed: boolean;
  status: HostedUsageTopUpPurchaseStatus;
  url: string | null;
}

function HostedUsageTopUpDialog({
  activePurchase = null,
  initialOpen = false,
  offers,
  purchaseReturn = null,
}: HostedUsageTopUpDialogProps) {
  const { refresh } = useRouter();
  const initialPurchaseId =
    purchaseReturn?.purchaseId ?? activePurchase?.purchaseId ?? null;
  const initialPurchaseStatus = purchaseReturn
    ? null
    : activePurchase?.status ?? null;
  const initialRecoveredCheckoutUrl =
    initialPurchaseStatus === "checkout_open" && activePurchase?.url
      ? readOptionalCheckoutUrl(activePurchase.url)
      : null;
  const initialRecoveryRestartAt =
    initialPurchaseStatus === "reconciling"
      ? readOptionalRestartAt(activePurchase?.restartAt)
      : null;
  const [open, setOpen] = useState(
    purchaseReturn !== null || initialOpen,
  );
  const [selectedOfferCode, setSelectedOfferCode] = useState<string | null>(null);
  const [hasCheckoutAttempt, setHasCheckoutAttempt] = useState(false);
  const [checkoutInFlight, setCheckoutInFlight] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [activePurchaseId, setActivePurchaseId] = useState<string | null>(
    initialPurchaseId,
  );
  const [recoveredCheckoutUrl, setRecoveredCheckoutUrl] = useState<string | null>(
    initialRecoveredCheckoutUrl,
  );
  const [recoveryRestartAt, setRecoveryRestartAt] = useState<string | null>(
    initialRecoveryRestartAt,
  );
  const [retryOfferCode, setRetryOfferCode] = useState<string | null>(
    activePurchase?.retryAllowed === true ? activePurchase.offerCode : null,
  );
  const [purchaseStatus, setPurchaseStatus] =
    useState<HostedUsageTopUpPurchaseStatus | null>(initialPurchaseStatus);
  const [pollExhausted, setPollExhausted] = useState(false);
  const [statusCheckFailed, setStatusCheckFailed] = useState(false);
  const [statusCheckAttempt, setStatusCheckAttempt] = useState(0);
  const clientRequestKeyRef = useRef<string | null>(null);
  const checkoutControllerRef = useRef<AbortController | null>(null);
  const statusControllerRef = useRef<AbortController | null>(null);
  const purchaseStatusRef = useRef<HostedUsageTopUpPurchaseStatus | null>(
    initialPurchaseStatus,
  );
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
    setRecoveryRestartAt(null);
    setOpen(true);
  }, [purchaseReturn, returnKey]);

  useEffect(() => () => {
    checkoutControllerRef.current?.abort();
    statusControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!open || !activePurchaseId) {
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
    statusControllerRef.current = controller;
    const timeout = setTimeout(() => {
      setPollExhausted(false);
      setStatusCheckFailed(true);
      controller.abort();
    }, STATUS_CHECK_ATTEMPT_TIMEOUT_MS);

    function applyPurchaseStatus(response: HostedUsageTopUpPurchaseResponse) {
      purchaseStatusRef.current = response.status;
      setPurchaseStatus(response.status);
      setRecoveryRestartAt(response.restartAt);
      if (response.status !== "checkout_open") {
        setRecoveredCheckoutUrl(null);
      }
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
        if (purchaseStatusRef.current !== null) {
          setPollExhausted(true);
        } else {
          setStatusCheckFailed(true);
        }
      }
    }

    void reconcileReturnedPurchase().finally(() => {
      clearTimeout(timeout);
      if (statusControllerRef.current === controller) {
        statusControllerRef.current = null;
      }
    });

    return () => {
      clearTimeout(timeout);
      controller.abort();
      if (statusControllerRef.current === controller) {
        statusControllerRef.current = null;
      }
    };
  }, [activePurchaseId, cancelReturnPurchaseId, open, refresh, statusCheckAttempt]);

  useEffect(() => {
    if (!open || !activePurchaseId || !recoveryRestartAt) {
      return;
    }

    const restartAtMs = Date.parse(recoveryRestartAt);
    const delayMs = restartAtMs - Date.now();
    const restart = () => {
      statusControllerRef.current?.abort();
      clientRequestKeyRef.current = null;
      purchaseStatusRef.current = null;
      setSelectedOfferCode(null);
      setHasCheckoutAttempt(false);
      setCheckoutError(null);
      setActivePurchaseId(null);
      setRecoveredCheckoutUrl(null);
      setRecoveryRestartAt(null);
      setRetryOfferCode(null);
      setPurchaseStatus(null);
      setPollExhausted(false);
      setStatusCheckFailed(false);
      refresh();
    };

    if (delayMs <= 0) {
      restart();
      return;
    }

    const timeout = setTimeout(restart, delayMs);
    return () => clearTimeout(timeout);
  }, [activePurchaseId, open, recoveryRestartAt, refresh]);

  function resetForNewAttempt() {
    clientRequestKeyRef.current = null;
    purchaseStatusRef.current = null;
    setSelectedOfferCode(null);
    setHasCheckoutAttempt(false);
    setCheckoutInFlight(false);
    setCheckoutError(null);
    setActivePurchaseId(null);
    setRecoveredCheckoutUrl(null);
    setRecoveryRestartAt(null);
    setRetryOfferCode(null);
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

  async function startCheckout(offerCode = selectedOffer?.offerCode ?? null) {
    if (!offerCode || checkoutInFlight) {
      return;
    }

    statusControllerRef.current?.abort();
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
          offerCode,
          clientRequestKey,
        },
        signal: controller.signal,
        url: CHECKOUT_URL,
      });
      const response = readPurchaseResponse(value);

      if (response.recovered) {
        setRetryOfferCode(response.retryAllowed ? offerCode : null);
        const checkoutUrl = response.url ? readCheckoutUrl(response.url) : null;
        if (response.status === "checkout_open" && !checkoutUrl) {
          throw new Error("Could not open Stripe right now. Try again.");
        }
        purchaseStatusRef.current = response.status;
        setPurchaseStatus(response.status);
        setRecoveryRestartAt(response.restartAt);
        setRecoveredCheckoutUrl(
          response.status === "checkout_open" ? checkoutUrl : null,
        );
        setPollExhausted(false);
        setStatusCheckFailed(false);
        setActivePurchaseId(response.purchaseId);
        if (shouldPollPurchaseStatus(response.status)) {
          setStatusCheckAttempt((attempt) => attempt + 1);
        }
        return;
      }

      if (response.url) {
        window.location.assign(readCheckoutUrl(response.url));
        return;
      }

      purchaseStatusRef.current = response.status;
      setRetryOfferCode(response.retryAllowed ? offerCode : null);
      setPurchaseStatus(response.status);
      setRecoveryRestartAt(response.restartAt);
      setPollExhausted(false);
      setStatusCheckFailed(false);
      setActivePurchaseId(response.purchaseId);
      if (shouldPollPurchaseStatus(response.status)) {
        setStatusCheckAttempt((attempt) => attempt + 1);
      }
    } catch (error) {
      setCheckoutError(
        isAbortError(error)
          ? "Checkout took too long to open. Try again."
          : toErrorMessage(error, "Could not open Stripe right now. Try again."),
      );
      const currentStatus = purchaseStatusRef.current;
      if (
        activePurchaseId !== null &&
        currentStatus !== null &&
        shouldPollPurchaseStatus(currentStatus)
      ) {
        setStatusCheckAttempt((attempt) => attempt + 1);
      }
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

  async function cancelRecoveredCheckout() {
    if (!activePurchaseId || checkoutInFlight) {
      return;
    }

    const purchaseId = activePurchaseId;
    setCheckoutInFlight(true);
    setCheckoutError(null);
    statusControllerRef.current?.abort();

    const controller = new AbortController();
    checkoutControllerRef.current = controller;
    const timeout = setTimeout(() => {
      controller.abort();
    }, CHECKOUT_REQUEST_TIMEOUT_MS);

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
      if (response.purchaseId !== purchaseId) {
        throw new Error("Could not cancel this checkout right now. Try again.");
      }

      purchaseStatusRef.current = response.status;
      setPurchaseStatus(response.status);
      setRecoveryRestartAt(response.restartAt);
      if (response.status !== "checkout_open") {
        setRecoveredCheckoutUrl(null);
      }
      setPollExhausted(false);
      setStatusCheckFailed(false);
      if (response.status === "fulfilled") {
        refreshPurchaseOnce(
          purchaseId,
          refreshedPurchaseIdsRef.current,
          refresh,
        );
      }
    } catch (error) {
      setCheckoutError(
        isAbortError(error)
          ? "Canceling checkout took too long. Try again."
          : toErrorMessage(
              error,
              "Could not cancel this checkout right now. Try again.",
            ),
      );
    } finally {
      clearTimeout(timeout);
      if (checkoutControllerRef.current === controller) {
        checkoutControllerRef.current = null;
      }
      setCheckoutInFlight(false);
      setStatusCheckAttempt((attempt) => attempt + 1);
    }
  }

  const showingPurchaseStatus = activePurchaseId !== null;
  const canResumeRecoveredCheckout =
    purchaseStatus === "checkout_open" && recoveredCheckoutUrl !== null;
  const canCancelRecoveredCheckout = purchaseStatus === "checkout_open";
  const canRetryCheckout =
    purchaseStatus === "reconciling" && retryOfferCode !== null;
  const statusContent = readStatusContent(
    purchaseStatus,
    pollExhausted,
    statusCheckFailed,
    canResumeRecoveredCheckout,
    canRetryCheckout,
    purchaseReturn?.kind === "success" &&
      purchaseReturn.purchaseId === activePurchaseId,
  );
  const canRetryStatusCheck =
    statusCheckFailed ||
    (pollExhausted &&
      (purchaseStatus === null || shouldPollPurchaseStatus(purchaseStatus)));
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {offers.length > 0 || activePurchaseId ? (
        <DialogTrigger render={<Button type="button" variant="outline" size="lg" />}>
          {activePurchaseId ? "Continue checkout" : "Add usage"}
        </DialogTrigger>
      ) : null}

      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto border border-border bg-popover p-5 sm:max-w-lg sm:p-6"
        showCloseButton={!checkoutInFlight}
      >
        <DialogHeader className="pr-10">
          <DialogTitle className="text-2xl leading-tight">
            {showingPurchaseStatus
              ? statusContent.title
              : offers.length === 0
                ? "Usage credit unavailable"
                : "Add usage"}
          </DialogTitle>
          <DialogDescription>
            {showingPurchaseStatus
              ? "Murph checks Stripe before changing your available usage."
              : offers.length === 0
                ? "There isn’t a usage-credit offer available for this account right now."
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
            <FieldError>{checkoutError}</FieldError>
            <div className="flex flex-col gap-2">
              {canResumeRecoveredCheckout ? (
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  disabled={checkoutInFlight}
                  onClick={() => {
                    window.location.assign(recoveredCheckoutUrl);
                  }}
                >
                  Resume checkout
                </Button>
              ) : null}
              {canCancelRecoveredCheckout ? (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full"
                  aria-busy={checkoutInFlight}
                  disabled={checkoutInFlight}
                  onClick={() => {
                    void cancelRecoveredCheckout();
                  }}
                >
                  {checkoutInFlight ? "Canceling checkout…" : "Cancel checkout"}
                </Button>
              ) : null}
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
              {canRetryCheckout ? (
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  aria-busy={checkoutInFlight}
                  disabled={checkoutInFlight}
                  onClick={() => {
                    void startCheckout(retryOfferCode);
                  }}
                >
                  {checkoutInFlight ? "Opening Stripe…" : "Retry checkout"}
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
        ) : offers.length === 0 ? (
          <div className="flex flex-col gap-5">
            <div className="rounded-2xl border border-border bg-muted/30 p-5">
              <p className="text-pretty text-sm leading-6 text-foreground">
                No purchase is available from this account at the moment.
              </p>
            </div>
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
                    id={`usage-top-up-${index}`}
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
    (value.recovered !== undefined && value.recovered !== true) ||
    (value.restartAt !== undefined &&
      (value.status !== "reconciling" || !isCanonicalIsoTimestamp(value.restartAt))) ||
    (value.retryAllowed !== undefined && value.retryAllowed !== true) ||
    (value.url !== undefined && value.url !== null && typeof value.url !== "string")
  ) {
    throw new Error("Could not open Stripe right now. Try again.");
  }

  return {
    purchaseId: value.purchaseId,
    recovered: value.recovered === true,
    restartAt: typeof value.restartAt === "string" ? value.restartAt : null,
    retryAllowed: value.retryAllowed === true,
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

function readStatusContent(
  status: HostedUsageTopUpPurchaseStatus | null,
  pollExhausted: boolean,
  statusCheckFailed: boolean,
  canResumeCheckout: boolean,
  canRetryCheckout: boolean,
  returnedFromSuccessfulCheckout: boolean,
): { message: string; title: string } {
  if (statusCheckFailed) {
    return {
      title: "Couldn't check payment",
      message: "We couldn't check this payment right now. Try again.",
    };
  }

  if (status === "checkout_open") {
    return canResumeCheckout
      ? {
          title: "Checkout already open",
          message:
            "You already have a usage-credit checkout in progress. Resume it or cancel it before starting a new one.",
        }
      : {
          title: "Checkout already open",
          message:
            "An existing usage-credit checkout is open, but it can’t be resumed from this account right now. You can cancel it.",
        };
  }

  if (pollExhausted && (!status || shouldPollPurchaseStatus(status))) {
    if (status === "reconciling" && !returnedFromSuccessfulCheckout) {
      return {
        title: "Checkout not open yet",
        message: canRetryCheckout
          ? "Stripe checkout still hasn’t opened. You can safely retry with the same purchase."
          : "This purchase is still being reconciled. Checkout is not available right now.",
      };
    }
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
    case null:
      return {
        title: "Confirming payment",
        message: "Confirming your payment with Stripe…",
      };
    case "reconciling":
      return returnedFromSuccessfulCheckout
        ? {
            title: "Confirming payment",
            message: "Confirming your payment with Stripe…",
          }
        : {
            title: "Checkout not open yet",
            message: canRetryCheckout
              ? "Stripe checkout hasn’t opened yet. You can safely retry with the same purchase."
              : "This purchase is still being reconciled. Checkout is not available right now.",
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
  HostedUsageTopUpActivePurchase,
  HostedUsageTopUpDialogProps,
  HostedUsageTopUpOffer,
  HostedUsageTopUpPurchaseStatus,
  HostedUsageTopUpReturn,
};
