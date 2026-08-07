import "server-only";

import { after } from "next/server";

import { sha256Hex } from "../primitives";
import { sanitizeHostedOnboardingLogString } from "./http";
import { readHostedOperationalAlertEmailConfig } from "./operational-alert-email-config";
import {
  HostedResendPlainTextEmailError,
  sendHostedResendPlainTextEmail,
} from "./resend-plain-text-email";
import type { HostedStripeErrorFields } from "./stripe-error-log";

const HOSTED_STRIPE_ALERT_OPERATION_MAX_LENGTH = 120;
const HOSTED_STRIPE_ALERT_TOKEN_PATTERN = /^[A-Za-z0-9_.\-[\]]{1,120}$/u;
const HOSTED_STRIPE_ALERT_EVENT_ID_PATTERN = /^evt_[A-Za-z0-9_-]{1,128}$/u;
const HOSTED_STRIPE_ALERT_REQUEST_ID_PATTERN = /^req_[A-Za-z0-9_-]{1,64}$/u;
const HOSTED_STRIPE_ALERT_OPERATION_CORRELATION_PATTERN =
  /^stripe_op_[a-f0-9]{24}$/u;
const HOSTED_STRIPE_PAYMENT_FAILURE_EVENT_TYPES = new Set([
  "checkout.session.async_payment_failed",
  "invoice.finalization_failed",
  "invoice.payment_failed",
  "payment_intent.payment_failed",
]);

export type HostedStripeAlertEmailOutcome =
  | "ignored_event"
  | "not_configured"
  | "sent";

type HostedStripeAlertEmailSend = typeof sendHostedResendPlainTextEmail;

export function scheduleHostedStripeOperationFailureAlert(input: {
  fields: HostedStripeErrorFields;
  operationCorrelationId: string;
  operationName: string;
  stripeLiveMode: boolean;
}): void {
  scheduleHostedStripeAlert(async () => {
    await reportHostedStripeOperationFailureAlertBestEffort(input);
  });
}

export async function sendHostedStripeOperationFailureAlert(input: {
  env?: Readonly<Record<string, string | undefined>>;
  fields: HostedStripeErrorFields;
  operationCorrelationId: string;
  operationName: string;
  sendEmail?: HostedStripeAlertEmailSend;
  stripeLiveMode: boolean;
}): Promise<HostedStripeAlertEmailOutcome> {
  const emailConfig = readHostedOperationalAlertEmailConfig(
    input.env ?? process.env,
  );
  if (!emailConfig) {
    return "not_configured";
  }

  const operationName = sanitizeHostedOnboardingLogString(
    input.operationName,
    HOSTED_STRIPE_ALERT_OPERATION_MAX_LENGTH,
  ) ?? "unknown";
  const requestId = readHostedStripeAlertRequestId(input.fields.requestId);
  const operationCorrelationId = readHostedStripeOperationCorrelationId(
    input.operationCorrelationId,
  );

  await (input.sendEmail ?? sendHostedResendPlainTextEmail)({
    config: emailConfig.resend,
    idempotencyKey: buildHostedStripeAlertEmailIdempotencyKey({
      category: "operation",
      identity: [
        input.stripeLiveMode ? "live" : "test",
        operationName,
        requestId ?? operationCorrelationId,
      ].join(":"),
    }),
    subject: `Murph Stripe operation failed — ${operationName}`,
    text: [
      "A Murph Stripe API operation failed.",
      "",
      `operation: ${operationName}`,
      `operation correlation: ${operationCorrelationId}`,
      `mode: ${input.stripeLiveMode ? "live" : "test"}`,
      `error type: ${readHostedStripeAlertToken(input.fields.type) ?? "unknown"}`,
      `raw error type: ${readHostedStripeAlertToken(input.fields.rawType) ?? "unknown"}`,
      `error code: ${readHostedStripeAlertToken(input.fields.code) ?? "unknown"}`,
      `decline code: ${readHostedStripeAlertToken(input.fields.declineCode) ?? "unknown"}`,
      `parameter: ${readHostedStripeAlertToken(input.fields.param) ?? "unknown"}`,
      `http status: ${readHostedStripeAlertHttpStatus(input.fields.statusCode) ?? "unknown"}`,
      `Stripe request id: ${requestId ?? "unavailable"}`,
      "",
      "No member identity, contact detail, checkout contents, or raw provider payload is included in this alert.",
    ].join("\n"),
    to: emailConfig.recipients,
  });

  return "sent";
}

export function scheduleHostedStripePaymentFailureEventAlert(input: {
  eventId: string;
  eventType: string;
  livemode: boolean;
}): void {
  if (!isHostedStripePaymentFailureEventType(input.eventType)) {
    return;
  }

  scheduleHostedStripeAlert(async () => {
    await reportHostedStripePaymentFailureEventAlertBestEffort(input);
  });
}

export async function sendHostedStripePaymentFailureEventAlert(input: {
  env?: Readonly<Record<string, string | undefined>>;
  eventId: string;
  eventType: string;
  livemode: boolean;
  sendEmail?: HostedStripeAlertEmailSend;
}): Promise<HostedStripeAlertEmailOutcome> {
  if (!isHostedStripePaymentFailureEventType(input.eventType)) {
    return "ignored_event";
  }

  const emailConfig = readHostedOperationalAlertEmailConfig(
    input.env ?? process.env,
  );
  if (!emailConfig) {
    return "not_configured";
  }

  const eventId = readHostedStripeAlertEventId(input.eventId);

  await (input.sendEmail ?? sendHostedResendPlainTextEmail)({
    config: emailConfig.resend,
    idempotencyKey: buildHostedStripeAlertEmailIdempotencyKey({
      category: "payment-event",
      identity: input.eventId,
    }),
    subject: `Murph Stripe payment failed — ${input.eventType}`,
    text: [
      "Stripe reported a failed Murph checkout or subscription payment.",
      "",
      `event type: ${input.eventType}`,
      `Stripe event id: ${eventId ?? "unavailable"}`,
      `mode: ${input.livemode ? "live" : "test"}`,
      "",
      "Inspect this event in Stripe for the customer-facing failure details. No member identity, contact detail, checkout contents, or raw provider payload is included in this alert.",
    ].join("\n"),
    to: emailConfig.recipients,
  });

  return "sent";
}

export function scheduleHostedStripeReconciliationFailureAlert(input: {
  errorCode: string;
  eventId: string;
  eventType: string;
  livemode: boolean;
}): void {
  scheduleHostedStripeAlert(async () => {
    await reportHostedStripeReconciliationFailureAlertBestEffort(input);
  });
}

export async function sendHostedStripeReconciliationFailureAlert(input: {
  env?: Readonly<Record<string, string | undefined>>;
  errorCode: string;
  eventId: string;
  eventType: string;
  livemode: boolean;
  sendEmail?: HostedStripeAlertEmailSend;
}): Promise<HostedStripeAlertEmailOutcome> {
  const emailConfig = readHostedOperationalAlertEmailConfig(
    input.env ?? process.env,
  );
  if (!emailConfig) {
    return "not_configured";
  }

  const eventId = readHostedStripeAlertEventId(input.eventId);
  const eventType = readHostedStripeAlertToken(input.eventType) ?? "unknown";
  const errorCode = readHostedStripeAlertToken(input.errorCode) ?? "unknown";

  await (input.sendEmail ?? sendHostedResendPlainTextEmail)({
    config: emailConfig.resend,
    idempotencyKey: buildHostedStripeAlertEmailIdempotencyKey({
      category: "reconciliation",
      identity: input.eventId,
    }),
    subject: `Murph Stripe reconciliation failed — ${eventType}`,
    text: [
      "Murph could not reconcile a verified Stripe event.",
      "",
      `event type: ${eventType}`,
      `Stripe event id: ${eventId ?? "unavailable"}`,
      `mode: ${input.livemode ? "live" : "test"}`,
      `error code: ${errorCode}`,
      "",
      "The existing Stripe event receipt remains the retry owner. No billing state was changed by this alert, and no member identity, contact detail, or raw provider payload is included.",
    ].join("\n"),
    to: emailConfig.recipients,
  });

  return "sent";
}

export function isHostedStripePaymentFailureEventType(type: string): boolean {
  return HOSTED_STRIPE_PAYMENT_FAILURE_EVENT_TYPES.has(type);
}

export function buildHostedStripeOperationCorrelationId(
  identity: string,
): string {
  return `stripe_op_${sha256Hex(identity).slice(0, 24)}`;
}

async function reportHostedStripeOperationFailureAlertBestEffort(input: {
  fields: HostedStripeErrorFields;
  operationCorrelationId: string;
  operationName: string;
  stripeLiveMode: boolean;
}): Promise<void> {
  try {
    await sendHostedStripeOperationFailureAlert(input);
  } catch (error) {
    logHostedStripeAlertDeliveryFailure({
      alertKind: "operation",
      error,
      stripeType: readHostedStripeAlertToken(input.fields.type),
    });
  }
}

async function reportHostedStripePaymentFailureEventAlertBestEffort(input: {
  eventId: string;
  eventType: string;
  livemode: boolean;
}): Promise<void> {
  try {
    await sendHostedStripePaymentFailureEventAlert(input);
  } catch (error) {
    logHostedStripeAlertDeliveryFailure({
      alertKind: "payment-event",
      error,
      stripeType: input.eventType,
    });
  }
}

async function reportHostedStripeReconciliationFailureAlertBestEffort(input: {
  errorCode: string;
  eventId: string;
  eventType: string;
  livemode: boolean;
}): Promise<void> {
  try {
    await sendHostedStripeReconciliationFailureAlert(input);
  } catch (error) {
    logHostedStripeAlertDeliveryFailure({
      alertKind: "reconciliation",
      error,
      stripeType: readHostedStripeAlertToken(input.eventType),
    });
  }
}

function scheduleHostedStripeAlert(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

function buildHostedStripeAlertEmailIdempotencyKey(input: {
  category: "operation" | "payment-event" | "reconciliation";
  identity: string;
}): string {
  return `hosted-stripe-alert/${input.category}/${sha256Hex(input.identity)}`;
}

function readHostedStripeAlertToken(value: string | null): string | null {
  return value && HOSTED_STRIPE_ALERT_TOKEN_PATTERN.test(value) ? value : null;
}

function readHostedStripeAlertEventId(value: string): string | null {
  return HOSTED_STRIPE_ALERT_EVENT_ID_PATTERN.test(value) ? value : null;
}

function readHostedStripeAlertRequestId(value: string | null): string | null {
  return value && HOSTED_STRIPE_ALERT_REQUEST_ID_PATTERN.test(value) ? value : null;
}

function readHostedStripeOperationCorrelationId(value: string): string {
  if (!HOSTED_STRIPE_ALERT_OPERATION_CORRELATION_PATTERN.test(value)) {
    throw new TypeError("Stripe alert operation correlation is invalid.");
  }
  return value;
}

function readHostedStripeAlertHttpStatus(value: number | null): number | null {
  return value !== null &&
      Number.isInteger(value) &&
      value >= 100 &&
      value <= 599
    ? value
    : null;
}

function logHostedStripeAlertDeliveryFailure(details: {
  alertKind: "operation" | "payment-event" | "reconciliation";
  error: unknown;
  stripeType: string | null;
}): void {
  const providerError = details.error instanceof HostedResendPlainTextEmailError
    ? details.error
    : null;
  console.warn("Hosted Stripe alert email failed.", {
    alertKind: details.alertKind,
    ...(providerError ? { errorCode: providerError.code } : {}),
    ...(providerError?.providerStatus === null || providerError === null
      ? {}
      : { providerStatus: providerError.providerStatus }),
    ...(details.stripeType ? { stripeType: details.stripeType } : {}),
  });
}
