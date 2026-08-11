import type Stripe from "stripe";

import { coerceStripeObjectId, coerceStripeSubscriptionId } from "./billing";
import { logHostedStripeFailure, withHostedStripeFailureLog } from "./stripe-error-log";

export interface HostedSubscriptionCheckoutTerminalState {
  customerId: string | null;
  status: "complete" | "expired";
  subscriptionId: string | null;
}

export async function retrieveAndExpireHostedSubscriptionCheckout(input: {
  sessionId: string;
  stripe: Stripe;
}): Promise<HostedSubscriptionCheckoutTerminalState> {
  let session;
  try {
    session = await withHostedStripeFailureLog(
      "checkout.sessions.retrieve.subscription-cleanup",
      () => input.stripe.checkout.sessions.retrieve(input.sessionId),
    );
  } catch (error) {
    if (isStripeResourceMissingError(error)) {
      return absentHostedSubscriptionCheckout();
    }
    throw error;
  }

  if (session.status === "open") {
    try {
      session = await input.stripe.checkout.sessions.expire(input.sessionId);
    } catch (error) {
      try {
        session = await withHostedStripeFailureLog(
          "checkout.sessions.retrieve.subscription-cleanup-after-expire",
          () => input.stripe.checkout.sessions.retrieve(input.sessionId),
        );
      } catch (retrieveError) {
        if (isStripeResourceMissingError(retrieveError)) {
          return absentHostedSubscriptionCheckout();
        }
        throw retrieveError;
      }
      if (session.status === "open") {
        logHostedStripeFailure({
          error,
          operationName: "checkout.sessions.expire.subscription-cleanup",
        });
        throw error;
      }
      logHostedStripeFailure({
        error,
        operationName: "checkout.sessions.expire.subscription-cleanup-race",
      });
    }
  }

  if (session.status !== "complete" && session.status !== "expired") {
    throw new TypeError("Stripe subscription Checkout did not reach a terminal state.");
  }

  return {
    customerId: coerceStripeObjectId(session.customer),
    status: session.status,
    subscriptionId: coerceStripeSubscriptionId(session.subscription),
  };
}

function absentHostedSubscriptionCheckout(): HostedSubscriptionCheckoutTerminalState {
  return {
    customerId: null,
    status: "expired",
    subscriptionId: null,
  };
}

export async function closeUnboundHostedSubscriptionCheckout(input: {
  deleteSessionCustomer: boolean;
  sessionId: string;
  stripe: Stripe;
}): Promise<void> {
  const terminal = await retrieveAndExpireHostedSubscriptionCheckout(input);
  if (terminal.status === "expired") {
    return;
  }

  if (!terminal.subscriptionId) {
    throw new TypeError(
      "Completed Stripe subscription Checkout is missing its subscription.",
    );
  }

  try {
    const subscription = await input.stripe.subscriptions.retrieve(
      terminal.subscriptionId,
    );
    if (
      subscription.status !== "canceled"
      && subscription.status !== "incomplete_expired"
    ) {
      await input.stripe.subscriptions.cancel(terminal.subscriptionId);
    }
  } catch (error) {
    if (!isStripeResourceMissingError(error)) {
      logHostedStripeFailure({
        error,
        operationName: "subscription.cancel.unbound-checkout",
      });
      throw error;
    }
  }

  if (input.deleteSessionCustomer && terminal.customerId) {
    try {
      await input.stripe.customers.del(terminal.customerId);
    } catch (error) {
      if (!isStripeResourceMissingError(error)) {
        logHostedStripeFailure({
          error,
          operationName: "customers.del.unbound-checkout",
        });
        throw error;
      }
    }
  }
}

export function isStripeResourceMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const type = Reflect.get(error, "type");
  return Reflect.get(error, "code") === "resource_missing"
    && typeof type === "string"
    && type.startsWith("Stripe");
}
