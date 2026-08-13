import { randomUUID } from "node:crypto";

import {
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  type HostedCryptoDomain,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import {
  lockAndReadActiveHostedDomainRootKeyIdTx,
} from "@/src/lib/hosted-crypto/domain-root-store";
import {
  buildHostedGroupJoinOutreachIdempotencyKey,
  enqueueHostedGroupJoinOutreachTx,
  HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
  HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
  readHostedGroupJoinOutreachReplyContextTx,
} from "@/src/lib/hosted-groups/group-join-outreach-store";
import {
  createHostedLinqChatLookupKey,
  createHostedLinqMessageLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  readHostedMemberRoutingRecord,
  readHostedMemberRoutingState,
  upsertHostedMemberHomeLinqBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  parseHostedLinqWebhookEvent,
} from "@/src/lib/hosted-onboarding/linq";
import {
  createHostedLinqParticipantContact,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";
import {
  upsertHostedLinqLineForPhoneTx,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  buildHostedMemberIdentityPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import {
  planHostedOnboardingLinqWebhook,
  resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq";
import {
  runHostedOnboardingWebhookTransaction,
} from "@/src/lib/hosted-onboarding/webhook-service";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const transactionOptions = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted Linq activation concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted Linq activation PostgreSQL concurrency",
  () => {
    const runtimeGlobals = globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    };
    const previousPublicBaseUrl = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
    const previousHostedOnboardingEnvironment =
      runtimeGlobals.__murphHostedOnboardingEnv;

    beforeAll(() => {
      process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://join.example.test";
      delete runtimeGlobals.__murphHostedOnboardingEnv;
    });

    afterAll(() => {
      if (previousPublicBaseUrl === undefined) {
        delete process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
      } else {
        process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = previousPublicBaseUrl;
      }
      if (previousHostedOnboardingEnvironment === undefined) {
        delete runtimeGlobals.__murphHostedOnboardingEnv;
      } else {
        runtimeGlobals.__murphHostedOnboardingEnv =
          previousHostedOnboardingEnvironment;
      }
    });

    it("releases root authority and keeps an ordinary duplicate canonical after group eligibility changes", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_linq_activation_${fixtureId}`;
      const groupOwnerMemberId = `member_linq_group_owner_${fixtureId}`;
      const groupRuntimeMemberId = `member_linq_group_runtime_${fixtureId}`;
      const groupId = `group_linq_activation_${fixtureId}`;
      const groupOfferId = `group_offer_linq_activation_${fixtureId}`;
      const memberPhone = buildFixturePhone(fixtureId, 5);
      const recipientPhone = buildFixturePhone(fixtureId, 6);
      const chatId = `chat_linq_activation_${fixtureId}`;
      const controlRootKeyId = `control_${fixtureId}`;
      const ingressRootKeyId = `ingress_${fixtureId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const activation = createPrismaClient({ databaseUrl, poolMax: 1 });
      const inbound = createPrismaClient({ databaseUrl, poolMax: 1 });
      const activationOwnsMember = createDeferred();
      const allowActivationRoot = createDeferred();
      const event = buildDirectLinqEvent({
        chatId,
        eventId: `event_linq_activation_${fixtureId}`,
        memberPhone,
        messageId: `message_linq_activation_${fixtureId}`,
        recipientPhone,
      });
      const missingEvent = buildDirectLinqEvent({
        chatId,
        eventId: `event_linq_activation_missing_${fixtureId}`,
        memberPhone,
        messageId: `message_linq_activation_missing_${fixtureId}`,
        recipientPhone,
      });
      let firstAttempt: Promise<unknown> | null = null;

      await observer.hostedMember.createMany({
        data: [{
          billingStatus: HostedBillingStatus.active,
          id: memberId,
        }, {
          billingStatus: HostedBillingStatus.active,
          id: groupOwnerMemberId,
        }, {
          billingStatus: HostedBillingStatus.active,
          id: groupRuntimeMemberId,
        }],
      });
      await observer.$transaction(async (tx) => {
        const identityPrivate = await buildHostedMemberIdentityPrivateColumns({
          memberId,
          phoneNumber: memberPhone,
          prisma: tx,
          privyUserId: null,
          signupPhoneCodeSendAttemptId: null,
          signupPhoneCodeSendAttemptStartedAt: null,
          signupPhoneCodeSentAt: null,
          signupPhoneNumber: null,
        });
        await tx.hostedMemberIdentity.create({
          data: {
            ...identityPrivate,
            maskedPhoneNumberHint: "*** test",
            memberId,
            phoneLookupKey: requireValue(
              createHostedPhoneLookupKey(memberPhone),
              "member phone lookup key",
            ),
            phoneNumberVerifiedAt: new Date("2026-08-12T00:00:00.000Z"),
          },
        });
        await upsertHostedMemberHomeLinqBindingTx({
          clearPending: true,
          homeLineAssignedAt: new Date("2026-08-12T00:00:00.000Z"),
          linqChatId: chatId,
          memberId,
          participantContact: createHostedLinqParticipantContact({
            kind: "phone",
            value: memberPhone,
          }),
          prisma: tx,
          recipientPhone,
        });
      }, transactionOptions);
      await observer.hostedGroup.create({
        data: {
          displayName: "Linq activation transition proof",
          id: groupId,
          joinCode: `join_${fixtureId}`,
          joinCodeCreatedAt: new Date("2026-08-12T00:00:00.000Z"),
          ownerMemberId: groupOwnerMemberId,
          runtimeMemberId: groupRuntimeMemberId,
        },
      });
      await observer.hostedGroupJoinOffer.create({
        data: {
          groupId,
          id: groupOfferId,
          messageLookupKey: `offer_message_${fixtureId}`,
          postedAt: new Date("2026-08-12T00:00:00.000Z"),
          projectionKindsJson: ["best_effort"],
        },
      });
      const outreach = await observer.$transaction((tx) =>
        enqueueHostedGroupJoinOutreachTx({
          offerId: groupOfferId,
          participantPhoneNumber: memberPhone,
          requestedAt: new Date("2026-08-12T00:00:00.000Z"),
          tx,
        }),
      transactionOptions);
      const openerMessageLookupKey = requireValue(
        createHostedLinqMessageLookupKey(`opener_${fixtureId}`),
        "outreach opener message lookup key",
      );
      const openerIdempotencyKey = requireValue(
        createHostedLinqDeliveryIdempotencyLookupKey(
          buildHostedGroupJoinOutreachIdempotencyKey(outreach.outreachId),
        ),
        "outreach opener idempotency key",
      );
      const groupSignupDeliveryId = `group_signup_linq_activation_${fixtureId}`;
      await upsertHostedLinqLineForPhoneTx({
        observedAt: new Date("2026-08-12T00:00:00.000Z"),
        phoneNumber: recipientPhone,
        prisma: observer,
        source: "configured",
      });
      await observer.hostedLinqDelivery.createMany({
        data: [{
          acceptedAt: new Date("2026-08-12T00:00:01.000Z"),
          attemptedAt: new Date("2026-08-12T00:00:00.000Z"),
          groupJoinOutreachId: outreach.outreachId,
          id: `group_opener_linq_activation_${fixtureId}`,
          idempotencyKey: openerIdempotencyKey,
          linqChatLookupKey: requireValue(
            createHostedLinqChatLookupKey(chatId),
            "outreach opener chat lookup key",
          ),
          messageLookupKey: openerMessageLookupKey,
          phoneNumberLookupKey: requireValue(
            createHostedPhoneLookupKey(recipientPhone),
            "outreach recipient phone lookup key",
          ),
          source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
          sourceRef: outreach.outreachId,
          status: "accepted",
          targetKind: "participant",
          template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
        }, {
          acceptedAt: new Date("2026-08-12T00:00:03.000Z"),
          attemptedAt: new Date("2026-08-12T00:00:02.000Z"),
          groupJoinOutreachId: outreach.outreachId,
          id: groupSignupDeliveryId,
          source: "hosted_group_join_signup",
          sourceRef: outreach.outreachId,
          status: "accepted",
          targetKind: "participant",
          template: "invite_signup",
        }],
      });
      await expect(observer.$transaction((tx) =>
        readHostedGroupJoinOutreachReplyContextTx({
          linqChatId: chatId,
          participantMemberId: memberId,
          participantPhoneNumber: memberPhone,
          recipientPhoneNumber: recipientPhone,
          sourceEventId: event.event_id,
          tx,
        }),
      transactionOptions)).resolves.toBeNull();
      await Promise.all([
        insertActiveRootEnvelope({
          domain: "control",
          prisma: observer,
          rootKeyId: controlRootKeyId,
          userId: memberId,
        }),
        insertActiveRootEnvelope({
          domain: "ingress",
          prisma: observer,
          rootKeyId: ingressRootKeyId,
          userId: memberId,
        }),
      ]);

      const routingRecord = await readHostedMemberRoutingRecord({
        memberId,
        prisma: observer,
      });
      const routingState = await readHostedMemberRoutingState({
        memberId,
        prisma: observer,
      });
      if (!routingRecord || !routingState) {
        throw new Error("Expected a prepared Linq routing fixture.");
      }
      const preparedDirectMailboxPayloadRoot = {
        activeControlRootKeyId: controlRootKeyId,
        memberId,
        rootKeyId: ingressRootKeyId,
        routingRecord,
        routingState,
      };

      const activationTransaction = activation.$transaction(async (tx) => {
        await lockHostedMemberRow(tx, memberId);
        activationOwnsMember.resolve();
        await allowActivationRoot.promise;
        await expect(lockAndReadActiveHostedDomainRootKeyIdTx({
          domain: "control",
          tx,
          userId: memberId,
        })).resolves.toBe(controlRootKeyId);
        await tx.hostedMember.update({
          data: {
            billingStatus: HostedBillingStatus.active,
          },
          where: { id: memberId },
        });
      }, transactionOptions);

      try {
        await Promise.race([
          activationOwnsMember.promise,
          activationTransaction,
        ]);
        firstAttempt = runPreparedLinqPlanTransaction({
          controlRootKeyId,
          event,
          ingressRootKeyId,
          memberId,
          preparedDirectMailboxPayloadRoot,
          prisma: inbound,
        });
        const firstOutcome = await settleWithin(firstAttempt, 1_000);

        allowActivationRoot.resolve();
        await expect(activationTransaction).resolves.toBeUndefined();

        expect(firstOutcome).toMatchObject({
          reason: {
            code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
            details: {
              preparationTarget: "direct_linq_mailbox",
              reason: "member",
            },
            retryable: true,
          },
          status: "rejected",
        });
        await expect(runPreparedLinqPlanTransaction({
          controlRootKeyId,
          event,
          ingressRootKeyId,
          memberId,
          preparedDirectMailboxPayloadRoot,
          prisma: inbound,
        })).resolves.toMatchObject({
          response: {
            ok: true,
            reason: "wake-appended-active-member",
          },
        });

        await observer.hostedLinqDelivery.update({
          data: {
            failedAt: new Date("2026-08-12T00:00:04.000Z"),
            status: "failed",
          },
          where: { id: groupSignupDeliveryId },
        });
        await expect(observer.$transaction((tx) =>
          readHostedGroupJoinOutreachReplyContextTx({
            linqChatId: chatId,
            participantMemberId: memberId,
            participantPhoneNumber: memberPhone,
            recipientPhoneNumber: recipientPhone,
            sourceEventId: event.event_id,
            tx,
          }),
        transactionOptions)).resolves.toEqual({
          joinCode: `join_${fixtureId}`,
          outreachId: outreach.outreachId,
        });
        const mailboxCountAfterAppend = await observer.hostedMailboxItem.count({
          where: {
            kind: "conversation.message",
            userId: memberId,
          },
        });
        const dailyStateAfterAppend = await observer.hostedLinqDailyState.findMany({
          where: { memberId },
        });
        const inviteCountAfterAppend = await observer.hostedInvite.count({
          where: { memberId },
        });
        const routingAfterAppend = await readHostedMemberRoutingRecord({
          memberId,
          prisma: observer,
        });
        const recoveredPlan = await runPreparedLinqPlanTransaction({
          controlRootKeyId,
          event,
          ingressRootKeyId,
          memberId,
          preparedDirectMailboxPayloadRoot,
          prisma: inbound,
        });
        expect(recoveredPlan).toMatchObject({
          response: {
            duplicate: true,
            ignored: true,
            ok: true,
            reason: "duplicate-webhook-event",
          },
          wakeHandoffs: [{
            eventId: event.event_id,
            source: "linq",
            userId: memberId,
          }],
        });
        expect(recoveredPlan.wakeHandoffs).toHaveLength(1);

        await expect(observer.hostedMailboxItem.count({
          where: {
            kind: "conversation.message",
            userId: memberId,
          },
        })).resolves.toBe(mailboxCountAfterAppend);
        await expect(observer.hostedLinqDailyState.findMany({
          where: { memberId },
        })).resolves.toEqual(dailyStateAfterAppend);
        await expect(observer.hostedInvite.count({
          where: { memberId },
        })).resolves.toBe(inviteCountAfterAppend);
        await expect(readHostedMemberRoutingRecord({
          memberId,
          prisma: observer,
        })).resolves.toEqual(routingAfterAppend);

        const newEventPlan = await runPreparedLinqPlanTransaction({
          controlRootKeyId,
          event: missingEvent,
          ingressRootKeyId,
          memberId,
          preparedDirectMailboxPayloadRoot,
          prisma: inbound,
        });
        expect(newEventPlan).toMatchObject({
          response: {
            ok: true,
            reason: "sent-signup-link",
          },
        });
        expect(newEventPlan.wakeHandoffs).toBeUndefined();
        await expect(observer.hostedMailboxItem.count({
          where: {
            kind: "conversation.message",
            userId: memberId,
          },
        })).resolves.toBe(mailboxCountAfterAppend);
        const dailyStateAfterNewEvent = await observer.hostedLinqDailyState.findMany({
          where: { memberId },
        });
        expect(dailyStateAfterNewEvent).toHaveLength(dailyStateAfterAppend.length);
        expect(dailyStateAfterNewEvent[0]?.inboundCount).toBe(
          (dailyStateAfterAppend[0]?.inboundCount ?? 0) + 1,
        );
        await expect(observer.hostedInvite.count({
          where: { memberId },
        })).resolves.toBe(inviteCountAfterAppend + 1);
        await expect(readHostedMemberRoutingRecord({
          memberId,
          prisma: observer,
        })).resolves.toEqual(routingAfterAppend);
      } finally {
        allowActivationRoot.resolve();
        await Promise.allSettled([
          ...(activationTransaction ? [activationTransaction] : []),
          ...(firstAttempt ? [firstAttempt] : []),
        ]);
        await observer.hostedGroup.deleteMany({
          where: { id: groupId },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: {
              in: [memberId, groupOwnerMemberId, groupRuntimeMemberId],
            },
          },
        });
        await observer.hostedLinqLine.deleteMany({
          where: {
            phoneNumberLookupKey: requireValue(
              createHostedPhoneLookupKey(recipientPhone),
              "outreach recipient phone lookup key",
            ),
          },
        });
        await disconnectClients([observer, activation, inbound]);
      }
    });

    it("retries an explicit-null preflight when activation commits before planning", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_linq_null_transition_${fixtureId}`;
      const groupOwnerMemberId = `member_linq_null_group_owner_${fixtureId}`;
      const groupRuntimeMemberId = `member_linq_null_group_runtime_${fixtureId}`;
      const groupId = `group_linq_null_transition_${fixtureId}`;
      const groupOfferId = `group_offer_linq_null_transition_${fixtureId}`;
      const memberPhone = buildFixturePhone(fixtureId, 7);
      const recipientPhone = buildFixturePhone(fixtureId, 8);
      const chatId = `chat_linq_null_transition_${fixtureId}`;
      const controlRootKeyId = `control_null_${fixtureId}`;
      const ingressRootKeyId = `ingress_null_${fixtureId}`;
      const event = buildDirectLinqEvent({
        chatId,
        eventId: `event_linq_null_transition_${fixtureId}`,
        memberPhone,
        messageId: `message_linq_null_transition_${fixtureId}`,
        recipientPhone,
      });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const inbound = createPrismaClient({ databaseUrl, poolMax: 1 });

      await observer.hostedMember.createMany({
        data: [{
          billingStatus: HostedBillingStatus.not_started,
          id: memberId,
        }, {
          billingStatus: HostedBillingStatus.active,
          id: groupOwnerMemberId,
        }, {
          billingStatus: HostedBillingStatus.active,
          id: groupRuntimeMemberId,
        }],
      });

      try {
        await observer.$transaction(async (tx) => {
          const identityPrivate = await buildHostedMemberIdentityPrivateColumns({
            memberId,
            phoneNumber: memberPhone,
            prisma: tx,
            privyUserId: null,
            signupPhoneCodeSendAttemptId: null,
            signupPhoneCodeSendAttemptStartedAt: null,
            signupPhoneCodeSentAt: null,
            signupPhoneNumber: null,
          });
          await tx.hostedMemberIdentity.create({
            data: {
              ...identityPrivate,
              maskedPhoneNumberHint: "*** test",
              memberId,
              phoneLookupKey: requireValue(
                createHostedPhoneLookupKey(memberPhone),
                "member phone lookup key",
              ),
              phoneNumberVerifiedAt: new Date("2026-08-12T00:00:00.000Z"),
            },
          });
          await upsertHostedMemberHomeLinqBindingTx({
            clearPending: true,
            homeLineAssignedAt: new Date("2026-08-12T00:00:00.000Z"),
            linqChatId: chatId,
            memberId,
            participantContact: createHostedLinqParticipantContact({
              kind: "phone",
              value: memberPhone,
            }),
            prisma: tx,
            recipientPhone,
          });
        }, transactionOptions);
        await observer.hostedGroup.create({
          data: {
            displayName: "Linq null-preflight transition proof",
            id: groupId,
            joinCode: `join_null_${fixtureId}`,
            joinCodeCreatedAt: new Date("2026-08-12T00:00:00.000Z"),
            ownerMemberId: groupOwnerMemberId,
            runtimeMemberId: groupRuntimeMemberId,
          },
        });
        await observer.hostedGroupJoinOffer.create({
          data: {
            groupId,
            id: groupOfferId,
            messageLookupKey: `offer_message_null_${fixtureId}`,
            postedAt: new Date("2026-08-12T00:00:00.000Z"),
            projectionKindsJson: ["best_effort"],
          },
        });
        const outreach = await observer.$transaction((tx) =>
          enqueueHostedGroupJoinOutreachTx({
            offerId: groupOfferId,
            participantPhoneNumber: memberPhone,
            requestedAt: new Date("2026-08-12T00:00:00.000Z"),
            tx,
          }),
        transactionOptions);
        await upsertHostedLinqLineForPhoneTx({
          observedAt: new Date("2026-08-12T00:00:00.000Z"),
          phoneNumber: recipientPhone,
          prisma: observer,
          source: "configured",
        });
        await observer.hostedLinqDelivery.create({
          data: {
            acceptedAt: new Date("2026-08-12T00:00:01.000Z"),
            attemptedAt: new Date("2026-08-12T00:00:00.000Z"),
            groupJoinOutreachId: outreach.outreachId,
            id: `group_opener_linq_null_${fixtureId}`,
            idempotencyKey: requireValue(
              createHostedLinqDeliveryIdempotencyLookupKey(
                buildHostedGroupJoinOutreachIdempotencyKey(outreach.outreachId),
              ),
              "outreach opener idempotency key",
            ),
            linqChatLookupKey: requireValue(
              createHostedLinqChatLookupKey(chatId),
              "outreach opener chat lookup key",
            ),
            messageLookupKey: requireValue(
              createHostedLinqMessageLookupKey(`opener_null_${fixtureId}`),
              "outreach opener message lookup key",
            ),
            phoneNumberLookupKey: requireValue(
              createHostedPhoneLookupKey(recipientPhone),
              "outreach recipient phone lookup key",
            ),
            source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
            sourceRef: outreach.outreachId,
            status: "accepted",
            targetKind: "participant",
            template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
          },
        });

        await expect(resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
          event,
          prisma: observer,
          threadRoute: null,
        })).resolves.toBeNull();

        await observer.$transaction(async (tx) => {
          await Promise.all([
            insertActiveRootEnvelope({
              domain: "control",
              prisma: tx,
              rootKeyId: controlRootKeyId,
              userId: memberId,
            }),
            insertActiveRootEnvelope({
              domain: "ingress",
              prisma: tx,
              rootKeyId: ingressRootKeyId,
              userId: memberId,
            }),
          ]);
          await tx.hostedMember.update({
            data: { billingStatus: HostedBillingStatus.active },
            where: { id: memberId },
          });
        }, transactionOptions);

        await expect(observer.$transaction((tx) =>
          readHostedGroupJoinOutreachReplyContextTx({
            linqChatId: chatId,
            participantMemberId: memberId,
            participantPhoneNumber: memberPhone,
            recipientPhoneNumber: recipientPhone,
            sourceEventId: event.event_id,
            tx,
          }),
        transactionOptions)).resolves.toEqual({
          joinCode: `join_null_${fixtureId}`,
          outreachId: outreach.outreachId,
        });
        const routingBeforeNullAttempt = await readHostedMemberRoutingRecord({
          memberId,
          prisma: observer,
        });
        const runNullPreparedAttempt = () => runHostedOnboardingWebhookTransaction(
          inbound,
          (transaction) => planHostedOnboardingLinqWebhook({
            event,
            preparedDirectMailboxPayloadRoot: null,
            prisma: transaction,
          }),
        );
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await expect(runNullPreparedAttempt()).rejects.toMatchObject({
            code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
            details: {
              preparationTarget: "direct_linq_mailbox",
              reason: "member",
            },
            retryable: true,
          });
        }
        await expect(observer.hostedLinqDailyState.count({
          where: { memberId },
        })).resolves.toBe(0);
        await expect(observer.hostedInvite.count({
          where: { memberId },
        })).resolves.toBe(0);
        await expect(observer.hostedMailboxItem.count({
          where: { userId: memberId },
        })).resolves.toBe(0);
        await expect(readHostedMemberRoutingRecord({
          memberId,
          prisma: observer,
        })).resolves.toEqual(routingBeforeNullAttempt);

        const routingRecord = await readHostedMemberRoutingRecord({
          memberId,
          prisma: observer,
        });
        const routingState = await readHostedMemberRoutingState({
          memberId,
          prisma: observer,
        });
        if (!routingRecord || !routingState) {
          throw new Error("Expected routing after the activation transition.");
        }
        await expect(runPreparedLinqPlanTransaction({
          controlRootKeyId,
          event,
          ingressRootKeyId,
          memberId,
          preparedDirectMailboxPayloadRoot: {
            activeControlRootKeyId: controlRootKeyId,
            memberId,
            rootKeyId: ingressRootKeyId,
            routingRecord,
            routingState,
          },
          prisma: inbound,
        })).resolves.toMatchObject({
          response: {
            ok: true,
            reason: "sent-signup-link",
          },
        });
        await expect(observer.hostedLinqDailyState.count({
          where: { memberId },
        })).resolves.toBe(1);
        await expect(observer.hostedInvite.count({
          where: { memberId },
        })).resolves.toBe(1);
        await expect(observer.hostedMailboxItem.count({
          where: { userId: memberId },
        })).resolves.toBe(0);
      } finally {
        await observer.hostedGroup.deleteMany({
          where: { id: groupId },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: {
              in: [memberId, groupOwnerMemberId, groupRuntimeMemberId],
            },
          },
        });
        await observer.hostedLinqLine.deleteMany({
          where: {
            phoneNumberLookupKey: requireValue(
              createHostedPhoneLookupKey(recipientPhone),
              "outreach recipient phone lookup key",
            ),
          },
        });
        await disconnectClients([observer, inbound]);
      }
    });
  },
);

async function runPreparedLinqPlanTransaction(input: {
  controlRootKeyId: string;
  event: ReturnType<typeof buildDirectLinqEvent>;
  ingressRootKeyId: string;
  memberId: string;
  preparedDirectMailboxPayloadRoot: NonNullable<
    Parameters<typeof planHostedOnboardingLinqWebhook>[0][
      "preparedDirectMailboxPayloadRoot"
    ]
  >;
  prisma: PrismaClient;
}) {
  return runHostedOnboardingWebhookTransaction(
    input.prisma,
    (transaction) => planHostedOnboardingLinqWebhook({
      event: input.event,
      preparedDirectMailboxPayloadRoot:
        input.preparedDirectMailboxPayloadRoot,
      prisma: transaction,
    }),
    async () => {
      seedPreparedRoot({
        domain: "control",
        rootKeyId: input.controlRootKeyId,
        userId: input.memberId,
      });
      seedPreparedRoot({
        domain: "ingress",
        rootKeyId: input.ingressRootKeyId,
        userId: input.memberId,
      });
    },
  );
}

async function insertActiveRootEnvelope(input: {
  domain: HostedCryptoDomain;
  prisma: PrismaClient | Prisma.TransactionClient;
  rootKeyId: string;
  userId: string;
}): Promise<void> {
  const envelope = buildRootEnvelope(input);
  await input.prisma.hostedUserCryptoEnvelope.create({
    data: {
      activatedAt: new Date(envelope.createdAt),
      domain: input.domain,
      id: `root_envelope_${randomUUID()}`,
      rootKeyId: input.rootKeyId,
      signedEnvelopeJson: envelope as unknown as Prisma.InputJsonValue,
      status: "active",
      userId: input.userId,
    },
  });
}

function seedPreparedRoot(input: {
  domain: HostedCryptoDomain;
  rootKeyId: string;
  userId: string;
}): void {
  const envelope = buildRootEnvelope(input);
  const pendingRoot = Promise.resolve({
    envelope,
    rootKey: new Uint8Array(32),
  });
  const cache = getHostedDomainRootUnwrapCache();
  if (!cache) {
    throw new Error("Expected a scoped hosted root cache.");
  }
  cache.set(`${input.userId}|${input.domain}|@active`, pendingRoot);
  cache.set(`${input.userId}|${input.domain}|${input.rootKeyId}`, pendingRoot);
}

function buildRootEnvelope(input: {
  domain: HostedCryptoDomain;
  rootKeyId: string;
  userId: string;
}): HostedDomainRootKeyEnvelopeV1 {
  const timestamp = "2026-08-12T00:00:00.000Z";
  return {
    authoritySignature: {
      alg: "GCP-KMS-EC-P256-SHA256",
      keyVersionName: "test-authority-key",
      signature: "test-signature",
      signedAt: timestamp,
    },
    createdAt: timestamp,
    domain: input.domain,
    generation: 1,
    rootKeyId: input.rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: timestamp,
    userId: input.userId,
    wraps: [{
      additionalAuthenticatedData: "test-aad",
      ciphertextBlob: "test-ciphertext",
      encryptionContext: {},
      kind: "gcp-kms",
      kmsKeyName: "test-kms-key",
      recipient: input.domain === "control"
        ? "web-control-kms"
        : "web-ingress-kms",
    }],
  };
}

function buildDirectLinqEvent(input: {
  chatId: string;
  eventId: string;
  memberPhone: string;
  messageId: string;
  recipientPhone: string;
}) {
  return parseHostedLinqWebhookEvent(JSON.stringify({
    api_version: "v3",
    created_at: "2026-08-12T00:00:00.000Z",
    data: {
      chat: {
        id: input.chatId,
        is_group: false,
        owner_handle: {
          handle: input.recipientPhone,
          id: "owner-handle",
          is_me: true,
          service: "sms",
        },
      },
      direction: "inbound",
      id: input.messageId,
      is_from_me: false,
      parts: [{ type: "text", value: "hello" }],
      sender_handle: {
        handle: input.memberPhone,
        id: "sender-handle",
        service: "sms",
      },
      sent_at: "2026-08-12T00:00:00.000Z",
      service: "sms",
    },
    event_id: input.eventId,
    event_type: "message.received",
    webhook_version: "2026-02-03",
  }));
}

function buildFixturePhone(fixtureId: string, prefixDigit: number): string {
  const digits = fixtureId.replaceAll("-", "").slice(0, 7);
  const suffix = String(Number.parseInt(digits, 16) % 10_000_000).padStart(
    7,
    "0",
  );
  return `+155${prefixDigit}${suffix}`;
}

function requireValue(value: string | null, label: string): string {
  if (!value) {
    throw new Error(`Expected ${label}.`);
  }
  return value;
}

async function settleWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<
  | { status: "fulfilled"; value: unknown }
  | { reason: unknown; status: "rejected" }
  | { status: "timed_out" }
> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ reason, status: "rejected" as const }),
      ),
      new Promise<{ status: "timed_out" }>((resolve) => {
        timeout = setTimeout(() => resolve({ status: "timed_out" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function disconnectClients(clients: PrismaClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.$disconnect()));
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}
