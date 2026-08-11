import {
  readOptionalCheckoutUrl,
  readOptionalRestartAt,
  shouldPollPurchaseStatus,
  type HostedUsageTopUpActivePurchase,
  type HostedUsageTopUpPurchaseResponse,
  type HostedUsageTopUpPurchaseStatus,
  type HostedUsageTopUpReturn,
} from "./hosted-usage-top-up-contract";

type HostedUsageTopUpSelectionAttempt =
  | { kind: "idle" }
  | { kind: "opening"; offerCode: string; requestKey: string }
  | {
      error: string | null;
      kind: "locked";
      offerCode: string;
      requestKey: string | null;
    };

interface HostedUsageTopUpPoll {
  kind: "dormant" | "checking" | "exhausted" | "failed";
  run: number;
}

interface HostedUsageTopUpSelectionScreen {
  attempt: HostedUsageTopUpSelectionAttempt;
  capacityConflict: boolean;
  kind: "selection";
  selectedOfferCode: string | null;
  unresolvedRequestKey: string | null;
}

interface HostedUsageTopUpPurchaseScreen {
  cancelAllowed: boolean;
  checkoutError: string | null;
  checkoutUrl: string | null;
  kind: "purchase";
  operation: "idle" | "opening_checkout" | "canceling_checkout";
  poll: HostedUsageTopUpPoll;
  purchaseId: string;
  restartAt: string | null;
  retryOfferCode: string | null;
  retryRequestKey: string | null;
  selectionConflict: HostedUsageTopUpPurchaseResponse["selectionConflict"];
  status: HostedUsageTopUpPurchaseStatus | null;
  targetConflict: boolean;
}

type HostedUsageTopUpScreen =
  | HostedUsageTopUpSelectionScreen
  | HostedUsageTopUpPurchaseScreen;
interface HostedUsageTopUpState {
  open: boolean;
  screen: HostedUsageTopUpScreen;
}

type HostedUsageTopUpAction =
  | { type: "close" }
  | { type: "open"; reset: boolean }
  | { type: "offer_selected"; offerCode: string }
  | { type: "amount_change_requested" }
  | { type: "capacity_conflict" }
  | {
      type: "selection_checkout_started";
      offerCode: string;
      requestKey: string;
    }
  | {
      type: "selection_checkout_failed";
      error: string;
      offerCode: string;
      requestKey: string | null;
    }
  | {
      type: "selection_checkout_redirected";
      offerCode: string;
      requestKey: string;
    }
  | {
      type: "checkout_recovery_missed";
      offerCode: string;
      requestKey: string;
    }
  | {
      type: "purchase_checkout_started";
      purchaseId: string;
      requestKey: string;
    }
  | { type: "purchase_checkout_failed"; error: string; purchaseId: string }
  | {
      type: "purchase_checkout_finished";
      pollRun: number;
      purchaseId: string;
      restartPoll: boolean;
    }
  | { type: "purchase_cancel_started"; purchaseId: string }
  | { type: "purchase_cancel_failed"; error: string; purchaseId: string }
  | {
      type: "purchase_cancel_finished";
      pollRun: number;
      purchaseId: string;
    }
  | { type: "poll_started"; purchaseId: string; run: number }
  | { type: "poll_failed"; purchaseId: string; run: number }
  | {
      type: "poll_exhausted";
      observedStatus: boolean;
      purchaseId: string;
      run: number;
    }
  | { type: "poll_retry_requested"; purchaseId: string }
  | { type: "redirect_page_restored" }
  | {
      type: "checkout_response";
      offerCode: string;
      requestKey: string;
      response: HostedUsageTopUpPurchaseResponse;
    }
  | {
      type: "poll_response";
      purchaseId: string;
      response: HostedUsageTopUpPurchaseResponse;
    }
  | { type: "purchase_return"; purchaseId: string }
  | { type: "recovery_expired"; purchaseId: string };

function createHostedUsageTopUpState(input: {
  activePurchase: HostedUsageTopUpActivePurchase | null;
  initialCapacityConflict: boolean;
  initialOpen: boolean;
  purchaseReturn: HostedUsageTopUpReturn | null;
}): HostedUsageTopUpState {
  const activePurchase = input.purchaseReturn ? null : input.activePurchase;
  const purchaseId =
    input.purchaseReturn?.purchaseId ?? activePurchase?.purchaseId ?? null;
  if (!purchaseId) {
    return {
      open: input.initialOpen,
      screen: createSelectionScreen(null, input.initialCapacityConflict),
    };
  }
  const status = input.purchaseReturn
    ? null
    : activePurchase?.status ?? null;
  return {
    open: input.purchaseReturn !== null || input.initialOpen,
    screen: {
      ...createPurchaseScreen(purchaseId),
      cancelAllowed: activePurchase?.cancelAllowed === true,
      checkoutUrl:
        status === "checkout_open" &&
        activePurchase?.targetConflict !== true &&
        activePurchase?.url
          ? readOptionalCheckoutUrl(activePurchase.url)
          : null,
      restartAt:
        status === "reconciling"
          ? readOptionalRestartAt(activePurchase?.restartAt)
          : null,
      retryOfferCode:
        (status === "reconciling" || status === "payment_pending") &&
        activePurchase?.targetConflict !== true &&
        activePurchase?.retryAllowed
          ? activePurchase.offerCode
          : null,
      status,
      targetConflict: activePurchase?.targetConflict === true,
    },
  };
}

function hostedUsageTopUpReducer(
  state: HostedUsageTopUpState,
  action: HostedUsageTopUpAction,
): HostedUsageTopUpState {
  switch (action.type) {
    case "close":
      return state.open ? { ...state, open: false } : state;
    case "open":
      return {
        ...state,
        open: true,
        screen: action.reset
          ? createSelectionScreen()
          : state.screen,
      };
    case "offer_selected":
      return updateSelectionScreen(state, (screen) =>
        screen.attempt.kind === "idle" && !screen.capacityConflict
          ? { ...screen, selectedOfferCode: action.offerCode }
          : screen,
      );
    case "amount_change_requested":
      return updateSelectionScreen(state, () =>
        createSelectionScreen(),
      );
    case "capacity_conflict":
      return { ...state, screen: createSelectionScreen(null, true) };
    case "selection_checkout_started":
      return updateSelectionScreen(state, (screen) => ({
        ...screen,
        attempt: {
          kind: "opening",
          offerCode: action.offerCode,
          requestKey: action.requestKey,
        },
      }));
    case "selection_checkout_failed":
      return updateSelectionScreen(state, (screen) => ({
        ...screen,
        attempt: {
          error: action.error,
          kind: "locked",
          offerCode: action.offerCode,
          requestKey: action.requestKey,
        },
      }));
    case "selection_checkout_redirected":
      return updateSelectionScreen(state, (screen) => ({
        ...screen,
        attempt: {
          error: null,
          kind: "locked",
          offerCode: action.offerCode,
          requestKey: action.requestKey,
        },
      }));
    case "checkout_recovery_missed":
      return applyCheckoutRecoveryMiss(state, action);
    case "purchase_checkout_started":
      return updatePurchaseScreen(state, action.purchaseId, (screen) => ({
        ...screen,
        checkoutError: null,
        operation: "opening_checkout",
        retryRequestKey: action.requestKey,
      }));
    case "purchase_checkout_failed":
      return updatePurchaseScreen(state, action.purchaseId, (screen) => ({
        ...screen,
        checkoutError: action.error,
      }));
    case "purchase_checkout_finished":
      return updatePurchaseScreen(state, action.purchaseId, (screen) => ({
        ...screen,
        operation: "idle",
        poll: action.restartPoll
          ? createPoll(action.pollRun + 1)
          : screen.poll,
      }));
    case "purchase_cancel_started":
      return updatePurchaseScreen(state, action.purchaseId, (screen) => ({
        ...screen,
        checkoutError: null,
        operation: "canceling_checkout",
      }));
    case "purchase_cancel_failed":
      return updatePurchaseScreen(state, action.purchaseId, (screen) => ({
        ...screen,
        checkoutError: action.error,
      }));
    case "purchase_cancel_finished":
      return updatePurchaseScreen(state, action.purchaseId, (screen) => ({
        ...screen,
        operation: "idle",
        poll: createPoll(action.pollRun + 1),
      }));
    case "poll_started":
      return updatePurchaseScreen(state, action.purchaseId, (screen) => ({
        ...screen,
        poll: { kind: "checking", run: action.run },
      }));
    case "poll_failed":
      return updatePurchaseScreen(state, action.purchaseId, (screen) => ({
        ...screen,
        poll: { kind: "failed", run: action.run },
      }));
    case "poll_exhausted":
      return updatePurchaseScreen(state, action.purchaseId, (screen) => ({
        ...screen,
        poll: {
          kind: action.observedStatus ? "exhausted" : "failed",
          run: action.run,
        },
      }));
    case "poll_retry_requested":
      return updatePurchaseScreen(state, action.purchaseId, (screen) => ({
        ...screen,
        poll: createPoll(screen.poll.run + 1),
      }));
    case "redirect_page_restored":
      return updateSelectionScreen(state, (screen) =>
        screen.attempt.kind === "locked" && screen.attempt.error === null
          ? {
              ...screen,
              attempt: {
                ...screen.attempt,
                error: "Checkout was interrupted. Retry to recover it.",
              },
            }
          : screen,
      );
    case "checkout_response":
      return applyCheckoutResponse(state, action);
    case "poll_response":
      if (
        state.screen.kind !== "purchase" ||
        state.screen.purchaseId !== action.purchaseId ||
        action.response.purchaseId !== action.purchaseId
      ) {
        return state;
      }
      return {
        ...state,
        screen: screenFromResponse(
          state.screen,
          action.response,
          state.screen.retryOfferCode,
          state.screen.retryRequestKey,
          false,
        ),
      };
    case "purchase_return":
      return {
        ...state,
        open: true,
        screen: createPurchaseScreen(action.purchaseId),
      };
    case "recovery_expired":
      return state.screen.kind === "purchase" &&
        state.screen.purchaseId === action.purchaseId
        ? {
            ...state,
            screen: createSelectionScreen(),
          }
        : state;
  }
}

function updateSelectionScreen(
  state: HostedUsageTopUpState,
  update: (
    screen: HostedUsageTopUpSelectionScreen,
  ) => HostedUsageTopUpSelectionScreen,
): HostedUsageTopUpState {
  if (state.screen.kind !== "selection") {
    return state;
  }
  const screen = update(state.screen);
  return screen === state.screen ? state : { ...state, screen };
}

function updatePurchaseScreen(
  state: HostedUsageTopUpState,
  purchaseId: string,
  update: (
    screen: HostedUsageTopUpPurchaseScreen,
  ) => HostedUsageTopUpPurchaseScreen,
): HostedUsageTopUpState {
  if (
    state.screen.kind !== "purchase" ||
    state.screen.purchaseId !== purchaseId
  ) {
    return state;
  }
  return { ...state, screen: update(state.screen) };
}

function applyCheckoutResponse(
  state: HostedUsageTopUpState,
  action: Extract<HostedUsageTopUpAction, { type: "checkout_response" }>,
): HostedUsageTopUpState {
  const previous = state.screen.kind === "purchase" ? state.screen : null;
  const selectionMatches =
    state.screen.kind === "selection" &&
    state.screen.attempt.kind === "opening" &&
    state.screen.attempt.offerCode === action.offerCode &&
    state.screen.attempt.requestKey === action.requestKey;
  const purchaseMatches =
    previous?.operation === "opening_checkout" &&
    previous.retryOfferCode === action.offerCode &&
    previous.retryRequestKey === action.requestKey;
  if (!selectionMatches && !purchaseMatches) {
    return state;
  }
  return {
    ...state,
    screen: screenFromResponse(
      previous,
      action.response,
      action.response.retryAllowed ? action.offerCode : null,
      action.requestKey,
      true,
    ),
  };
}

function applyCheckoutRecoveryMiss(
  state: HostedUsageTopUpState,
  action: Extract<
    HostedUsageTopUpAction,
    { type: "checkout_recovery_missed" }
  >,
): HostedUsageTopUpState {
  const selectionMatches =
    state.screen.kind === "selection" &&
    state.screen.attempt.kind === "opening" &&
    state.screen.attempt.offerCode === action.offerCode &&
    state.screen.attempt.requestKey === action.requestKey;
  const purchaseMatches =
    state.screen.kind === "purchase" &&
    state.screen.operation === "opening_checkout" &&
    state.screen.retryOfferCode === action.offerCode &&
    state.screen.retryRequestKey === action.requestKey;
  return selectionMatches || purchaseMatches
    ? { ...state, screen: createSelectionScreen(action.requestKey) }
    : state;
}

function screenFromResponse(
  previous: HostedUsageTopUpPurchaseScreen | null,
  response: HostedUsageTopUpPurchaseResponse,
  retryOfferCode: string | null,
  retryRequestKey: string | null,
  requestAnotherPoll: boolean,
): HostedUsageTopUpPurchaseScreen {
  const previousPoll = previous?.poll ?? createPoll();
  const responseUrl = response.url
    ? readOptionalCheckoutUrl(response.url)
    : null;
  return {
    ...createPurchaseScreen(response.purchaseId),
    cancelAllowed: response.cancelAllowed,
    checkoutUrl:
      !response.selectionConflict &&
      !response.targetConflict &&
      response.status === "checkout_open"
        ? responseUrl ?? previous?.checkoutUrl ?? null
        : null,
    poll:
      shouldPollPurchaseStatus(response.status) && requestAnotherPoll
        ? createPoll(previousPoll.run + 1)
        : shouldPollPurchaseStatus(response.status)
          ? previousPoll
          : createPoll(previousPoll.run),
    restartAt: response.status === "reconciling" ? response.restartAt : null,
    retryOfferCode:
      response.selectionConflict || response.targetConflict
        ? null
        : retryOfferCode,
    retryRequestKey:
      response.selectionConflict || response.targetConflict || !retryOfferCode
        ? null
        : retryRequestKey,
    selectionConflict:
      response.selectionConflict ?? previous?.selectionConflict ?? null,
    status: response.status,
    targetConflict: response.targetConflict || previous?.targetConflict === true,
  };
}

function createSelectionScreen(
  unresolvedRequestKey: string | null = null,
  capacityConflict = false,
): HostedUsageTopUpSelectionScreen {
  return {
    attempt: { kind: "idle" },
    capacityConflict,
    kind: "selection",
    selectedOfferCode: null,
    unresolvedRequestKey,
  };
}

function createPurchaseScreen(
  purchaseId: string,
): HostedUsageTopUpPurchaseScreen {
  return {
    cancelAllowed: false,
    checkoutError: null,
    checkoutUrl: null,
    kind: "purchase",
    operation: "idle",
    poll: createPoll(),
    purchaseId,
    restartAt: null,
    retryOfferCode: null,
    retryRequestKey: null,
    selectionConflict: null,
    status: null,
    targetConflict: false,
  };
}

function createPoll(run = 0): HostedUsageTopUpPoll {
  return { kind: "dormant", run };
}

export { createHostedUsageTopUpState, hostedUsageTopUpReducer };
