import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import type {
  HostedPlanUsageSubscriptionActionQuote,
} from "@murphai/hosted-execution/plan-usage";

import { readHostedAppSessionHmacKey } from "./app-session-config";
import {
  formatHostedBillingPrice,
  getHostedBillingPlanDefinition,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { hostedOnboardingError } from "./errors";

const QUOTE_DOMAIN = "murph.hosted-billing-plan-quote";
const QUOTE_VERSION = 1;
const QUOTE_TTL_MS = 10 * 60 * 1_000;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type HostedBillingPlanQuoteTiming =
  | "at_trial_end"
  | "immediate"
  | "now"
  | "period_end";

export interface HostedBillingPlanQuoteState {
  billingStatus: string;
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  currentCheckoutOffer: string | null;
  currentPeriodEnd: string | null;
  hasStripeCustomerId: boolean;
  hasStripeSubscriptionId: boolean;
  scheduledBillingEffectiveAt: string | null;
  scheduledBillingPlanCode: string | null;
}

export function buildHostedBillingPlanQuoteState(input: {
  billingState: {
    currentBillingPhase: string | null;
    currentBillingPlanCode: string | null;
    currentCheckoutOffer: string | null;
    currentPeriodEnd: Date | null;
    hasStripeCustomerId: boolean;
    hasStripeSubscriptionId: boolean;
    scheduledBillingEffectiveAt: Date | null;
    scheduledBillingPlanCode: string | null;
  };
  billingStatus: string;
}): HostedBillingPlanQuoteState {
  return {
    billingStatus: input.billingStatus,
    currentBillingPhase: input.billingState.currentBillingPhase,
    currentBillingPlanCode: input.billingState.currentBillingPlanCode,
    currentCheckoutOffer: input.billingState.currentCheckoutOffer,
    currentPeriodEnd: input.billingState.currentPeriodEnd instanceof Date
      ? input.billingState.currentPeriodEnd.toISOString()
      : null,
    hasStripeCustomerId: input.billingState.hasStripeCustomerId,
    hasStripeSubscriptionId: input.billingState.hasStripeSubscriptionId,
    scheduledBillingEffectiveAt:
      input.billingState.scheduledBillingEffectiveAt instanceof Date
        ? input.billingState.scheduledBillingEffectiveAt.toISOString()
        : null,
    scheduledBillingPlanCode:
      input.billingState.scheduledBillingPlanCode,
  };
}

interface HostedBillingPlanQuotePayload {
  expiresAtMs: number;
  memberBinding: string;
  monthlyPriceUsdCents: number;
  stateFingerprint: string;
  targetPlanCode: HostedBillingPlanCode;
  timing: HostedBillingPlanQuoteTiming;
  version: typeof QUOTE_VERSION;
}

export function createHostedBillingPlanQuote(input: {
  memberId: string;
  now: Date;
  state: HostedBillingPlanQuoteState;
  targetPlanCode: HostedBillingPlanCode;
  timing: HostedBillingPlanQuoteTiming;
}): HostedPlanUsageSubscriptionActionQuote {
  const definition = getHostedBillingPlanDefinition(input.targetPlanCode);
  const expiresAtMs = input.now.getTime() + QUOTE_TTL_MS;
  const payload: HostedBillingPlanQuotePayload = {
    expiresAtMs,
    memberBinding: createMemberBinding(input.memberId),
    monthlyPriceUsdCents: definition.recurringAmountUsdCents,
    stateFingerprint: createStateFingerprint(input.state),
    targetPlanCode: input.targetPlanCode,
    timing: input.timing,
    version: QUOTE_VERSION,
  };
  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url");
  const signature = createQuoteSignature(encodedPayload);

  return {
    action: "change_plan",
    expiresAt: new Date(expiresAtMs).toISOString(),
    label: buildHostedBillingPlanQuoteLabel({
      targetPlanCode: input.targetPlanCode,
      timing: input.timing,
    }),
    monthlyPriceUsdCents: definition.recurringAmountUsdCents,
    quoteId: `${encodedPayload}.${signature}`,
    targetPlanCode: input.targetPlanCode,
    timing: input.timing,
  };
}

export function verifyHostedBillingPlanQuote(input: {
  memberId: string;
  now: Date;
  quoteId: string;
  state: HostedBillingPlanQuoteState;
  targetPlanCode: HostedBillingPlanCode;
}): HostedBillingPlanQuoteTiming {
  const payload = parseHostedBillingPlanQuote(input.quoteId);
  const definition = getHostedBillingPlanDefinition(input.targetPlanCode);
  const matchesAppliedState = isHostedBillingPlanQuoteApplied({
    payload,
    state: input.state,
  });

  if (
    payload.memberBinding !== createMemberBinding(input.memberId)
    || payload.monthlyPriceUsdCents !== definition.recurringAmountUsdCents
    || payload.targetPlanCode !== input.targetPlanCode
    || (
      payload.stateFingerprint !== createStateFingerprint(input.state)
      && !matchesAppliedState
    )
    || (
      payload.expiresAtMs <= input.now.getTime()
      && !matchesAppliedState
    )
  ) {
    throw buildHostedBillingPlanQuoteStaleError();
  }

  return payload.timing;
}

function isHostedBillingPlanQuoteApplied(input: {
  payload: HostedBillingPlanQuotePayload;
  state: HostedBillingPlanQuoteState;
}): boolean {
  if (
    !input.state.hasStripeCustomerId
    || !input.state.hasStripeSubscriptionId
  ) {
    return false;
  }

  if (
    input.payload.timing === "immediate"
    || input.payload.timing === "now"
  ) {
    return input.state.billingStatus === "active"
      && input.state.currentBillingPhase === "paid"
      && input.state.currentBillingPlanCode === input.payload.targetPlanCode;
  }

  return input.state.scheduledBillingEffectiveAt !== null
    && input.state.scheduledBillingPlanCode === input.payload.targetPlanCode;
}

function parseHostedBillingPlanQuote(
  quoteId: string,
): HostedBillingPlanQuotePayload {
  const parts = quoteId.split(".");
  const encodedPayload = parts[0];
  const suppliedSignature = parts[1];
  if (
    parts.length !== 2
    || !encodedPayload
    || !suppliedSignature
    || !SHA256_BASE64URL_PATTERN.test(suppliedSignature)
  ) {
    throw buildHostedBillingPlanQuoteStaleError();
  }

  const expectedSignature = createQuoteSignature(encodedPayload);
  if (
    !timingSafeEqual(
      Buffer.from(suppliedSignature, "base64url"),
      Buffer.from(expectedSignature, "base64url"),
    )
  ) {
    throw buildHostedBillingPlanQuoteStaleError();
  }

  let value: unknown;
  try {
    value = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
  } catch {
    throw buildHostedBillingPlanQuoteStaleError();
  }

  if (!isHostedBillingPlanQuotePayload(value)) {
    throw buildHostedBillingPlanQuoteStaleError();
  }

  return value;
}

function isHostedBillingPlanQuotePayload(
  value: unknown,
): value is HostedBillingPlanQuotePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const read = (key: string): unknown => Reflect.get(value, key);
  const targetPlanCode = read("targetPlanCode");
  const timing = read("timing");

  return Object.keys(value).length === 7
    && read("version") === QUOTE_VERSION
    && Number.isSafeInteger(read("expiresAtMs"))
    && typeof read("memberBinding") === "string"
    && SHA256_BASE64URL_PATTERN.test(String(read("memberBinding")))
    && Number.isSafeInteger(read("monthlyPriceUsdCents"))
    && typeof read("stateFingerprint") === "string"
    && SHA256_BASE64URL_PATTERN.test(String(read("stateFingerprint")))
    && (
      targetPlanCode === "launch_group_monthly"
      || targetPlanCode === "launch_monthly"
      || targetPlanCode === "launch_edge_monthly"
      || targetPlanCode === "launch_max_monthly"
    )
    && (
      timing === "at_trial_end"
      || timing === "immediate"
      || timing === "now"
      || timing === "period_end"
    );
}

function createMemberBinding(memberId: string): string {
  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(JSON.stringify([QUOTE_DOMAIN, QUOTE_VERSION, memberId]), "utf8")
    .digest("base64url");
}

function createStateFingerprint(state: HostedBillingPlanQuoteState): string {
  return createHash("sha256")
    .update(JSON.stringify([
      state.billingStatus,
      state.currentBillingPhase,
      state.currentBillingPlanCode,
      state.currentCheckoutOffer,
      state.currentPeriodEnd,
      state.hasStripeCustomerId,
      state.hasStripeSubscriptionId,
      state.scheduledBillingEffectiveAt,
      state.scheduledBillingPlanCode,
    ]), "utf8")
    .digest("base64url");
}

function createQuoteSignature(encodedPayload: string): string {
  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(
      JSON.stringify([QUOTE_DOMAIN, QUOTE_VERSION, encodedPayload]),
      "utf8",
    )
    .digest("base64url");
}

function buildHostedBillingPlanQuoteLabel(input: {
  targetPlanCode: HostedBillingPlanCode;
  timing: HostedBillingPlanQuoteTiming;
}): string {
  const definition = getHostedBillingPlanDefinition(input.targetPlanCode);
  const price = formatHostedBillingPrice(
    definition.recurringAmountUsdCents,
  );
  const verb = input.timing === "at_trial_end"
    ? input.targetPlanCode === "launch_monthly"
      ? "Keep Pulse after your trial"
      : `Choose ${definition.displayName} after your trial`
    : input.timing === "period_end"
      ? `Switch to ${definition.displayName}`
      : input.timing === "now"
        ? `Start ${definition.displayName} now`
        : `Upgrade to ${definition.displayName}`;

  return `${verb} (${price}/month)`;
}

function buildHostedBillingPlanQuoteStaleError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_PLAN_QUOTE_STALE",
    httpStatus: 409,
    message:
      "That plan quote is no longer current. Review the latest plan terms before confirming again.",
  });
}
