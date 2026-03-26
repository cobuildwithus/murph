import { randomBytes } from "node:crypto";

import { Prisma, type HostedInvite, type HostedMember, type PrismaClient } from "@prisma/client";
import {
  HostedBillingCheckoutStatus,
  HostedBillingMode,
  HostedBillingStatus,
  HostedInviteStatus,
  HostedMemberStatus,
  HostedPasskeyChallengeType,
} from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { dispatchHostedExecution } from "../hosted-execution/dispatch";
import { hostedOnboardingError } from "./errors";
import {
  buildHostedInviteReply,
  parseHostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
  sendHostedLinqChatMessage,
  summarizeHostedLinqMessage,
  assertHostedLinqWebhookSignature,
} from "./linq";
import {
  createHostedAuthenticationOptions,
  createHostedRegistrationOptions,
  decodeHostedPasskeyPublicKey,
  verifyHostedAuthentication,
  verifyHostedRegistration,
} from "./passkeys";
import { getHostedOnboardingEnvironment, getHostedOnboardingSecretCodec, requireHostedOnboardingPasskeyConfig, requireHostedOnboardingPublicBaseUrl, requireHostedOnboardingStripeConfig } from "./runtime";
import { applyHostedSessionCookie, createHostedSession, type HostedSessionRecord } from "./session";
import {
  challengeExpiresAt,
  generateHostedBootstrapSecret,
  generateHostedChallengeId,
  generateHostedCheckoutId,
  generateHostedInviteCode,
  generateHostedInviteId,
  generateHostedMemberId,
  generateHostedPasskeyId,
  generateHostedPasskeyUserId,
  inviteExpiresAt,
  maskPhoneNumber,
  normalizeNullableString,
  normalizePhoneNumber,
  shouldStartHostedOnboarding,
} from "./shared";
import {
  buildStripeCancelUrl,
  buildStripeSuccessUrl,
  coerceStripeSubscriptionId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";

import type { HostedInviteStatusPayload } from "./types";

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

  if (!invite) {
    return {
      capabilities: {
        billingReady: Boolean(environment.stripeSecretKey && environment.stripePriceId),
        passkeyReady: Boolean(environment.passkeyOrigin && environment.passkeyRpId),
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
  const hasPasskeys = invite.member.passkeys.length > 0;
  const isActive = invite.member.billingStatus === HostedBillingStatus.active;
  const stage =
    invite.expiresAt <= now || inviteStatus === HostedInviteStatus.expired
      ? "expired"
      : sessionMatchesInvite
        ? isActive
          ? "active"
          : "checkout"
        : hasPasskeys
          ? "authenticate"
          : "register";

  return {
    capabilities: {
      billingReady: Boolean(environment.stripeSecretKey && environment.stripePriceId),
      passkeyReady: Boolean(environment.passkeyOrigin && environment.passkeyRpId),
    },
    invite: {
      code: invite.inviteCode,
      expiresAt: invite.expiresAt.toISOString(),
      phoneHint: maskPhoneNumber(invite.member.normalizedPhoneNumber),
      status: inviteStatus,
    },
    member: {
      billingStatus: invite.member.billingStatus,
      hasPasskeys,
      phoneHint: maskPhoneNumber(invite.member.normalizedPhoneNumber),
      status: invite.member.status,
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
  const claimedReceipt = await recordHostedWebhookReceipt({
    eventId: event.event_id,
    payloadJson: {
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
            await dispatchHostedExecutionSafely({
              event: {
                kind: "linq.message.received",
                linqChatId: summary.chatId,
                linqEvent: event as unknown as Record<string, unknown>,
                normalizedPhoneNumber,
                userId: existingMember.id,
              },
              eventId: event.event_id,
              occurredAt: new Date().toISOString(),
            });

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
                linqChatId: summary.chatId,
                linqEventId: event.event_id,
                memberId: member.id,
                prisma,
                triggerText: summary.text,
              });
              const joinUrl = buildHostedInviteUrl(invite.inviteCode);
              await sendHostedLinqChatMessage({
                chatId: summary.chatId,
                message: buildHostedInviteReply({
                  activeSubscription: member.billingStatus === HostedBillingStatus.active,
                  joinUrl,
                }),
                signal: input.signal,
              });
              await prisma.hostedInvite.update({
                where: {
                  id: invite.id,
                },
                data: {
                  sentAt: new Date(),
                },
              });

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

    await markHostedWebhookReceiptCompleted({
      claimedReceipt,
      eventId: event.event_id,
      payloadJson: {
        eventType: event.event_type,
      },
      prisma,
      source: "linq",
    });

    return response;
  } catch (error) {
    await markHostedWebhookReceiptFailed({
      claimedReceipt,
      error,
      eventId: event.event_id,
      payloadJson: {
        eventType: event.event_type,
      },
      prisma,
      source: "linq",
    });
    throw error;
  }
}

export async function beginHostedPasskeyRegistration(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
}) {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const passkeyConfig = requireHostedOnboardingPasskeyConfig();
  const invite = await requireHostedInviteForAuthentication(input.inviteCode, prisma, now);
  const challenge = createRandomChallenge();

  await prisma.hostedPasskeyChallenge.deleteMany({
    where: {
      memberId: invite.memberId,
      inviteId: invite.id,
      type: HostedPasskeyChallengeType.registration,
    },
  });

  await prisma.hostedPasskeyChallenge.create({
    data: {
      id: generateHostedChallengeId(),
      memberId: invite.memberId,
      inviteId: invite.id,
      type: HostedPasskeyChallengeType.registration,
      challenge,
      expiresAt: challengeExpiresAt(now),
    },
  });

  return {
    options: createHostedRegistrationOptions({
      challenge,
      memberLabel: invite.member.phoneNumber,
      passkeys: invite.member.passkeys.map((passkey) => ({
        counter: passkey.counter,
        credentialId: passkey.credentialId,
        publicKey: passkey.publicKey,
        transports: passkey.transports,
      })),
      rpId: passkeyConfig.rpId,
      rpName: passkeyConfig.rpName,
      userId: invite.member.webauthnUserId,
    }),
  };
}

export async function finishHostedPasskeyRegistration(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
  response: unknown;
  userAgent?: string | null;
}) {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const passkeyConfig = requireHostedOnboardingPasskeyConfig();
  const invite = await requireHostedInviteForAuthentication(input.inviteCode, prisma, now);
  const challenge = await consumeHostedPasskeyChallenge({
    inviteId: invite.id,
    memberId: invite.memberId,
    now,
    prisma,
    type: HostedPasskeyChallengeType.registration,
  });
  const verification = await verifyHostedRegistration({
    credential: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: passkeyConfig.expectedOrigin,
    expectedRpId: passkeyConfig.rpId,
  });
  const credential = verification.credential;
  const existingPasskey = await prisma.hostedPasskey.findUnique({
    where: {
      credentialId: credential.id,
    },
  });

  if (existingPasskey && existingPasskey.memberId !== invite.memberId) {
    throw hostedOnboardingError({
      code: "PASSKEY_ALREADY_BOUND",
      message: "That passkey is already linked to a different hosted member.",
      httpStatus: 409,
    });
  }

  if (existingPasskey) {
    await prisma.hostedPasskey.update({
      where: {
        id: existingPasskey.id,
      },
      data: {
        publicKey: decodeHostedPasskeyPublicKey(credential.publicKey),
      },
    });
  } else {
    await prisma.hostedPasskey.create({
      data: {
        id: generateHostedPasskeyId(),
        memberId: invite.memberId,
        credentialId: credential.id,
        publicKey: decodeHostedPasskeyPublicKey(credential.publicKey),
      },
    });
  }

  await prisma.hostedMember.update({
    where: {
      id: invite.memberId,
    },
    data: {
      status: invite.member.billingStatus === HostedBillingStatus.active
        ? HostedMemberStatus.active
        : HostedMemberStatus.registered,
    },
  });
  await prisma.hostedInvite.update({
    where: {
      id: invite.id,
    },
    data: {
      authenticatedAt: now,
      status: invite.member.billingStatus === HostedBillingStatus.active
        ? HostedInviteStatus.paid
        : HostedInviteStatus.authenticated,
    },
  });

  const session = await createHostedSession({
    inviteId: invite.id,
    memberId: invite.memberId,
    now,
    prisma,
    userAgent: input.userAgent ?? null,
  });

  return {
    expiresAt: session.expiresAt,
    stage: invite.member.billingStatus === HostedBillingStatus.active ? "active" : "checkout",
    token: session.token,
  };
}

export async function beginHostedPasskeyAuthentication(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
}) {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const passkeyConfig = requireHostedOnboardingPasskeyConfig();
  const invite = await requireHostedInviteForAuthentication(input.inviteCode, prisma, now);

  if (invite.member.passkeys.length === 0) {
    throw hostedOnboardingError({
      code: "PASSKEY_NOT_FOUND",
      message: "No passkey is registered for this hosted member yet.",
      httpStatus: 404,
    });
  }

  const challenge = createRandomChallenge();

  await prisma.hostedPasskeyChallenge.deleteMany({
    where: {
      memberId: invite.memberId,
      inviteId: invite.id,
      type: HostedPasskeyChallengeType.authentication,
    },
  });
  await prisma.hostedPasskeyChallenge.create({
    data: {
      id: generateHostedChallengeId(),
      memberId: invite.memberId,
      inviteId: invite.id,
      type: HostedPasskeyChallengeType.authentication,
      challenge,
      expiresAt: challengeExpiresAt(now),
    },
  });

  return {
    options: createHostedAuthenticationOptions({
      challenge,
      passkeys: invite.member.passkeys.map((passkey) => ({
        counter: passkey.counter,
        credentialId: passkey.credentialId,
        publicKey: passkey.publicKey,
        transports: passkey.transports,
      })),
      rpId: passkeyConfig.rpId,
    }),
  };
}

export async function finishHostedPasskeyAuthentication(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
  response: unknown;
  userAgent?: string | null;
}) {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const passkeyConfig = requireHostedOnboardingPasskeyConfig();
  const invite = await requireHostedInviteForAuthentication(input.inviteCode, prisma, now);
  const challenge = await consumeHostedPasskeyChallenge({
    inviteId: invite.id,
    memberId: invite.memberId,
    now,
    prisma,
    type: HostedPasskeyChallengeType.authentication,
  });
  const credentialId = normalizeNullableString(
    input.response && typeof input.response === "object" && "id" in (input.response as Record<string, unknown>)
      ? (input.response as Record<string, unknown>).id
      : null,
  );

  if (!credentialId) {
    throw hostedOnboardingError({
      code: "PASSKEY_CREDENTIAL_REQUIRED",
      message: "Authentication response did not include a credential id.",
      httpStatus: 400,
    });
  }

  const passkey = await prisma.hostedPasskey.findUnique({
    where: {
      credentialId,
    },
  });

  if (!passkey || passkey.memberId !== invite.memberId) {
    throw hostedOnboardingError({
      code: "PASSKEY_NOT_FOUND",
      message: "That passkey is not linked to this invite.",
      httpStatus: 404,
    });
  }

  const verification = await verifyHostedAuthentication({
    expectedChallenge: challenge.challenge,
    expectedOrigin: passkeyConfig.expectedOrigin,
    expectedRpId: passkeyConfig.rpId,
    passkey: {
      credentialId: passkey.credentialId,
      publicKey: passkey.publicKey,
    },
    response: input.response,
  });

  if (!verification) {
    throw hostedOnboardingError({
      code: "PASSKEY_AUTH_FAILED",
      message: "Passkey authentication could not be verified.",
      httpStatus: 401,
    });
  }

  await prisma.hostedPasskey.update({
    where: {
      id: passkey.id,
    },
    data: {
      lastUsedAt: now,
    },
  });
  await prisma.hostedMember.update({
    where: {
      id: invite.memberId,
    },
    data: {
      status: invite.member.billingStatus === HostedBillingStatus.active
        ? HostedMemberStatus.active
        : HostedMemberStatus.registered,
    },
  });
  await prisma.hostedInvite.update({
    where: {
      id: invite.id,
    },
    data: {
      authenticatedAt: now,
      status: invite.member.billingStatus === HostedBillingStatus.active
        ? HostedInviteStatus.paid
        : HostedInviteStatus.authenticated,
    },
  });

  const session = await createHostedSession({
    inviteId: invite.id,
    memberId: invite.memberId,
    now,
    prisma,
    userAgent: input.userAgent ?? null,
  });

  return {
    expiresAt: session.expiresAt,
    stage: invite.member.billingStatus === HostedBillingStatus.active ? "active" : "checkout",
    token: session.token,
  };
}

export async function createHostedBillingCheckout(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
  sessionRecord: HostedSessionRecord;
  shareCode?: string | null;
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

  const { billingMode, priceId, stripe } = requireHostedOnboardingStripeConfig();
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
  const customerId = await ensureHostedStripeCustomer({
    member: invite.member,
    prisma,
    stripe,
  });
  const checkoutSession = await stripe.checkout.sessions.create({
    cancel_url: buildStripeCancelUrl(publicBaseUrl, invite.inviteCode, normalizeNullableString(input.shareCode)),
    client_reference_id: invite.member.id,
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      inviteCode: invite.inviteCode,
      inviteId: invite.id,
      memberId: invite.member.id,
      normalizedPhoneNumber: invite.member.normalizedPhoneNumber,
    },
    mode: billingMode,
    success_url: buildStripeSuccessUrl(publicBaseUrl, invite.inviteCode, normalizeNullableString(input.shareCode)),
  });

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

  const claimedReceipt = await recordHostedWebhookReceipt({
    eventId: event.id,
    payloadJson: {
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
    switch (event.type) {
      case "checkout.session.completed":
        await applyStripeCheckoutCompleted(event.data.object as Stripe.Checkout.Session, prisma);
        break;
      case "checkout.session.expired":
        await applyStripeCheckoutExpired(event.data.object as Stripe.Checkout.Session, prisma);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await applyStripeSubscriptionUpdated(event.data.object as Stripe.Subscription, prisma);
        break;
      case "invoice.paid":
        await applyStripeInvoicePaid(event.data.object as Stripe.Invoice, prisma);
        break;
      case "invoice.payment_failed":
        await applyStripeInvoicePaymentFailed(event.data.object as Stripe.Invoice, prisma);
        break;
      default:
        break;
    }

    await markHostedWebhookReceiptCompleted({
      claimedReceipt,
      eventId: event.id,
      payloadJson: {
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
    await markHostedWebhookReceiptFailed({
      claimedReceipt,
      error,
      eventId: event.id,
      payloadJson: {
        type: event.type,
      },
      prisma,
      source: "stripe",
    });
    throw error;
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
      member: {
        include: {
          passkeys: {
            orderBy: {
              createdAt: "asc",
            },
          },
        },
      },
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
      webauthnUserId: generateHostedPasskeyUserId(),
      status: HostedMemberStatus.invited,
      billingStatus: HostedBillingStatus.not_started,
      linqChatId: input.linqChatId,
      encryptedBootstrapSecret: encryptHostedBootstrapSecret(),
      encryptionKeyVersion: getHostedOnboardingEnvironment().encryptionKeyVersion,
    },
  });
}

async function issueHostedInvite(input: {
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
        channel: input.linqChatId ? "linq" : "share",
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
      channel: input.linqChatId ? "linq" : "share",
      triggerText: input.triggerText,
      linqChatId: input.linqChatId,
      linqEventId: input.linqEventId,
      expiresAt: inviteExpiresAt(now, getHostedOnboardingEnvironment().inviteTtlHours),
    },
  });
}

export async function issueHostedInviteForPhone(input: {
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

async function consumeHostedPasskeyChallenge(input: {
  inviteId: string;
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  type: HostedPasskeyChallengeType;
}) {
  await input.prisma.hostedPasskeyChallenge.deleteMany({
    where: {
      expiresAt: {
        lte: input.now,
      },
    },
  });

  const challenge = await input.prisma.hostedPasskeyChallenge.findFirst({
    where: {
      memberId: input.memberId,
      inviteId: input.inviteId,
      type: input.type,
      expiresAt: {
        gt: input.now,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!challenge) {
    throw hostedOnboardingError({
      code: "PASSKEY_CHALLENGE_EXPIRED",
      message: "That passkey challenge expired. Reload the link and try again.",
      httpStatus: 410,
    });
  }

  const deleted = await input.prisma.hostedPasskeyChallenge.deleteMany({
    where: {
      id: challenge.id,
    },
  });

  if (deleted.count !== 1) {
    throw hostedOnboardingError({
      code: "PASSKEY_CHALLENGE_EXPIRED",
      message: "That passkey challenge expired. Reload the link and try again.",
      httpStatus: 410,
    });
  }

  return challenge;
}

function createRandomChallenge(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

async function ensureHostedStripeCustomer(input: {
  member: HostedMember;
  prisma: PrismaClient;
  stripe: Stripe;
}): Promise<string> {
  if (input.member.stripeCustomerId) {
    return input.member.stripeCustomerId;
  }

  const customer = await input.stripe.customers.create({
    metadata: {
      memberId: input.member.id,
      normalizedPhoneNumber: input.member.normalizedPhoneNumber,
    },
    phone: input.member.normalizedPhoneNumber,
  });

  await input.prisma.hostedMember.update({
    where: {
      id: input.member.id,
    },
    data: {
      stripeCustomerId: customer.id,
    },
  });

  return customer.id;
}

async function recordHostedWebhookReceipt(input: {
  eventId: string;
  payloadJson: Prisma.InputJsonValue;
  prisma: PrismaClient;
  source: string;
}): Promise<{ payloadJson: Prisma.InputJsonValue } | null> {
  const now = new Date();
  const receiptPayloadJson = buildHostedWebhookProcessingPayload({
    attemptCount: 1,
    payloadJson: input.payloadJson,
    receivedAt: now,
  });

  try {
    await input.prisma.hostedWebhookReceipt.create({
      data: {
        source: input.source,
        eventId: input.eventId,
        firstReceivedAt: now,
        payloadJson: receiptPayloadJson,
      },
    });
    return {
      payloadJson: receiptPayloadJson,
    };
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
    payloadJson: Prisma.InputJsonValue;
    prisma: PrismaClient;
    source: string;
  },
  receivedAt: Date,
): Promise<{ payloadJson: Prisma.InputJsonValue } | null> {
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
      const receiptPayloadJson = buildHostedWebhookProcessingPayload({
        attemptCount: 1,
        payloadJson: input.payloadJson,
        receivedAt,
      });
      try {
        await input.prisma.hostedWebhookReceipt.create({
          data: {
            source: input.source,
            eventId: input.eventId,
            firstReceivedAt: receivedAt,
            payloadJson: receiptPayloadJson,
          },
        });
        return {
          payloadJson: receiptPayloadJson,
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue;
        }

        throw error;
      }
    }

    const existingStatus = readHostedWebhookReceiptStatus(existingReceipt.payloadJson);
    if (existingStatus === "completed" || existingStatus === "processing") {
      return null;
    }

    const nextPayloadJson = buildHostedWebhookProcessingPayload({
      attemptCount: readHostedWebhookReceiptAttemptCount(existingReceipt.payloadJson) + 1,
      payloadJson: input.payloadJson,
      previousPayloadJson: existingReceipt.payloadJson,
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
        payloadJson: nextPayloadJson,
      },
    });

    if (updatedReceipt.count === 1) {
      return {
        payloadJson: nextPayloadJson,
      };
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
  claimedReceipt: {
    payloadJson: Prisma.InputJsonValue;
  };
  eventId: string;
  payloadJson: Prisma.InputJsonValue;
  prisma: PrismaClient;
  source: string;
}): Promise<void> {
  await updateHostedWebhookReceiptStatus({
    claimedReceipt: input.claimedReceipt,
    eventId: input.eventId,
    payloadJson: input.payloadJson,
    prisma: input.prisma,
    source: input.source,
    status: "completed",
  });
}

async function markHostedWebhookReceiptFailed(input: {
  claimedReceipt: {
    payloadJson: Prisma.InputJsonValue;
  };
  error: unknown;
  eventId: string;
  payloadJson: Prisma.InputJsonValue;
  prisma: PrismaClient;
  source: string;
}): Promise<void> {
  await updateHostedWebhookReceiptStatus({
    claimedReceipt: input.claimedReceipt,
    error: input.error,
    eventId: input.eventId,
    payloadJson: input.payloadJson,
    prisma: input.prisma,
    source: input.source,
    status: "failed",
  });
}

async function updateHostedWebhookReceiptStatus(input: {
  claimedReceipt: {
    payloadJson: Prisma.InputJsonValue;
  };
  error?: unknown;
  eventId: string;
  payloadJson: Prisma.InputJsonValue;
  prisma: PrismaClient;
  source: string;
  status: "completed" | "failed";
}): Promise<void> {
  await input.prisma.hostedWebhookReceipt.updateMany({
    where: {
      source: input.source,
      eventId: input.eventId,
      payloadJson: {
        equals: input.claimedReceipt.payloadJson,
      },
    },
    data: {
      payloadJson: buildHostedWebhookReceiptPayload({
        attemptCount: 0,
        attemptId:
          readHostedWebhookReceiptAttemptId(input.claimedReceipt.payloadJson) ??
          undefined,
        error: input.error,
        payloadJson: input.payloadJson,
        previousPayloadJson: input.claimedReceipt.payloadJson,
        receivedAt: new Date(),
        status: input.status,
      }),
    },
  });
}

function buildHostedWebhookProcessingPayload(input: {
  attemptCount: number;
  attemptId?: string;
  payloadJson: Prisma.InputJsonValue;
  previousPayloadJson?: Prisma.InputJsonValue | Prisma.JsonValue | null;
  receivedAt: Date;
}): Prisma.InputJsonValue {
  return buildHostedWebhookReceiptPayload({
    attemptCount: input.attemptCount,
    attemptId: input.attemptId ?? generateHostedWebhookReceiptAttemptId(),
    payloadJson: input.payloadJson,
    previousPayloadJson: input.previousPayloadJson,
    receivedAt: input.receivedAt,
    status: "processing",
  });
}

function buildHostedWebhookReceiptPayload(input: {
  attemptCount: number;
  attemptId?: string;
  error?: unknown;
  payloadJson: Prisma.InputJsonValue;
  previousPayloadJson?: Prisma.InputJsonValue | Prisma.JsonValue | null;
  receivedAt: Date;
  status: "completed" | "failed" | "processing";
}): Prisma.InputJsonValue {
  const basePayload = readHostedWebhookReceiptBasePayload(input.payloadJson, input.previousPayloadJson);
  const previousAttemptCount = readHostedWebhookReceiptAttemptCount(input.previousPayloadJson ?? null);
  const attemptCount = input.attemptCount > 0 ? input.attemptCount : previousAttemptCount;

  return {
    ...basePayload,
    receiptAttemptId:
      input.attemptId ??
      readHostedWebhookReceiptAttemptId(input.previousPayloadJson ?? null) ??
      generateHostedWebhookReceiptAttemptId(),
    receiptAttemptCount: Math.max(attemptCount, 1),
    receiptCompletedAt: input.status === "completed" ? input.receivedAt.toISOString() : null,
    receiptLastError: input.status === "failed" ? serializeHostedWebhookReceiptError(input.error) : null,
    receiptLastReceivedAt: input.receivedAt.toISOString(),
    receiptStatus: input.status,
  } satisfies Prisma.InputJsonObject;
}

function readHostedWebhookReceiptBasePayload(
  payloadJson: Prisma.InputJsonValue,
  previousPayloadJson?: Prisma.InputJsonValue | Prisma.JsonValue | null,
): Prisma.InputJsonObject {
  const currentPayload = toHostedWebhookReceiptObject(payloadJson);
  const previousPayload = toHostedWebhookReceiptObject(previousPayloadJson);

  return {
    ...previousPayload,
    ...currentPayload,
  };
}

function readHostedWebhookReceiptAttemptCount(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): number {
  const rawAttemptCount = toHostedWebhookReceiptObject(payloadJson).receiptAttemptCount;

  return typeof rawAttemptCount === "number" && Number.isFinite(rawAttemptCount)
    ? Math.max(Math.trunc(rawAttemptCount), 0)
    : 0;
}

function readHostedWebhookReceiptAttemptId(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): string | null {
  const rawAttemptId = toHostedWebhookReceiptObject(payloadJson).receiptAttemptId;

  return typeof rawAttemptId === "string" && rawAttemptId.trim().length > 0
    ? rawAttemptId
    : null;
}

function readHostedWebhookReceiptStatus(payloadJson: Prisma.JsonValue | null): "completed" | "failed" | "processing" | null {
  const rawStatus = toHostedWebhookReceiptObject(payloadJson).receiptStatus;

  return rawStatus === "completed" || rawStatus === "failed" || rawStatus === "processing"
    ? rawStatus
    : null;
}

function serializeHostedWebhookReceiptError(error: unknown): Prisma.InputJsonValue {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    } satisfies Prisma.InputJsonObject;
  }

  if (typeof error === "string") {
    return {
      message: error,
      name: "Error",
    } satisfies Prisma.InputJsonObject;
  }

  return {
    message: "Unknown hosted webhook failure.",
    name: "UnknownError",
  } satisfies Prisma.InputJsonObject;
}

function generateHostedWebhookReceiptAttemptId(): string {
  return randomBytes(16).toString("hex");
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

async function applyStripeCheckoutCompleted(session: Stripe.Checkout.Session, prisma: PrismaClient): Promise<void> {
  const member = await findMemberForStripeObject({
    clientReferenceId: normalizeNullableString(session.client_reference_id),
    customerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
    memberId: normalizeNullableString(session.metadata?.memberId),
    prisma,
    subscriptionId: coerceStripeSubscriptionId(session.subscription),
  });
  const inviteId = normalizeNullableString(session.metadata?.inviteId);
  const billingStatus =
    session.mode === "subscription"
      ? session.payment_status === "paid" || session.payment_status === "no_payment_required"
        ? HostedBillingStatus.active
        : HostedBillingStatus.incomplete
      : session.payment_status === "paid"
        ? HostedBillingStatus.active
        : HostedBillingStatus.checkout_open;

  if (member) {
    await prisma.hostedMember.update({
      where: { id: member.id },
      data: {
        billingMode: session.mode === "subscription" ? HostedBillingMode.subscription : HostedBillingMode.payment,
        billingStatus,
        status: billingStatus === HostedBillingStatus.active ? HostedMemberStatus.active : member.status,
        stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? member.stripeCustomerId,
        stripeSubscriptionId: coerceStripeSubscriptionId(session.subscription) ?? member.stripeSubscriptionId,
        stripeLatestCheckoutSessionId: session.id,
      },
    });
    if (billingStatus === HostedBillingStatus.active) {
      await dispatchHostedMemberActivationSafely(member.id, member.normalizedPhoneNumber, member.linqChatId);
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

async function applyStripeSubscriptionUpdated(subscription: Stripe.Subscription, prisma: PrismaClient): Promise<void> {
  const billingStatus = mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status);
  const member = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    memberId: normalizeNullableString(subscription.metadata?.memberId),
    prisma,
    subscriptionId: subscription.id,
  });

  if (!member) {
    return;
  }

  await prisma.hostedMember.update({
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
  if (billingStatus === HostedBillingStatus.active) {
    await dispatchHostedMemberActivationSafely(member.id, member.normalizedPhoneNumber, member.linqChatId);
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
}

async function applyStripeInvoicePaid(invoice: Stripe.Invoice, prisma: PrismaClient): Promise<void> {
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
      billingMode: subscriptionId ? HostedBillingMode.subscription : member.billingMode,
      billingStatus: HostedBillingStatus.active,
      status: HostedMemberStatus.active,
      stripeCustomerId: customerId ?? member.stripeCustomerId,
      stripeSubscriptionId: subscriptionId ?? member.stripeSubscriptionId,
    },
  });
  await dispatchHostedMemberActivationSafely(member.id, member.normalizedPhoneNumber, member.linqChatId);
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

async function dispatchHostedMemberActivationSafely(
  memberId: string,
  normalizedPhoneNumber: string,
  linqChatId: string | null,
): Promise<void> {
  await dispatchHostedExecutionSafely({
    event: {
      kind: "member.activated",
      linqChatId,
      normalizedPhoneNumber,
      userId: memberId,
    },
    eventId: `member.activated:${memberId}:${Date.now()}`,
    occurredAt: new Date().toISOString(),
  });
}

async function dispatchHostedExecutionSafely(
  input: import("@healthybob/runtime-state").HostedExecutionDispatchRequest,
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
