import { randomBytes } from "node:crypto";

import {
  buildHostedExecutionLinqMessageReceivedDispatch,
  type HostedExecutionDispatchRequest,
} from "@healthybob/hosted-execution";
import { Prisma, type HostedMember, type HostedRevnetIssuance, type PrismaClient } from "@prisma/client";
import { REVNET_NATIVE_TOKEN } from "@cobuild/wire";
import {
  HostedBillingCheckoutStatus,
  HostedBillingMode,
  HostedBillingStatus,
  HostedInviteStatus,
  HostedMemberStatus,
  HostedRevnetIssuanceStatus,
} from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import {
  drainHostedExecutionOutboxBestEffort,
  enqueueHostedExecutionOutbox,
} from "../hosted-execution/outbox";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  buildHostedInviteReply,
  parseHostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
  sendHostedLinqChatMessage,
  summarizeHostedLinqMessage,
  assertHostedLinqWebhookSignature,
} from "./linq";
import {
  ensureHostedMemberForPhone,
  issueHostedInvite,
  buildHostedInviteUrl,
  buildHostedMemberActivationDispatch,
} from "./member-service";
import {
  getHostedOnboardingEnvironment,
  requireHostedOnboardingStripeConfig,
} from "./runtime";
import {
  generateHostedRevnetIssuanceId,
  normalizeNullableString,
  normalizePhoneNumber,
  shouldStartHostedOnboarding,
} from "./shared";
import {
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import {
  coerceHostedWalletAddress,
  convertStripeMinorAmountToRevnetPaymentAmount,
  isHostedRevnetBroadcastStatusUnknownError,
  isHostedOnboardingRevnetEnabled,
  requireHostedRevnetConfig,
  submitHostedRevnetPayment,
} from "./revnet";
import { requireHostedMemberWalletAddressForRevnet } from "./billing-service";
import { revokeHostedSessionsForMember } from "./session";

const REVNET_BROADCAST_STATUS_UNKNOWN_CODE = "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN";

type HostedRevnetIssuanceRecord = Pick<
  HostedRevnetIssuance,
  | "beneficiaryAddress"
  | "chainId"
  | "failureCode"
  | "id"
  | "idempotencyKey"
  | "payTxHash"
  | "paymentAmount"
  | "projectId"
  | "status"
  | "stripeChargeId"
  | "stripePaymentIntentId"
  | "terminalAddress"
  | "updatedAt"
>;

type HostedWebhookEventPayload = Prisma.InputJsonObject;

type HostedWebhookReceiptErrorState = {
  message: string;
  name: string;
};

type HostedWebhookSideEffectErrorState = {
  code: string | null;
  message: string;
  name: string;
  retryable: boolean | null;
};

type HostedWebhookSideEffectStatus = "pending" | "sent";

type HostedWebhookDispatchSideEffect = {
  attemptCount: number;
  effectId: string;
  kind: "hosted_execution_dispatch";
  lastAttemptAt: string | null;
  lastError: HostedWebhookSideEffectErrorState | null;
  payload: {
    dispatch: HostedExecutionDispatchRequest;
  };
  result: {
    dispatched: true;
  } | null;
  sentAt: string | null;
  status: HostedWebhookSideEffectStatus;
};

type HostedWebhookLinqMessageSideEffect = {
  attemptCount: number;
  effectId: string;
  kind: "linq_message_send";
  lastAttemptAt: string | null;
  lastError: HostedWebhookSideEffectErrorState | null;
  payload: {
    chatId: string;
    inviteId: string | null;
    message: string;
  };
  result: {
    chatId: string | null;
    messageId: string | null;
  } | null;
  sentAt: string | null;
  status: HostedWebhookSideEffectStatus;
};

type HostedWebhookSideEffect =
  | HostedWebhookDispatchSideEffect
  | HostedWebhookLinqMessageSideEffect;

type HostedWebhookReceiptStatus = "completed" | "failed" | "processing";

type HostedWebhookReceiptState = {
  attemptCount: number;
  attemptId: string | null;
  completedAt: string | null;
  eventPayload: HostedWebhookEventPayload;
  lastError: HostedWebhookReceiptErrorState | null;
  lastReceivedAt: string | null;
  sideEffects: HostedWebhookSideEffect[];
  status: HostedWebhookReceiptStatus | null;
};

type HostedWebhookReceiptClaim = {
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null;
  state: HostedWebhookReceiptState;
};

class HostedWebhookReceiptSideEffectDrainError extends Error {
  readonly claimedReceipt: HostedWebhookReceiptClaim;
  readonly cause: unknown;

  constructor(claimedReceipt: HostedWebhookReceiptClaim, cause: unknown) {
    super("Hosted webhook side-effect drain failed.");
    this.name = "HostedWebhookReceiptSideEffectDrainError";
    this.claimedReceipt = claimedReceipt;
    this.cause = cause;
  }
}

const HOSTED_REVNET_SUBMITTING_STALE_MS = 5 * 60 * 1000;

type HostedOnboardingLinqWebhookResponse = {
  duplicate?: boolean;
  ignored?: boolean;
  inviteCode?: string;
  joinUrl?: string;
  ok: true;
  reason?: string;
};

type HostedOnboardingLinqWebhookPlan =
  | {
    desiredSideEffects: [];
    kind: "ignore";
    response: HostedOnboardingLinqWebhookResponse;
  }
  | {
    desiredSideEffects: [HostedWebhookDispatchSideEffect];
    kind: "active-member-dispatch";
    response: HostedOnboardingLinqWebhookResponse;
  }
  | {
    desiredSideEffects: [HostedWebhookLinqMessageSideEffect];
    kind: "invite-reply";
    response: HostedOnboardingLinqWebhookResponse;
  };

export async function handleHostedOnboardingLinqWebhook(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedOnboardingLinqWebhookResponse> {
  const prisma = input.prisma ?? getPrisma();
  const environment = getHostedOnboardingEnvironment();

  if (environment.linqWebhookSecret) {
    assertHostedLinqWebhookSignature({
      payload: input.rawBody,
      signature: input.signature,
      timestamp: input.timestamp,
    });
  }

  const event = parseHostedLinqWebhookEvent(input.rawBody);
  let claimedReceipt = await recordHostedWebhookReceipt({
    eventId: event.event_id,
    eventPayload: {
      eventType: event.event_type,
    },
    prisma,
    source: "linq",
  });

  if (!claimedReceipt) {
    return {
      ok: true,
      duplicate: true,
    };
  }

  try {
    const plan = await planHostedOnboardingLinqWebhook({
      event,
      prisma,
    });

    claimedReceipt = await queueHostedWebhookReceiptSideEffects({
      claimedReceipt,
      desiredSideEffects: plan.desiredSideEffects,
      eventId: event.event_id,
      prisma,
      source: "linq",
    });
    claimedReceipt = await drainHostedWebhookReceiptSideEffects({
      claimedReceipt,
      eventId: event.event_id,
      prisma,
      signal: input.signal,
      source: "linq",
    });

    await markHostedWebhookReceiptCompleted({
      claimedReceipt,
      eventId: event.event_id,
      eventPayload: {
        eventType: event.event_type,
      },
      prisma,
      source: "linq",
    });

    return plan.response;
  } catch (error) {
    const drainFailure = readHostedWebhookReceiptDrainError(error);
    const failure = drainFailure?.cause ?? error;
    claimedReceipt = drainFailure?.claimedReceipt ?? claimedReceipt;
    await markHostedWebhookReceiptFailed({
      claimedReceipt,
      error: failure,
      eventId: event.event_id,
      eventPayload: {
        eventType: event.event_type,
      },
      prisma,
      source: "linq",
    });
    throw failure;
  }
}

async function planHostedOnboardingLinqWebhook(input: {
  event: ReturnType<typeof parseHostedLinqWebhookEvent>;
  prisma: PrismaClient;
}): Promise<HostedOnboardingLinqWebhookPlan> {
  if (input.event.event_type !== "message.received") {
    return {
      kind: "ignore",
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: input.event.event_type,
      },
    };
  }

  const messageEvent = requireHostedLinqMessageReceivedEvent(input.event);
  const summary = summarizeHostedLinqMessage(messageEvent);

  if (summary.isFromMe) {
    return {
      kind: "ignore",
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: "own-message",
      },
    };
  }

  const normalizedPhoneNumber = normalizePhoneNumber(summary.phoneNumber);

  if (!normalizedPhoneNumber) {
    return {
      kind: "ignore",
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: "invalid-phone",
      },
    };
  }

  const existingMember = await input.prisma.hostedMember.findUnique({
    where: {
      normalizedPhoneNumber,
    },
    include: {
      invites: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
  });

  if (existingMember?.billingStatus === HostedBillingStatus.active) {
    return {
      kind: "active-member-dispatch",
      desiredSideEffects: [
        createHostedWebhookDispatchSideEffect({
          dispatch: buildHostedExecutionLinqMessageReceivedDispatch({
            eventId: input.event.event_id,
            linqChatId: summary.chatId,
            linqEvent: input.event as unknown as Record<string, unknown>,
            normalizedPhoneNumber,
            occurredAt: input.event.created_at,
            userId: existingMember.id,
          }),
        }),
      ],
      response: {
        ok: true,
        ignored: false,
        reason: "dispatched-active-member",
      },
    };
  }

  if (existingMember && !shouldStartHostedOnboarding(summary.text)) {
    return {
      kind: "ignore",
      desiredSideEffects: [],
      response: {
        ok: true,
        ignored: true,
        reason: "no-trigger",
      },
    };
  }

  const member = await ensureHostedMemberForPhone({
    linqChatId: summary.chatId,
    normalizedPhoneNumber,
    originalPhoneNumber: summary.phoneNumber,
    prisma: input.prisma,
  });
  const invite = await issueHostedInvite({
    channel: "linq",
    linqChatId: summary.chatId,
    linqEventId: input.event.event_id,
    memberId: member.id,
    prisma: input.prisma,
    triggerText: summary.text,
  });
  const joinUrl = buildHostedInviteUrl(invite.inviteCode);

  return {
    kind: "invite-reply",
    desiredSideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: summary.chatId,
        inviteId: invite.id,
        message: buildHostedInviteReply({
          activeSubscription: member.billingStatus === HostedBillingStatus.active,
          joinUrl,
        }),
        sourceEventId: input.event.event_id,
      }),
    ],
    response: {
      ok: true,
      inviteCode: invite.inviteCode,
      joinUrl,
    },
  };
}

export async function handleHostedStripeWebhook(input: {
  rawBody: string;
  signature: string | null;
  prisma?: PrismaClient;
}): Promise<{ duplicate?: boolean; ok: true; type: string }> {
  const prisma = input.prisma ?? getPrisma();
  const { stripe, webhookSecret } = requireHostedOnboardingStripeConfig();

  if (!webhookSecret) {
    throw hostedOnboardingError({
      code: "STRIPE_WEBHOOK_SECRET_REQUIRED",
      message: "STRIPE_WEBHOOK_SECRET must be configured for Stripe webhooks.",
      httpStatus: 500,
    });
  }

  if (!input.signature) {
    throw hostedOnboardingError({
      code: "STRIPE_SIGNATURE_REQUIRED",
      message: "Missing Stripe webhook signature.",
      httpStatus: 401,
    });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(input.rawBody, input.signature, webhookSecret);
  } catch (error) {
    throw hostedOnboardingError({
      code: "STRIPE_SIGNATURE_INVALID",
      message: error instanceof Error ? error.message : "Invalid Stripe webhook signature.",
      httpStatus: 401,
    });
  }

  let claimedReceipt = await recordHostedWebhookReceipt({
    eventId: event.id,
    eventPayload: {
      type: event.type,
    },
    prisma,
    source: "stripe",
  });

  if (!claimedReceipt) {
    return {
      ok: true,
      duplicate: true,
      type: event.type,
    };
  }

  try {
    const occurredAt = Number.isFinite(event.created)
      ? new Date(event.created * 1000).toISOString()
      : new Date().toISOString();
    let desiredSideEffects: HostedWebhookSideEffect[] = [];

    switch (event.type) {
      case "checkout.session.completed":
        desiredSideEffects = await applyStripeCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
          {
            occurredAt,
            sourceEventId: event.id,
          },
          prisma,
        );
        break;
      case "checkout.session.expired":
        await applyStripeCheckoutExpired(event.data.object as Stripe.Checkout.Session, prisma);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        desiredSideEffects = await applyStripeSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
          {
            occurredAt,
            sourceEventId: event.id,
            sourceType: event.type,
          },
          prisma,
        );
        break;
      case "invoice.paid":
        desiredSideEffects = await applyStripeInvoicePaid(
          event.data.object as Stripe.Invoice,
          {
            occurredAt,
            sourceEventId: event.id,
          },
          prisma,
        );
        break;
      case "invoice.payment_failed":
        await applyStripeInvoicePaymentFailed(event.data.object as Stripe.Invoice, prisma);
        break;
      case "refund.created":
        await applyStripeRefundCreated(event.data.object as Stripe.Refund, event.type, prisma);
        break;
      case "charge.dispute.created":
      case "charge.dispute.closed":
      case "charge.dispute.funds_reinstated":
      case "charge.dispute.funds_withdrawn":
        await applyStripeDisputeUpdated(event.data.object as Stripe.Dispute, event.type, prisma);
        break;
      default:
        break;
    }

    claimedReceipt = await queueHostedWebhookReceiptSideEffects({
      claimedReceipt,
      desiredSideEffects,
      eventId: event.id,
      prisma,
      source: "stripe",
    });
    claimedReceipt = await drainHostedWebhookReceiptSideEffects({
      claimedReceipt,
      eventId: event.id,
      prisma,
      source: "stripe",
    });

    await markHostedWebhookReceiptCompleted({
      claimedReceipt,
      eventId: event.id,
      eventPayload: {
        type: event.type,
      },
      prisma,
      source: "stripe",
    });

    return {
      ok: true,
      type: event.type,
    };
  } catch (error) {
    const drainFailure = readHostedWebhookReceiptDrainError(error);
    const failure = drainFailure?.cause ?? error;
    claimedReceipt = drainFailure?.claimedReceipt ?? claimedReceipt;
    await markHostedWebhookReceiptFailed({
      claimedReceipt,
      error: failure,
      eventId: event.id,
      eventPayload: {
        type: event.type,
      },
      prisma,
      source: "stripe",
    });
    throw failure;
  }
}

async function maybeIssueHostedRevnetForStripeInvoice(input: {
  invoice: Stripe.Invoice;
  member: HostedMember;
  prisma: PrismaClient;
}): Promise<void> {
  if (input.member.status === HostedMemberStatus.suspended) {
    return;
  }

  if (!isHostedOnboardingRevnetEnabled()) {
    return;
  }

  const amountPaid = typeof input.invoice.amount_paid === "number" ? input.invoice.amount_paid : 0;

  if (amountPaid < 1) {
    return;
  }

  const config = requireHostedRevnetConfig();
  const invoiceCurrency = normalizeNullableString(input.invoice.currency)?.toLowerCase() ?? null;

  if (invoiceCurrency && invoiceCurrency !== config.stripeCurrency) {
    throw hostedOnboardingError({
      code: "REVNET_PAYMENT_CURRENCY_MISMATCH",
      message: `Stripe invoice ${input.invoice.id} used ${invoiceCurrency}, but Hosted RevNet issuance is configured for ${config.stripeCurrency}.`,
      httpStatus: 502,
    });
  }

  const beneficiaryAddress = requireHostedMemberWalletAddressForRevnet(input.member);
  const idempotencyKey = `stripe:invoice:${input.invoice.id}`;
  const paymentAmount = convertStripeMinorAmountToRevnetPaymentAmount(
    amountPaid,
    config.weiPerStripeMinorUnit,
  );
  const paymentIntentId = coerceStripeObjectId(
    (input.invoice as Stripe.Invoice & { payment_intent?: string | { id?: unknown } | null }).payment_intent ??
      null,
  );
  const chargeId = coerceStripeObjectId(
    (input.invoice as Stripe.Invoice & { charge?: string | { id?: unknown } | null }).charge ?? null,
  );

  let issuance = await findOrCreateHostedRevnetIssuance({
    amountPaid,
    beneficiaryAddress,
    chargeId,
    config,
    idempotencyKey,
    invoiceId: input.invoice.id,
    memberId: input.member.id,
    paymentAmount,
    paymentIntentId,
    prisma: input.prisma,
  });

  issuance = await patchHostedRevnetIssuanceStripeReferences({
    chargeId,
    issuance,
    paymentIntentId,
    prisma: input.prisma,
  });

  if (shouldSkipHostedRevnetIssuanceSubmission(issuance)) {
    return;
  }

  const claimedIssuance = await input.prisma.hostedRevnetIssuance.updateMany({
    where: {
      id: issuance.id,
      status: issuance.status,
      updatedAt: issuance.updatedAt,
    },
    data: {
      status: HostedRevnetIssuanceStatus.submitting,
      failureCode: null,
      failureMessage: null,
    },
  });

  if (claimedIssuance.count !== 1) {
    const latestIssuance = await input.prisma.hostedRevnetIssuance.findUnique({
      where: {
        idempotencyKey,
      },
    });

    if (shouldSkipHostedRevnetIssuanceSubmission(latestIssuance)) {
      return;
    }

    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_CLAIM_FAILED",
      message: `Hosted RevNet issuance could not be claimed safely for Stripe invoice ${input.invoice.id}.`,
      httpStatus: 503,
      retryable: true,
    });
  }

  try {
    const submission = await submitHostedRevnetPayment({
      beneficiaryAddress: requireHostedRevnetIssuanceAddress(
        issuance.beneficiaryAddress,
        "Hosted RevNet issuance beneficiary address",
      ),
      chainId: issuance.chainId,
      memo: buildHostedRevnetPaymentMemo(issuance.id),
      paymentAmount: requireHostedRevnetIssuanceBigInt(
        issuance.paymentAmount,
        "Hosted RevNet issuance payment amount",
      ),
      projectId: requireHostedRevnetIssuanceBigInt(
        issuance.projectId,
        "Hosted RevNet issuance project id",
      ),
      terminalAddress: requireHostedRevnetIssuanceAddress(
        issuance.terminalAddress,
        "Hosted RevNet issuance terminal address",
      ),
    });

    issuance = await input.prisma.hostedRevnetIssuance.update({
      where: {
        id: issuance.id,
      },
      data: {
        failureCode: null,
        failureMessage: null,
        payTxHash: submission.payTxHash,
        status: HostedRevnetIssuanceStatus.submitted,
        submittedAt: new Date(),
      },
    });
  } catch (error) {
    const failure = classifyHostedRevnetIssuanceFailure(error);

    await input.prisma.hostedRevnetIssuance.update({
      where: {
        id: issuance.id,
      },
      data: {
        failureCode: failure.code,
        failureMessage: failure.message,
        status: failure.bucket === "broadcast_unknown"
          ? HostedRevnetIssuanceStatus.submitting
          : HostedRevnetIssuanceStatus.failed,
      },
    });
  }
}

function buildHostedRevnetPaymentMemo(issuanceId: string): string {
  return `issuance:${issuanceId}`;
}

function isHostedRevnetIssuanceSubmittingStale(updatedAt: Date): boolean {
  return updatedAt.getTime() <= Date.now() - HOSTED_REVNET_SUBMITTING_STALE_MS;
}

function requireHostedRevnetIssuanceBigInt(value: string, label: string): bigint {
  if (!/^\d+$/u.test(value)) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_INVALID",
      message: `${label} must be an unsigned integer string.`,
      httpStatus: 503,
      retryable: true,
    });
  }

  return BigInt(value);
}

function requireHostedRevnetIssuanceAddress(value: string, label: string) {
  const address = coerceHostedWalletAddress(value);

  if (!address) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_INVALID",
      message: `${label} must be a valid EVM address.`,
      httpStatus: 503,
      retryable: true,
    });
  }

  return address;
}

function serializeHostedRevnetIssuanceFailure(error: unknown): {
  code: string;
  message: string;
} {
  if (isHostedOnboardingError(error)) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      code: "REVNET_PAYMENT_FAILED",
      message: error.message,
    };
  }

  return {
    code: "REVNET_PAYMENT_FAILED",
    message: "Unknown Hosted RevNet issuance failure.",
  };
}

function classifyHostedRevnetIssuanceFailure(error: unknown): {
  bucket: "broadcast_unknown" | "definitely_not_broadcast";
  code: string;
  message: string;
} {
  if (isHostedRevnetBroadcastStatusUnknownError(error)) {
    const failure = serializeHostedRevnetIssuanceFailure(error);

    return {
      bucket: "broadcast_unknown",
      code: REVNET_BROADCAST_STATUS_UNKNOWN_CODE,
      message: failure.message,
    };
  }

  const failure = serializeHostedRevnetIssuanceFailure(error);

  return {
    bucket: "definitely_not_broadcast",
    code: failure.code,
    message: failure.message,
  };
}

function isHostedRevnetIssuanceBroadcastStatusUnknown(issuance: HostedRevnetIssuanceRecord): boolean {
  return (
    issuance.status === HostedRevnetIssuanceStatus.submitting &&
    issuance.failureCode === REVNET_BROADCAST_STATUS_UNKNOWN_CODE
  );
}

function shouldSkipHostedRevnetIssuanceSubmission(
  issuance: HostedRevnetIssuanceRecord | null,
): boolean {
  return Boolean(
    !issuance ||
      issuance.status === HostedRevnetIssuanceStatus.confirmed ||
      issuance.status === HostedRevnetIssuanceStatus.submitted ||
      issuance.payTxHash ||
      isHostedRevnetIssuanceBroadcastStatusUnknown(issuance) ||
      (issuance.status === HostedRevnetIssuanceStatus.submitting &&
        !isHostedRevnetIssuanceSubmittingStale(issuance.updatedAt)),
  );
}

async function findOrCreateHostedRevnetIssuance(input: {
  amountPaid: number;
  beneficiaryAddress: ReturnType<typeof requireHostedMemberWalletAddressForRevnet>;
  chargeId: string | null;
  config: ReturnType<typeof requireHostedRevnetConfig>;
  idempotencyKey: string;
  invoiceId: string;
  memberId: string;
  paymentAmount: bigint;
  paymentIntentId: string | null;
  prisma: PrismaClient;
}): Promise<HostedRevnetIssuanceRecord> {
  const existingIssuance = await input.prisma.hostedRevnetIssuance.findUnique({
    where: {
      idempotencyKey: input.idempotencyKey,
    },
  });

  if (existingIssuance) {
    return existingIssuance;
  }

  try {
    return await input.prisma.hostedRevnetIssuance.create({
      data: {
        id: generateHostedRevnetIssuanceId(),
        memberId: input.memberId,
        idempotencyKey: input.idempotencyKey,
        stripeInvoiceId: input.invoiceId,
        stripePaymentIntentId: input.paymentIntentId,
        stripeChargeId: input.chargeId,
        chainId: input.config.chainId,
        projectId: input.config.projectId.toString(),
        terminalAddress: input.config.terminalAddress,
        paymentAssetAddress: REVNET_NATIVE_TOKEN,
        beneficiaryAddress: input.beneficiaryAddress.toLowerCase(),
        stripePaymentAmountMinor: input.amountPaid,
        stripePaymentCurrency: input.config.stripeCurrency,
        paymentAmount: input.paymentAmount.toString(),
        status: HostedRevnetIssuanceStatus.pending,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const issuance = await input.prisma.hostedRevnetIssuance.findUnique({
        where: {
          idempotencyKey: input.idempotencyKey,
        },
      });

      if (issuance) {
        return issuance;
      }
    }

    throw error;
  }
}

async function patchHostedRevnetIssuanceStripeReferences(input: {
  chargeId: string | null;
  issuance: HostedRevnetIssuanceRecord;
  paymentIntentId: string | null;
  prisma: PrismaClient;
}): Promise<HostedRevnetIssuanceRecord> {
  const updateData: {
    stripeChargeId?: string;
    stripePaymentIntentId?: string;
  } = {};

  if (!input.issuance.stripePaymentIntentId && input.paymentIntentId) {
    updateData.stripePaymentIntentId = input.paymentIntentId;
  }

  if (!input.issuance.stripeChargeId && input.chargeId) {
    updateData.stripeChargeId = input.chargeId;
  }

  if (Object.keys(updateData).length === 0) {
    return input.issuance;
  }

  return input.prisma.hostedRevnetIssuance.update({
    where: {
      id: input.issuance.id,
    },
    data: updateData,
  });
}

async function recordHostedWebhookReceipt(input: {
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: PrismaClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim | null> {
  const now = new Date();
  const receipt = buildHostedWebhookProcessingReceipt({
    eventPayload: input.eventPayload,
    receivedAt: now,
  });

  try {
    await input.prisma.hostedWebhookReceipt.create({
      data: {
        source: input.source,
        eventId: input.eventId,
        firstReceivedAt: now,
        payloadJson: toHostedWebhookReceiptJsonInput(receipt.payloadJson),
      },
    });
    return receipt;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return reclaimHostedWebhookReceipt(input, now);
    }

    throw error;
  }
}

async function reclaimHostedWebhookReceipt(
  input: {
    eventId: string;
    eventPayload: HostedWebhookEventPayload;
    prisma: PrismaClient;
    source: string;
  },
  receivedAt: Date,
): Promise<HostedWebhookReceiptClaim | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existingReceipt = await input.prisma.hostedWebhookReceipt.findUnique({
      where: {
        source_eventId: {
          eventId: input.eventId,
          source: input.source,
        },
      },
      select: {
        payloadJson: true,
      },
    });

    if (!existingReceipt) {
      const receipt = buildHostedWebhookProcessingReceipt({
        eventPayload: input.eventPayload,
        receivedAt,
      });
      try {
        await input.prisma.hostedWebhookReceipt.create({
          data: {
            source: input.source,
            eventId: input.eventId,
            firstReceivedAt: receivedAt,
            payloadJson: toHostedWebhookReceiptJsonInput(receipt.payloadJson),
          },
        });
        return receipt;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue;
        }

        throw error;
      }
    }

    const existingState = readHostedWebhookReceiptState(existingReceipt.payloadJson);

    if (existingState.status === "completed" || existingState.status === "processing") {
      return null;
    }

    const nextReceipt = buildHostedWebhookProcessingReceipt({
      eventPayload: input.eventPayload,
      previousState: existingState,
      receivedAt,
    });
    const updatedReceipt = await input.prisma.hostedWebhookReceipt.updateMany({
      where: {
        source: input.source,
        eventId: input.eventId,
        payloadJson: {
          equals: existingReceipt.payloadJson ?? Prisma.JsonNull,
        },
      },
      data: {
        payloadJson: toHostedWebhookReceiptJsonInput(nextReceipt.payloadJson),
      },
    });

    if (updatedReceipt.count === 1) {
      return nextReceipt;
    }
  }

  throw hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_CLAIM_FAILED",
    message: "Hosted webhook receipt could not be claimed safely for processing.",
    httpStatus: 503,
    retryable: true,
  });
}

async function markHostedWebhookReceiptCompleted(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: PrismaClient;
  source: string;
}): Promise<void> {
  await updateHostedWebhookReceiptStatus({
    claimedReceipt: input.claimedReceipt,
    eventId: input.eventId,
    eventPayload: input.eventPayload,
    prisma: input.prisma,
    source: input.source,
    status: "completed",
  });
}

async function markHostedWebhookReceiptFailed(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  error: unknown;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: PrismaClient;
  source: string;
}): Promise<void> {
  await updateHostedWebhookReceiptStatus({
    claimedReceipt: input.claimedReceipt,
    error: input.error,
    eventId: input.eventId,
    eventPayload: input.eventPayload,
    prisma: input.prisma,
    source: input.source,
    status: "failed",
  });
}

async function queueHostedWebhookReceiptSideEffects(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  desiredSideEffects: HostedWebhookSideEffect[];
  eventId: string;
  prisma: PrismaClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  if (input.desiredSideEffects.length === 0) {
    return input.claimedReceipt;
  }

  return updateHostedWebhookReceiptClaim({
    claimedReceipt: input.claimedReceipt,
    eventId: input.eventId,
    mutate(currentState) {
      return replaceHostedWebhookReceiptState(currentState, {
        sideEffects: mergeHostedWebhookSideEffects(currentState.sideEffects, input.desiredSideEffects),
      });
    },
    prisma: input.prisma,
    source: input.source,
  });
}

async function drainHostedWebhookReceiptSideEffects(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  eventId: string;
  prisma: PrismaClient;
  signal?: AbortSignal;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  let currentClaim = input.claimedReceipt;

  for (const queuedEffect of currentClaim.state.sideEffects) {
    if (queuedEffect.status === "sent") {
      continue;
    }

    const startedAt = new Date().toISOString();
    currentClaim = await updateHostedWebhookReceiptClaim({
      claimedReceipt: currentClaim,
      eventId: input.eventId,
      mutate(currentState) {
        return replaceHostedWebhookReceiptState(currentState, {
          sideEffects: replaceHostedWebhookSideEffects(currentState.sideEffects, queuedEffect.effectId, (effect) => ({
            ...effect,
            attemptCount: effect.attemptCount + 1,
            lastAttemptAt: startedAt,
            lastError: null,
          })),
        });
      },
      prisma: input.prisma,
      source: input.source,
    });

    const effect = getHostedWebhookSideEffect(currentClaim.state, queuedEffect.effectId);

    try {
      if (effect.kind === "hosted_execution_dispatch") {
        const sentAt = new Date().toISOString();
        currentClaim = await markHostedWebhookDispatchEffectQueued({
          claimedReceipt: currentClaim,
          dispatchEffect: effect,
          eventId: input.eventId,
          prisma: input.prisma,
          sentAt,
          source: input.source,
        });
        await drainHostedExecutionOutboxBestEffort({
          context: `hosted-onboarding ${input.source} event=${input.eventId}`,
          eventIds: [effect.payload.dispatch.eventId],
          prisma: input.prisma,
        });
        continue;
      }

      const result = await performHostedWebhookSideEffect(effect, {
        signal: input.signal,
      });
      const sentAt = new Date().toISOString();
      currentClaim = await updateHostedWebhookReceiptClaim({
        claimedReceipt: currentClaim,
        eventId: input.eventId,
        mutate(currentState) {
          return replaceHostedWebhookReceiptState(currentState, {
            sideEffects: replaceHostedWebhookSideEffects(currentState.sideEffects, effect.effectId, (currentEffect) =>
              markHostedWebhookSideEffectSent(currentEffect, result, sentAt),
            ),
          });
        },
        prisma: input.prisma,
        source: input.source,
      });

      if (effect.kind === "linq_message_send" && effect.payload.inviteId) {
        await markHostedInviteSentBestEffort(effect.payload.inviteId, input.prisma);
      }
    } catch (error) {
      currentClaim = await updateHostedWebhookReceiptClaim({
        claimedReceipt: currentClaim,
        eventId: input.eventId,
        mutate(currentState) {
          return replaceHostedWebhookReceiptState(currentState, {
            sideEffects: replaceHostedWebhookSideEffects(currentState.sideEffects, effect.effectId, (currentEffect) => ({
              ...currentEffect,
              lastError: serializeHostedWebhookSideEffectError(error),
              status: "pending",
            })),
          });
        },
        prisma: input.prisma,
        source: input.source,
      });
      throw new HostedWebhookReceiptSideEffectDrainError(currentClaim, error);
    }
  }

  return currentClaim;
}

async function markHostedWebhookDispatchEffectQueued(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  dispatchEffect: HostedWebhookDispatchSideEffect;
  eventId: string;
  prisma: PrismaClient;
  sentAt: string;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  let currentClaim = input.claimedReceipt;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextState = replaceHostedWebhookReceiptState(currentClaim.state, {
      sideEffects: replaceHostedWebhookSideEffects(
        currentClaim.state.sideEffects,
        input.dispatchEffect.effectId,
        (currentEffect) => markHostedWebhookSideEffectSent(currentEffect, { dispatched: true }, input.sentAt),
      ),
    });
    const nextClaim: HostedWebhookReceiptClaim = {
      payloadJson: serializeHostedWebhookReceiptState(nextState),
      state: nextState,
    };
    const updatedCount = await enqueueHostedWebhookDispatchEffect({
      eventId: input.eventId,
      nextClaim,
      prisma: input.prisma,
      previousClaim: currentClaim,
      source: input.source,
      dispatch: input.dispatchEffect.payload.dispatch,
    });

    if (updatedCount === 1) {
      return nextClaim;
    }

    const latestReceipt = await input.prisma.hostedWebhookReceipt.findUnique({
      where: {
        source_eventId: {
          eventId: input.eventId,
          source: input.source,
        },
      },
      select: {
        payloadJson: true,
      },
    });

    if (!latestReceipt) {
      break;
    }

    currentClaim = {
      payloadJson: latestReceipt.payloadJson,
      state: readHostedWebhookReceiptState(latestReceipt.payloadJson),
    };
  }

  throw hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_UPDATE_FAILED",
    message: "Hosted webhook receipt could not be updated safely.",
    httpStatus: 503,
    retryable: true,
  });
}

async function enqueueHostedWebhookDispatchEffect(input: {
  dispatch: HostedExecutionDispatchRequest;
  eventId: string;
  nextClaim: HostedWebhookReceiptClaim;
  previousClaim: HostedWebhookReceiptClaim;
  prisma: PrismaClient;
  source: string;
}): Promise<number> {
  if (typeof input.prisma.$transaction === "function") {
    return input.prisma.$transaction(async (tx) => {
      await enqueueHostedExecutionOutbox({
        dispatch: input.dispatch,
        sourceId: `${input.source}:${input.eventId}`,
        sourceType: "hosted_webhook_receipt",
        tx,
      });
      const updatedReceipt = await tx.hostedWebhookReceipt.updateMany({
        where: {
          source: input.source,
          eventId: input.eventId,
          payloadJson: {
            equals: input.previousClaim.payloadJson ?? Prisma.JsonNull,
          },
        },
        data: {
          payloadJson: toHostedWebhookReceiptJsonInput(input.nextClaim.payloadJson),
        },
      });

      return updatedReceipt.count;
    });
  }

  await enqueueHostedExecutionOutbox({
    dispatch: input.dispatch,
    sourceId: `${input.source}:${input.eventId}`,
    sourceType: "hosted_webhook_receipt",
    tx: input.prisma as unknown as Prisma.TransactionClient,
  });
  const updatedReceipt = await input.prisma.hostedWebhookReceipt.updateMany({
    where: {
      source: input.source,
      eventId: input.eventId,
      payloadJson: {
        equals: input.previousClaim.payloadJson ?? Prisma.JsonNull,
      },
    },
    data: {
      payloadJson: toHostedWebhookReceiptJsonInput(input.nextClaim.payloadJson),
    },
  });

  return updatedReceipt.count;
}

async function updateHostedWebhookReceiptStatus(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  error?: unknown;
  eventId: string;
  eventPayload: HostedWebhookEventPayload;
  prisma: PrismaClient;
  source: string;
  status: "completed" | "failed";
}): Promise<void> {
  const receivedAt = new Date().toISOString();
  await updateHostedWebhookReceiptClaim({
    claimedReceipt: input.claimedReceipt,
    eventId: input.eventId,
    mutate(currentState) {
      return replaceHostedWebhookReceiptState(currentState, {
        completedAt: input.status === "completed" ? receivedAt : null,
        eventPayload: mergeHostedWebhookEventPayload(
          input.eventPayload,
          currentState.eventPayload,
        ),
        lastError:
          input.status === "failed"
            ? serializeHostedWebhookReceiptError(input.error)
            : null,
        lastReceivedAt: receivedAt,
        status: input.status,
      });
    },
    prisma: input.prisma,
    source: input.source,
  });
}

function buildHostedWebhookProcessingReceipt(input: {
  eventPayload: HostedWebhookEventPayload;
  previousState?: HostedWebhookReceiptState | null;
  receivedAt: Date;
}): HostedWebhookReceiptClaim {
  const state = buildHostedWebhookReceiptState({
    attemptCount: Math.max(input.previousState?.attemptCount ?? 0, 0) + 1,
    attemptId: generateHostedWebhookReceiptAttemptId(),
    completedAt: null,
    eventPayload: mergeHostedWebhookEventPayload(
      input.eventPayload,
      input.previousState?.eventPayload ?? null,
    ),
    lastError: null,
    lastReceivedAt: input.receivedAt.toISOString(),
    sideEffects: input.previousState?.sideEffects ?? [],
    status: "processing",
  });

  return {
    payloadJson: serializeHostedWebhookReceiptState(state),
    state,
  };
}

function buildHostedWebhookReceiptState(input: {
  attemptCount: number;
  attemptId: string | null;
  completedAt: string | null;
  eventPayload: HostedWebhookEventPayload;
  lastError: HostedWebhookReceiptErrorState | null;
  lastReceivedAt: string | null;
  sideEffects: HostedWebhookSideEffect[];
  status: HostedWebhookReceiptStatus | null;
}): HostedWebhookReceiptState {
  return {
    attemptCount: Math.max(Math.trunc(input.attemptCount), 1),
    attemptId: input.attemptId,
    completedAt: input.status === "completed" ? input.completedAt : null,
    eventPayload: input.eventPayload,
    lastError: input.status === "failed" ? input.lastError : null,
    lastReceivedAt: input.lastReceivedAt,
    sideEffects: input.sideEffects,
    status: input.status,
  };
}

function serializeHostedWebhookReceiptState(
  receiptState: HostedWebhookReceiptState,
): Prisma.InputJsonValue {
  return {
    eventPayload: receiptState.eventPayload,
    receiptState: {
      attemptCount: Math.max(Math.trunc(receiptState.attemptCount), 1),
      attemptId: receiptState.attemptId ?? generateHostedWebhookReceiptAttemptId(),
      completedAt: receiptState.status === "completed" ? receiptState.completedAt : null,
      lastError: receiptState.status === "failed" ? receiptState.lastError : null,
      lastReceivedAt: receiptState.lastReceivedAt,
      sideEffects: receiptState.sideEffects.map((effect) => serializeHostedWebhookSideEffect(effect)),
      status: receiptState.status,
    },
  } satisfies Prisma.InputJsonObject;
}

function readHostedWebhookReceiptState(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookReceiptState {
  const payloadObject = toHostedWebhookReceiptObject(payloadJson);
  const nestedState = toHostedWebhookReceiptObject(payloadObject.receiptState);
  const attemptId = readHostedWebhookReceiptString(
    nestedState.attemptId ?? payloadObject.receiptAttemptId,
  );
  const attemptCount = readHostedWebhookReceiptNumber(
    nestedState.attemptCount ?? payloadObject.receiptAttemptCount,
  );
  const status = readHostedWebhookReceiptStatusValue(
    nestedState.status ?? payloadObject.receiptStatus,
  );

  return {
    attemptCount: Math.max(attemptCount, 0),
    attemptId,
    completedAt: readHostedWebhookReceiptString(
      nestedState.completedAt ?? payloadObject.receiptCompletedAt,
    ),
    eventPayload: readHostedWebhookReceiptEventPayload(payloadJson),
    lastError: readHostedWebhookReceiptError(
      nestedState.lastError ?? payloadObject.receiptLastError,
    ),
    lastReceivedAt: readHostedWebhookReceiptString(
      nestedState.lastReceivedAt ?? payloadObject.receiptLastReceivedAt,
    ),
    sideEffects: readHostedWebhookReceiptSideEffects(
      nestedState.sideEffects ?? payloadObject.receiptSideEffects,
    ),
    status,
  };
}

function readHostedWebhookReceiptEventPayload(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookEventPayload {
  if (payloadJson && typeof payloadJson === "object" && !Array.isArray(payloadJson)) {
    const payloadObject = payloadJson as Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null>;
    const nestedEventPayload = payloadObject.eventPayload;

    if (nestedEventPayload && typeof nestedEventPayload === "object" && !Array.isArray(nestedEventPayload)) {
      return nestedEventPayload as HostedWebhookEventPayload;
    }

    const legacyEventPayload = { ...payloadObject };
    delete legacyEventPayload.receiptAttemptCount;
    delete legacyEventPayload.receiptAttemptId;
    delete legacyEventPayload.receiptCompletedAt;
    delete legacyEventPayload.receiptLastError;
    delete legacyEventPayload.receiptLastReceivedAt;
    delete legacyEventPayload.receiptSideEffects;
    delete legacyEventPayload.receiptState;
    delete legacyEventPayload.receiptStatus;

    return legacyEventPayload as HostedWebhookEventPayload;
  }

  return {};
}

function readHostedWebhookReceiptError(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookReceiptErrorState | null {
  const errorObject = toHostedWebhookReceiptObject(value);
  const message = readHostedWebhookReceiptString(errorObject.message);
  const name = readHostedWebhookReceiptString(errorObject.name);

  return message && name
    ? {
        message,
        name,
      }
    : null;
}

function mergeHostedWebhookEventPayload(
  eventPayload: HostedWebhookEventPayload,
  previousEventPayload: HostedWebhookEventPayload | null,
): HostedWebhookEventPayload {
  return {
    ...(previousEventPayload ?? {}),
    ...eventPayload,
  };
}

function readHostedWebhookReceiptSideEffects(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookSideEffect[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sideEffects: HostedWebhookSideEffect[] = [];

  for (const candidate of value) {
    const parsed = readHostedWebhookSideEffect(candidate);
    if (parsed) {
      sideEffects.push(parsed);
    }
  }

  return sideEffects;
}

function readHostedWebhookReceiptNumber(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(Math.trunc(value), 0)
    : 0;
}

function readHostedWebhookReceiptString(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function readHostedWebhookReceiptStatusValue(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookReceiptStatus | null {
  return value === "completed" || value === "failed" || value === "processing"
    ? value
    : null;
}

function readHostedWebhookSideEffectStatusValue(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookSideEffectStatus | null {
  return value === "pending" || value === "sent"
    ? value
    : null;
}

function serializeHostedWebhookReceiptError(error: unknown): HostedWebhookReceiptErrorState {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  if (typeof error === "string") {
    return {
      message: error,
      name: "Error",
    };
  }

  return {
    message: "Unknown hosted webhook failure.",
    name: "UnknownError",
  };
}

function serializeHostedWebhookSideEffectError(error: unknown): HostedWebhookSideEffectErrorState {
  if (isHostedOnboardingError(error)) {
    return {
      code: error.code,
      message: error.message,
      name: error.name,
      retryable: error.retryable ?? null,
    };
  }

  if (error instanceof Error) {
    return {
      code: null,
      message: error.message,
      name: error.name,
      retryable: readHostedWebhookSideEffectRetryable(error),
    };
  }

  if (typeof error === "string") {
    return {
      code: null,
      message: error,
      name: "Error",
      retryable: null,
    };
  }

  return {
    code: null,
    message: "Unknown hosted side-effect failure.",
    name: "UnknownError",
    retryable: null,
  };
}

function readHostedWebhookSideEffectError(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookSideEffectErrorState | null {
  const errorObject = toHostedWebhookReceiptObject(value);
  const message = readHostedWebhookReceiptString(errorObject.message);
  const name = readHostedWebhookReceiptString(errorObject.name);

  return message && name
    ? {
        code: readHostedWebhookReceiptString(errorObject.code),
        message,
        name,
        retryable:
          typeof errorObject.retryable === "boolean"
            ? errorObject.retryable
            : null,
      }
    : null;
}

function serializeHostedWebhookSideEffect(
  effect: HostedWebhookSideEffect,
): Prisma.InputJsonObject {
  return {
    attemptCount: effect.attemptCount,
    effectId: effect.effectId,
    kind: effect.kind,
    lastAttemptAt: effect.lastAttemptAt,
    lastError: effect.lastError,
    payload: effect.payload as unknown as Prisma.InputJsonValue,
    result: effect.result as unknown as Prisma.InputJsonValue,
    sentAt: effect.sentAt,
    status: effect.status,
  } satisfies Prisma.InputJsonObject;
}

function readHostedWebhookSideEffect(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookSideEffect | null {
  const effectObject = toHostedWebhookReceiptObject(value);
  const effectId = readHostedWebhookReceiptString(effectObject.effectId);
  const kind = readHostedWebhookReceiptString(effectObject.kind);
  const status = readHostedWebhookSideEffectStatusValue(effectObject.status);

  if (!effectId || !kind || !status) {
    return null;
  }

  const attemptCount = readHostedWebhookReceiptNumber(effectObject.attemptCount);
  const lastAttemptAt = readHostedWebhookReceiptString(effectObject.lastAttemptAt);
  const lastError = readHostedWebhookSideEffectError(effectObject.lastError);
  const sentAt = readHostedWebhookReceiptString(effectObject.sentAt);
  const payload = toHostedWebhookReceiptObject(effectObject.payload);
  const result = toHostedWebhookReceiptObject(effectObject.result);

  switch (kind) {
    case "hosted_execution_dispatch": {
      const dispatchPayload = payload.dispatch;

      if (!dispatchPayload || typeof dispatchPayload !== "object" || Array.isArray(dispatchPayload)) {
        return null;
      }

      return {
        attemptCount,
        effectId,
        kind,
        lastAttemptAt,
        lastError,
        payload: {
          dispatch: dispatchPayload as unknown as HostedExecutionDispatchRequest,
        },
        result: result.dispatched === true ? { dispatched: true } : null,
        sentAt,
        status,
      };
    }
    case "linq_message_send": {
      const chatId = readHostedWebhookReceiptString(payload.chatId);
      const message = readHostedWebhookReceiptString(payload.message);

      if (!chatId || !message) {
        return null;
      }

      return {
        attemptCount,
        effectId,
        kind,
        lastAttemptAt,
        lastError,
        payload: {
          chatId,
          inviteId: readHostedWebhookReceiptString(payload.inviteId),
          message,
        },
        result:
          Object.keys(result).length === 0
            ? null
            : {
                chatId: readHostedWebhookReceiptString(result.chatId),
                messageId: readHostedWebhookReceiptString(result.messageId),
              },
        sentAt,
        status,
      };
    }
    default:
      return null;
  }
}

function readHostedWebhookSideEffectRetryable(error: Error): boolean | null {
  return "retryable" in error && typeof error.retryable === "boolean"
    ? error.retryable
    : null;
}

function readHostedWebhookReceiptDrainError(
  error: unknown,
): HostedWebhookReceiptSideEffectDrainError | null {
  return error instanceof HostedWebhookReceiptSideEffectDrainError
    ? error
    : null;
}

function generateHostedWebhookReceiptAttemptId(): string {
  return randomBytes(16).toString("hex");
}

function replaceHostedWebhookReceiptState(
  currentState: HostedWebhookReceiptState,
  overrides: Partial<HostedWebhookReceiptState>,
): HostedWebhookReceiptState {
  return buildHostedWebhookReceiptState({
    attemptCount: "attemptCount" in overrides ? overrides.attemptCount ?? 0 : currentState.attemptCount,
    attemptId: "attemptId" in overrides ? overrides.attemptId ?? null : currentState.attemptId,
    completedAt: "completedAt" in overrides ? overrides.completedAt ?? null : currentState.completedAt,
    eventPayload: "eventPayload" in overrides ? overrides.eventPayload ?? {} : currentState.eventPayload,
    lastError: "lastError" in overrides ? overrides.lastError ?? null : currentState.lastError,
    lastReceivedAt: "lastReceivedAt" in overrides ? overrides.lastReceivedAt ?? null : currentState.lastReceivedAt,
    sideEffects: "sideEffects" in overrides ? overrides.sideEffects ?? [] : currentState.sideEffects,
    status: "status" in overrides ? overrides.status ?? null : currentState.status,
  });
}

function mergeHostedWebhookSideEffects(
  currentSideEffects: readonly HostedWebhookSideEffect[],
  desiredSideEffects: readonly HostedWebhookSideEffect[],
): HostedWebhookSideEffect[] {
  const remainingEffects = new Map(
    currentSideEffects.map((effect) => [effect.effectId, effect] as const),
  );
  const mergedEffects: HostedWebhookSideEffect[] = [];

  for (const desiredEffect of desiredSideEffects) {
    const currentEffect = remainingEffects.get(desiredEffect.effectId);
    remainingEffects.delete(desiredEffect.effectId);
    mergedEffects.push(
      currentEffect
        ? mergeHostedWebhookSideEffect(currentEffect, desiredEffect)
        : desiredEffect,
    );
  }

  for (const currentEffect of currentSideEffects) {
    if (remainingEffects.has(currentEffect.effectId)) {
      mergedEffects.push(currentEffect);
    }
  }

  return mergedEffects;
}

function mergeHostedWebhookSideEffect(
  currentEffect: HostedWebhookSideEffect,
  desiredEffect: HostedWebhookSideEffect,
): HostedWebhookSideEffect {
  if (currentEffect.kind !== desiredEffect.kind) {
    return desiredEffect;
  }

  switch (desiredEffect.kind) {
    case "hosted_execution_dispatch": {
      const currentDispatchEffect = currentEffect as HostedWebhookDispatchSideEffect;
      return {
        ...desiredEffect,
        attemptCount: currentDispatchEffect.attemptCount,
        lastAttemptAt: currentDispatchEffect.lastAttemptAt,
        lastError: currentDispatchEffect.status === "sent" ? null : currentDispatchEffect.lastError,
        result: currentDispatchEffect.status === "sent" ? currentDispatchEffect.result : null,
        sentAt: currentDispatchEffect.status === "sent" ? currentDispatchEffect.sentAt : null,
        status: currentDispatchEffect.status === "sent" ? "sent" : "pending",
      };
    }
    case "linq_message_send": {
      const currentLinqEffect = currentEffect as HostedWebhookLinqMessageSideEffect;
      return {
        ...desiredEffect,
        attemptCount: currentLinqEffect.attemptCount,
        lastAttemptAt: currentLinqEffect.lastAttemptAt,
        lastError: currentLinqEffect.status === "sent" ? null : currentLinqEffect.lastError,
        result: currentLinqEffect.status === "sent" ? currentLinqEffect.result : null,
        sentAt: currentLinqEffect.status === "sent" ? currentLinqEffect.sentAt : null,
        status: currentLinqEffect.status === "sent" ? "sent" : "pending",
      };
    }
    default:
      return desiredEffect;
  }
}

function replaceHostedWebhookSideEffects(
  currentSideEffects: readonly HostedWebhookSideEffect[],
  effectId: string,
  mutate: (effect: HostedWebhookSideEffect) => HostedWebhookSideEffect,
): HostedWebhookSideEffect[] {
  return currentSideEffects.map((effect) => effect.effectId === effectId ? mutate(effect) : effect);
}

function getHostedWebhookSideEffect(
  state: HostedWebhookReceiptState,
  effectId: string,
): HostedWebhookSideEffect {
  const effect = state.sideEffects.find((candidate) => candidate.effectId === effectId);

  if (!effect) {
    throw new Error(`Hosted webhook side effect ${effectId} was not found.`);
  }

  return effect;
}

function markHostedWebhookSideEffectSent(
  effect: HostedWebhookSideEffect,
  result: { dispatched: true } | { chatId: string | null; messageId: string | null },
  sentAt: string,
): HostedWebhookSideEffect {
  switch (effect.kind) {
    case "hosted_execution_dispatch":
      return {
        ...effect,
        lastError: null,
        result: result as HostedWebhookDispatchSideEffect["result"],
        sentAt,
        status: "sent",
      };
    case "linq_message_send":
      return {
        ...effect,
        lastError: null,
        result: result as HostedWebhookLinqMessageSideEffect["result"],
        sentAt,
        status: "sent",
      };
    default:
      return effect;
  }
}

async function updateHostedWebhookReceiptClaim(input: {
  claimedReceipt: HostedWebhookReceiptClaim;
  eventId: string;
  mutate: (currentState: HostedWebhookReceiptState) => HostedWebhookReceiptState;
  prisma: PrismaClient;
  source: string;
}): Promise<HostedWebhookReceiptClaim> {
  let currentClaim = input.claimedReceipt;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextState = input.mutate(currentClaim.state);
    const nextClaim: HostedWebhookReceiptClaim = {
      payloadJson: serializeHostedWebhookReceiptState(nextState),
      state: nextState,
    };
    const updatedReceipt = await input.prisma.hostedWebhookReceipt.updateMany({
      where: {
        source: input.source,
        eventId: input.eventId,
        payloadJson: {
          equals: currentClaim.payloadJson ?? Prisma.JsonNull,
        },
      },
      data: {
        payloadJson: toHostedWebhookReceiptJsonInput(nextClaim.payloadJson),
      },
    });

    if (updatedReceipt.count === 1) {
      return nextClaim;
    }

    const latestReceipt = await input.prisma.hostedWebhookReceipt.findUnique({
      where: {
        source_eventId: {
          eventId: input.eventId,
          source: input.source,
        },
      },
      select: {
        payloadJson: true,
      },
    });

    if (!latestReceipt) {
      break;
    }

    currentClaim = {
      payloadJson: latestReceipt.payloadJson,
      state: readHostedWebhookReceiptState(latestReceipt.payloadJson),
    };
  }

  throw hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_UPDATE_FAILED",
    message: "Hosted webhook receipt could not be updated safely.",
    httpStatus: 503,
    retryable: true,
  });
}

async function performHostedWebhookSideEffect(
  effect: HostedWebhookSideEffect,
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<{ dispatched: true } | { chatId: string | null; messageId: string | null }> {
  switch (effect.kind) {
    case "hosted_execution_dispatch":
      throw new Error("Hosted execution dispatch effects must be queued through the execution outbox.");
    case "linq_message_send":
      return sendHostedLinqChatMessage({
        chatId: effect.payload.chatId,
        message: effect.payload.message,
        signal: options.signal,
      });
    default:
      throw new Error(`Unsupported hosted webhook side effect kind: ${JSON.stringify(effect)}`);
  }
}

async function markHostedInviteSentBestEffort(
  inviteId: string,
  prisma: PrismaClient,
): Promise<void> {
  try {
    await prisma.hostedInvite.update({
      where: {
        id: inviteId,
      },
      data: {
        sentAt: new Date(),
      },
    });
  } catch (error) {
    console.error(
      "Hosted invite sentAt update failed.",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function toHostedWebhookReceiptObject(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null> {
  if (payloadJson && typeof payloadJson === "object" && !Array.isArray(payloadJson)) {
    return payloadJson as Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null>;
  }

  if (payloadJson === null || payloadJson === undefined) {
    return {};
  }

  return {
    payload: payloadJson,
  };
}

function toHostedWebhookReceiptJsonInput(
  value: HostedWebhookReceiptClaim["payloadJson"],
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null
    ? Prisma.JsonNull
    : value as Prisma.InputJsonValue;
}

async function applyStripeCheckoutCompleted(
  session: Stripe.Checkout.Session,
  dispatchContext: {
    occurredAt: string;
    sourceEventId: string;
  },
  prisma: PrismaClient,
): Promise<HostedWebhookSideEffect[]> {
  const desiredSideEffects: HostedWebhookSideEffect[] = [];
  const member = await findMemberForStripeObject({
    clientReferenceId: normalizeNullableString(session.client_reference_id),
    customerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
    memberId: normalizeNullableString(session.metadata?.memberId),
    prisma,
    subscriptionId: coerceStripeSubscriptionId(session.subscription),
  });
  const inviteId = normalizeNullableString(session.metadata?.inviteId);
  const billingStatus = resolveHostedCheckoutCompletedBillingStatus({
    currentBillingStatus: member?.billingStatus ?? null,
    mode: session.mode,
    paymentStatus: session.payment_status,
    revnetSubscription:
      isHostedOnboardingRevnetEnabled() && session.mode === "subscription",
  });

  if (member) {
    const updatedMember = await prisma.hostedMember.update({
      where: { id: member.id },
      data: {
        billingMode: session.mode === "subscription" ? HostedBillingMode.subscription : HostedBillingMode.payment,
        billingStatus,
        status:
          member.status === HostedMemberStatus.suspended
            ? HostedMemberStatus.suspended
            : billingStatus === HostedBillingStatus.active
              ? HostedMemberStatus.active
              : member.status,
        stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? member.stripeCustomerId,
        stripeSubscriptionId: coerceStripeSubscriptionId(session.subscription) ?? member.stripeSubscriptionId,
        stripeLatestCheckoutSessionId: session.id,
      },
    });
    if (
      updatedMember.status !== HostedMemberStatus.suspended &&
      billingStatus === HostedBillingStatus.active &&
      !(isHostedOnboardingRevnetEnabled() && session.mode === "subscription")
    ) {
      desiredSideEffects.push(
        createHostedWebhookDispatchSideEffect({
          dispatch: buildHostedMemberActivationDispatch({
            linqChatId: updatedMember.linqChatId,
            memberId: updatedMember.id,
            normalizedPhoneNumber: updatedMember.normalizedPhoneNumber,
            occurredAt: dispatchContext.occurredAt,
            sourceEventId: dispatchContext.sourceEventId,
            sourceType: "stripe.checkout.session.completed",
          }),
        }),
      );
    }
  }

  await prisma.hostedBillingCheckout.updateMany({
    where: {
      stripeCheckoutSessionId: session.id,
    },
    data: {
      amountTotal: session.amount_total ?? null,
      completedAt: new Date(),
      currency: session.currency ?? null,
      status: HostedBillingCheckoutStatus.completed,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
      stripeSubscriptionId: coerceStripeSubscriptionId(session.subscription),
    },
  });

  if (inviteId && billingStatus === HostedBillingStatus.active) {
    await prisma.hostedInvite.updateMany({
      where: { id: inviteId },
      data: {
        paidAt: new Date(),
        status: HostedInviteStatus.paid,
      },
    });
  }

  return desiredSideEffects;
}

async function applyStripeCheckoutExpired(session: Stripe.Checkout.Session, prisma: PrismaClient): Promise<void> {
  await prisma.hostedBillingCheckout.updateMany({
    where: {
      stripeCheckoutSessionId: session.id,
    },
    data: {
      expiredAt: new Date(),
      status: HostedBillingCheckoutStatus.expired,
    },
  });

  const member = await findMemberForStripeObject({
    clientReferenceId: normalizeNullableString(session.client_reference_id),
    customerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
    memberId: normalizeNullableString(session.metadata?.memberId),
    prisma,
    subscriptionId: coerceStripeSubscriptionId(session.subscription),
  });

  if (member && member.billingStatus === HostedBillingStatus.checkout_open) {
    await prisma.hostedMember.update({
      where: {
        id: member.id,
      },
      data: {
        billingStatus: HostedBillingStatus.not_started,
      },
    });
  }
}

async function applyStripeSubscriptionUpdated(
  subscription: Stripe.Subscription,
  dispatchContext: {
    occurredAt: string;
    sourceEventId: string;
    sourceType: string;
  },
  prisma: PrismaClient,
): Promise<HostedWebhookSideEffect[]> {
  const desiredSideEffects: HostedWebhookSideEffect[] = [];
  const member = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    memberId: normalizeNullableString(subscription.metadata?.memberId),
    prisma,
    subscriptionId: subscription.id,
  });

  if (!member) {
    return desiredSideEffects;
  }

  const billingStatus = resolveHostedSubscriptionBillingStatus({
    currentBillingStatus: member.billingStatus,
    nextBillingStatus: mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status),
    revnetEnabled: isHostedOnboardingRevnetEnabled(),
  });

  const updatedMember = await prisma.hostedMember.update({
    where: {
      id: member.id,
    },
    data: {
      billingMode: HostedBillingMode.subscription,
      billingStatus,
      status:
        member.status === HostedMemberStatus.suspended
          ? HostedMemberStatus.suspended
          : billingStatus === HostedBillingStatus.active
            ? HostedMemberStatus.active
            : member.status,
      stripeCustomerId:
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      stripeSubscriptionId: subscription.id,
    },
  });
  if (
    updatedMember.status !== HostedMemberStatus.suspended &&
    billingStatus === HostedBillingStatus.active &&
    !isHostedOnboardingRevnetEnabled()
  ) {
    desiredSideEffects.push(
      createHostedWebhookDispatchSideEffect({
        dispatch: buildHostedMemberActivationDispatch({
          linqChatId: updatedMember.linqChatId,
          memberId: updatedMember.id,
          normalizedPhoneNumber: updatedMember.normalizedPhoneNumber,
          occurredAt: dispatchContext.occurredAt,
          sourceEventId: dispatchContext.sourceEventId,
          sourceType: dispatchContext.sourceType,
        }),
      }),
    );
  }
  await prisma.hostedBillingCheckout.updateMany({
    where: {
      memberId: member.id,
      stripeSubscriptionId: null,
    },
    data: {
      stripeSubscriptionId: subscription.id,
    },
  });

  return desiredSideEffects;
}

async function applyStripeInvoicePaid(
  invoice: Stripe.Invoice,
  dispatchContext: {
    occurredAt: string;
    sourceEventId: string;
  },
  prisma: PrismaClient,
): Promise<HostedWebhookSideEffect[]> {
  const desiredSideEffects: HostedWebhookSideEffect[] = [];
  const subscriptionId = resolveStripeInvoiceSubscriptionId(invoice);
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  const member = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId,
    memberId: null,
    prisma,
    subscriptionId,
  });

  if (!member) {
    return desiredSideEffects;
  }

  const updatedMember = await prisma.hostedMember.update({
    where: {
      id: member.id,
    },
    data: {
      billingMode: subscriptionId ? HostedBillingMode.subscription : member.billingMode,
      billingStatus: HostedBillingStatus.active,
      status:
        member.status === HostedMemberStatus.suspended
          ? HostedMemberStatus.suspended
          : HostedMemberStatus.active,
      stripeCustomerId: customerId ?? member.stripeCustomerId,
      stripeSubscriptionId: subscriptionId ?? member.stripeSubscriptionId,
    },
  });

  if (updatedMember.status === HostedMemberStatus.suspended) {
    return desiredSideEffects;
  }
  await prisma.hostedInvite.updateMany({
    where: {
      memberId: member.id,
      paidAt: null,
    },
    data: {
      paidAt: new Date(),
      status: HostedInviteStatus.paid,
    },
  });
  desiredSideEffects.push(
    createHostedWebhookDispatchSideEffect({
      dispatch: buildHostedMemberActivationDispatch({
        linqChatId: updatedMember.linqChatId,
        memberId: updatedMember.id,
        normalizedPhoneNumber: updatedMember.normalizedPhoneNumber,
        occurredAt: dispatchContext.occurredAt,
        sourceEventId: dispatchContext.sourceEventId,
        sourceType: "stripe.invoice.paid",
      }),
    }),
  );

  try {
    await maybeIssueHostedRevnetForStripeInvoice({
      invoice,
      member: updatedMember,
      prisma,
    });
  } catch (error) {
    console.error(
      "Hosted RevNet invoice issuance failed after Stripe invoice.paid; member activation remains active.",
      error instanceof Error ? error.message : String(error),
    );
  }

  return desiredSideEffects;
}

async function applyStripeInvoicePaymentFailed(invoice: Stripe.Invoice, prisma: PrismaClient): Promise<void> {
  const subscriptionId = resolveStripeInvoiceSubscriptionId(invoice);
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  const member = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId,
    memberId: null,
    prisma,
    subscriptionId,
  });

  if (!member) {
    return;
  }

  await prisma.hostedMember.update({
    where: {
      id: member.id,
    },
    data: {
      billingStatus: member.billingMode === HostedBillingMode.subscription
        ? HostedBillingStatus.past_due
        : HostedBillingStatus.incomplete,
      stripeCustomerId: customerId ?? member.stripeCustomerId,
      stripeSubscriptionId: subscriptionId ?? member.stripeSubscriptionId,
    },
  });
}

function resolveHostedCheckoutCompletedBillingStatus(input: {
  currentBillingStatus: HostedBillingStatus | null;
  mode: Stripe.Checkout.Session.Mode | null;
  paymentStatus: Stripe.Checkout.Session.PaymentStatus | null;
  revnetSubscription: boolean;
}): HostedBillingStatus {
  if (input.mode === "subscription") {
    const paymentSettled =
      input.paymentStatus === "paid" || input.paymentStatus === "no_payment_required";

    if (!paymentSettled) {
      return HostedBillingStatus.incomplete;
    }

    if (
      input.revnetSubscription &&
      input.currentBillingStatus !== HostedBillingStatus.active
    ) {
      return HostedBillingStatus.incomplete;
    }

    return HostedBillingStatus.active;
  }

  return input.paymentStatus === "paid"
    ? HostedBillingStatus.active
    : HostedBillingStatus.checkout_open;
}

function resolveHostedSubscriptionBillingStatus(input: {
  currentBillingStatus: HostedBillingStatus;
  nextBillingStatus: HostedBillingStatus;
  revnetEnabled: boolean;
}): HostedBillingStatus {
  if (
    input.revnetEnabled &&
    input.nextBillingStatus === HostedBillingStatus.active &&
    input.currentBillingStatus !== HostedBillingStatus.active
  ) {
    return HostedBillingStatus.incomplete;
  }

  return input.nextBillingStatus;
}

function resolveStripeInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parentSubscriptionId = coerceStripeObjectId(
    (
      invoice as Stripe.Invoice & {
        parent?: {
          subscription_details?: {
            subscription?: unknown;
          } | null;
        } | null;
      }
    ).parent?.subscription_details?.subscription ?? null,
  );

  if (parentSubscriptionId) {
    return parentSubscriptionId;
  }

  return coerceStripeObjectId(
    (
      invoice as Stripe.Invoice & {
        subscription?: unknown;
      }
    ).subscription ?? null,
  );
}

async function applyStripeRefundCreated(
  refund: Stripe.Refund,
  sourceType: string,
  prisma: PrismaClient,
): Promise<void> {
  const customerContext = await resolveStripeCustomerContext({
    chargeId: coerceStripeObjectId(refund.charge),
    paymentIntentId: coerceStripeObjectId(refund.payment_intent),
  });
  const member = await findMemberForStripeReversal({
    chargeId: coerceStripeObjectId(refund.charge),
    customerId: customerContext.customerId,
    paymentIntentId: coerceStripeObjectId(refund.payment_intent),
    prisma,
    subscriptionId: null,
  });

  if (!member) {
    return;
  }

  await suspendHostedMemberForBillingReversal({
    member,
    prisma,
    reason: sourceType,
    stripeCustomerId: customerContext.customerId,
  });
}

async function applyStripeDisputeUpdated(
  dispute: Stripe.Dispute,
  sourceType: string,
  prisma: PrismaClient,
): Promise<void> {
  const paymentIntentId = coerceStripeObjectId(dispute.payment_intent);
  const chargeId = coerceStripeObjectId(dispute.charge);
  const customerContext = await resolveStripeCustomerContext({
    chargeId,
    paymentIntentId,
  });
  const member = await findMemberForStripeReversal({
    chargeId,
    customerId: customerContext.customerId,
    paymentIntentId,
    prisma,
    subscriptionId: null,
  });

  if (!member) {
    return;
  }

  await suspendHostedMemberForBillingReversal({
    member,
    prisma,
    reason: sourceType,
    stripeCustomerId: customerContext.customerId,
  });
}

async function suspendHostedMemberForBillingReversal(input: {
  member: HostedMember;
  prisma: PrismaClient;
  reason: string;
  stripeCustomerId?: string | null;
}): Promise<void> {
  await input.prisma.hostedMember.update({
    where: {
      id: input.member.id,
    },
    data: {
      billingStatus: HostedBillingStatus.unpaid,
      status: HostedMemberStatus.suspended,
      stripeCustomerId: input.stripeCustomerId ?? input.member.stripeCustomerId,
    },
  });
  await revokeHostedSessionsForMember({
    memberId: input.member.id,
    prisma: input.prisma,
    reason: `billing_reversal:${input.reason}`,
  });
}

async function findMemberForStripeObject(input: {
  clientReferenceId: string | null;
  customerId: string | null;
  memberId: string | null;
  prisma: PrismaClient;
  subscriptionId: string | null;
}): Promise<HostedMember | null> {
  if (input.memberId) {
    const member = await input.prisma.hostedMember.findUnique({
      where: {
        id: input.memberId,
      },
    });

    if (member) {
      return member;
    }
  }

  if (input.clientReferenceId) {
    const member = await input.prisma.hostedMember.findUnique({
      where: {
        id: input.clientReferenceId,
      },
    });

    if (member) {
      return member;
    }
  }

  if (input.subscriptionId) {
    const member = await input.prisma.hostedMember.findUnique({
      where: {
        stripeSubscriptionId: input.subscriptionId,
      },
    });

    if (member) {
      return member;
    }
  }

  if (input.customerId) {
    const member = await input.prisma.hostedMember.findUnique({
      where: {
        stripeCustomerId: input.customerId,
      },
    });

    if (member) {
      return member;
    }
  }

  return null;
}

async function findMemberForStripeReversal(input: {
  chargeId: string | null;
  customerId: string | null;
  paymentIntentId: string | null;
  prisma: PrismaClient;
  subscriptionId: string | null;
}): Promise<HostedMember | null> {
  const directMember = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId: input.customerId,
    memberId: null,
    prisma: input.prisma,
    subscriptionId: input.subscriptionId,
  });

  if (directMember) {
    return directMember;
  }

  if (!input.chargeId && !input.paymentIntentId) {
    return null;
  }

  const issuance = await input.prisma.hostedRevnetIssuance.findFirst({
    where: {
      OR: [
        ...(input.chargeId
          ? [
            {
              stripeChargeId: input.chargeId,
            },
          ]
          : []),
        ...(input.paymentIntentId
          ? [
            {
              stripePaymentIntentId: input.paymentIntentId,
            },
          ]
          : []),
      ],
    },
    include: {
      member: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return issuance?.member ?? null;
}

async function resolveStripeCustomerContext(input: {
  chargeId: string | null;
  paymentIntentId: string | null;
}): Promise<{ customerId: string | null }> {
  if (input.paymentIntentId) {
    const { stripe } = requireHostedOnboardingStripeConfig();
    const paymentIntent = await stripe.paymentIntents.retrieve(input.paymentIntentId);

    return {
      customerId: coerceStripeObjectId(
        (paymentIntent as Stripe.PaymentIntent & { customer?: unknown }).customer ?? null,
      ),
    };
  }

  if (input.chargeId) {
    const { stripe } = requireHostedOnboardingStripeConfig();
    const charge = await stripe.charges.retrieve(input.chargeId);

    return {
      customerId: coerceStripeObjectId((charge as Stripe.Charge & { customer?: unknown }).customer ?? null),
    };
  }

  return {
    customerId: null,
  };
}

function createHostedWebhookDispatchSideEffect(input: {
  dispatch: HostedExecutionDispatchRequest;
}): HostedWebhookDispatchSideEffect {
  return {
    attemptCount: 0,
    effectId: `dispatch:${input.dispatch.eventId}`,
    kind: "hosted_execution_dispatch",
    lastAttemptAt: null,
    lastError: null,
    payload: {
      dispatch: input.dispatch,
    },
    result: null,
    sentAt: null,
    status: "pending",
  };
}

function createHostedWebhookLinqMessageSideEffect(input: {
  chatId: string;
  inviteId: string | null;
  message: string;
  sourceEventId: string;
}): HostedWebhookLinqMessageSideEffect {
  return {
    attemptCount: 0,
    effectId: `linq-message:${input.sourceEventId}`,
    kind: "linq_message_send",
    lastAttemptAt: null,
    lastError: null,
    payload: {
      chatId: input.chatId,
      inviteId: input.inviteId,
      message: input.message,
    },
    result: null,
    sentAt: null,
    status: "pending",
  };
}
