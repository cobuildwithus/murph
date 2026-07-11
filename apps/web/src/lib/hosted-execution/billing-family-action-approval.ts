import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type {
  HostedActionApprovalRequest,
  HostedActionApprovalReturnContactKind,
} from "@murphai/hosted-execution/action-approval";
import type {
  HostedRuntimeBillingPlanToolStatusResponse,
  HostedRuntimeFamilyPlanToolStatusResponse,
  HostedRuntimeSensitiveActionApprovalResult,
} from "@murphai/hosted-execution/runtime-control";

import {
  consumeHostedActionApproval,
  requestHostedActionApproval,
} from "@/src/lib/action-approvals";

const APPROVAL_FINGERPRINT_VERSION =
  "murph.hosted-billing-family-action-approval.v1";

export type HostedRuntimeSensitiveActionApprovalGate =
  | { status: "approved" }
  | HostedRuntimeSensitiveActionApprovalResult;

export async function requestHostedRuntimeSensitiveActionApproval(input: {
  memberId: string;
  prisma: PrismaClient;
  request: HostedActionApprovalRequest;
}): Promise<HostedRuntimeSensitiveActionApprovalGate> {
  const approval = await requestHostedActionApproval({
    memberId: input.memberId,
    prisma: input.prisma,
    request: input.request,
  });
  if (approval.status !== "approved") {
    return projectHostedRuntimeSensitiveActionApproval(approval);
  }

  const consumed = await consumeHostedActionApproval({
    memberId: input.memberId,
    prisma: input.prisma,
    request: {
      approvalGeneration: approval.approvalGeneration,
      consumerId: `hosted-product-mutation:${randomUUID()}`,
      request: input.request,
    },
  });
  return consumed.status === "approved"
    ? { status: "approved" }
    : projectHostedRuntimeSensitiveActionApproval(consumed);
}

export function buildHostedRuntimeBillingPlanActionApprovalRequest(input: {
  action:
    | "start_paid_pulse"
    | "switch_to_pulse_at_renewal"
    | "upgrade_to_edge";
  returnContactKind: HostedActionApprovalReturnContactKind | null;
  status: HostedRuntimeBillingPlanToolStatusResponse;
}): HostedActionApprovalRequest {
  const pulse = requirePlan(input.status, "launch_monthly");
  const edge = input.action === "start_paid_pulse"
    ? null
    : requirePlan(input.status, "launch_edge_monthly");
  const terms = input.action === "start_paid_pulse"
    ? [
        input.action,
        input.status.billingStatus,
        input.status.currentBillingPhase,
        input.status.currentBillingPlanCode,
        input.status.currentCheckoutOffer,
        pulse.code,
        "USD",
        pulse.recurringAmountUsdCents,
        pulse.interval,
        "immediate_trial_end_and_subscription_invoice",
      ]
    : input.action === "upgrade_to_edge"
      ? [
          input.action,
          input.status.currentBillingPhase,
          input.status.currentBillingPlanCode,
          input.status.currentPeriodEnd,
          pulse.code,
          pulse.recurringAmountUsdCents,
          edge?.code,
          "USD",
          edge?.recurringAmountUsdCents,
          edge?.interval,
          "immediate_with_proration_and_immediate_invoice",
        ]
      : [
          input.action,
          input.status.currentBillingPhase,
          input.status.currentBillingPlanCode,
          input.status.currentPeriodEnd,
          edge?.code,
          edge?.recurringAmountUsdCents,
          pulse.code,
          "USD",
          pulse.recurringAmountUsdCents,
          pulse.interval,
          "renewal_without_immediate_proration",
        ];
  const actionFingerprint = fingerprintExactAction(terms);

  if (input.action === "start_paid_pulse") {
    return approvalRequest({
      action: input.action,
      actionKind: "billing.plan.start-paid-pulse.v1",
      body: [
        `Start Pulse now at ${formatUsd(pulse.recurringAmountUsdCents)} per month.`,
        "The trial ends now and Stripe will attempt the first subscription invoice immediately.",
        "If payment details or confirmation are needed, Murph will open Stripe in your browser.",
      ].join(" "),
      fingerprint: actionFingerprint,
      returnContactKind: input.returnContactKind,
      title: "Start paid Pulse?",
    });
  }
  if (input.action === "upgrade_to_edge") {
    if (!edge) {
      throw new TypeError("Canonical Edge pricing is unavailable.");
    }
    return approvalRequest({
      action: input.action,
      actionKind: "billing.plan.upgrade-to-edge.v1",
      body: [
        `Upgrade from Pulse (${formatUsd(pulse.recurringAmountUsdCents)} per month) to Edge (${formatUsd(edge.recurringAmountUsdCents)} per month) now.`,
        "Stripe will prorate the remaining billing period and may immediately invoice the prorated difference.",
      ].join(" "),
      fingerprint: actionFingerprint,
      returnContactKind: input.returnContactKind,
      title: "Upgrade to Edge now?",
    });
  }

  if (!edge) {
    throw new TypeError("Canonical Edge pricing is unavailable.");
  }

  return approvalRequest({
    action: input.action,
    actionKind: "billing.plan.switch-to-pulse-at-renewal.v1",
    body: [
      `Schedule the switch from Edge to Pulse (${formatUsd(pulse.recurringAmountUsdCents)} per month) for ${formatEffectiveAt(input.status.currentPeriodEnd)}.`,
      "Edge stays active until then, with no immediate prorated charge from this switch.",
    ].join(" "),
    fingerprint: actionFingerprint,
    returnContactKind: input.returnContactKind,
    title: "Switch to Pulse at renewal?",
  });
}

export function buildHostedRuntimeFamilyActionApprovalRequest(input:
  | {
      action: "cancel_invite";
      inviteId: string;
      returnContactKind: HostedActionApprovalReturnContactKind | null;
      status: HostedRuntimeFamilyPlanToolStatusResponse;
      targetLabel: string | null;
    }
  | {
      action: "remove_member";
      memberId: string;
      returnContactKind: HostedActionApprovalReturnContactKind | null;
      status: HostedRuntimeFamilyPlanToolStatusResponse;
      targetLabel: string | null;
    }
  | {
      action: "change_seat_count";
      returnContactKind: HostedActionApprovalReturnContactKind | null;
      status: HostedRuntimeFamilyPlanToolStatusResponse;
      targetSeatCount: number;
    }
): HostedActionApprovalRequest {
  const pricing = requireFamilyPricing(input.status);
  if (input.action === "cancel_invite") {
    const fingerprintValue = fingerprintExactAction([
      input.action,
      input.inviteId,
      input.targetLabel,
      "revoke_pending_invite",
    ]);
    return approvalRequest({
      action: input.action,
      actionKind: "family.plan.cancel-invite.v1",
      body: [
        `Cancel the pending Family invite for ${formatTarget(input.targetLabel, "the selected person")}.`,
        "Its acceptance link will stop working. Family seat billing is unchanged.",
      ].join(" "),
      fingerprint: fingerprintValue,
      returnContactKind: input.returnContactKind,
      title: "Cancel this Family invite?",
    });
  }
  if (input.action === "remove_member") {
    const fingerprintValue = fingerprintExactAction([
      input.action,
      input.memberId,
      input.targetLabel,
      input.status.seats.billed,
      pricing.currency,
      pricing.currentRecurringAmountUsdCents,
      pricing.interval,
      "revoke_sponsorship_without_account_deletion",
    ]);
    return approvalRequest({
      action: input.action,
      actionKind: "family.plan.remove-member.v1",
      body: [
        `Remove ${formatTarget(input.targetLabel, "the selected member")} from Family sponsorship now.`,
        "This does not delete their Murph account or private data.",
        `The billed seat count and current ${formatUsd(pricing.currentRecurringAmountUsdCents)} Family total stay unchanged.`,
      ].join(" "),
      fingerprint: fingerprintValue,
      returnContactKind: input.returnContactKind,
      title: "Remove this Family member?",
    });
  }

  const sourceSeatCount = input.status.seats.billed;
  const targetTotal =
    input.targetSeatCount * pricing.recurringAmountUsdCentsPerSeat;
  const increase = input.targetSeatCount > sourceSeatCount;
  const timing = increase
    ? pricing.seatIncreaseTiming
    : pricing.seatDecreaseTiming;
  const fingerprintValue = fingerprintExactAction([
    input.action,
    sourceSeatCount,
    input.targetSeatCount,
    pricing.currency,
    pricing.recurringAmountUsdCentsPerSeat,
    pricing.currentRecurringAmountUsdCents,
    targetTotal,
    pricing.interval,
    timing,
  ]);
  return approvalRequest({
    action: input.action,
    actionKind: "family.plan.change-seat-count.v1",
    body: increase
      ? [
          `Increase Family from ${sourceSeatCount} seats (${formatUsd(pricing.currentRecurringAmountUsdCents)} per month) to ${input.targetSeatCount} seats (${formatUsd(targetTotal)} per month).`,
          "The change is immediate. Stripe prorates the added seats and immediately invoices the prorated amount.",
        ].join(" ")
      : [
          `Decrease Family from ${sourceSeatCount} seats (${formatUsd(pricing.currentRecurringAmountUsdCents)} per month) to ${input.targetSeatCount} seats (${formatUsd(targetTotal)} per month).`,
          "The seat quantity changes immediately without a prorated credit or refund; the lower recurring total applies at the next renewal.",
        ].join(" "),
    fingerprint: fingerprintValue,
    returnContactKind: input.returnContactKind,
    title: increase ? "Increase Family seats?" : "Decrease Family seats?",
  });
}

function approvalRequest(input: {
  action: string;
  actionKind: string;
  body: string;
  fingerprint: string;
  returnContactKind: HostedActionApprovalReturnContactKind | null;
  title: string;
}): HostedActionApprovalRequest {
  return {
    actionFingerprint: input.fingerprint,
    actionId: `hosted-product:${input.action}:${input.fingerprint}`,
    actionKind: input.actionKind,
    presentation: {
      body: input.body,
      title: input.title,
    },
    returnContactKind: input.returnContactKind,
  };
}

function projectHostedRuntimeSensitiveActionApproval(input:
  | { approvalId: string; approvalUrl: string; expiresAt: string; status: "pending" }
  | { approvalId: string; status: "denied" | "expired" }
): HostedRuntimeSensitiveActionApprovalResult {
  if (input.status === "pending") {
    return {
      approvalUrl: input.approvalUrl,
      expiresAt: input.expiresAt,
      status: "approval_required",
    };
  }
  return {
    status: input.status === "denied" ? "approval_denied" : "approval_expired",
  };
}

function fingerprintExactAction(terms: readonly unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify([APPROVAL_FINGERPRINT_VERSION, ...terms]))
    .digest("hex");
}

function requirePlan(
  status: HostedRuntimeBillingPlanToolStatusResponse,
  code: "launch_edge_monthly" | "launch_monthly",
) {
  const plan = status.planPresentations.find((candidate) => candidate.code === code);
  if (!plan) {
    throw new TypeError(`Canonical ${code} pricing is unavailable.`);
  }
  return plan;
}

function requireFamilyPricing(status: HostedRuntimeFamilyPlanToolStatusResponse) {
  if (!status.pricing) {
    throw new TypeError("Canonical Family pricing is unavailable.");
  }
  return status.pricing;
}

function formatUsd(amountUsdCents: number): string {
  return `$${(amountUsdCents / 100).toFixed(2)} USD`;
}

function formatEffectiveAt(value: string | null): string {
  if (!value) {
    throw new TypeError("Canonical renewal timing is unavailable.");
  }
  return value;
}

function formatTarget(value: string | null, fallback: string): string {
  const normalized = value
    ?.replace(/[\u0000-\u001F\u007F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80);
  return normalized ? JSON.stringify(normalized) : fallback;
}
