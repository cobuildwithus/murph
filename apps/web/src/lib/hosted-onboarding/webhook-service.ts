import {
  buildHostedExecutionLinqMessageReceivedDispatch,
  type HostedExecutionDispatchRequest,
} from "@murph/hosted-execution";
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
  createHostedWebhookDispatchSideEffect,
  createHostedWebhookLinqMessageSideEffect,
  runHostedWebhookWithReceipt,
  type HostedWebhookDispatchEnqueueInput,
  type HostedWebhookDispatchSideEffect,
  type HostedWebhookLinqMessageSideEffect,
  type HostedWebhookSideEffect,
} from "./webhook-receipts";
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

const HOSTED_REVNET_SUBMITTING_STALE_MS = 5 * 60 * 1000;

type HostedOnboardingLinqWebhookResponse = {
  duplicate?: boolean;
  ignored?: boolean;
  inviteCode?: string;
  joinUrl?: string;
  ok: true;
  reason?: string;
};

type HostedStripeWebhookResponse = {
  duplicate?: boolean;
  ok: true;
  type: string;
};

type HostedOnboardingLinqWebhookPlan =
  | {
    desiredSideEffects: [];
    response: HostedOnboardingLinqWebhookResponse;
  }
  | {
    desiredSideEffects: [HostedWebhookDispatchSideEffect];
    response: HostedOnboardingLinqWebhookResponse;
  }
  | {
    desiredSideEffects: [HostedWebhookLinqMessageSideEffect];
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
  return runHostedWebhookWithReceipt({
    duplicateResponse: {
      ok: true,
      duplicate: true,
    },
    eventId: event.event_id,
    eventPayload: {
      eventType: event.event_type,
    },
    handlers: hostedWebhookReceiptHandlers(),
    plan: () =>
      planHostedOnboardingLinqWebhook({
        event,
        prisma,
      }),
    prisma,
    signal: input.signal,
    source: "linq",
  });
}

async function planHostedOnboardingLinqWebhook(input: {
  event: ReturnType<typeof parseHostedLinqWebhookEvent>;
  prisma: PrismaClient;
}): Promise<HostedOnboardingLinqWebhookPlan> {
  if (input.event.event_type !== "message.received") {
    return {
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
      desiredSideEffects: [
        createHostedWebhookDispatchSideEffect({
          dispatch: buildHostedExecutionLinqMessageReceivedDispatch({
            eventId: input.event.event_id,
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
}): Promise<HostedStripeWebhookResponse> {
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

  return runHostedWebhookWithReceipt({
    duplicateResponse: {
      ok: true,
      duplicate: true,
      type: event.type,
    },
    eventId: event.id,
    eventPayload: {
      type: event.type,
    },
    handlers: hostedWebhookReceiptHandlers(),
    plan: () =>
      planHostedStripeWebhook({
        event,
        prisma,
      }),
    prisma,
    source: "stripe",
  });
}

async function planHostedStripeWebhook(input: {
  event: Stripe.Event;
  prisma: PrismaClient;
}): Promise<{ desiredSideEffects: HostedWebhookSideEffect[]; response: HostedStripeWebhookResponse }> {
  const occurredAt = Number.isFinite(input.event.created)
    ? new Date(input.event.created * 1000).toISOString()
    : new Date().toISOString();
  let desiredSideEffects: HostedWebhookSideEffect[] = [];

  switch (input.event.type) {
    case "checkout.session.completed":
      desiredSideEffects = await applyStripeCheckoutCompleted(
        input.event.data.object as Stripe.Checkout.Session,
        {
          occurredAt,
          sourceEventId: input.event.id,
        },
        input.prisma,
      );
      break;
    case "checkout.session.expired":
      await applyStripeCheckoutExpired(input.event.data.object as Stripe.Checkout.Session, input.prisma);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      desiredSideEffects = await applyStripeSubscriptionUpdated(
        input.event.data.object as Stripe.Subscription,
        {
          occurredAt,
          sourceEventId: input.event.id,
          sourceType: input.event.type,
        },
        input.prisma,
      );
      break;
    case "invoice.paid":
      desiredSideEffects = await applyStripeInvoicePaid(
        input.event.data.object as Stripe.Invoice,
        {
          occurredAt,
          sourceEventId: input.event.id,
        },
        input.prisma,
      );
      break;
    case "invoice.payment_failed":
      await applyStripeInvoicePaymentFailed(input.event.data.object as Stripe.Invoice, input.prisma);
      break;
    case "refund.created":
      await applyStripeRefundCreated(input.event.data.object as Stripe.Refund, input.event.type, input.prisma);
      break;
    case "charge.dispute.created":
    case "charge.dispute.closed":
    case "charge.dispute.funds_reinstated":
    case "charge.dispute.funds_withdrawn":
      await applyStripeDisputeUpdated(input.event.data.object as Stripe.Dispute, input.event.type, input.prisma);
      break;
    default:
      break;
  }

  return {
    desiredSideEffects,
    response: {
      ok: true,
      type: input.event.type,
    },
  };
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

function hostedWebhookReceiptHandlers() {
  return {
    afterSideEffectSent: async ({
      effect,
      prisma,
    }: {
      effect: HostedWebhookSideEffect;
      prisma: PrismaClient;
    }) => {
      if (effect.kind === "linq_message_send" && effect.payload.inviteId) {
        await markHostedInviteSentBestEffort(effect.payload.inviteId, prisma);
      }
    },
    enqueueDispatchEffect: enqueueHostedWebhookDispatchEffect,
    performSideEffect: performHostedWebhookSideEffect,
  };
}

async function enqueueHostedWebhookDispatchEffect(input: HostedWebhookDispatchEnqueueInput): Promise<number> {
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
          payloadJson: input.nextPayloadJson,
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
      payloadJson: input.nextPayloadJson,
    },
  });

  return updatedReceipt.count;
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
            memberId: updatedMember.id,
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
          memberId: updatedMember.id,
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
        memberId: updatedMember.id,
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
