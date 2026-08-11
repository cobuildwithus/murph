"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import {
  stripSettingsQueryParams,
  toErrorMessage,
} from "@/src/components/settings/hosted-settings-utils";
import {
  HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE,
} from "@/src/lib/hosted-onboarding/usage-credit-capacity-conflict";

import {
  createClientRequestKey,
  readCheckoutAttemptResponse,
  readCheckoutUrl,
  readPurchaseResponse,
  readReturnKey,
  shouldPollPurchaseStatus,
  type HostedUsageTopUpDialogProps,
} from "./hosted-usage-top-up-contract";
import {
  createHostedUsageTopUpState,
  hostedUsageTopUpReducer,
} from "./hosted-usage-top-up-state";
import {
  clearHostedUsageTopUpRequestIdentity,
  readHostedUsageTopUpRequestIdentity,
  writeHostedUsageTopUpRequestIdentity,
} from "./hosted-usage-top-up-request-identity";

const CHECKOUT_URL = "/api/settings/billing/usage-credit/checkout";
const CHECKOUT_REQUEST_TIMEOUT_MS = 20_000;
const MAX_STATUS_READS = 10;
const STATUS_CHECK_ATTEMPT_TIMEOUT_MS = 30_000;
const STATUS_POLL_INTERVAL_MS = 1_250;

type CheckoutAbortReason = "dismissed" | "timeout" | null;

interface OwnedCheckoutRequest {
  abortReason: CheckoutAbortReason;
  controller: AbortController;
}

interface HostedUsageTopUpRequestIdentitySnapshot {
  available: boolean;
  checkoutUrl: string | null;
  payerMemberId: string | null;
  requestKey: string | null;
}

function useHostedUsageTopUpDialog({
  activePurchase = null,
  buildCheckoutPayload,
  checkoutUrl = CHECKOUT_URL,
  deferTerminalRefreshUntilClose = false,
  groupPaymentMode,
  initialCheckoutErrorCode,
  initialOpen = false,
  inert = false,
  offers,
  payerMemberId,
  purchaseReturn = null,
}: HostedUsageTopUpDialogProps) {
  const { refresh } = useRouter();
  const [state, dispatch] = useReducer(
    hostedUsageTopUpReducer,
    {
      activePurchase,
      initialCapacityConflict:
        inert &&
        initialCheckoutErrorCode === HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE,
      initialOpen,
      purchaseReturn,
    },
    createHostedUsageTopUpState,
  );
  const checkoutRequestRef = useRef<OwnedCheckoutRequest | null>(null);
  const statusControllerRef = useRef<AbortController | null>(null);
  const refreshedPurchaseIdsRef = useRef(new Set<string>());
  const handledReturnKeyRef = useRef(readReturnKey(purchaseReturn));
  const cleanedQueryKeyRef = useRef<string | null>(null);
  const [requestIdentity, setRequestIdentity] =
    useState<HostedUsageTopUpRequestIdentitySnapshot>({
      available: false,
      checkoutUrl: null,
      payerMemberId: null,
      requestKey: null,
    });
  const returnKey = readReturnKey(purchaseReturn);
  const cancelReturnPurchaseId =
    purchaseReturn?.kind === "cancel" ? purchaseReturn.purchaseId : null;
  const selectedOfferCode =
    state.screen.kind === "selection" && !state.screen.capacityConflict
      ? state.screen.selectedOfferCode ??
        (groupPaymentMode === "monthly" ? offers[0]?.offerCode ?? null : null)
      : null;
  const selectedOffer =
    offers.find((offer) => offer.offerCode === selectedOfferCode) ?? null;
  const checkoutInFlight =
    state.screen.kind === "selection"
      ? state.screen.attempt.kind === "opening" ||
        (state.screen.attempt.kind === "locked" &&
          state.screen.attempt.error === null)
      : state.screen.operation !== "idle";
  const requestIdentityReady =
    requestIdentity.available &&
    requestIdentity.checkoutUrl === checkoutUrl &&
    requestIdentity.payerMemberId === payerMemberId;
  const requestIdentityError =
    state.screen.kind === "selection" &&
    requestIdentity.checkoutUrl === checkoutUrl &&
    requestIdentity.payerMemberId === payerMemberId &&
    !requestIdentity.available
      ? "This browser tab can’t safely start a payment. Open this page in a regular tab and try again."
      : null;

  function refreshPurchaseOnce(purchaseId: string) {
    // A recovery-only host has no trigger after terminal reconciliation. Keep
    // its confirmation visible until the owner closes it, then refresh away
    // the host instead of unmounting the result immediately.
    if (deferTerminalRefreshUntilClose) {
      return;
    }
    if (refreshedPurchaseIdsRef.current.has(purchaseId)) {
      return;
    }
    refreshedPurchaseIdsRef.current.add(purchaseId);
    refresh();
  }

  function beginOwnedCheckoutRequest() {
    const request: OwnedCheckoutRequest = {
      abortReason: null,
      controller: new AbortController(),
    };
    checkoutRequestRef.current = request;
    const timeout = setTimeout(() => {
      request.abortReason = "timeout";
      request.controller.abort();
    }, CHECKOUT_REQUEST_TIMEOUT_MS);
    return {
      request,
      finish() {
        clearTimeout(timeout);
        if (checkoutRequestRef.current === request) {
          checkoutRequestRef.current = null;
        }
      },
    };
  }

  async function runOwnedCheckoutRequest<T>(
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<
    | { ok: true; value: T }
    | { abortReason: CheckoutAbortReason; error: unknown; ok: false }
  > {
    const owned = beginOwnedCheckoutRequest();
    try {
      const value = await run(owned.request.controller.signal);
      if (owned.request.controller.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return { ok: true, value };
    } catch (error) {
      return { abortReason: owned.request.abortReason, error, ok: false };
    } finally {
      owned.finish();
    }
  }

  useEffect(() => {
    const queryKeys = [
      ...(initialOpen ? ["addUsage"] : []),
      ...(purchaseReturn
        ? ["usagePurchase", "usageCheckout", "usageFamily", "usageMember"]
        : []),
    ];
    const cleanupKey = `${queryKeys.join(":")}:${returnKey ?? ""}`;
    if (queryKeys.length === 0 || cleanedQueryKeyRef.current === cleanupKey) {
      return;
    }
    cleanedQueryKeyRef.current = cleanupKey;
    stripSettingsQueryParams(queryKeys);
  }, [initialOpen, purchaseReturn, returnKey]);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (canceled) {
        return;
      }
      const storedIdentity =
        readHostedUsageTopUpRequestIdentity({ checkoutUrl, payerMemberId });
      setRequestIdentity({
        ...storedIdentity,
        checkoutUrl,
        payerMemberId,
      });
    });
    return () => {
      canceled = true;
    };
  }, [checkoutUrl, payerMemberId]);

  useEffect(() => {
    if (!purchaseReturn) {
      handledReturnKeyRef.current = null;
      return;
    }
    if (handledReturnKeyRef.current === returnKey) {
      return;
    }
    handledReturnKeyRef.current = returnKey;
    dispatch({ type: "purchase_return", purchaseId: purchaseReturn.purchaseId });
  }, [purchaseReturn, returnKey]);

  useEffect(
    () => () => {
      checkoutRequestRef.current?.controller.abort();
      statusControllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        dispatch({ type: "redirect_page_restored" });
      }
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const pollingScreen = state.screen.kind === "purchase" ? state.screen : null;
  const pollPurchaseId = pollingScreen?.purchaseId ?? null;
  const pollRun = pollingScreen?.poll.run ?? 0;
  const pollInitialStatus = pollingScreen?.status ?? null;

  useEffect(() => {
    if (!state.open || !pollPurchaseId) {
      return;
    }
    if (pollInitialStatus && !shouldPollPurchaseStatus(pollInitialStatus)) {
      if (pollInitialStatus === "fulfilled") {
        refreshPurchaseOnce(pollPurchaseId);
      }
      return;
    }

    const purchaseId = pollPurchaseId;
    const run = pollRun;
    const controller = new AbortController();
    statusControllerRef.current = controller;
    dispatch({ type: "poll_started", purchaseId, run });
    const timeout = setTimeout(() => {
      dispatch({ type: "poll_failed", purchaseId, run });
      controller.abort();
    }, STATUS_CHECK_ATTEMPT_TIMEOUT_MS);

    async function reconcilePurchase() {
      let latestStatus = pollInitialStatus;
      async function readStatus(expire = false) {
        try {
          const value = await requestHostedOnboardingJson<unknown>({
            ...(expire
              ? {
                  credentials: "same-origin" as const,
                  headers: { accept: "application/json" },
                }
              : {}),
            method: expire ? "POST" : "GET",
            signal: controller.signal,
            url: expire
              ? purchaseExpireUrl(purchaseId)
              : purchaseStatusUrl(purchaseId),
          });
          const response = readPurchaseResponse(value);
          if (
            response.purchaseId !== purchaseId ||
            controller.signal.aborted
          ) {
            return controller.signal.aborted;
          }
          latestStatus = response.status;
          dispatch({ type: "poll_response", purchaseId, response });
          if (response.status === "fulfilled") {
            refreshPurchaseOnce(purchaseId);
          }
          return !shouldPollPurchaseStatus(response.status);
        } catch (error) {
          return controller.signal.aborted || isAbortError(error);
        }
      }

      if (
        cancelReturnPurchaseId === purchaseId &&
        (await readStatus(true))
      ) {
        return;
      }
      for (let readIndex = 0; readIndex < MAX_STATUS_READS; readIndex += 1) {
        if (readIndex > 0) {
          await waitForNextStatusRead(controller.signal);
        }
        if (controller.signal.aborted) {
          return;
        }
        if (await readStatus()) {
          return;
        }
      }

      if (!controller.signal.aborted) {
        dispatch({
          type: "poll_exhausted",
          observedStatus: latestStatus !== null,
          purchaseId,
          run,
        });
      }
    }

    void reconcilePurchase().finally(() => {
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
    // A run token owns one bounded poll. Status updates inside that run must not
    // restart it and silently reset its read limit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelReturnPurchaseId, pollPurchaseId, pollRun, refresh, state.open]);

  const recoveryRestartAt = pollingScreen?.restartAt ?? null;
  useEffect(() => {
    if (!state.open || !pollPurchaseId || !recoveryRestartAt) {
      return;
    }
    const delayMs = Date.parse(recoveryRestartAt) - Date.now();
    const restart = () => {
      statusControllerRef.current?.abort();
      dispatch({ type: "recovery_expired", purchaseId: pollPurchaseId });
      refresh();
    };
    if (delayMs <= 0) {
      restart();
      return;
    }
    const timeout = setTimeout(restart, delayMs);
    return () => clearTimeout(timeout);
  }, [pollPurchaseId, recoveryRestartAt, refresh, state.open]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      const refreshOnClose = state.screen.kind === "purchase" && (
        state.screen.targetConflict ||
        (deferTerminalRefreshUntilClose &&
          state.screen.status !== null &&
          !shouldPollPurchaseStatus(state.screen.status))
      );
      const request = checkoutRequestRef.current;
      if (request) {
        request.abortReason = "dismissed";
        request.controller.abort();
      }
      statusControllerRef.current?.abort();
      dispatch({ type: "close" });
      if (refreshOnClose) {
        refresh();
      }
      return;
    }

    const reset =
      state.screen.kind === "purchase"
        ? state.screen.status !== null &&
          !shouldPollPurchaseStatus(state.screen.status)
        : state.screen.attempt.kind === "idle" &&
          state.screen.unresolvedRequestKey === null;
    dispatch({ type: "open", reset });
  }

  function selectOffer(offerCode: string) {
    if (
      requestIdentityReady &&
      state.screen.kind === "selection" &&
      !state.screen.capacityConflict &&
      state.screen.attempt.kind === "idle" &&
      offers.some((offer) => offer.offerCode === offerCode)
    ) {
      dispatch({ type: "offer_selected", offerCode });
    }
  }

  function changeAmount() {
    dispatch({ type: "amount_change_requested" });
  }

  async function startCheckout(offerCode = selectedOffer?.offerCode ?? null) {
    if (
      !offerCode ||
      checkoutInFlight ||
      checkoutRequestRef.current ||
      (state.screen.kind === "selection" &&
        (state.screen.capacityConflict || !requestIdentityReady))
    ) {
      return;
    }
    const sourceScreen = state.screen;
    const recoveryRequestKey =
      sourceScreen.kind === "selection"
        ? sourceScreen.attempt.kind === "locked" &&
          sourceScreen.attempt.offerCode === offerCode
          ? sourceScreen.attempt.requestKey
          : null
        : sourceScreen.retryOfferCode === offerCode
          ? sourceScreen.retryRequestKey
          : null;
    const recoveryOnly =
      sourceScreen.kind === "purchase" || recoveryRequestKey !== null;
    const unresolvedRequestKey =
      sourceScreen.kind === "selection"
        ? sourceScreen.unresolvedRequestKey
        : null;
    const storedRequestKey =
      sourceScreen.kind === "selection" &&
      requestIdentity.checkoutUrl === checkoutUrl &&
      requestIdentity.payerMemberId === payerMemberId
        ? requestIdentity.requestKey
        : null;

    let requestKey: string;
    try {
      requestKey =
        recoveryRequestKey ??
        unresolvedRequestKey ??
        storedRequestKey ??
        createClientRequestKey();
    } catch {
      const message = "Try again, or choose another amount.";
      if (sourceScreen.kind === "selection") {
        dispatch({
          type: "selection_checkout_failed",
          error: message,
          offerCode,
          requestKey: null,
        });
      } else {
        dispatch({
          type: "purchase_checkout_failed",
          error: message,
          purchaseId: sourceScreen.purchaseId,
        });
      }
      return;
    }

    if (
      sourceScreen.kind === "selection" &&
      !writeHostedUsageTopUpRequestIdentity(
        { checkoutUrl, payerMemberId },
        requestKey,
      )
    ) {
      setRequestIdentity({
        available: false,
        checkoutUrl,
        payerMemberId,
        requestKey: null,
      });
      dispatch({
        type: "selection_checkout_failed",
        error:
          "This browser tab can’t safely start a payment. Open this page in a regular tab and try again.",
        offerCode,
        requestKey: null,
      });
      return;
    }
    if (sourceScreen.kind === "selection") {
      setRequestIdentity({
        available: true,
        checkoutUrl,
        payerMemberId,
        requestKey,
      });
    }

    statusControllerRef.current?.abort();
    if (sourceScreen.kind === "selection") {
      dispatch({
        type: "selection_checkout_started",
        offerCode,
        requestKey,
      });
    } else {
      dispatch({
        type: "purchase_checkout_started",
        purchaseId: sourceScreen.purchaseId,
        requestKey,
      });
    }

    const outcome = await runOwnedCheckoutRequest(async (signal) => {
      const payload = buildCheckoutPayload?.({
        clientRequestKey: requestKey,
        offerCode,
      }) ?? { offerCode, clientRequestKey: requestKey };
      const value = await requestHostedOnboardingJson<unknown>({
        method: "POST",
        payload: {
          ...payload,
          ...(recoveryOnly ? { recoveryOnly: true } : {}),
        },
        signal,
        url: checkoutUrl,
      });
      const response = readCheckoutAttemptResponse(value);
      if ("recoveryMiss" in response) {
        if (!recoveryOnly) {
          throw new Error("Checkout didn’t open. Try again.");
        }
        return { kind: "recovery_miss" as const };
      }
      const resolvedCheckoutUrl = response.url ? readCheckoutUrl(response.url) : null;
      if (
        response.recovered
        && response.status === "checkout_open"
        && !resolvedCheckoutUrl
        && !response.selectionConflict
        && !response.targetConflict
      ) {
        throw new Error("Checkout didn’t open. Try again.");
      }
      return {
        checkoutUrl: resolvedCheckoutUrl,
        kind: "purchase" as const,
        response,
      };
    });

    if (outcome.ok) {
      if (outcome.value.kind === "recovery_miss") {
        dispatch({
          type: "checkout_recovery_missed",
          offerCode,
          requestKey,
        });
      } else {
        const {
          checkoutUrl: resolvedCheckoutUrl,
          response,
        } = outcome.value;
        // Recovery may project another active purchase. Only exact server proof
        // resolves the tab's ambiguous create-capable identity.
        if (
          sourceScreen.kind === "selection" &&
          response.requestKeyMatched
        ) {
          const identityCleared =
            clearHostedUsageTopUpRequestIdentity({
              checkoutUrl,
              payerMemberId,
            });
          setRequestIdentity({
            available: identityCleared,
            checkoutUrl,
            payerMemberId,
            requestKey: null,
          });
        }
        if (response.recovered || !resolvedCheckoutUrl) {
          dispatch({
            type: "checkout_response",
            offerCode,
            requestKey,
            response: { ...response, url: resolvedCheckoutUrl },
          });
        } else {
          window.location.assign(resolvedCheckoutUrl);
          if (sourceScreen.kind === "selection") {
            dispatch({
              type: "selection_checkout_redirected",
              offerCode,
              requestKey,
            });
          }
        }
      }
    } else {
      if (isHostedUsageCreditCapacityConflict(outcome.error)) {
        dispatch({ type: "capacity_conflict" });
      } else {
        const message = checkoutErrorMessage(
          outcome.error,
          outcome.abortReason,
        );
        if (sourceScreen.kind === "selection") {
          dispatch({
            type: "selection_checkout_failed",
            error: message,
            offerCode,
            requestKey,
          });
        } else {
          dispatch({
            type: "purchase_checkout_failed",
            error: message,
            purchaseId: sourceScreen.purchaseId,
          });
        }
      }
    }

    if (sourceScreen.kind === "purchase") {
      dispatch({
        type: "purchase_checkout_finished",
        pollRun: sourceScreen.poll.run,
        purchaseId: sourceScreen.purchaseId,
        restartPoll:
          sourceScreen.status === null ||
          shouldPollPurchaseStatus(sourceScreen.status),
      });
    }
  }

  async function cancelRecoveredCheckout() {
    if (
      state.screen.kind !== "purchase" ||
      checkoutInFlight ||
      checkoutRequestRef.current
    ) {
      return;
    }
    const sourceScreen = state.screen;
    const purchaseId = sourceScreen.purchaseId;
    statusControllerRef.current?.abort();
    dispatch({ type: "purchase_cancel_started", purchaseId });
    const outcome = await runOwnedCheckoutRequest(async (signal) => {
      const value = await requestHostedOnboardingJson<unknown>({
        credentials: "same-origin",
        headers: { accept: "application/json" },
        method: "POST",
        signal,
        url: purchaseExpireUrl(purchaseId),
      });
      const response = readCancelPurchaseResponse(value);
      if (response.purchaseId !== purchaseId) {
        throw new Error("Could not cancel this checkout right now. Try again.");
      }
      return response;
    });

    if (outcome.ok) {
      const response = outcome.value;
      dispatch({ type: "poll_response", purchaseId, response });
      if (response.status === "fulfilled") {
        refreshPurchaseOnce(purchaseId);
      }
    } else {
      dispatch({
        type: "purchase_cancel_failed",
        error: cancelErrorMessage(outcome.error, outcome.abortReason),
        purchaseId,
      });
    }
    dispatch({
      type: "purchase_cancel_finished",
      pollRun: sourceScreen.poll.run,
      purchaseId,
    });
  }

  function retryStatusCheck() {
    if (state.screen.kind !== "purchase") {
      return;
    }
    dispatch({
      type: "poll_retry_requested",
      purchaseId: state.screen.purchaseId,
    });
  }

  return {
    cancelRecoveredCheckout,
    changeAmount,
    checkoutInFlight,
    handleOpenChange,
    requestIdentityError,
    requestIdentityReady,
    retryStatusCheck,
    selectedOffer,
    selectOffer,
    startCheckout,
    state,
  };
}

function checkoutErrorMessage(
  error: unknown,
  abortReason: CheckoutAbortReason,
): string {
  if (isAbortError(error)) {
    return abortReason === "dismissed"
      ? "Checkout was interrupted. Retry to recover it."
      : "Checkout took too long to open. Try again.";
  }
  return "Try again, or choose another amount.";
}

function isHostedUsageCreditCapacityConflict(error: unknown): boolean {
  return (
    error instanceof HostedOnboardingApiError &&
    error.code === HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE
  );
}

function cancelErrorMessage(
  error: unknown,
  abortReason: CheckoutAbortReason,
): string {
  if (isAbortError(error)) {
    return abortReason === "dismissed"
      ? "Canceling checkout was interrupted. Murph will check its current status."
      : "Canceling checkout took too long. Try again.";
  }
  return toErrorMessage(
    error,
    "Could not cancel this checkout right now. Try again.",
  );
}

function readCancelPurchaseResponse(value: unknown) {
  try {
    return readPurchaseResponse(value);
  } catch {
    throw new Error("Could not cancel this checkout right now. Try again.");
  }
}

function purchaseStatusUrl(purchaseId: string): string {
  return `/api/settings/billing/usage-credit/purchases/${encodeURIComponent(purchaseId)}`;
}

function purchaseExpireUrl(purchaseId: string): string {
  return `${purchaseStatusUrl(purchaseId)}/expire`;
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export { useHostedUsageTopUpDialog };
