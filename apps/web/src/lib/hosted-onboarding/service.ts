import { randomBytes } from "node:crypto";

import type { HostedExecutionDispatchRequest } from "@healthybob/runtime-state";
import { Prisma, type HostedInvite, type HostedMember, type PrismaClient } from "@prisma/client";
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
import { dispatchHostedExecution } from "../hosted-execution/dispatch";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  buildHostedInviteReply,
  parseHostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
  sendHostedLinqChatMessage,
  summarizeHostedLinqMessage,
  assertHostedLinqWebhookSignature,
} from "./linq";
import { hasHostedPrivyPhoneAuthConfig, type HostedPrivyIdentity } from "./privy";
import {
  getHostedOnboardingEnvironment,
  getHostedOnboardingSecretCodec,
  requireHostedOnboardingPublicBaseUrl,
  requireHostedOnboardingStripeConfig,
} from "./runtime";
import { applyHostedSessionCookie, createHostedSession, type HostedSessionRecord } from "./session";
import {
  generateHostedBootstrapSecret,
  generateHostedCheckoutId,
  generateHostedInviteCode,
  generateHostedInviteId,
  generateHostedMemberId,
  generateHostedRevnetIssuanceId,
  inviteExpiresAt,
  maskPhoneNumber,
  normalizeNullableString,
  normalizePhoneNumber,
  shouldStartHostedOnboarding,
} from "./shared";
import {
  buildStripeCancelUrl,
  buildStripeSuccessUrl,
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import {
  coerceHostedWalletAddress,
  convertStripeMinorAmountToRevnetPaymentAmount,
  isHostedOnboardingRevnetEnabled,
  normalizeHostedWalletAddress,
  requireHostedRevnetConfig,
  submitHostedRevnetPayment,
  waitForHostedRevnetPaymentConfirmation,
} from "./revnet";

import type { HostedInviteStatusPayload } from "./types";

type HostedRevnetIssuanceRecord = {
  id: string;
  idempotencyKey: string;
  payTxHash: string | null;
  status: HostedRevnetIssuanceStatus;
  updatedAt: Date;
};

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

export async function getHostedInviteStatus(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
  sessionRecord?: HostedSessionRecord | null;
}): Promise<HostedInviteStatusPayload> {
  const prisma = input.prisma ?? getPrisma();
  const environment = getHostedOnboardingEnvironment();
  const now = input.now ?? new Date();
  const invite = await findHostedInviteByCode(input.inviteCode, prisma);
  const billingReady = Boolean(environment.stripeSecretKey && environment.stripePriceId);
  const phoneAuthReady = hasHostedPrivyPhoneAuthConfig();

  if (!invite) {
    return {
      capabilities: {
        billingReady,
        phoneAuthReady,
      },
      invite: null,
      member: null,
      session: {
        authenticated: Boolean(input.sessionRecord),
        expiresAt: input.sessionRecord?.session.expiresAt.toISOString() ?? null,
        matchesInvite: false,
      },
      stage: "invalid",
    };
  }

  let inviteStatus = invite.status;

  if (invite.expiresAt <= now && invite.status !== HostedInviteStatus.expired) {
    await prisma.hostedInvite.update({
      where: { id: invite.id },
      data: {
        status: HostedInviteStatus.expired,
      },
    });
    inviteStatus = HostedInviteStatus.expired;
  } else if (!invite.openedAt) {
    const openedInvite = await prisma.hostedInvite.update({
      where: { id: invite.id },
      data: {
        openedAt: now,
        status:
          invite.status === HostedInviteStatus.pending
            ? HostedInviteStatus.opened
            : invite.status,
      },
      select: {
        openedAt: true,
        status: true,
      },
    });
    inviteStatus = openedInvite.status;
  }

  const sessionMatchesInvite = input.sessionRecord?.member.id === invite.memberId;
  const hasWallet = Boolean(invite.member.walletAddress);
  const hasPrivyIdentity = Boolean(invite.member.privyUserId && invite.member.walletAddress);
  const isActive = invite.member.billingStatus === HostedBillingStatus.active;
  const stage =
    invite.expiresAt <= now || inviteStatus === HostedInviteStatus.expired
      ? "expired"
      : sessionMatchesInvite
        ? isActive
          ? "active"
          : "checkout"
        : hasPrivyIdentity
          ? "authenticate"
          : "register";

  return {
    capabilities: {
      billingReady,
      phoneAuthReady,
    },
    invite: {
      code: invite.inviteCode,
      expiresAt: invite.expiresAt.toISOString(),
      phoneHint: maskPhoneNumber(invite.member.normalizedPhoneNumber),
      status: inviteStatus,
    },
    member: {
      billingStatus: invite.member.billingStatus,
      hasWallet,
      phoneHint: maskPhoneNumber(invite.member.normalizedPhoneNumber),
      phoneVerified: Boolean(invite.member.phoneNumberVerifiedAt),
      status: invite.member.status,
      walletAddress: invite.member.walletAddress,
      walletChainType: invite.member.walletChainType,
    },
    session: {
      authenticated: Boolean(input.sessionRecord),
      expiresAt: input.sessionRecord?.session.expiresAt.toISOString() ?? null,
      matchesInvite: Boolean(sessionMatchesInvite),
    },
    stage,
  };
}

export async function handleHostedOnboardingLinqWebhook(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<{
  duplicate?: boolean;
  ignored?: boolean;
  inviteCode?: string;
  joinUrl?: string;
  ok: true;
  reason?: string;
}> {
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
    const desiredSideEffects: HostedWebhookSideEffect[] = [];
    let response:
      | {
        duplicate?: boolean;
        ignored?: boolean;
        inviteCode?: string;
        joinUrl?: string;
        ok: true;
        reason?: string;
      };

    if (event.event_type !== "message.received") {
      response = {
        ok: true,
        ignored: true,
        reason: event.event_type,
      };
    } else {
      const messageEvent = requireHostedLinqMessageReceivedEvent(event);
      const summary = summarizeHostedLinqMessage(messageEvent);

      if (summary.isFromMe) {
        response = {
          ok: true,
          ignored: true,
          reason: "own-message",
        };
      } else {
        const normalizedPhoneNumber = normalizePhoneNumber(summary.phoneNumber);

        if (!normalizedPhoneNumber) {
          response = {
            ok: true,
            ignored: true,
            reason: "invalid-phone",
          };
        } else {
          const existingMember = await prisma.hostedMember.findUnique({
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
            desiredSideEffects.push(
              createHostedWebhookDispatchSideEffect({
                dispatch: {
                  event: {
                    kind: "linq.message.received",
                    linqChatId: summary.chatId,
                    linqEvent: event as unknown as Record<string, unknown>,
                    normalizedPhoneNumber,
                    userId: existingMember.id,
                  },
                  eventId: event.event_id,
                  occurredAt: event.created_at,
                },
              }),
            );

            response = {
              ok: true,
              ignored: false,
              reason: "dispatched-active-member",
            };
          } else {
            const shouldStart = !existingMember || shouldStartHostedOnboarding(summary.text);

            if (!shouldStart) {
              response = {
                ok: true,
                ignored: true,
                reason: "no-trigger",
              };
            } else {
              const member = await ensureHostedMemberForPhone({
                linqChatId: summary.chatId,
                normalizedPhoneNumber,
                originalPhoneNumber: summary.phoneNumber,
                prisma,
              });
              const invite = await issueHostedInvite({
                channel: "linq",
                linqChatId: summary.chatId,
                linqEventId: event.event_id,
                memberId: member.id,
                prisma,
                triggerText: summary.text,
              });
              const joinUrl = buildHostedInviteUrl(invite.inviteCode);
              desiredSideEffects.push(
                createHostedWebhookLinqMessageSideEffect({
                  chatId: summary.chatId,
                  inviteId: invite.id,
                  message: buildHostedInviteReply({
                    activeSubscription: member.billingStatus === HostedBillingStatus.active,
                    joinUrl,
                  }),
                  sourceEventId: event.event_id,
                }),
              );

              response = {
                ok: true,
                inviteCode: invite.inviteCode,
                joinUrl,
              };
            }
          }
        }
      }
    }

    claimedReceipt = await queueHostedWebhookReceiptSideEffects({
      claimedReceipt,
      desiredSideEffects,
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

    return response;
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

export async function completeHostedPrivyVerification(input: {
  identity: HostedPrivyIdentity;
  inviteCode?: string | null;
  now?: Date;
  prisma?: PrismaClient;
  userAgent?: string | null;
}) {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const invite = input.inviteCode
    ? await requireHostedInviteForAuthentication(input.inviteCode, prisma, now)
    : null;
  const member = invite
    ? await reconcileHostedPrivyIdentityOnMember({
        expectedPhoneNumber: invite.member.normalizedPhoneNumber,
        identity: input.identity,
        member: invite.member,
        prisma,
        now,
      })
    : await ensureHostedMemberForPrivyIdentity({
        identity: input.identity,
        prisma,
        now,
      });
  const activeInvite = invite ?? await issueHostedInvite({
    channel: "web",
    linqChatId: null,
    linqEventId: null,
    memberId: member.id,
    prisma,
    triggerText: null,
  });
  const stage = member.billingStatus === HostedBillingStatus.active ? "active" : "checkout";

  await prisma.hostedInvite.update({
    where: {
      id: activeInvite.id,
    },
    data: {
      authenticatedAt: now,
      status: stage === "active"
        ? HostedInviteStatus.paid
        : HostedInviteStatus.authenticated,
      ...(stage === "active" ? { paidAt: activeInvite.paidAt ?? now } : {}),
    },
  });

  const session = await createHostedSession({
    inviteId: activeInvite.id,
    memberId: member.id,
    now,
    prisma,
    userAgent: input.userAgent ?? null,
  });

  return {
    expiresAt: session.expiresAt,
    inviteCode: activeInvite.inviteCode,
    joinUrl: buildHostedInviteUrl(activeInvite.inviteCode),
    stage,
    token: session.token,
  };
}

export async function createHostedBillingCheckout(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
  sessionRecord: HostedSessionRecord;
  shareCode?: string | null;
  walletAddress?: string | null;
}): Promise<{ alreadyActive: boolean; url: string | null }> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const invite = await requireHostedInviteForAuthentication(input.inviteCode, prisma, now);

  if (input.sessionRecord.member.id !== invite.memberId) {
    throw hostedOnboardingError({
      code: "AUTH_INVITE_MISMATCH",
      message: "That invite belongs to a different hosted member.",
      httpStatus: 403,
    });
  }

  if (invite.member.billingStatus === HostedBillingStatus.active) {
    return {
      alreadyActive: true,
      url: null,
    };
  }

  const shareCode = normalizeNullableString(input.shareCode);
  const resolvedWalletAddress = resolveHostedMemberWalletAddress({
    existingWalletAddress: invite.member.walletAddress,
    nextWalletAddress: normalizeNullableString(input.walletAddress),
    requireWalletAddress: isHostedOnboardingRevnetEnabled(),
  });
  const { billingMode, priceId, stripe } = requireHostedOnboardingStripeConfig();
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
  const memberForCustomer = resolvedWalletAddress
    ? {
        ...invite.member,
        walletAddress: resolvedWalletAddress,
      }
    : invite.member;
  const customerId = await ensureHostedStripeCustomer({
    member: memberForCustomer,
    prisma,
    stripe,
  });
  const checkoutMetadata: Record<string, string> = {
    inviteCode: invite.inviteCode,
    inviteId: invite.id,
    memberId: invite.member.id,
    normalizedPhoneNumber: invite.member.normalizedPhoneNumber,
    ...(resolvedWalletAddress ? { walletAddress: resolvedWalletAddress } : {}),
  };
  const checkoutSessionParams: Stripe.Checkout.SessionCreateParams = {
    cancel_url: buildStripeCancelUrl(publicBaseUrl, invite.inviteCode, shareCode),
    client_reference_id: invite.member.id,
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: checkoutMetadata,
    mode: billingMode,
    success_url: buildStripeSuccessUrl(publicBaseUrl, invite.inviteCode, shareCode),
  };

  if (billingMode === "subscription") {
    checkoutSessionParams.subscription_data = {
      metadata: checkoutMetadata,
    };
  } else {
    checkoutSessionParams.payment_intent_data = {
      metadata: checkoutMetadata,
    };
  }

  const checkoutSession = await stripe.checkout.sessions.create(checkoutSessionParams);

  if (!checkoutSession.url) {
    throw hostedOnboardingError({
      code: "CHECKOUT_URL_MISSING",
      message: "Stripe Checkout did not return a redirect URL.",
      httpStatus: 502,
    });
  }

  await prisma.hostedBillingCheckout.create({
    data: {
      id: generateHostedCheckoutId(),
      memberId: invite.member.id,
      inviteId: invite.id,
      stripeCheckoutSessionId: checkoutSession.id,
      stripeCustomerId: customerId,
      stripeSubscriptionId: coerceStripeSubscriptionId(checkoutSession.subscription),
      priceId,
      mode: billingMode === "payment" ? HostedBillingMode.payment : HostedBillingMode.subscription,
      status: HostedBillingCheckoutStatus.open,
      checkoutUrl: checkoutSession.url,
    },
  });
  await prisma.hostedMember.update({
    where: {
      id: invite.member.id,
    },
    data: {
      billingMode: billingMode === "payment" ? HostedBillingMode.payment : HostedBillingMode.subscription,
      billingStatus: HostedBillingStatus.checkout_open,
      stripeCustomerId: customerId,
      stripeLatestCheckoutSessionId: checkoutSession.id,
      ...(resolvedWalletAddress ? { walletAddress: resolvedWalletAddress } : {}),
    },
  });

  return {
    alreadyActive: false,
    url: checkoutSession.url,
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

export async function buildHostedInvitePageData(input: {
  inviteCode: string;
  prisma?: PrismaClient;
  sessionRecord?: HostedSessionRecord | null;
}) {
  return getHostedInviteStatus(input);
}

export function attachHostedSessionCookie(input: {
  expiresAt: Date;
  response: import("next/server").NextResponse;
  token: string;
}): void {
  applyHostedSessionCookie(input.response, input.token, input.expiresAt);
}

async function findHostedInviteByCode(inviteCode: string, prisma: PrismaClient) {
  return prisma.hostedInvite.findUnique({
    where: {
      inviteCode,
    },
    include: {
      member: true,
      checkouts: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
  });
}

async function ensureHostedMemberForPhone(input: {
  linqChatId: string | null;
  normalizedPhoneNumber: string;
  originalPhoneNumber: string;
  prisma: PrismaClient;
}): Promise<HostedMember> {
  const existingMember = await input.prisma.hostedMember.findUnique({
    where: {
      normalizedPhoneNumber: input.normalizedPhoneNumber,
    },
  });

  if (existingMember) {
    return input.prisma.hostedMember.update({
      where: {
        id: existingMember.id,
      },
      data: {
        linqChatId: input.linqChatId,
        phoneNumber: input.originalPhoneNumber,
        phoneNumberVerifiedAt: new Date(),
        encryptedBootstrapSecret:
          existingMember.encryptedBootstrapSecret
            ? undefined
            : encryptHostedBootstrapSecret(),
        encryptionKeyVersion:
          existingMember.encryptionKeyVersion
            ? undefined
            : getHostedOnboardingEnvironment().encryptionKeyVersion,
      },
    });
  }

  return input.prisma.hostedMember.create({
    data: {
      id: generateHostedMemberId(),
      phoneNumber: input.originalPhoneNumber,
      normalizedPhoneNumber: input.normalizedPhoneNumber,
      phoneNumberVerifiedAt: new Date(),
      status: HostedMemberStatus.invited,
      billingStatus: HostedBillingStatus.not_started,
      linqChatId: input.linqChatId,
      encryptedBootstrapSecret: encryptHostedBootstrapSecret(),
      encryptionKeyVersion: getHostedOnboardingEnvironment().encryptionKeyVersion,
    },
  });
}

async function findHostedMemberForPrivyIdentity(input: {
  identity: HostedPrivyIdentity;
  prisma: PrismaClient;
}): Promise<HostedMember | null> {
  const matches = new Map<string, HostedMember>();
  const normalizedWalletAddress = normalizeHostedWalletAddress(input.identity.wallet.address);

  if (input.identity.userId) {
    const memberByPrivyUserId = await input.prisma.hostedMember.findUnique({
      where: {
        privyUserId: input.identity.userId,
      },
    });

    if (memberByPrivyUserId) {
      matches.set(memberByPrivyUserId.id, memberByPrivyUserId);
    }
  }

  const memberByPhoneNumber = await input.prisma.hostedMember.findUnique({
    where: {
      normalizedPhoneNumber: input.identity.phone.number,
    },
  });

  if (memberByPhoneNumber) {
    matches.set(memberByPhoneNumber.id, memberByPhoneNumber);
  }

  if (normalizedWalletAddress) {
    const memberByWalletAddress = await input.prisma.hostedMember.findUnique({
      where: {
        walletAddress: normalizedWalletAddress,
      },
    });

    if (memberByWalletAddress) {
      matches.set(memberByWalletAddress.id, memberByWalletAddress);
    }
  }

  if (matches.size > 1) {
    throw hostedOnboardingError({
      code: "PRIVY_IDENTITY_CONFLICT",
      message: "This verified phone session conflicts with an existing Healthy Bob account. Contact support so we can merge it safely.",
      httpStatus: 409,
    });
  }

  return matches.values().next().value ?? null;
}

async function ensureHostedMemberForPrivyIdentity(input: {
  identity: HostedPrivyIdentity;
  now: Date;
  prisma: PrismaClient;
}): Promise<HostedMember> {
  const existingMember = await findHostedMemberForPrivyIdentity({
    identity: input.identity,
    prisma: input.prisma,
  });

  if (!existingMember) {
    return input.prisma.hostedMember.create({
      data: {
        id: generateHostedMemberId(),
        phoneNumber: input.identity.phone.number,
        normalizedPhoneNumber: input.identity.phone.number,
        phoneNumberVerifiedAt: input.now,
        privyUserId: input.identity.userId,
        status: HostedMemberStatus.registered,
        billingStatus: HostedBillingStatus.not_started,
        walletAddress: normalizeHostedWalletAddress(input.identity.wallet.address),
        walletChainType: input.identity.wallet.chainType,
        walletProvider: "privy",
        walletCreatedAt: input.now,
        encryptedBootstrapSecret: encryptHostedBootstrapSecret(),
        encryptionKeyVersion: getHostedOnboardingEnvironment().encryptionKeyVersion,
      },
    });
  }

  return reconcileHostedPrivyIdentityOnMember({
    identity: input.identity,
    member: existingMember,
    prisma: input.prisma,
    now: input.now,
  });
}

async function reconcileHostedPrivyIdentityOnMember(input: {
  expectedPhoneNumber?: string;
  identity: HostedPrivyIdentity;
  member: HostedMember;
  prisma: PrismaClient;
  now: Date;
}): Promise<HostedMember> {
  if (input.expectedPhoneNumber && input.identity.phone.number !== input.expectedPhoneNumber) {
    throw hostedOnboardingError({
      code: "PRIVY_PHONE_MISMATCH",
      message: `Enter the same phone number that received this invite (${maskPhoneNumber(input.expectedPhoneNumber)}).`,
      httpStatus: 403,
    });
  }

  if (input.member.privyUserId && input.member.privyUserId !== input.identity.userId) {
    throw hostedOnboardingError({
      code: "PRIVY_USER_MISMATCH",
      message: "This phone number is already linked to a different Privy account.",
      httpStatus: 409,
    });
  }

  const normalizedWalletAddress = normalizeHostedWalletAddress(input.identity.wallet.address);

  if (
    input.member.walletAddress
    && normalizeHostedWalletAddress(input.member.walletAddress) !== normalizedWalletAddress
  ) {
    throw hostedOnboardingError({
      code: "PRIVY_WALLET_MISMATCH",
      message: "This phone number is already linked to a different rewards wallet.",
      httpStatus: 409,
    });
  }

  try {
    return await input.prisma.hostedMember.update({
      where: {
        id: input.member.id,
      },
      data: {
        phoneNumber: input.identity.phone.number,
        normalizedPhoneNumber: input.identity.phone.number,
        phoneNumberVerifiedAt: input.now,
        privyUserId: input.identity.userId,
        status: input.member.billingStatus === HostedBillingStatus.active
          ? HostedMemberStatus.active
          : HostedMemberStatus.registered,
        walletAddress: normalizedWalletAddress,
        walletChainType: input.identity.wallet.chainType,
        walletProvider: "privy",
        walletCreatedAt: input.member.walletCreatedAt ?? input.now,
        encryptedBootstrapSecret:
          input.member.encryptedBootstrapSecret
            ? undefined
            : encryptHostedBootstrapSecret(),
        encryptionKeyVersion:
          input.member.encryptionKeyVersion
            ? undefined
            : getHostedOnboardingEnvironment().encryptionKeyVersion,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw hostedOnboardingError({
        code: "PRIVY_IDENTITY_CONFLICT",
        message: "This verified phone session conflicts with an existing Healthy Bob account. Contact support so we can merge it safely.",
        httpStatus: 409,
      });
    }

    throw error;
  }
}

async function issueHostedInvite(input: {
  channel: "linq" | "share" | "web";
  linqChatId: string | null;
  linqEventId: string | null;
  memberId: string;
  prisma: PrismaClient;
  triggerText: string | null;
}): Promise<HostedInvite> {
  const now = new Date();
  const existingInvite = await input.prisma.hostedInvite.findFirst({
    where: {
      memberId: input.memberId,
      expiresAt: {
        gt: now,
      },
      status: {
        in: [
          HostedInviteStatus.pending,
          HostedInviteStatus.opened,
          HostedInviteStatus.authenticated,
          HostedInviteStatus.paid,
        ],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (existingInvite) {
    return input.prisma.hostedInvite.update({
      where: {
        id: existingInvite.id,
      },
      data: {
        channel: input.channel,
        linqChatId: input.linqChatId,
        linqEventId: input.linqEventId,
        triggerText: input.triggerText,
      },
    });
  }

  return input.prisma.hostedInvite.create({
    data: {
      id: generateHostedInviteId(),
      memberId: input.memberId,
      inviteCode: generateHostedInviteCode(),
      status: HostedInviteStatus.pending,
      channel: input.channel,
      triggerText: input.triggerText,
      linqChatId: input.linqChatId,
      linqEventId: input.linqEventId,
      expiresAt: inviteExpiresAt(now, getHostedOnboardingEnvironment().inviteTtlHours),
    },
  });
}

export async function issueHostedInviteForPhone(input: {
  channel?: "share" | "web";
  phoneNumber: string;
  prisma?: PrismaClient;
}): Promise<{ invite: HostedInvite; inviteUrl: string; member: HostedMember }> {
  const prisma = input.prisma ?? getPrisma();
  const normalizedPhoneNumber = normalizePhoneNumber(input.phoneNumber);

  if (!normalizedPhoneNumber) {
    throw hostedOnboardingError({
      code: "PHONE_NUMBER_INVALID",
      message: "A valid phone number is required to issue a hosted invite.",
      httpStatus: 400,
    });
  }

  const member = await ensureHostedMemberForPhone({
    linqChatId: null,
    normalizedPhoneNumber,
    originalPhoneNumber: input.phoneNumber,
    prisma,
  });
  const invite = await issueHostedInvite({
    channel: input.channel ?? "share",
    linqChatId: member.linqChatId,
    linqEventId: null,
    memberId: member.id,
    prisma,
    triggerText: null,
  });

  return {
    invite,
    inviteUrl: buildHostedInviteUrl(invite.inviteCode),
    member,
  };
}

function buildHostedInviteUrl(inviteCode: string): string {
  return `${requireHostedOnboardingPublicBaseUrl()}/join/${encodeURIComponent(inviteCode)}`;
}

function encryptHostedBootstrapSecret(): string {
  return getHostedOnboardingSecretCodec().encrypt(generateHostedBootstrapSecret());
}

async function requireHostedInviteForAuthentication(
  inviteCode: string,
  prisma: PrismaClient,
  now: Date,
) {
  const invite = await findHostedInviteByCode(inviteCode, prisma);

  if (!invite) {
    throw hostedOnboardingError({
      code: "INVITE_NOT_FOUND",
      message: "That Healthy Bob invite link is no longer valid.",
      httpStatus: 404,
    });
  }

  if (invite.expiresAt <= now || invite.status === HostedInviteStatus.expired) {
    throw hostedOnboardingError({
      code: "INVITE_EXPIRED",
      message: "That Healthy Bob invite link has expired. Text the number again for a fresh link.",
      httpStatus: 410,
    });
  }

  return invite;
}

async function ensureHostedStripeCustomer(input: {
  member: HostedMember;
  prisma: PrismaClient;
  stripe: Stripe;
}): Promise<string> {
  const customerMetadata = {
    memberId: input.member.id,
    normalizedPhoneNumber: input.member.normalizedPhoneNumber,
    ...(input.member.walletAddress ? { walletAddress: input.member.walletAddress } : {}),
  };

  if (input.member.stripeCustomerId) {
    await input.stripe.customers.update(input.member.stripeCustomerId, {
      metadata: customerMetadata,
      phone: input.member.normalizedPhoneNumber,
    });

    return input.member.stripeCustomerId;
  }

  const customer = await input.stripe.customers.create({
    metadata: customerMetadata,
    phone: input.member.normalizedPhoneNumber,
  });

  await input.prisma.hostedMember.update({
    where: {
      id: input.member.id,
    },
    data: {
      stripeCustomerId: customer.id,
      ...(input.member.walletAddress ? { walletAddress: input.member.walletAddress } : {}),
    },
  });

  return customer.id;
}

function resolveHostedMemberWalletAddress(input: {
  existingWalletAddress: string | null | undefined;
  nextWalletAddress: string | null | undefined;
  requireWalletAddress: boolean;
}): string | null {
  const normalizedNextWalletAddress = normalizeNullableString(input.nextWalletAddress);

  if (normalizedNextWalletAddress) {
    const walletAddress = normalizeHostedWalletAddress(normalizedNextWalletAddress);

    if (!walletAddress) {
      throw hostedOnboardingError({
        code: "HOSTED_WALLET_ADDRESS_INVALID",
        message: "The hosted wallet address must be a valid EVM address.",
        httpStatus: 400,
      });
    }

    return walletAddress;
  }

  const normalizedExistingWalletAddress = normalizeNullableString(input.existingWalletAddress);

  if (normalizedExistingWalletAddress) {
    const walletAddress = normalizeHostedWalletAddress(normalizedExistingWalletAddress);

    if (walletAddress) {
      return walletAddress;
    }

    if (!input.requireWalletAddress) {
      return null;
    }

    throw hostedOnboardingError({
      code: "HOSTED_WALLET_ADDRESS_INVALID",
      message: "The hosted wallet address must be a valid EVM address.",
      httpStatus: 400,
    });
  }

  if (input.requireWalletAddress) {
    throw hostedOnboardingError({
      code: "HOSTED_WALLET_ADDRESS_REQUIRED",
      message: "A hosted wallet address is required before Stripe checkout can begin.",
      httpStatus: 400,
    });
  }

  return null;
}

function requireHostedMemberWalletAddressForRevnet(member: HostedMember) {
  const walletAddress = coerceHostedWalletAddress(member.walletAddress);

  if (!walletAddress) {
    throw hostedOnboardingError({
      code: "REVNET_BENEFICIARY_REQUIRED",
      message: "Hosted RevNet issuance requires a valid wallet address on the hosted member.",
      httpStatus: 503,
      retryable: true,
      details: {
        memberId: member.id,
      },
    });
  }

  return walletAddress;
}

async function maybeIssueHostedRevnetForStripeInvoice(input: {
  invoice: Stripe.Invoice;
  member: HostedMember;
  prisma: PrismaClient;
}): Promise<void> {
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

  let issuance = await input.prisma.hostedRevnetIssuance.upsert({
    where: {
      idempotencyKey,
    },
    create: {
      id: generateHostedRevnetIssuanceId(),
      memberId: input.member.id,
      idempotencyKey,
      stripeInvoiceId: input.invoice.id,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: chargeId,
      chainId: config.chainId,
      projectId: config.projectId.toString(),
      terminalAddress: config.terminalAddress,
      paymentAssetAddress: REVNET_NATIVE_TOKEN,
      beneficiaryAddress: beneficiaryAddress.toLowerCase(),
      stripePaymentAmountMinor: amountPaid,
      stripePaymentCurrency: config.stripeCurrency,
      paymentAmount: paymentAmount.toString(),
      status: HostedRevnetIssuanceStatus.pending,
    },
    update: {
      stripePaymentIntentId: paymentIntentId ?? undefined,
      stripeChargeId: chargeId ?? undefined,
      beneficiaryAddress: beneficiaryAddress.toLowerCase(),
      paymentAssetAddress: REVNET_NATIVE_TOKEN,
      stripePaymentAmountMinor: amountPaid,
      stripePaymentCurrency: config.stripeCurrency,
      paymentAmount: paymentAmount.toString(),
    },
  });

  if (issuance.status === HostedRevnetIssuanceStatus.confirmed) {
    return;
  }

  if (
    issuance.payTxHash &&
    (issuance.status === HostedRevnetIssuanceStatus.submitted ||
      issuance.status === HostedRevnetIssuanceStatus.failed)
  ) {
    await confirmHostedRevnetIssuance({
      issuance,
      prisma: input.prisma,
    });
    return;
  }

  if (
    issuance.status === HostedRevnetIssuanceStatus.submitting &&
    !isHostedRevnetIssuanceSubmittingStale(issuance.updatedAt)
  ) {
    throw hostedOnboardingError({
      code: "REVNET_ISSUANCE_IN_FLIGHT",
      message: `Hosted RevNet issuance is already in flight for Stripe invoice ${input.invoice.id}.`,
      httpStatus: 503,
      retryable: true,
    });
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

    if (latestIssuance?.status === HostedRevnetIssuanceStatus.confirmed) {
      return;
    }

    if (
      latestIssuance?.payTxHash &&
      (latestIssuance.status === HostedRevnetIssuanceStatus.submitted ||
        latestIssuance.status === HostedRevnetIssuanceStatus.failed)
    ) {
      await confirmHostedRevnetIssuance({
        issuance: latestIssuance,
        prisma: input.prisma,
      });
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
      amountMinor: amountPaid,
      beneficiaryAddress,
      memo: buildHostedRevnetPaymentMemo(input.member.id, input.invoice.id),
    });

    issuance = await input.prisma.hostedRevnetIssuance.update({
      where: {
        id: issuance.id,
      },
      data: {
        payTxHash: submission.payTxHash,
        status: HostedRevnetIssuanceStatus.submitted,
        submittedAt: new Date(),
        paymentAmount: submission.paymentAmount.toString(),
      },
    });
  } catch (error) {
    const failure = serializeHostedRevnetIssuanceFailure(error);

    await input.prisma.hostedRevnetIssuance.update({
      where: {
        id: issuance.id,
      },
      data: {
        failureCode: failure.code,
        failureMessage: failure.message,
        status: HostedRevnetIssuanceStatus.failed,
      },
    });

    throw error;
  }

  await confirmHostedRevnetIssuance({
    issuance,
    prisma: input.prisma,
  });
}

async function confirmHostedRevnetIssuance(input: {
  issuance: HostedRevnetIssuanceRecord;
  prisma: PrismaClient;
}): Promise<void> {
  if (!input.issuance.payTxHash) {
    throw hostedOnboardingError({
      code: "REVNET_PAYMENT_HASH_MISSING",
      message: "Hosted RevNet issuance is missing the submitted transaction hash.",
      httpStatus: 503,
      retryable: true,
    });
  }

  try {
    await waitForHostedRevnetPaymentConfirmation({
      txHash: input.issuance.payTxHash as `0x${string}`,
    });
  } catch (error) {
    const failure = serializeHostedRevnetIssuanceFailure(error);

    await input.prisma.hostedRevnetIssuance.update({
      where: {
        id: input.issuance.id,
      },
      data: {
        failureCode: failure.code,
        failureMessage: failure.message,
        status: HostedRevnetIssuanceStatus.failed,
      },
    });

    throw error;
  }

  await input.prisma.hostedRevnetIssuance.update({
    where: {
      id: input.issuance.id,
    },
    data: {
      confirmedAt: new Date(),
      failureCode: null,
      failureMessage: null,
      status: HostedRevnetIssuanceStatus.confirmed,
    },
  });
}

function buildHostedRevnetPaymentMemo(memberId: string, invoiceId: string): string {
  return `HealthyBob invoice ${invoiceId} member ${memberId}`;
}

function isHostedRevnetIssuanceSubmittingStale(updatedAt: Date): boolean {
  return updatedAt.getTime() <= Date.now() - HOSTED_REVNET_SUBMITTING_STALE_MS;
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
      await dispatchHostedExecutionSafely(effect.payload.dispatch);
      return {
        dispatched: true,
      };
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
  const walletAddress = normalizeHostedWalletAddress(normalizeNullableString(session.metadata?.walletAddress));
  const billingStatus =
    session.mode === "subscription"
      ? session.payment_status === "paid" || session.payment_status === "no_payment_required"
        ? HostedBillingStatus.active
        : HostedBillingStatus.incomplete
      : session.payment_status === "paid"
        ? HostedBillingStatus.active
        : HostedBillingStatus.checkout_open;

  if (member) {
    const updatedMember = await prisma.hostedMember.update({
      where: { id: member.id },
      data: {
        billingMode: session.mode === "subscription" ? HostedBillingMode.subscription : HostedBillingMode.payment,
        billingStatus,
        status: billingStatus === HostedBillingStatus.active ? HostedMemberStatus.active : member.status,
        stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? member.stripeCustomerId,
        stripeSubscriptionId: coerceStripeSubscriptionId(session.subscription) ?? member.stripeSubscriptionId,
        stripeLatestCheckoutSessionId: session.id,
        ...(walletAddress ? { walletAddress } : {}),
      },
    });
    if (
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
  const billingStatus = mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status);
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

  const updatedMember = await prisma.hostedMember.update({
    where: {
      id: member.id,
    },
    data: {
      billingMode: HostedBillingMode.subscription,
      billingStatus,
      status: billingStatus === HostedBillingStatus.active ? HostedMemberStatus.active : member.status,
      stripeCustomerId:
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      stripeSubscriptionId: subscription.id,
    },
  });
  if (billingStatus === HostedBillingStatus.active && !isHostedOnboardingRevnetEnabled()) {
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
  const subscriptionId = coerceStripeSubscriptionId(
    invoice.parent?.subscription_details?.subscription,
  );
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
      status: HostedMemberStatus.active,
      stripeCustomerId: customerId ?? member.stripeCustomerId,
      stripeSubscriptionId: subscriptionId ?? member.stripeSubscriptionId,
    },
  });

  await maybeIssueHostedRevnetForStripeInvoice({
    invoice,
    member: updatedMember,
    prisma,
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

  return desiredSideEffects;
}

async function applyStripeInvoicePaymentFailed(invoice: Stripe.Invoice, prisma: PrismaClient): Promise<void> {
  const subscriptionId = coerceStripeSubscriptionId(
    invoice.parent?.subscription_details?.subscription,
  );
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

function buildHostedMemberActivationDispatch(input: {
  linqChatId: string | null;
  memberId: string;
  normalizedPhoneNumber: string;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
}): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "member.activated",
      linqChatId: input.linqChatId,
      normalizedPhoneNumber: input.normalizedPhoneNumber,
      userId: input.memberId,
    },
    eventId: buildHostedMemberActivationEventId(input),
    occurredAt: input.occurredAt,
  };
}

function buildHostedMemberActivationEventId(input: {
  memberId: string;
  sourceEventId: string;
  sourceType: string;
}): string {
  return `member.activated:${input.sourceType}:${input.memberId}:${input.sourceEventId}`;
}

async function dispatchHostedExecutionSafely(
  input: HostedExecutionDispatchRequest,
): Promise<void> {
  try {
    await dispatchHostedExecution(input);
  } catch (error) {
    console.error(
      "Hosted execution dispatch failed.",
      error instanceof Error ? error.message : String(error),
    );

    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_DISPATCH_FAILED",
      message: "Hosted execution dispatch failed and the webhook should be retried.",
      httpStatus: 503,
      retryable: true,
    });
  }
}
