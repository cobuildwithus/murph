import { generateKeyPairSync, randomUUID } from "node:crypto";

import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import {
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { encryptHostedLinqLinePhoneNumber } from "@/src/lib/hosted-onboarding/linq-line-phone-codec";
import {
  buildHostedMemberIdentityPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
import {
  ensureHostedStarterUsageEnrollment,
} from "@/src/lib/hosted-onboarding/starter-usage-enrollment-service";
import { buildHostedStarterUsageSemanticSourceKey } from "@/src/lib/hosted-onboarding/starter-usage";
import { parseHostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import { planHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-provider-linq";
import { createPrismaClient } from "@/src/lib/prisma";

vi.mock("server-only", () => ({}));

const boundaries = vi.hoisted(() => ({
  sendSignupWelcomeEmail: vi.fn(),
  signalMailboxAppend: vi.fn(async () => ({
    signalAccepted: true as const,
    workflowId: "hosted-user-runtime:test",
  })),
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/src/lib/hosted-orchestration/signal-runtime")
  >()),
  signalHostedMailboxAppendRuntime: boundaries.signalMailboxAppend,
}));

vi.mock("@/src/lib/hosted-onboarding/signup-welcome-email", () => ({
  sendHostedSignupWelcomeEmailForMemberBestEffort:
    boundaries.sendSignupWelcomeEmail,
}));

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The companion enrollment PostgreSQL proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "companion Starter enrollment PostgreSQL integration",
  () => {
    it.each([
      {
        expectedMailboxCount: 2,
        expectedRoute: true,
        expectedWelcomeCount: 1,
        lineState: "available" as const,
        name: "routes one welcome",
      },
      {
        expectedMailboxCount: 1,
        expectedRoute: false,
        expectedWelcomeCount: 0,
        lineState: "missing" as const,
        name: "activates without a welcome when no line is assignable",
      },
      {
        expectedMailboxCount: 1,
        expectedRoute: false,
        expectedWelcomeCount: 0,
        lineState: "at_cap" as const,
        name: "activates route-less when the available line is at its proactive cap",
      },
    ])("$name and replays without duplicate state or email", async (scenario) => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for this proof.");
      }

      const fixtureId = randomUUID();
      const memberId = `member_companion_welcome_${fixtureId}`;
      const inviteCode = `companion-welcome-${fixtureId}`;
      const inviteId = `invite_companion_welcome_${fixtureId}`;
      const memberPhone = "+15551230001";
      const linePhone = "+15551230002";
      const now = new Date("2026-08-12T18:00:00.000Z");
      const currentDayUtc = new Date();
      currentDayUtc.setUTCHours(0, 0, 0, 0);
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const restoreEnvironment = configureLocalCryptoForTest();
      const lineLookupKey = requirePhoneLookupKey(linePhone);
      let memberCreated = false;
      let lineCreated = false;

      boundaries.sendSignupWelcomeEmail.mockClear();
      boundaries.signalMailboxAppend.mockClear();
      setHostedSecureBoxStringTestCodecForTests({
        decrypt: ({ value }) => value,
        encrypt: ({ value }) => value,
      });

      try {
        if (scenario.lineState !== "missing") {
          await prisma.hostedLinqLine.create({
            data: {
              assignmentWeight: 1_000_000,
              configuredAt: now,
              egressPolicy: "enabled",
              healthStatus: "healthy",
              maxNewConversationsPerDay: 50,
              ...(scenario.lineState === "at_cap"
                ? {
                    proactiveConversationCount: 50,
                    proactiveConversationDayUtc: currentDayUtc,
                  }
                : {}),
              phoneNumberEncrypted:
                encryptHostedLinqLinePhoneNumber(linePhone),
              phoneNumberHint: "*** test",
              phoneNumberLookupKey: lineLookupKey,
              source: "test",
            },
          });
          lineCreated = true;
        }

        await prisma.$transaction(async (tx) => {
          await tx.hostedMember.create({
            data: {
              billingStatus: HostedBillingStatus.not_started,
              id: memberId,
              initialOnboardingCompletedAt: null,
            },
          });
          memberCreated = true;
          await tx.hostedMemberIdentity.create({
            data: {
              ...(await buildHostedMemberIdentityPrivateColumns({
                memberId,
                phoneNumber: memberPhone,
                prisma: tx,
                privyUserId: null,
                signupPhoneCodeSendAttemptId: null,
                signupPhoneCodeSendAttemptStartedAt: null,
                signupPhoneCodeSentAt: null,
                signupPhoneNumber: null,
              })),
              maskedPhoneNumberHint: "*** test",
              memberId,
              phoneLookupKey: requirePhoneLookupKey(memberPhone),
              phoneNumberVerifiedAt: now,
            },
          });
          await tx.hostedInvite.create({
            data: {
              channel: "companion",
              expiresAt: new Date(now.getTime() + 60 * 60_000),
              id: inviteId,
              inviteCode,
              memberId,
            },
          });
          await tx.hostedConsentGrant.createMany({
            data: [
              {
                documentVersionsJson: {
                  "health-ai-safety-disclosure": "2026-07-23",
                  "privacy-policy": "2026-07-23",
                  "terms-of-service": "2026-07-23",
                },
                grantedAt: now,
                memberId,
                scope: "launch.legal",
                source: "test",
              },
              {
                documentVersionsJson: {
                  "consumer-health-data-notice": "2026-07-23",
                },
                grantedAt: now,
                memberId,
                scope: "launch.health-data",
                source: "test",
              },
            ],
          });
        });

        await expect(ensureHostedStarterUsageEnrollment({
          inviteCode,
          member: { id: memberId, suspendedAt: null },
          now,
          prisma,
          source: "companion_onboarding",
        })).resolves.toEqual({
          redirectPath: "/home",
          status: "enrolled",
        });

        const activationEventId = [
          "member.activated",
          "hosted.starter_usage.enrolled",
          memberId,
          buildHostedStarterUsageSemanticSourceKey(memberId),
        ].join(":");
        await expect(prisma.hostedMember.findUniqueOrThrow({
          select: { billingStatus: true },
          where: { id: memberId },
        })).resolves.toEqual({ billingStatus: HostedBillingStatus.active });
        await expect(prisma.hostedMailboxItem.count({
          where: {
            kind: "member.activated",
            userId: memberId,
          },
        })).resolves.toBe(1);
        await expect(prisma.hostedMailboxItem.count({
          where: {
            kind: "assistant.notification.requested",
            userId: memberId,
          },
        })).resolves.toBe(scenario.expectedWelcomeCount);
        await expect(prisma.hostedMailboxItem.findUnique({
          select: { consumedAt: true, id: true },
          where: {
            userId_dedupeKey: {
              dedupeKey: activationEventId,
              userId: memberId,
            },
          },
        })).resolves.toMatchObject({
          consumedAt: null,
          id: expect.any(String),
        });
        await expect(prisma.hostedMemberRouting.findUnique({
          select: { linqRecipientPhoneLookupKey: true },
          where: { memberId },
        })).resolves.toEqual(
          scenario.expectedRoute
            ? { linqRecipientPhoneLookupKey: lineLookupKey }
            : null,
        );
        await expect(prisma.hostedUsageCreditEntry.count({
          where: {
            beneficiaryMemberId: memberId,
            semanticSourceKey:
              buildHostedStarterUsageSemanticSourceKey(memberId),
          },
        })).resolves.toBe(1);
        expect(boundaries.signalMailboxAppend).toHaveBeenCalledOnce();
        expect(boundaries.sendSignupWelcomeEmail).not.toHaveBeenCalled();

        await expect(ensureHostedStarterUsageEnrollment({
          inviteCode,
          member: { id: memberId, suspendedAt: null },
          now: new Date(now.getTime() + 60_000),
          prisma,
          source: "companion_onboarding",
        })).resolves.toMatchObject({ status: "already_enrolled" });
        await expect(prisma.hostedMailboxItem.count({
          where: { userId: memberId },
        })).resolves.toBe(scenario.expectedMailboxCount);
        await expect(prisma.hostedUsageCreditEntry.count({
          where: { beneficiaryMemberId: memberId },
        })).resolves.toBe(1);
        expect(boundaries.signalMailboxAppend).toHaveBeenCalledTimes(2);
        expect(boundaries.sendSignupWelcomeEmail).not.toHaveBeenCalled();

        if (!scenario.expectedRoute) {
          if (scenario.lineState === "missing") {
            await prisma.hostedLinqLine.create({
              data: {
                assignmentWeight: 1_000_000,
                configuredAt: new Date(now.getTime() + 120_000),
                egressPolicy: "enabled",
                healthStatus: "warning",
                maxNewConversationsPerDay: 50,
                phoneNumberEncrypted:
                  encryptHostedLinqLinePhoneNumber(linePhone),
                phoneNumberHint: "*** test",
                phoneNumberLookupKey: lineLookupKey,
                providerReputationStatus: "HEALTHY",
                providerServiceStatus: "ACTIVE",
                source: "test",
              },
            });
            lineCreated = true;
          } else {
            await prisma.hostedLinqLine.update({
              data: {
                healthStatus: "warning",
                providerReputationStatus: "HEALTHY",
                providerServiceStatus: "ACTIVE",
              },
              where: { phoneNumberLookupKey: lineLookupKey },
            });
          }

          const firstInbound = buildCompanionFirstInboundEvent({
            chatId: `chat_companion_first_inbound_${fixtureId}`,
            eventId: `event_companion_first_inbound_${fixtureId}`,
            linePhone,
            memberPhone,
            messageId: `message_companion_first_inbound_${fixtureId}`,
            occurredAt: new Date(now.getTime() + 180_000),
          });
          const firstInboundPlan = await prisma.$transaction((tx) =>
            planHostedOnboardingLinqWebhook({
              event: firstInbound,
              prisma: tx,
            })
          );

          expect(firstInboundPlan.response).toMatchObject({
            ignored: false,
            ok: true,
            reason: "wake-appended-active-member",
          });
          expect(firstInboundPlan.wakeHandoffs).toHaveLength(1);
          if (!firstInboundPlan.wakeHandoffs) {
            throw new Error("Expected the first inbound runtime wake.");
          }
          await expect(prisma.hostedMemberRouting.findUnique({
            select: {
              linqChatLookupKey: true,
              linqRecipientPhoneLookupKey: true,
            },
            where: { memberId },
          })).resolves.toMatchObject({
            linqChatLookupKey: expect.any(String),
            linqRecipientPhoneLookupKey: lineLookupKey,
          });
          await expect(prisma.hostedMailboxItem.count({
            where: {
              dedupeKey: firstInbound.event_id,
              kind: "conversation.message",
              userId: memberId,
            },
          })).resolves.toBe(1);

          const replayPlan = await prisma.$transaction((tx) =>
            planHostedOnboardingLinqWebhook({
              event: firstInbound,
              prisma: tx,
            })
          );
          expect(replayPlan.response).toMatchObject({
            duplicate: true,
            ignored: true,
            ok: true,
            reason: "duplicate-webhook-event",
          });
          if (!replayPlan.wakeHandoffs) {
            throw new Error("Expected the duplicate inbound runtime wake.");
          }
          expect(replayPlan.wakeHandoffs[0]?.mailboxItemId).toBe(
            firstInboundPlan.wakeHandoffs[0]?.mailboxItemId,
          );
          await expect(prisma.hostedMailboxItem.count({
            where: {
              dedupeKey: firstInbound.event_id,
              kind: "conversation.message",
              userId: memberId,
            },
          })).resolves.toBe(1);
        }
      } finally {
        if (memberCreated) {
          await prisma.hostedUsageCreditGrant.deleteMany({
            where: { beneficiaryMemberId: memberId },
          });
          await prisma.hostedUsageCreditEntry.deleteMany({
            where: { beneficiaryMemberId: memberId },
          });
          await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        }
        if (lineCreated) {
          await prisma.hostedLinqLine.deleteMany({
            where: { phoneNumberLookupKey: lineLookupKey },
          });
        }
        setHostedSecureBoxStringTestCodecForTests(null);
        restoreEnvironment();
        await prisma.$disconnect();
      }
    });
  },
);

function buildCompanionFirstInboundEvent(input: {
  chatId: string;
  eventId: string;
  linePhone: string;
  memberPhone: string;
  messageId: string;
  occurredAt: Date;
}) {
  const occurredAt = input.occurredAt.toISOString();
  return parseHostedLinqWebhookEvent(JSON.stringify({
    api_version: "v3",
    created_at: occurredAt,
    data: {
      chat: {
        id: input.chatId,
        is_group: false,
        owner_handle: {
          handle: input.linePhone,
          id: "owner-handle",
          is_me: true,
          service: "iMessage",
        },
      },
      direction: "inbound",
      id: input.messageId,
      parts: [{ type: "text", value: "hello" }],
      sender_handle: {
        handle: input.memberPhone,
        id: "sender-handle",
        service: "iMessage",
      },
      sent_at: occurredAt,
      service: "iMessage",
    },
    event_id: input.eventId,
    event_type: "message.received",
    webhook_version: "2026-02-03",
  }));
}

function requirePhoneLookupKey(phoneNumber: string): string {
  const lookupKey = createHostedPhoneLookupKey(phoneNumber);
  if (!lookupKey) {
    throw new Error("Expected a phone lookup key.");
  }
  return lookupKey;
}

const LOCAL_CRYPTO_ENV_KEYS = [
  "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
  "HOSTED_CONTACT_PRIVACY_KEYS",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
  "HOSTED_CRYPTO_ENV",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_GCP_KMS_API_ROOT",
  "HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME",
  "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
  "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY",
] as const;

function configureLocalCryptoForTest(): () => void {
  const previous = new Map(
    LOCAL_CRYPTO_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const authorityKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const automationKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "jwk" },
  });
  Object.assign(process.env, {
    HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v1",
    HOSTED_CONTACT_PRIVACY_KEYS:
      `v1:${Buffer.alloc(32, 5).toString("base64")}`,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "test-automation-key",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK:
      JSON.stringify(automationKey.publicKey),
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION:
      "projects/test/locations/global/keyRings/test/cryptoKeys/authority/cryptoKeyVersions/1",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: authorityKey.publicKey,
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
      "projects/test/locations/global/keyRings/test/cryptoKeys/web-wrap",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK:
      JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY:
      Buffer.alloc(32, 7).toString("base64"),
  });
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  const parsed = new URL(value);
  const effectiveHost = decodeURIComponent(parsed.hostname || parsed.host);
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(
    effectiveHost,
  ) || effectiveHost.startsWith("/");
}
