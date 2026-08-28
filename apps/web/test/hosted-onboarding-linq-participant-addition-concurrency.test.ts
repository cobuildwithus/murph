import { createHmac, generateKeyPairSync, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  encodeHostedExecutionSignedRequestPayload,
} from "@murphai/hosted-execution/auth";
import { describe, expect, it, vi } from "vitest";

const groupActionAuthorityMocks = vi.hoisted(() => ({
  hasActivationProof: vi.fn(),
  readWake: vi.fn(),
  resolveSenderMemberId: vi.fn(),
}));

const visibleReconciliationMocks = vi.hoisted(() => ({
  access: null as unknown,
  client: null as unknown,
  enabled: false,
  facts: null as unknown,
  item: null as unknown,
  wake: null as unknown,
}));

vi.mock("@/src/lib/hosted-mailbox/store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-mailbox/store")
  >();
  return {
    ...actual,
    readHostedMailboxConversationWakeByAssistantInputId:
      groupActionAuthorityMocks.readWake,
    readHostedMailboxLatestPendingConversationItem: (...args: Parameters<
      typeof actual.readHostedMailboxLatestPendingConversationItem
    >) => {
      if (visibleReconciliationMocks.enabled) {
        return Promise.resolve(visibleReconciliationMocks.item);
      }
      return actual.readHostedMailboxLatestPendingConversationItem(...args);
    },
    readHostedMailboxWakeByItemId: (...args: Parameters<
      typeof actual.readHostedMailboxWakeByItemId
    >) => {
      if (visibleReconciliationMocks.enabled) {
        return Promise.resolve(visibleReconciliationMocks.wake);
      }
      return actual.readHostedMailboxWakeByItemId(...args);
    },
  };
});

vi.mock("@/src/lib/hosted-orchestration/runtime-reconciliation-facts", () => ({
  readHostedRuntimeReconciliationFacts: () =>
    Promise.resolve(visibleReconciliationMocks.facts),
}));

vi.mock("@/src/lib/hosted-groups/group-message-sender", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-groups/group-message-sender")
  >();
  return {
    ...actual,
    resolveHostedGroupMessageSenderMemberId:
      groupActionAuthorityMocks.resolveSenderMemberId,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-activation", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/member-activation")
  >();
  return {
    ...actual,
    hasHostedMemberActivationProof:
      groupActionAuthorityMocks.hasActivationProof,
  };
});

import {
  deleteHostedAddressBookProjection,
  parseHostedAddressBookDeleteRequest,
  parseHostedAddressBookReplaceRequest,
  replaceHostedAddressBookProjection,
} from "@/src/lib/hosted-address-book/projection";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  markHostedAiUsageLimitNoticeDeliveryRetryableTx,
  startHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  startAuthorizedHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-execution/usage-limit-notice-claim";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
  createHostedLinqProviderEventLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  readHostedMailboxWakeByDedupeKey,
} from "@/src/lib/hosted-mailbox/store";
import * as prismaModule from "@/src/lib/prisma";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  POST as postHostedLinqEgressEngagement,
} from "../app/api/internal/hosted-runtime/linq-egress/engagement/route";
import {
  recordHostedLaunchRequiredConsent,
} from "@/src/lib/legal/consent";
import {
  readHostedGroupMembershipsForMember,
} from "@/src/lib/hosted-groups/group-store";
import {
  readHostedRuntimeReconciliationFactsWithVisibleAccess,
} from "@/src/lib/hosted-orchestration/visible-runtime-reconciliation";
import * as hostedRuntimeSignal from "@/src/lib/hosted-orchestration/signal-runtime";
import * as hostedLinqClient from "@/src/lib/hosted-onboarding/linq-client";
import * as recognizedInboundAccess from "@/src/lib/hosted-onboarding/recognized-inbound-access";
import {
  assertHostedGroupParticipantActionOriginHasOwnMurph,
} from "@/src/lib/hosted-groups/participant-action-authority";
import {
  ensureHostedThreadContainerRouteTx,
  type PreparedHostedThreadContainerCreation,
  type PreparedHostedThreadContainerDeliveryRoute,
} from "@/src/lib/hosted-routing/thread-container-service";
import {
  buildHostedThreadDeliveryRoute,
  HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
  sealHostedThreadDeliveryRoute,
  type HostedThreadDeliveryRouteChannel,
} from "@/src/lib/hosted-routing/thread-delivery-route";
import {
  consumeHostedLinqThreadRouteParticipantAdditionPendingTx,
  lockHostedThreadRouteByThreadIdentityTx,
  markHostedLinqThreadRouteParticipantAdditionPendingTx,
  readHostedThreadRouteByThreadIdentity,
  retireHostedLinqThreadRouteForRemovedAccountTx,
} from "@/src/lib/hosted-routing/thread-route-store";
import {
  parseHostedLinqWebhookEvent,
  requireHostedLinqMessageEditedEvent,
  requireHostedLinqMessageReceivedEvent,
  type HostedLinqParticipantChangedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import {
  buildHostedMemberIdentityPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
import {
  upsertHostedMemberHomeLinqBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-linq";
import {
  encryptHostedLinqLinePhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-line-phone-codec";
import {
  planHostedOnboardingLinqWebhook,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq";
import {
  applyHostedLinqParticipantChangeToRouteTx,
  handleHostedOnboardingLinqWebhook,
  runHostedLinqMessageEditPreparedTransaction,
} from "@/src/lib/hosted-onboarding/webhook-service";
import {
  HOSTED_CRYPTO_DOMAINS,
  HOSTED_CRYPTO_DOMAIN_RECIPIENT_KINDS,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
} from "@murphai/runtime-state";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const TEST_AUTHORITY_KEY_VERSION_NAME =
  "projects/example/locations/global/keyRings/hosted/cryptoKeys/authority/cryptoKeyVersions/1";
const TEST_ADDRESS_BOOK_KEY_VERSION_NAME =
  "projects/example/locations/global/keyRings/address-book/cryptoKeys/phone-token/cryptoKeyVersions/1";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type RouteFixture = {
  containerMemberId: string;
  messageClient: PrismaClient;
  observer: PrismaClient;
  ownerMemberId: string;
  participantClient: PrismaClient;
  threadId: string;
  threadIdentityLookupKey: string;
};

type ActiveLinqGroupRoute = {
  canonicalAccountLookupKey: string;
  canonicalDeliveryRouteEncrypted: string;
  canonicalPreparedDeliveryRoute: PreparedHostedThreadContainerDeliveryRoute;
  canonicalRecipientPhone: string;
  canonicalThreadLookupKey: string;
  deliveringPreparedDeliveryRoute: PreparedHostedThreadContainerDeliveryRoute;
  deliveringRecipientPhone: string;
  participantPhone: string;
};

type ActiveLinqDirectRoute = ActiveLinqGroupRoute & {
  recipientPhoneLookupKey: string;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createSignedHostedCallbackRequest(input: {
  body: string;
  keyId: string;
  nonce: string;
  path: string;
  privateKey: JsonWebKey;
  timestamp: string;
  userId: string;
}): Promise<Request> {
  const key = await crypto.subtle.importKey(
    "jwk",
    input.privateKey,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    {
      hash: "SHA-256",
      name: "ECDSA",
    },
    key,
    encodeHostedExecutionSignedRequestPayload({
      method: "POST",
      nonce: input.nonce,
      path: input.path,
      payload: input.body,
      search: "",
      timestamp: input.timestamp,
      userId: input.userId,
    }),
  );

  return new Request(`https://internal.example.test${input.path}`, {
    body: input.body,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [HOSTED_EXECUTION_NONCE_HEADER]: input.nonce,
      [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: input.keyId,
      [HOSTED_EXECUTION_SIGNATURE_HEADER]: Buffer.from(signature).toString(
        "base64url",
      ),
      [HOSTED_EXECUTION_TIMESTAMP_HEADER]: input.timestamp,
      [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
    },
    method: "POST",
  });
}

async function buildPreparedThreadContainerCreation(input: {
  accountLookupKey: string;
  channel?: HostedThreadDeliveryRouteChannel;
  containerMemberId: string;
  prisma: PrismaClient;
  threadId: string;
}): Promise<PreparedHostedThreadContainerCreation> {
  const channel = input.channel ?? "linq";
  const deliveryRoute = buildHostedThreadDeliveryRoute({
    accountLookupKey: input.accountLookupKey,
    channel,
    threadId: input.threadId,
  });
  const preparedAt = "2026-08-09T11:59:00.000Z";
  return {
    containerMemberId: input.containerMemberId,
    cryptoDomainRoots: new Map(HOSTED_CRYPTO_DOMAINS.map((domain) => [
      domain,
      {
        authoritySignature: {
          alg: "GCP-KMS-EC-P256-SHA256",
          keyVersionName: TEST_AUTHORITY_KEY_VERSION_NAME,
          signature: "test-authority-signature",
          signedAt: preparedAt,
        },
        createdAt: preparedAt,
        domain,
        generation: 1,
        rootKeyId: `test-root:${domain}:${input.containerMemberId}`,
        schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
        updatedAt: preparedAt,
        userId: input.containerMemberId,
        wraps: [{
          recipient: HOSTED_CRYPTO_DOMAIN_RECIPIENT_KINDS[domain][0],
        }],
      } as never,
    ])),
    deliveryRoute,
    deliveryRouteEncrypted: await sealHostedThreadDeliveryRoute({
      containerMemberId: input.containerMemberId,
      prisma: input.prisma,
      route: deliveryRoute,
    }),
    observedDeliveryRouteEncrypted: null,
  };
}

async function createRouteFixture(): Promise<RouteFixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
  }

  const fixtureId = randomUUID();
  const ownerMemberId = `member_linq_lock_owner_${fixtureId}`;
  const containerMemberId = `member_linq_lock_container_${fixtureId}`;
  const threadId = `chat_linq_lock_${fixtureId}`;
  const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
    channel: "linq",
    threadId,
  });
  if (!threadIdentityLookupKey) {
    throw new Error("Expected a Linq thread identity lookup key.");
  }

  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const participantClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const messageClient = createPrismaClient({ databaseUrl, poolMax: 1 });

  await observer.hostedMember.createMany({
    data: [
      { id: ownerMemberId },
      { id: containerMemberId },
    ],
  });
  // The hosted secure-box test codec in test/setup-env.ts short-circuits seal
  // and open before any domain-root lookup, so this fixture must not provision
  // real crypto roots: doing so would require the GCP authority key that the
  // PostgreSQL-ordering CI lane deliberately does not configure.
  await observer.hostedThreadContainer.create({
    data: {
      memberId: containerMemberId,
      ownerMemberId,
    },
  });
  await observer.hostedThreadRoute.create({
    data: {
      channel: "linq",
      containerMemberId,
      pendingParticipantAddition: false,
      threadIdentityLookupKey,
      threadLookupKey: `linq-lock-proof:${fixtureId}`,
    },
  });

  return {
    containerMemberId,
    messageClient,
    observer,
    ownerMemberId,
    participantClient,
    threadId,
    threadIdentityLookupKey,
  };
}

async function activateLinqGroupRoute(
  fixture: RouteFixture,
): Promise<ActiveLinqGroupRoute> {
  const numericSuffix = String(
    Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 7), 16)
      % 10_000_000,
  ).padStart(7, "0");
  const participantPhone = `+1555${numericSuffix}`;
  const canonicalRecipientPhone = `+1556${numericSuffix}`;
  const deliveringRecipientPhone = `+1557${numericSuffix}`;
  const participantPhoneLookupKey = createHostedPhoneLookupKey(
    participantPhone,
  );
  const canonicalAccountLookupKey = createHostedPhoneLookupKey(
    canonicalRecipientPhone,
  );
  const deliveringAccountLookupKey = createHostedPhoneLookupKey(
    deliveringRecipientPhone,
  );
  if (
    !participantPhoneLookupKey
    || !canonicalAccountLookupKey
    || !deliveringAccountLookupKey
  ) {
    throw new Error("Expected valid Linq routing phone inputs.");
  }

  await fixture.observer.hostedMember.update({
    data: { billingStatus: "active" },
    where: { id: fixture.ownerMemberId },
  });
  for (const scope of ["launch.legal", "launch.health-data"] as const) {
    await recordHostedLaunchRequiredConsent({
      memberId: fixture.ownerMemberId,
      prisma: fixture.observer,
      scope,
      source: "linq-route-lock-order-concurrency-test",
    });
  }
  const identityPrivate = await buildHostedMemberIdentityPrivateColumns({
    memberId: fixture.ownerMemberId,
    phoneNumber: participantPhone,
    prisma: fixture.observer,
    privyUserId: null,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
  });
  await fixture.observer.hostedMemberIdentity.create({
    data: {
      ...identityPrivate,
      maskedPhoneNumberHint: "*** test",
      memberId: fixture.ownerMemberId,
      phoneLookupKey: participantPhoneLookupKey,
      phoneNumberVerifiedAt: new Date("2026-08-09T11:00:00.000Z"),
    },
  });

  const canonicalDeliveryRoute = buildHostedThreadDeliveryRoute({
    accountLookupKey: canonicalAccountLookupKey,
    channel: "linq",
    threadId: fixture.threadId,
  });
  const canonicalDeliveryRouteEncrypted = await sealHostedThreadDeliveryRoute({
    containerMemberId: fixture.containerMemberId,
    prisma: fixture.observer,
    route: canonicalDeliveryRoute,
  });
  const canonicalThreadLookupKey = createHostedExternalThreadLookupKey({
    accountLookupKey: canonicalAccountLookupKey,
    channel: "linq",
    threadId: fixture.threadId,
  });
  if (!canonicalThreadLookupKey) {
    throw new Error("Expected a canonical Linq thread lookup key.");
  }
  await fixture.observer.hostedThreadRoute.update({
    data: {
      accountLookupKey: canonicalAccountLookupKey,
      deliveryRouteEncrypted: canonicalDeliveryRouteEncrypted,
      threadLookupKey: canonicalThreadLookupKey,
    },
    where: {
      channel_threadIdentityLookupKey: {
        channel: "linq",
        threadIdentityLookupKey: fixture.threadIdentityLookupKey,
      },
    },
  });

  const deliveringRoute = buildHostedThreadDeliveryRoute({
    accountLookupKey: deliveringAccountLookupKey,
    channel: "linq",
    threadId: fixture.threadId,
  });
  return {
    canonicalAccountLookupKey,
    canonicalDeliveryRouteEncrypted,
    canonicalPreparedDeliveryRoute: {
      containerMemberId: fixture.containerMemberId,
      deliveryRoute: canonicalDeliveryRoute,
      deliveryRouteEncrypted: canonicalDeliveryRouteEncrypted,
      observedDeliveryRouteEncrypted: canonicalDeliveryRouteEncrypted,
    },
    canonicalRecipientPhone,
    canonicalThreadLookupKey,
    deliveringPreparedDeliveryRoute: {
      containerMemberId: fixture.containerMemberId,
      deliveryRoute: deliveringRoute,
      deliveryRouteEncrypted: await sealHostedThreadDeliveryRoute({
        containerMemberId: fixture.containerMemberId,
        prisma: fixture.observer,
        route: deliveringRoute,
      }),
      observedDeliveryRouteEncrypted: canonicalDeliveryRouteEncrypted,
    },
    deliveringRecipientPhone,
    participantPhone,
  };
}

async function activateLinqDirectRoute(
  fixture: RouteFixture,
): Promise<ActiveLinqDirectRoute> {
  const route = await activateLinqGroupRoute(fixture);
  const recipientPhoneLookupKey = createHostedPhoneLookupKey(
    route.canonicalRecipientPhone,
  );
  const participantPhoneLookupKey = createHostedPhoneLookupKey(
    route.participantPhone,
  );
  if (!recipientPhoneLookupKey) {
    throw new Error("Expected a direct-route recipient lookup key.");
  }
  if (!participantPhoneLookupKey) {
    throw new Error("Expected a direct-route participant lookup key.");
  }

  await fixture.observer.hostedThreadRoute.deleteMany({
    where: {
      channel: "linq",
      threadIdentityLookupKey: fixture.threadIdentityLookupKey,
    },
  });
  await fixture.observer.hostedLinqLine.create({
    data: {
      configuredAt: new Date("2026-08-09T11:00:00.000Z"),
      egressPolicy: "enabled",
      healthStatus: "healthy",
      phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(
        route.canonicalRecipientPhone,
      ),
      phoneNumberHint: "*** test",
      phoneNumberLookupKey: recipientPhoneLookupKey,
      source: "test",
    },
  });
  await fixture.observer.$transaction((tx) =>
    upsertHostedMemberHomeLinqBindingTx({
      clearPending: true,
      homeLineAssignedAt: new Date("2026-08-09T11:00:00.000Z"),
      linqChatId: fixture.threadId,
      memberId: fixture.ownerMemberId,
      participantContact: {
        kind: "phone",
        lookupKey: participantPhoneLookupKey,
      },
      prisma: tx,
      recipientPhone: route.canonicalRecipientPhone,
    })
  );

  return { ...route, recipientPhoneLookupKey };
}

async function cleanupRouteFixture(fixture: RouteFixture): Promise<void> {
  await fixture.observer.hostedThreadRoute.deleteMany({
    where: {
      channel: "linq",
      threadIdentityLookupKey: fixture.threadIdentityLookupKey,
    },
  });
  const container = await fixture.observer.hostedThreadContainer.findUnique({
    select: { ownerMemberId: true },
    where: { memberId: fixture.containerMemberId },
  });
  await fixture.observer.hostedGroup.deleteMany({
    where: { runtimeMemberId: fixture.containerMemberId },
  });
  await fixture.observer.hostedThreadContainer.deleteMany({
    where: { memberId: fixture.containerMemberId },
  });
  await fixture.observer.hostedMember.deleteMany({
    where: {
      id: {
        in: [
          fixture.containerMemberId,
          fixture.ownerMemberId,
          ...(container ? [container.ownerMemberId] : []),
        ],
      },
    },
  });
  await Promise.all([
    fixture.messageClient.$disconnect(),
    fixture.participantClient.$disconnect(),
    fixture.observer.$disconnect(),
  ]);
}

async function expectCanonicalOwnerActionAuthority(input: {
  containerMemberId: string;
  ownerMemberId: string;
  prisma: PrismaClient;
  threadId: string;
}): Promise<void> {
  const originAssistantInputId = `ain_${"a".repeat(32)}`;
  const routeAuthority = {
    accountLookupKey: "test-account",
    channel: "linq" as const,
    containerMemberId: input.containerMemberId,
    threadId: input.threadId,
  };
  groupActionAuthorityMocks.readWake.mockResolvedValue({
    userId: input.containerMemberId,
  });
  groupActionAuthorityMocks.resolveSenderMemberId
    .mockResolvedValue(input.ownerMemberId);
  groupActionAuthorityMocks.hasActivationProof.mockResolvedValue(true);

  await expect(assertHostedGroupParticipantActionOriginHasOwnMurph({
    originAssistantInputId,
    prisma: input.prisma,
    routeAuthority,
  })).resolves.toBe(input.ownerMemberId);

  groupActionAuthorityMocks.resolveSenderMemberId
    .mockResolvedValue("member_roster_only");
  await expect(assertHostedGroupParticipantActionOriginHasOwnMurph({
    originAssistantInputId,
    prisma: input.prisma,
    routeAuthority,
  })).rejects.toMatchObject({
    code: "HOSTED_GROUP_PARTICIPANT_ACTION_AUTHORITY_REQUIRED",
    httpStatus: 403,
  });
}

async function readBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid() AS pid
  `;
  const pid = rows[0]?.pid;
  if (typeof pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return pid;
}

async function waitForBlockedBackend(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the PostgreSQL transaction to wait on a held lock.");
}

async function readPendingParticipantAddition(
  fixture: RouteFixture,
): Promise<boolean | null> {
  const route = await fixture.observer.hostedThreadRoute.findFirst({
    select: { pendingParticipantAddition: true },
    where: {
      channel: "linq",
      threadIdentityLookupKey: fixture.threadIdentityLookupKey,
    },
  });
  return route?.pendingParticipantAddition ?? null;
}

const ADDRESS_BOOK_ENV_KEYS = [
  "HOSTED_ADDRESS_BOOK_ADVISORY_NAMES_ENABLED",
  "HOSTED_ADDRESS_BOOK_REPLACEMENT_ENABLED",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
  "HOSTED_CRYPTO_ENV",
  "HOSTED_CRYPTO_GCP_ADDRESS_BOOK_MAC_KEYRING_JSON",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_GCP_KMS_API_ROOT",
  "HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME",
  "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
  "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY",
] as const;

function configureHostedAddressBookLocalCryptoForTest(): () => void {
  const previous = new Map(
    ADDRESS_BOOK_ENV_KEYS.map((key) => [key, process.env[key]]),
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
    HOSTED_ADDRESS_BOOK_ADVISORY_NAMES_ENABLED: "1",
    HOSTED_ADDRESS_BOOK_REPLACEMENT_ENABLED: "1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "test-automation-key",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK:
      JSON.stringify(automationKey.publicKey),
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_CRYPTO_GCP_ADDRESS_BOOK_MAC_KEYRING_JSON: JSON.stringify({
      currentVersion: 1,
      keyVersionNames: { 1: TEST_ADDRESS_BOOK_KEY_VERSION_NAME },
      readVersions: [1],
    }),
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION:
      TEST_AUTHORITY_KEY_VERSION_NAME,
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: authorityKey.publicKey,
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
      "projects/test/locations/global/keyRings/test/cryptoKeys/web-wrap",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK:
      JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
  return () => {
    for (const [key, value] of previous) {
      restoreEnvValue(key, value);
    }
  };
}

async function prepareAddressBookLabelFixture(
  fixture: RouteFixture,
  participantHandle: string,
): Promise<void> {
  await fixture.observer.hostedMember.updateMany({
    data: { billingStatus: "active" },
    where: {
      id: {
        in: [fixture.containerMemberId, fixture.ownerMemberId],
      },
    },
  });
  for (const scope of ["launch.legal", "launch.health-data"] as const) {
    await recordHostedLaunchRequiredConsent({
      memberId: fixture.ownerMemberId,
      prisma: fixture.observer,
      scope,
      source: "participant-context-concurrency-test",
    });
  }
  await replaceHostedAddressBookProjection({
    memberId: fixture.ownerMemberId,
    prisma: fixture.observer,
    request: parseHostedAddressBookReplaceRequest({
      baseRevision: 0,
      contacts: [{
        advisoryName: "Taylor R.",
        phoneNumber: participantHandle,
      }],
      mutationId: randomUUID(),
      schemaVersion: 1,
    }),
  });
}

function buildParticipantChangeEvent(input: {
  eventType: HostedLinqParticipantChangedEvent["event_type"];
  handle: string;
  threadId: string;
}): HostedLinqParticipantChangedEvent {
  const base = {
    api_version: "v3",
    created_at: "2026-07-29T01:00:00.000Z",
    data: {
      chat_id: input.threadId,
      participant: {
        handle: input.handle,
        service: "iMessage",
      },
    },
    event_id: `evt_${randomUUID()}`,
  };
  return input.eventType === "participant.added"
    ? { ...base, event_type: "participant.added" }
    : { ...base, event_type: "participant.removed" };
}

function readHostedSecureBoxTestValue(ciphertext: string): string {
  const encoded = ciphertext.replace(/^hsb-test:/u, "");
  const decoded = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as { value?: unknown };
  if (typeof decoded.value !== "string") {
    throw new Error("Expected a hosted secure-box test value.");
  }
  return decoded.value;
}

function observeParticipantContextRouteWrite(input: {
  ciphertext: Deferred<string>;
  release?: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const hostedThreadRoute = new Proxy(input.tx.hostedThreadRoute, {
    get(target, property) {
      if (property === "updateMany") {
        return async (args: Prisma.HostedThreadRouteUpdateManyArgs) => {
          const result = await target.updateMany(args);
          const encrypted = args.data.pendingGroupReactionContextEncrypted;
          if (typeof encrypted === "string") {
            input.ciphertext.resolve(encrypted);
            await input.release?.promise;
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy<Prisma.TransactionClient>(input.tx, {
    get(target, property) {
      if (property === "hostedThreadRoute") {
        return hostedThreadRoute;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function pauseHostedParticipantWebhookAfterContextWrite(input: {
  ciphertext: Deferred<string>;
  client: PrismaClient;
  pid: Deferred<number>;
  release: Deferred<void>;
}): PrismaClient {
  return new Proxy(input.client, {
    get(target, property) {
      if (property === "$transaction") {
        return <TResult>(
          callback: (tx: Prisma.TransactionClient) => Promise<TResult>,
          options?: {
            isolationLevel?: Prisma.TransactionIsolationLevel;
            maxWait?: number;
            timeout?: number;
          },
        ) => target.$transaction(async (tx) => {
          input.pid.resolve(await readBackendPid(tx));
          return callback(observeParticipantContextRouteWrite({
            ciphertext: input.ciphertext,
            release: input.release,
            tx,
          }));
        }, options);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function pauseAddressBookClearBeforeCommit(input: {
  cleared: Deferred<void>;
  client: PrismaClient;
  release: Deferred<void>;
}): PrismaClient {
  return new Proxy(input.client, {
    get(target, property) {
      if (property === "$transaction") {
        return (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options?: {
            isolationLevel?: Prisma.TransactionIsolationLevel;
            maxWait?: number;
            timeout?: number;
          },
        ) => target.$transaction(async (tx) => callback(
          new Proxy<Prisma.TransactionClient>(tx, {
            get(transaction, transactionProperty) {
              if (transactionProperty === "hostedThreadRoute") {
                return new Proxy(transaction.hostedThreadRoute, {
                  get(delegate, delegateProperty) {
                    if (delegateProperty === "updateMany") {
                      return async (
                        args: Prisma.HostedThreadRouteUpdateManyArgs,
                      ) => {
                        const result = await delegate.updateMany(args);
                        if (
                          args.data.pendingGroupReactionContextEncrypted === null
                        ) {
                          input.cleared.resolve();
                          await input.release.promise;
                        }
                        return result;
                      };
                    }
                    const value = Reflect.get(
                      delegate,
                      delegateProperty,
                      delegate,
                    );
                    return typeof value === "function"
                      ? value.bind(delegate)
                      : value;
                  },
                });
              }
              const value = Reflect.get(
                transaction,
                transactionProperty,
                transaction,
              );
              return typeof value === "function"
                ? value.bind(transaction)
                : value;
            },
          }),
        ), options);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function configureHostedContactPrivacyKeyringForTest(
  currentVersion: "v1" | "v2",
): void {
  const keys = [
    `v1:${Buffer.alloc(32, 3).toString("base64url")}`,
  ];
  if (currentVersion === "v2") {
    keys.push(`v2:${Buffer.alloc(32, 4).toString("base64url")}`);
  }
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = keys.join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = currentVersion;
  clearHostedOnboardingEnvCache();
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function pauseHostedThreadRouteUpdateAfterWrite(input: {
  release: Deferred<void>;
  tx: Prisma.TransactionClient;
  updated: Deferred<void>;
}): Prisma.TransactionClient {
  const hostedThreadRoute = new Proxy(input.tx.hostedThreadRoute, {
    get(target, property) {
      if (property === "update") {
        return async (args: Prisma.HostedThreadRouteUpdateArgs) => {
          const route = await target.update(args);
          input.updated.resolve();
          await input.release.promise;
          return route;
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return new Proxy<Prisma.TransactionClient>(input.tx, {
    get(target, property) {
      if (property === "hostedThreadRoute") {
        return hostedThreadRoute;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function observeHostedThreadRouteLockAttempt(input: {
  attempted: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  return new Proxy<Prisma.TransactionClient>(input.tx, {
    get(target, property) {
      if (property === "$executeRaw") {
        input.attempted.resolve();
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function pauseHostedMemberRoutingDemotionAfterWrite(input: {
  demoted: Deferred<void>;
  release: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const hostedMemberRouting = new Proxy(input.tx.hostedMemberRouting, {
    get(target, property) {
      if (property === "updateMany") {
        return async (args: Prisma.HostedMemberRoutingUpdateManyArgs) => {
          const result = await target.updateMany(args);
          input.demoted.resolve();
          await input.release.promise;
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return new Proxy<Prisma.TransactionClient>(input.tx, {
    get(target, property) {
      if (property === "hostedMemberRouting") {
        return hostedMemberRouting;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function buildRoutedGroupMessageEvent(input: {
  createdAt: string;
  eventId: string;
  messageId: string;
  ownerPhone: string;
  participantPhone: string;
  text: string;
  threadId: string;
}) {
  return requireHostedLinqMessageReceivedEvent(parseHostedLinqWebhookEvent(
    JSON.stringify({
    api_version: "v3",
    created_at: input.createdAt,
    data: {
      chat: {
        id: input.threadId,
        is_group: true,
        owner_handle: {
          handle: input.ownerPhone,
          id: "owner-handle",
          is_me: true,
          service: "iMessage",
        },
      },
      direction: "inbound",
      id: input.messageId,
      parts: [{ type: "text", value: input.text }],
      sender_handle: {
        handle: input.participantPhone,
        id: "sender-handle",
        service: "iMessage",
      },
      sent_at: input.createdAt,
      service: "iMessage",
    },
    event_id: input.eventId,
    event_type: "message.received",
    webhook_version: "2026-02-03",
    }),
  ));
}

function buildRoutedDirectMessageEvent(input: {
  createdAt: string;
  eventId: string;
  messageId: string;
  participantPhone: string;
  recipientPhone: string;
  text: string;
  threadId: string;
}) {
  return requireHostedLinqMessageReceivedEvent(parseHostedLinqWebhookEvent(
    JSON.stringify({
      api_version: "v3",
      created_at: input.createdAt,
      data: {
        chat: {
          id: input.threadId,
          is_group: false,
          owner_handle: {
            handle: input.recipientPhone,
            id: "owner-handle-direct",
            is_me: true,
            service: "iMessage",
          },
        },
        direction: "inbound",
        id: input.messageId,
        parts: [{ type: "text", value: input.text }],
        sender_handle: {
          handle: input.participantPhone,
          id: "sender-handle-direct",
          service: "iMessage",
        },
        sent_at: input.createdAt,
        service: "iMessage",
      },
      event_id: input.eventId,
      event_type: "message.received",
      webhook_version: "2026-02-03",
    }),
  ));
}

function buildRoutedGroupMessageEditedEvent(input: {
  createdAt: string;
  eventId: string;
  messageId: string;
  participantPhone: string;
  text: string;
  threadId: string;
}) {
  return requireHostedLinqMessageEditedEvent(parseHostedLinqWebhookEvent(
    JSON.stringify({
    api_version: "v3",
    created_at: input.createdAt,
    data: {
      chat: { id: input.threadId },
      direction: "inbound",
      edited_at: input.createdAt,
      id: input.messageId,
      part: { index: 0, text: input.text },
      sender_handle: {
        handle: input.participantPhone,
        id: "sender-handle-edit",
        is_me: false,
        service: "iMessage",
      },
    },
    event_id: input.eventId,
    event_type: "message.edited",
    webhook_version: "2026-02-03",
    }),
  ));
}

function pauseHostedWebhookTransactionAfterRawOperation(input: {
  client: PrismaClient;
  locked: Deferred<void>;
  operation?: "execute" | "query";
  operationCall?: number;
  pid: Deferred<number>;
  release: Deferred<void>;
  timeoutMs?: number;
}): PrismaClient {
  let paused = false;
  let rawOperationCalls = 0;
  return new Proxy(input.client, {
    get(target, property) {
      if (property === "$transaction") {
        return <TResult>(
          callback: (tx: Prisma.TransactionClient) => Promise<TResult>,
          options?: {
            isolationLevel?: Prisma.TransactionIsolationLevel;
            maxWait?: number;
            timeout?: number;
          },
        ) => {
          return target.$transaction(async (tx) => {
            input.pid.resolve(await readBackendPid(tx));
            const propertyToPause = input.operation === "execute"
              ? "$executeRaw"
              : input.operation === "query"
                ? "$queryRaw"
                : null;
            const pausedTx = new Proxy<Prisma.TransactionClient>(tx, {
              get(transaction, transactionProperty) {
                const value = Reflect.get(
                  transaction,
                  transactionProperty,
                  transaction,
                );
                if (
                  propertyToPause !== null
                  && transactionProperty === propertyToPause
                  && typeof value === "function"
                ) {
                  return async (...args: unknown[]) => {
                    const result = await Reflect.apply(value, transaction, args);
                    rawOperationCalls += 1;
                    if (
                      !paused
                      && rawOperationCalls === (input.operationCall ?? 1)
                    ) {
                      paused = true;
                      input.locked.resolve();
                      await input.release.promise;
                    }
                    return result;
                  };
                }
                return typeof value === "function"
                  ? value.bind(transaction)
                  : value;
              },
            });
            return callback(pausedTx);
          }, {
            ...options,
            ...(input.timeoutMs ? { timeout: input.timeoutMs } : {}),
          });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function runVisibleAccessRace<T>(input: {
  accessKind?: "access_notice" | "signup";
  assignedPhone: string;
  fixture: RouteFixture;
  operationChatLockCall?: number;
  participantPhone: string;
  runOperation: (client: PrismaClient) => Promise<T>;
  startOrder: "operation-first" | "reconciliation-first";
}): Promise<{
  operation: T;
  reconciliation:
    | { error: unknown; status: "rejected" }
    | { status: "resolved" };
}> {
  const firstLockHeld = createDeferred();
  const releaseFirst = createDeferred();
  const reconciliationPid = createDeferred<number>();
  const operationPid = createDeferred<number>();
  let reconciliationTask: Promise<
    | { error: unknown; status: "rejected" }
    | { status: "resolved" }
  > | null = null;
  let operationTask: Promise<T> | null = null;
  const providerSend = vi.spyOn(
    hostedLinqClient,
    "sendHostedLinqChatMessage",
  ).mockResolvedValue({
    chatId: input.fixture.threadId,
    messageId: `message_visible_signup_${randomUUID()}`,
  });
  const providerCreateChat = vi.spyOn(
    hostedLinqClient,
    "createHostedLinqChat",
  ).mockResolvedValue({
    chatId: `chat_private_signup_${randomUUID()}`,
    messageId: `message_private_signup_${randomUUID()}`,
  });
  const signalRuntime = vi.spyOn(
    hostedRuntimeSignal,
    "signalHostedMailboxAppendRuntime",
  ).mockResolvedValue({
    signalAccepted: true,
    workflowId: "hosted-user-runtime:lock-order-test",
  });
  const getPrisma = vi.spyOn(prismaModule, "getPrisma")
    .mockImplementation(() => {
      if (!visibleReconciliationMocks.client) {
        throw new Error("Expected a visible reconciliation Prisma client.");
      }
      return visibleReconciliationMocks.client as PrismaClient;
    });
  const resolveAccess = vi.spyOn(
    recognizedInboundAccess,
    "resolveHostedRecognizedInboundAccess",
  ).mockImplementation(async () => {
    if (!visibleReconciliationMocks.access) {
      throw new Error("Expected a visible reconciliation access result.");
    }
    return visibleReconciliationMocks.access as never;
  });
  const previousPublicBaseUrl = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;

  try {
    process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://www.withmurph.ai";
    clearHostedOnboardingEnvCache();
    const accessKind = input.accessKind ?? "signup";
    const inviteId = `invite_visible_${randomUUID()}`;
    const inviteCode = `visible-${randomUUID()}`;
    if (accessKind === "signup") {
      await input.fixture.observer.hostedInvite.create({
        data: {
          channel: "linq",
          expiresAt: new Date("2026-09-09T12:00:00.000Z"),
          id: inviteId,
          inviteCode,
          memberId: input.fixture.ownerMemberId,
        },
      });
    }
    const participantPhoneLookupKey = createHostedPhoneLookupKey(
      input.participantPhone,
    );
    if (!participantPhoneLookupKey) {
      throw new Error("Expected a visible-signup participant lookup key.");
    }
    visibleReconciliationMocks.enabled = true;
    visibleReconciliationMocks.access = accessKind === "access_notice"
      ? {
          kind: "access_notice",
          message: "Your billing needs attention.",
          noticeCode: "billing_inactive",
          responseReason: "sent-billing-inactive-notice",
        }
      : {
          inviteCode,
          inviteId,
          joinUrl: `https://www.withmurph.ai/join/${inviteCode}`,
          kind: "signup",
          message: "Finish setup.",
          responseReason: "sent-signup-link",
        };
    visibleReconciliationMocks.facts = {
      blocked: { reason: "user_not_active" },
      mailboxLag: [{ lane: "conversation", lag: "1" }],
      workspace: { nextWakeAt: null },
    };
    visibleReconciliationMocks.item = { id: "mailbox_stale_direct" };
    visibleReconciliationMocks.wake = {
      eventId: `event_stale_direct_${randomUUID()}`,
      kind: "conversation.message",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: input.fixture.threadId,
          from: input.participantPhone,
          isFromMe: false,
          messageId: `message_stale_direct_${randomUUID()}`,
          parts: [{ type: "text", value: "Help" }],
          service: "iMessage",
          threadIsDirect: true,
        },
        phoneLookupKey: participantPhoneLookupKey,
        senderMemberId: input.fixture.ownerMemberId,
      },
      occurredAt: "2026-08-09T11:59:00.000Z",
      userId: input.fixture.ownerMemberId,
    };

    const runReconciliation = (pauseAfterMemberLock: boolean) => {
      visibleReconciliationMocks.client =
        pauseHostedWebhookTransactionAfterRawOperation({
          client: input.fixture.messageClient,
          locked: firstLockHeld,
          ...(pauseAfterMemberLock ? { operation: "query" } : {}),
          pid: reconciliationPid,
          release: releaseFirst,
          timeoutMs: 120_000,
        });
      reconciliationTask = readHostedRuntimeReconciliationFactsWithVisibleAccess({
        userId: input.fixture.ownerMemberId,
      }).then(
        () => ({ status: "resolved" as const }),
        (error: unknown) => ({ error, status: "rejected" as const }),
      );
    };
    const runOperation = (pauseAfterChatLock: boolean) => {
      const client = pauseHostedWebhookTransactionAfterRawOperation({
        client: input.fixture.participantClient,
        locked: firstLockHeld,
        ...(pauseAfterChatLock
          ? {
              operation: "execute",
              operationCall: input.operationChatLockCall ?? 1,
            }
          : {}),
        pid: operationPid,
        release: releaseFirst,
        timeoutMs: 120_000,
      });
      operationTask = input.runOperation(client);
    };

    if (input.startOrder === "reconciliation-first") {
      runReconciliation(true);
      await firstLockHeld.promise;
      runOperation(false);
      await waitForBlockedBackend({
        observer: input.fixture.observer,
        pid: await operationPid.promise,
      });
    } else {
      runOperation(true);
      await firstLockHeld.promise;
      runReconciliation(false);
      if (!reconciliationTask) {
        throw new Error("Expected the private reconciliation to start.");
      }
      await reconciliationTask;
    }
    releaseFirst.resolve();

    if (!operationTask || !reconciliationTask) {
      throw new Error("Expected both visible-access race transactions.");
    }
    const [operation, reconciliation] = await Promise.all([
      operationTask,
      reconciliationTask,
    ]);
    expect(providerSend).not.toHaveBeenCalled();
    expect(providerCreateChat).toHaveBeenCalledOnce();
    expect(providerCreateChat).toHaveBeenCalledWith(expect.objectContaining({
      from: input.assignedPhone,
      to: [input.participantPhone],
    }));
    return {
      operation,
      reconciliation,
    };
  } finally {
    releaseFirst.resolve();
    await Promise.allSettled([
      ...(operationTask ? [operationTask] : []),
      ...(reconciliationTask ? [reconciliationTask] : []),
    ]);
    visibleReconciliationMocks.client = null;
    visibleReconciliationMocks.access = null;
    visibleReconciliationMocks.enabled = false;
    visibleReconciliationMocks.facts = null;
    visibleReconciliationMocks.item = null;
    visibleReconciliationMocks.wake = null;
    resolveAccess.mockRestore();
    getPrisma.mockRestore();
    providerCreateChat.mockRestore();
    providerSend.mockRestore();
    signalRuntime.mockRestore();
    restoreEnvValue(
      "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
      previousPublicBaseUrl,
    );
    clearHostedOnboardingEnvCache();
  }
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "Linq group PostgreSQL ordering",
  () => {
    it("retires only a route that was not refreshed after the removal event", async () => {
      const fixture = await createRouteFixture();
      const accountLookupKey = `test-route-account-${randomUUID()}`;
      const removedAt = new Date("2026-08-28T12:00:00.000Z");
      try {
        await fixture.observer.hostedThreadRoute.update({
          data: {
            accountLookupKey,
            updatedAt: new Date("2026-08-28T12:00:01.000Z"),
          },
          where: {
            channel_threadIdentityLookupKey: {
              channel: "linq",
              threadIdentityLookupKey: fixture.threadIdentityLookupKey,
            },
          },
        });

        await expect(fixture.observer.$transaction((tx) =>
          retireHostedLinqThreadRouteForRemovedAccountTx({
            accountLookupKeys: [accountLookupKey],
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            removedAt,
            threadId: fixture.threadId,
          })
        )).resolves.toBe(false);
        await expect(fixture.observer.hostedThreadRoute.count({
          where: {
            channel: "linq",
            threadIdentityLookupKey: fixture.threadIdentityLookupKey,
          },
        })).resolves.toBe(1);

        await fixture.observer.hostedThreadRoute.update({
          data: { updatedAt: removedAt },
          where: {
            channel_threadIdentityLookupKey: {
              channel: "linq",
              threadIdentityLookupKey: fixture.threadIdentityLookupKey,
            },
          },
        });

        await expect(fixture.observer.$transaction((tx) =>
          retireHostedLinqThreadRouteForRemovedAccountTx({
            accountLookupKeys: [accountLookupKey],
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            removedAt,
            threadId: fixture.threadId,
          })
        )).resolves.toBe(true);
        await expect(fixture.observer.hostedThreadRoute.count({
          where: {
            channel: "linq",
            threadIdentityLookupKey: fixture.threadIdentityLookupKey,
          },
        })).resolves.toBe(0);
      } finally {
        await cleanupRouteFixture(fixture);
      }
    });
    it.each([
      { startOrder: "operation-first" },
      { startOrder: "reconciliation-first" },
    ] as const)(
      "serializes visible signup with actual direct ingress when $startOrder",
      async ({ startOrder }) => {
        let fixture: RouteFixture | null = null;
        let directRoute: ActiveLinqDirectRoute | null = null;
        try {
          fixture = await createRouteFixture();
          const activeFixture = fixture;
          directRoute = await activateLinqDirectRoute(activeFixture);
          const event = buildRoutedDirectMessageEvent({
            createdAt: "2026-08-09T12:00:00.000Z",
            eventId: `event_direct_${randomUUID()}`,
            messageId: `message_direct_${randomUUID()}`,
            participantPhone: directRoute.participantPhone,
            recipientPhone: directRoute.canonicalRecipientPhone,
            text: "Direct ingress",
            threadId: activeFixture.threadId,
          });
          const race = await runVisibleAccessRace({
            assignedPhone: directRoute.canonicalRecipientPhone,
            fixture: activeFixture,
            participantPhone: directRoute.participantPhone,
            runOperation: (client) => client.$transaction((tx) =>
              planHostedOnboardingLinqWebhook({ event, prisma: tx })
            ),
            startOrder,
          });

          expect(race.operation).toMatchObject({
            response: {
              ignored: false,
              ok: true,
              reason: "wake-appended-active-member",
            },
          });
          expect(race.reconciliation).toEqual({ status: "resolved" });
          expect(await activeFixture.observer.hostedMailboxItem.count({
            where: { dedupeKey: event.event_id },
          })).toBe(1);
          expect(await readHostedMailboxWakeByDedupeKey({
            dedupeKey: event.event_id,
            prisma: activeFixture.observer,
            userId: activeFixture.ownerMemberId,
          })).toMatchObject({
            eventId: event.event_id,
            kind: "conversation.message",
            message: {
              channel: "linq",
              linqMessage: {
                chatId: activeFixture.threadId,
                messageId: event.data.message.id,
                threadIsDirect: true,
              },
            },
          });
          expect(await activeFixture.observer.hostedThreadRoute.count({
            where: {
              channel: "linq",
              threadIdentityLookupKey: activeFixture.threadIdentityLookupKey,
            },
          })).toBe(0);
        } finally {
          if (fixture && directRoute) {
            await fixture.observer.hostedLinqLine.deleteMany({
              where: {
                phoneNumberLookupKey: directRoute.recipientPhoneLookupKey,
              },
            });
          }
          if (fixture) {
            await cleanupRouteFixture(fixture);
          }
        }
      },
    );

    it.each([
      { startOrder: "edit-first" },
      { startOrder: "egress-first" },
    ] as const)(
      "serializes the signed direct edit with authenticated runtime egress when $startOrder",
      async ({ startOrder }) => {
        const firstLockHeld = createDeferred();
        const releaseFirst = createDeferred();
        const editPid = createDeferred<number>();
        const egressPid = createDeferred<number>();
        let fixture: RouteFixture | null = null;
        let directRoute: ActiveLinqDirectRoute | null = null;
        let editTask: ReturnType<
          typeof handleHostedOnboardingLinqWebhook
        > | null = null;
        let egressTask: Promise<Response> | null = null;
        let egressClient: PrismaClient | null = null;
        const getPrisma = vi.spyOn(prismaModule, "getPrisma")
          .mockImplementation(() => {
            if (!egressClient) {
              throw new Error("Expected the authenticated egress Prisma client.");
            }
            return egressClient;
          });
        const signalRuntime = vi.spyOn(
          hostedRuntimeSignal,
          "signalHostedMailboxAppendRuntime",
        ).mockResolvedValue({
          signalAccepted: true,
          workflowId: "hosted-user-runtime:linq-lock-order-test",
        });
        const callbackKey = generateKeyPairSync("ec", {
          namedCurve: "prime256v1",
          privateKeyEncoding: { format: "jwk" },
          publicKeyEncoding: { format: "jwk" },
        });
        const callbackKeyId = `linq-lock-order-${randomUUID()}`;
        const previousCallbackKeyId =
          process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID;
        const previousCallbackPublicJwk =
          process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK;
        const previousCallbackKeyring =
          process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON;
        const previousWebhookSecret = process.env.LINQ_WEBHOOK_SECRET;
        const webhookSecret = `linq-lock-order-${randomUUID()}`;
        const providerIdempotencyKey =
          `assistant-outbox:linq-lock-order:${randomUUID()}`;
        const providerIdempotencyLookupKey =
          createHostedLinqDeliveryIdempotencyLookupKey(
            providerIdempotencyKey,
          );

        try {
          process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID = callbackKeyId;
          process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK =
            JSON.stringify(callbackKey.publicKey);
          process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON =
            JSON.stringify({ [callbackKeyId]: callbackKey.publicKey });
          process.env.LINQ_WEBHOOK_SECRET = webhookSecret;
          clearHostedOnboardingEnvCache();

          fixture = await createRouteFixture();
          const activeFixture = fixture;
          directRoute = await activateLinqDirectRoute(activeFixture);
          const activeDirectRoute = directRoute;
          const originalMessageId = `message_direct_original_${randomUUID()}`;
          const originalEvent = buildRoutedDirectMessageEvent({
            createdAt: "2026-08-09T12:00:00.000Z",
            eventId: `event_direct_original_${randomUUID()}`,
            messageId: originalMessageId,
            participantPhone: activeDirectRoute.participantPhone,
            recipientPhone: activeDirectRoute.canonicalRecipientPhone,
            text: "Original direct message",
            threadId: activeFixture.threadId,
          });
          await expect(activeFixture.observer.$transaction((tx) =>
            planHostedOnboardingLinqWebhook({
              event: originalEvent,
              prisma: tx,
            })
          )).resolves.toMatchObject({
            response: {
              ignored: false,
              ok: true,
              reason: "wake-appended-active-member",
            },
          });

          const editEvent = buildRoutedGroupMessageEditedEvent({
            createdAt: "2026-08-09T12:01:00.000Z",
            eventId: `event_direct_edit_${randomUUID()}`,
            messageId: originalMessageId,
            participantPhone: activeDirectRoute.participantPhone,
            text: "Corrected direct message",
            threadId: activeFixture.threadId,
          });
          const editRawBody = JSON.stringify(editEvent);
          const editTimestamp = String(Math.floor(Date.now() / 1_000));
          const editSignature = `sha256=${createHmac("sha256", webhookSecret)
            .update(`${editTimestamp}.${editRawBody}`)
            .digest("hex")}`;
          const engagementPath =
            "/api/internal/hosted-runtime/linq-egress/engagement";
          const engagementBody = JSON.stringify({
            authorityCheckOnly: false,
            directRecipientPhoneNumber: activeDirectRoute.participantPhone,
            fromPhoneNumber: activeDirectRoute.canonicalRecipientPhone,
            idempotencyKey: providerIdempotencyKey,
            target: activeFixture.threadId,
            targetKind: "thread",
          });
          const engagementRequest = await createSignedHostedCallbackRequest({
            body: engagementBody,
            keyId: callbackKeyId,
            nonce: randomUUID().replaceAll("-", ""),
            path: engagementPath,
            privateKey: callbackKey.privateKey,
            timestamp: new Date().toISOString(),
            userId: activeFixture.ownerMemberId,
          });
          const editClient = pauseHostedWebhookTransactionAfterRawOperation({
            client: activeFixture.participantClient,
            locked: firstLockHeld,
            ...(startOrder === "edit-first" ? { operation: "execute" } : {}),
            pid: editPid,
            release: releaseFirst,
          });
          egressClient = pauseHostedWebhookTransactionAfterRawOperation({
            client: activeFixture.messageClient,
            locked: firstLockHeld,
            ...(startOrder === "egress-first" ? { operation: "execute" } : {}),
            pid: egressPid,
            release: releaseFirst,
          });

          const startEdit = () =>
            handleHostedOnboardingLinqWebhook({
              prisma: editClient,
              rawBody: editRawBody,
              scheduleAfterResponse: () => undefined,
              signature: editSignature,
              timestamp: editTimestamp,
            });
          const startEgress = () =>
            postHostedLinqEgressEngagement(engagementRequest);

          if (startOrder === "edit-first") {
            editTask = startEdit();
            await firstLockHeld.promise;
            egressTask = startEgress();
            await waitForBlockedBackend({
              observer: activeFixture.observer,
              pid: await egressPid.promise,
            });
          } else {
            egressTask = startEgress();
            await firstLockHeld.promise;
            editTask = startEdit();
            await waitForBlockedBackend({
              observer: activeFixture.observer,
              pid: await editPid.promise,
            });
          }
          releaseFirst.resolve();

          if (!editTask || !egressTask) {
            throw new Error("Expected both signed Linq requests to start.");
          }
          const [editResult, egressResponse] = await Promise.all([
            editTask,
            egressTask,
          ]);
          expect(editResult).toMatchObject({
            ignored: false,
            ok: true,
            reason: "wake-appended-message-edit",
          });
          expect(egressResponse.status).toBe(200);
          await expect(egressResponse.json()).resolves.toMatchObject({
            ok: true,
            providerDispatchClaimed: true,
            resolvedRoute: {
              target: activeFixture.threadId,
              targetKind: "thread",
              threadIsDirect: true,
            },
          });
          expect(await activeFixture.observer.hostedMailboxItem.count({
            where: { dedupeKey: editEvent.event_id },
          })).toBe(1);
          expect(await activeFixture.observer.hostedLinqDelivery.count({
            where: { idempotencyKey: providerIdempotencyLookupKey },
          })).toBe(1);
          expect(signalRuntime).toHaveBeenCalledTimes(1);
        } finally {
          releaseFirst.resolve();
          await Promise.allSettled([
            ...(editTask ? [editTask] : []),
            ...(egressTask ? [egressTask] : []),
          ]);
          if (fixture) {
            await fixture.observer.hostedWebInternalRequestNonce.deleteMany({
              where: { userId: fixture.ownerMemberId },
            });
            await fixture.observer.hostedLinqDelivery.deleteMany({
              where: { idempotencyKey: providerIdempotencyLookupKey },
            });
          }
          if (fixture && directRoute) {
            await fixture.observer.hostedLinqLine.deleteMany({
              where: {
                phoneNumberLookupKey: directRoute.recipientPhoneLookupKey,
              },
            });
          }
          if (fixture) {
            await cleanupRouteFixture(fixture);
          }
          getPrisma.mockRestore();
          signalRuntime.mockRestore();
          restoreEnvValue(
            "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID",
            previousCallbackKeyId,
          );
          restoreEnvValue(
            "HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK",
            previousCallbackPublicJwk,
          );
          restoreEnvValue(
            "HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON",
            previousCallbackKeyring,
          );
          restoreEnvValue("LINQ_WEBHOOK_SECRET", previousWebhookSecret);
          clearHostedOnboardingEnvCache();
        }
      },
    );

    it.each([
      { startOrder: "operation-first" },
      { startOrder: "reconciliation-first" },
    ] as const)(
      "serializes visible signup with an actual direct edit when $startOrder",
      async ({ startOrder }) => {
        let fixture: RouteFixture | null = null;
        let directRoute: ActiveLinqDirectRoute | null = null;
        try {
          fixture = await createRouteFixture();
          const activeFixture = fixture;
          directRoute = await activateLinqDirectRoute(activeFixture);
          const originalMessageId = `message_direct_original_${randomUUID()}`;
          const originalEvent = buildRoutedDirectMessageEvent({
            createdAt: "2026-08-09T12:00:00.000Z",
            eventId: `event_direct_original_${randomUUID()}`,
            messageId: originalMessageId,
            participantPhone: directRoute.participantPhone,
            recipientPhone: directRoute.canonicalRecipientPhone,
            text: "Original direct message",
            threadId: activeFixture.threadId,
          });
          await expect(activeFixture.observer.$transaction((tx) =>
            planHostedOnboardingLinqWebhook({
              event: originalEvent,
              prisma: tx,
            })
          )).resolves.toMatchObject({
            response: {
              ignored: false,
              ok: true,
              reason: "wake-appended-active-member",
            },
          });
          const editEvent = buildRoutedGroupMessageEditedEvent({
            createdAt: "2026-08-09T12:01:00.000Z",
            eventId: `event_direct_edit_${randomUUID()}`,
            messageId: originalMessageId,
            participantPhone: directRoute.participantPhone,
            text: "Corrected direct message",
            threadId: activeFixture.threadId,
          });
          const race = await runVisibleAccessRace({
            assignedPhone: directRoute.canonicalRecipientPhone,
            fixture: activeFixture,
            operationChatLockCall: 2,
            participantPhone: directRoute.participantPhone,
            runOperation: (client) =>
              runHostedLinqMessageEditPreparedTransaction({
                event: editEvent,
                prisma: client,
              }),
            startOrder,
          });

          expect(race.operation).toMatchObject({
            response: {
              ignored: false,
              ok: true,
              reason: "wake-appended-message-edit",
            },
          });
          expect(race.reconciliation).toEqual({ status: "resolved" });
          expect(await activeFixture.observer.hostedMailboxItem.count({
            where: { dedupeKey: editEvent.event_id },
          })).toBe(1);
          expect(await readHostedMailboxWakeByDedupeKey({
            dedupeKey: editEvent.event_id,
            prisma: activeFixture.observer,
            userId: activeFixture.ownerMemberId,
          })).toMatchObject({
            eventId: editEvent.event_id,
            kind: "conversation.message",
            message: {
              channel: "linq",
              linqMessage: {
                chatId: activeFixture.threadId,
                editedTextPartIndex: 0,
                messageId: originalMessageId,
                parts: [{
                  type: "text",
                  value: "Corrected direct message",
                }],
                threadIsDirect: true,
              },
            },
          });
        } finally {
          if (fixture && directRoute) {
            await fixture.observer.hostedLinqLine.deleteMany({
              where: {
                phoneNumberLookupKey: directRoute.recipientPhoneLookupKey,
              },
            });
          }
          if (fixture) {
            await cleanupRouteFixture(fixture);
          }
        }
      },
    );

    it.each([
      { accessKind: "signup", startOrder: "operation-first" },
      { accessKind: "signup", startOrder: "reconciliation-first" },
      { accessKind: "access_notice", startOrder: "operation-first" },
      { accessKind: "access_notice", startOrder: "reconciliation-first" },
    ] as const)(
      "serializes visible $accessKind with actual first group-route creation when $startOrder",
      async ({ accessKind, startOrder }) => {
        let fixture: RouteFixture | null = null;
        let directRoute: ActiveLinqDirectRoute | null = null;
        try {
          fixture = await createRouteFixture();
          const activeFixture = fixture;
          directRoute = await activateLinqDirectRoute(activeFixture);
          await activeFixture.observer.hostedThreadContainer.delete({
            where: { memberId: activeFixture.containerMemberId },
          });
          await activeFixture.observer.hostedMember.delete({
            where: { id: activeFixture.containerMemberId },
          });
          const preparedCreation = await buildPreparedThreadContainerCreation({
            accountLookupKey: directRoute.canonicalAccountLookupKey,
            containerMemberId: activeFixture.containerMemberId,
            prisma: activeFixture.observer,
            threadId: activeFixture.threadId,
          });
          const event = buildRoutedGroupMessageEvent({
            createdAt: "2026-08-09T12:00:00.000Z",
            eventId: `event_group_create_${randomUUID()}`,
            messageId: `message_group_create_${randomUUID()}`,
            ownerPhone: directRoute.canonicalRecipientPhone,
            participantPhone: directRoute.participantPhone,
            text: "First group message",
            threadId: activeFixture.threadId,
          });
          const race = await runVisibleAccessRace({
            accessKind,
            assignedPhone: directRoute.canonicalRecipientPhone,
            fixture: activeFixture,
            participantPhone: directRoute.participantPhone,
            runOperation: (client) => client.$transaction((tx) =>
              planHostedOnboardingLinqWebhook({
                event,
                pendingGroupParticipantMemberIds: [
                  activeFixture.ownerMemberId,
                ],
                preparedThreadContainerCreation: preparedCreation,
                prisma: tx,
              })
            ),
            startOrder,
          });

          expect(race.operation).toMatchObject({
            response: {
              ignored: false,
              ok: true,
              reason: "wake-appended-thread-route",
            },
          });
          expect(race.reconciliation).toEqual({ status: "resolved" });
          expect(await activeFixture.observer.hostedMailboxItem.count({
            where: { dedupeKey: event.event_id },
          })).toBe(1);
          expect(await readHostedMailboxWakeByDedupeKey({
            dedupeKey: event.event_id,
            prisma: activeFixture.observer,
            userId: activeFixture.containerMemberId,
          })).toMatchObject({
            eventId: event.event_id,
            kind: "conversation.message",
            message: {
              channel: "linq",
              linqMessage: {
                chatId: activeFixture.threadId,
                messageId: event.data.message.id,
                threadIsDirect: false,
              },
            },
          });
          expect(await activeFixture.observer.hostedThreadRoute.findUnique({
            select: { containerMemberId: true },
            where: {
              channel_threadIdentityLookupKey: {
                channel: "linq",
                threadIdentityLookupKey: activeFixture.threadIdentityLookupKey,
              },
            },
          })).toEqual({ containerMemberId: activeFixture.containerMemberId });
          expect(await activeFixture.observer.hostedMemberRouting.findUnique({
            select: {
              linqChatLookupKey: true,
              pendingLinqChatLookupKey: true,
            },
            where: { memberId: activeFixture.ownerMemberId },
          })).toMatchObject({
            linqChatLookupKey: null,
            pendingLinqChatLookupKey: null,
          });
        } finally {
          if (fixture && directRoute) {
            await fixture.observer.hostedLinqLine.deleteMany({
              where: {
                phoneNumberLookupKey: directRoute.recipientPhoneLookupKey,
              },
            });
          }
          if (fixture) {
            await cleanupRouteFixture(fixture);
          }
        }
      },
    );

    it.each([
      { startOrder: "message-first" },
      { startOrder: "edit-first" },
    ] as const)(
      "serializes an active-group edit with a routed message when $startOrder",
      async ({ startOrder }) => {
        const firstLockHeld = createDeferred();
        const releaseFirst = createDeferred();
        const messagePid = createDeferred<number>();
        const editPid = createDeferred<number>();
        let fixture: RouteFixture | null = null;
        let messageTransaction: ReturnType<
          typeof planHostedOnboardingLinqWebhook
        > | null = null;
        let editTransaction: ReturnType<
          typeof runHostedLinqMessageEditPreparedTransaction
        > | null = null;

        try {
          fixture = await createRouteFixture();
          const activeFixture = fixture;
          const activeRoute = await activateLinqGroupRoute(activeFixture);
          const originalMessageId = `message_original_${randomUUID()}`;
          const originalEvent = buildRoutedGroupMessageEvent({
            createdAt: "2026-08-09T12:00:00.000Z",
            eventId: `event_original_${randomUUID()}`,
            messageId: originalMessageId,
            ownerPhone: activeRoute.canonicalRecipientPhone,
            participantPhone: activeRoute.participantPhone,
            text: "Original group message",
            threadId: activeFixture.threadId,
          });
          await expect(activeFixture.observer.$transaction((tx) =>
            planHostedOnboardingLinqWebhook({
              event: originalEvent,
              preparedThreadDeliveryRoute:
                activeRoute.canonicalPreparedDeliveryRoute,
              prisma: tx,
            })
          )).resolves.toMatchObject({
            response: {
              ignored: false,
              ok: true,
              reason: "wake-appended-thread-route",
            },
          });

          const newMessageEvent = buildRoutedGroupMessageEvent({
            createdAt: "2026-08-09T12:02:00.000Z",
            eventId: `event_new_${randomUUID()}`,
            messageId: `message_new_${randomUUID()}`,
            ownerPhone: activeRoute.canonicalRecipientPhone,
            participantPhone: activeRoute.participantPhone,
            text: "Concurrent group message",
            threadId: activeFixture.threadId,
          });
          const editEvent = buildRoutedGroupMessageEditedEvent({
            createdAt: "2026-08-09T12:01:00.000Z",
            eventId: `event_edit_${randomUUID()}`,
            messageId: originalMessageId,
            participantPhone: activeRoute.participantPhone,
            text: "Corrected group message",
            threadId: activeFixture.threadId,
          });

          const runMessage = (pauseAfterChatLock: boolean) => {
            const client = pauseHostedWebhookTransactionAfterRawOperation({
              client: activeFixture.messageClient,
              locked: firstLockHeld,
              ...(pauseAfterChatLock ? { operation: "execute" } : {}),
              pid: messagePid,
              release: releaseFirst,
            });
            messageTransaction = client.$transaction((tx) =>
              planHostedOnboardingLinqWebhook({
                event: newMessageEvent,
                preparedThreadDeliveryRoute:
                  activeRoute.canonicalPreparedDeliveryRoute,
                prisma: tx,
              })
            );
          };
          const runEdit = (pauseAfterChatLock: boolean) => {
            const client = pauseHostedWebhookTransactionAfterRawOperation({
              client: activeFixture.participantClient,
              locked: firstLockHeld,
              ...(pauseAfterChatLock
                ? { operation: "execute", operationCall: 2 }
                : {}),
              pid: editPid,
              release: releaseFirst,
            });
            editTransaction = runHostedLinqMessageEditPreparedTransaction({
              event: editEvent,
              prisma: client,
            });
          };

          if (startOrder === "message-first") {
            runMessage(true);
            await firstLockHeld.promise;
            runEdit(false);
            await waitForBlockedBackend({
              observer: activeFixture.observer,
              pid: await editPid.promise,
            });
          } else {
            runEdit(true);
            await firstLockHeld.promise;
            runMessage(false);
            await waitForBlockedBackend({
              observer: activeFixture.observer,
              pid: await messagePid.promise,
            });
          }
          releaseFirst.resolve();

          if (!messageTransaction || !editTransaction) {
            throw new Error("Expected both Linq message transactions.");
          }
          await expect(messageTransaction).resolves.toMatchObject({
            response: {
              ignored: false,
              ok: true,
              reason: "wake-appended-thread-route",
            },
          });
          await expect(editTransaction).resolves.toMatchObject({
            response: {
              ignored: false,
              ok: true,
              reason: "wake-appended-message-edit",
            },
          });

          const [newMessageWake, editWake] = await Promise.all([
            readHostedMailboxWakeByDedupeKey({
              dedupeKey: newMessageEvent.event_id,
              prisma: activeFixture.observer,
              userId: activeFixture.containerMemberId,
            }),
            readHostedMailboxWakeByDedupeKey({
              dedupeKey: editEvent.event_id,
              prisma: activeFixture.observer,
              userId: activeFixture.containerMemberId,
            }),
          ]);
          expect(newMessageWake).toMatchObject({
            eventId: newMessageEvent.event_id,
            kind: "conversation.message",
            message: {
              channel: "linq",
              linqMessage: {
                chatId: activeFixture.threadId,
                messageId: newMessageEvent.data.message.id,
              },
            },
          });
          expect(editWake).toMatchObject({
            eventId: editEvent.event_id,
            kind: "conversation.message",
            message: {
              channel: "linq",
              linqMessage: {
                chatId: activeFixture.threadId,
                editedTextPartIndex: 0,
                messageId: originalMessageId,
                parts: [{
                  type: "text",
                  value: "Corrected group message",
                }],
              },
            },
          });
        } finally {
          releaseFirst.resolve();
          await Promise.allSettled([
            ...(messageTransaction ? [messageTransaction] : []),
            ...(editTransaction ? [editTransaction] : []),
          ]);
          if (fixture) {
            await cleanupRouteFixture(fixture);
          }
        }
      },
    );

    it.each([
      {
        eventType: "participant.added",
        startOrder: "message-first",
      },
      {
        eventType: "participant.added",
        startOrder: "participant-first",
      },
      {
        eventType: "participant.removed",
        startOrder: "message-first",
      },
      {
        eventType: "participant.removed",
        startOrder: "participant-first",
      },
    ] as const)(
      "serializes $eventType with an owner-sent routed message when $startOrder",
      async ({ eventType, startOrder }) => {
        const messageDemoted = createDeferred();
        const releaseMessage = createDeferred();
        const participantContext = createDeferred<string>();
        const releaseParticipant = createDeferred();
        const messagePid = createDeferred<number>();
        const participantPid = createDeferred<number>();
        let fixture: RouteFixture | null = null;
        let messageTransaction: ReturnType<
          typeof planHostedOnboardingLinqWebhook
        > | null = null;
        let participantWebhook: ReturnType<
          typeof handleHostedOnboardingLinqWebhook
        > | null = null;
        let participantEventLookupKey: string | null = null;
        const previousWebhookSecret = process.env.LINQ_WEBHOOK_SECRET;
        const webhookSecret = "linq-lock-order-test-secret";

        try {
          process.env.LINQ_WEBHOOK_SECRET = webhookSecret;
          clearHostedOnboardingEnvCache();
          fixture = await createRouteFixture();
          const activeFixture = fixture;
          const activeRoute = await activateLinqGroupRoute(activeFixture);
          const {
            canonicalAccountLookupKey,
            canonicalDeliveryRouteEncrypted,
            canonicalThreadLookupKey,
            deliveringPreparedDeliveryRoute,
            deliveringRecipientPhone,
            participantPhone,
          } = activeRoute;
          const event = buildRoutedGroupMessageEvent({
            createdAt: "2026-08-09T12:00:00.000Z",
            eventId: `event_${randomUUID()}`,
            messageId: `message_${randomUUID()}`,
            ownerPhone: deliveringRecipientPhone,
            participantPhone,
            text: "Route this group message",
            threadId: activeFixture.threadId,
          });
          const participantEvent = buildParticipantChangeEvent({
            eventType,
            handle: participantPhone,
            threadId: activeFixture.threadId,
          });
          participantEventLookupKey = createHostedLinqProviderEventLookupKey(
            participantEvent.event_id,
          );
          const participantRawBody = JSON.stringify(participantEvent);
          const participantTimestamp = String(Math.floor(Date.now() / 1_000));
          const participantSignature = `sha256=${createHmac(
            "sha256",
            webhookSecret,
          ).update(`${participantTimestamp}.${participantRawBody}`).digest("hex")}`;

          const runOwnerMessage = (pauseAfterDemotion: boolean) => {
            messageTransaction = activeFixture.messageClient.$transaction(
              async (tx) => {
                messagePid.resolve(await readBackendPid(tx));
                return planHostedOnboardingLinqWebhook({
                  event,
                  preparedThreadDeliveryRoute:
                    deliveringPreparedDeliveryRoute,
                  prisma: pauseAfterDemotion
                    ? pauseHostedMemberRoutingDemotionAfterWrite({
                        demoted: messageDemoted,
                        release: releaseMessage,
                        tx,
                      })
                    : tx,
                });
              },
            );
          };
          const runParticipantWebhook = () => {
            participantWebhook = handleHostedOnboardingLinqWebhook({
              prisma: pauseHostedParticipantWebhookAfterContextWrite({
                ciphertext: participantContext,
                client: activeFixture.participantClient,
                pid: participantPid,
                release: releaseParticipant,
              }),
              rawBody: participantRawBody,
              signature: participantSignature,
              timestamp: participantTimestamp,
            });
          };

          if (startOrder === "message-first") {
            releaseParticipant.resolve();
            runOwnerMessage(true);
            await messageDemoted.promise;
            runParticipantWebhook();
            await waitForBlockedBackend({
              observer: activeFixture.observer,
              pid: await participantPid.promise,
            });
            releaseMessage.resolve();
          } else {
            runParticipantWebhook();
            await participantContext.promise;
            runOwnerMessage(false);
            await waitForBlockedBackend({
              observer: activeFixture.observer,
              pid: await messagePid.promise,
            });
            releaseParticipant.resolve();
          }

          if (!messageTransaction || !participantWebhook) {
            throw new Error("Expected both Linq webhook transactions.");
          }
          await expect(messageTransaction).resolves.toMatchObject({
            response: {
              ignored: false,
              ok: true,
              reason: "wake-appended-thread-route",
            },
          });
          await expect(participantWebhook).resolves.toMatchObject({
            ignored: true,
            ok: true,
            reason: `recorded-linq-provider-event:${eventType}`,
          });
          const storedRoute = await activeFixture.observer.hostedThreadRoute
            .findUnique({
              select: {
                accountLookupKey: true,
                deliveryRouteEncrypted: true,
                pendingGroupReactionContextEncrypted: true,
                pendingParticipantAddition: true,
                threadLookupKey: true,
              },
              where: {
                channel_threadIdentityLookupKey: {
                  channel: "linq",
                  threadIdentityLookupKey:
                    activeFixture.threadIdentityLookupKey,
                },
              },
            });
          expect(storedRoute).toMatchObject({
            accountLookupKey: canonicalAccountLookupKey,
            deliveryRouteEncrypted: canonicalDeliveryRouteEncrypted,
            threadLookupKey: canonicalThreadLookupKey,
          });
          expect(await activeFixture.observer.hostedLinqProviderEvent.count({
            where: { eventId: participantEventLookupKey },
          })).toBe(1);

          const wake = await readHostedMailboxWakeByDedupeKey({
            dedupeKey: event.event_id,
            prisma: activeFixture.observer,
            userId: activeFixture.containerMemberId,
          });
          if (
            !wake
            || wake.kind !== "conversation.message"
            || wake.message.channel !== "linq"
          ) {
            throw new Error("Expected a routed Linq conversation wake.");
          }
          const expectedContext = eventType === "participant.added"
            ? "was added to the group"
            : "was removed from the group";
          if (startOrder === "participant-first") {
            expect(wake.message.groupReactionContext).toContain(expectedContext);
            if (eventType === "participant.added") {
              expect(wake.message.groupParticipantAdded).toBe(true);
            } else {
              expect(wake.message).not.toHaveProperty("groupParticipantAdded");
            }
            expect(storedRoute).toMatchObject({
              pendingGroupReactionContextEncrypted: null,
              pendingParticipantAddition: false,
            });
          } else {
            expect(wake.message).not.toHaveProperty("groupParticipantAdded");
            expect(wake.message).not.toHaveProperty("groupReactionContext");
            expect(storedRoute?.pendingParticipantAddition).toBe(
              eventType === "participant.added",
            );
            expect(storedRoute?.pendingGroupReactionContextEncrypted)
              .toMatch(/^hsb-test:/u);
            expect(readHostedSecureBoxTestValue(
              storedRoute?.pendingGroupReactionContextEncrypted ?? "",
            )).toContain(expectedContext);
          }
        } finally {
          releaseMessage.resolve();
          releaseParticipant.resolve();
          await Promise.allSettled([
            ...(messageTransaction ? [messageTransaction] : []),
            ...(participantWebhook ? [participantWebhook] : []),
          ]);
          if (fixture) {
            if (participantEventLookupKey) {
              await fixture.observer.hostedLinqProviderEvent.deleteMany({
                where: { eventId: participantEventLookupKey },
              });
            }
            await cleanupRouteFixture(fixture);
          }
          restoreEnvValue("LINQ_WEBHOOK_SECRET", previousWebhookSecret);
          clearHostedOnboardingEnvCache();
        }
      },
    );

    it("serializes mixed-version Telegram creators on the raw external thread", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const previousPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
      const previousPrivacyCurrentVersion =
        process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
      const fixtureId = randomUUID();
      const threadId = `chat_thread_create_race_${fixtureId}`;
      const accountLookupKey = HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY;
      const ownerMemberIds = [
        `member_thread_create_owner_a_${fixtureId}`,
        `member_thread_create_owner_b_${fixtureId}`,
      ] as const;
      const containerMemberIds = [
        `member_thread_create_container_a_${fixtureId}`,
        `member_thread_create_container_b_${fixtureId}`,
      ] as const;
      const saturatedDestinationMemberIds = Array.from(
        { length: 25 },
        (_, index) => `member_thread_create_share_destination_${index}_${fixtureId}`,
      );
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const winnerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const loserClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const winnerCommittedState = createDeferred();
      const releaseWinner = createDeferred();
      const loserAttemptedRouteLock = createDeferred();
      const loserPid = createDeferred<number>();
      let winnerTransaction: Promise<unknown> | null = null;
      let loserTransaction: Promise<unknown> | null = null;

      configureHostedContactPrivacyKeyringForTest("v1");
      try {
        await observer.hostedMember.createMany({
          data: [
            ...ownerMemberIds.map((id) => ({
              billingStatus: "active" as const,
              id,
            })),
            ...saturatedDestinationMemberIds.map((id) => ({ id })),
          ],
        });
        await observer.hostedVaultShare.createMany({
          data: saturatedDestinationMemberIds.map((destinationMemberId, index) => ({
            destinationMemberId,
            grantedAt: new Date("2026-08-25T11:00:00.000Z"),
            grantorMemberId: ownerMemberIds[0],
            id: `share_thread_create_${index}_${fixtureId}`,
            projectionKind: "profile-name.v0",
            projectionScopeJson: { projectionKind: "profile-name.v0" },
            projectionScopeKey: "profile-name.v0",
            status: "granted",
          })),
        });
        const [winnerPreparation, loserPreparation] = await Promise.all([
          buildPreparedThreadContainerCreation({
            accountLookupKey,
            channel: "telegram",
            containerMemberId: containerMemberIds[0],
            prisma: winnerClient,
            threadId,
          }),
          buildPreparedThreadContainerCreation({
            accountLookupKey,
            channel: "telegram",
            containerMemberId: containerMemberIds[1],
            prisma: loserClient,
            threadId,
          }),
        ]);
        const v1ThreadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
          channel: "telegram",
          threadId,
        });
        if (!v1ThreadIdentityLookupKey) {
          throw new Error("Expected a v1 Telegram thread identity lookup key.");
        }

        winnerTransaction = winnerClient.$transaction(async (tx) => {
          const result = await ensureHostedThreadContainerRouteTx({
            accountLookupKey,
            channel: "telegram",
            mailboxDedupeKey: `thread-create-race:winner:${fixtureId}`,
            occurredAt: new Date("2026-08-09T12:00:00.000Z"),
            ownerMemberId: ownerMemberIds[0],
            preparedCreation: winnerPreparation,
            prisma: tx,
            threadId,
          });
          winnerCommittedState.resolve();
          await releaseWinner.promise;
          return result;
        });
        await winnerCommittedState.promise;

        configureHostedContactPrivacyKeyringForTest("v2");
        const v2ThreadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
          channel: "telegram",
          threadId,
        });
        if (!v2ThreadIdentityLookupKey) {
          throw new Error("Expected a v2 Telegram thread identity lookup key.");
        }
        expect(v2ThreadIdentityLookupKey).not.toBe(v1ThreadIdentityLookupKey);

        loserTransaction = loserClient.$transaction(async (tx) => {
          loserPid.resolve(await readBackendPid(tx));
          return ensureHostedThreadContainerRouteTx({
            accountLookupKey,
            channel: "telegram",
            mailboxDedupeKey: `thread-create-race:loser:${fixtureId}`,
            occurredAt: new Date("2026-08-09T12:00:01.000Z"),
            ownerMemberId: ownerMemberIds[1],
            preparedCreation: loserPreparation,
            prisma: observeHostedThreadRouteLockAttempt({
              attempted: loserAttemptedRouteLock,
              tx,
            }),
            threadId,
          });
        });
        await loserAttemptedRouteLock.promise;
        await waitForBlockedBackend({
          observer,
          pid: await loserPid.promise,
        });

        releaseWinner.resolve();
        await expect(winnerTransaction).resolves.toMatchObject({
          containerMemberId: containerMemberIds[0],
          created: true,
        });
        await expect(loserTransaction).rejects.toMatchObject({
          code: "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
          retryable: false,
        });

        await expect(observer.hostedThreadRoute.count({
          where: {
            channel: "telegram",
            containerMemberId: { in: [...containerMemberIds] },
          },
        })).resolves.toBe(1);
        await expect(readHostedThreadRouteByThreadIdentity({
          channel: "telegram",
          prisma: observer,
          threadId,
        })).resolves.toMatchObject({
          containerMemberId: containerMemberIds[0],
        });
        await expect(observer.hostedThreadRoute.findUnique({
          where: {
            channel_threadIdentityLookupKey: {
              channel: "telegram",
              threadIdentityLookupKey: v1ThreadIdentityLookupKey,
            },
          },
        })).resolves.toMatchObject({
          containerMemberId: containerMemberIds[0],
        });
        await expect(observer.hostedThreadRoute.findUnique({
          where: {
            channel_threadIdentityLookupKey: {
              channel: "telegram",
              threadIdentityLookupKey: v2ThreadIdentityLookupKey,
            },
          },
        })).resolves.toBeNull();
        await expect(observer.hostedThreadContainer.count({
          where: { memberId: { in: [...containerMemberIds] } },
        })).resolves.toBe(1);
        await expect(observer.hostedMember.count({
          where: { id: { in: [...containerMemberIds] } },
        })).resolves.toBe(1);
        await expect(observer.hostedUserCryptoEnvelope.count({
          where: { userId: { in: [...containerMemberIds] } },
        })).resolves.toBe(HOSTED_CRYPTO_DOMAINS.length);
        await expect(observer.hostedMailboxItem.count({
          where: { userId: { in: [...containerMemberIds] } },
        })).resolves.toBe(1);
        await expect(observer.hostedGroup.findUnique({
          where: { runtimeMemberId: containerMemberIds[0] },
          select: {
            displayName: true,
            joinCode: true,
            kind: true,
            members: {
              orderBy: { memberId: "asc" },
              select: { memberId: true, role: true },
            },
            ownerMemberId: true,
            runtimeMemberId: true,
          },
        })).resolves.toEqual({
          displayName: null,
          joinCode: null,
          kind: "custom",
          members: [{ memberId: ownerMemberIds[0], role: "owner" }],
          ownerMemberId: ownerMemberIds[0],
          runtimeMemberId: containerMemberIds[0],
        });
        await expect(readHostedGroupMembershipsForMember({
          memberId: ownerMemberIds[0],
          prisma: observer,
        })).resolves.toEqual({
          memberships: [{
            displayName: null,
            grantedVaultShareProjectionScopes: [],
            kind: "custom",
            memberCount: 1,
            membershipId: expect.any(String),
            ownerJoinCode: null,
            requestedVaultShareProjectionScopes: [],
            role: "owner",
            runtimeMemberId: containerMemberIds[0],
          }],
          nextCursor: null,
          truncated: false,
        });
        await expectCanonicalOwnerActionAuthority({
          containerMemberId: containerMemberIds[0],
          ownerMemberId: ownerMemberIds[0],
          prisma: observer,
          threadId,
        });
        await expect(observer.hostedVaultShare.count({
          where: { destinationMemberId: containerMemberIds[0] },
        })).resolves.toBe(0);
        await expect(observer.hostedVaultShare.count({
          where: {
            grantorMemberId: ownerMemberIds[0],
            projectionScopeKey: "profile-name.v0",
            status: "granted",
          },
        })).resolves.toBe(25);
      } finally {
        releaseWinner.resolve();
        await Promise.allSettled([
          ...(winnerTransaction ? [winnerTransaction] : []),
          ...(loserTransaction ? [loserTransaction] : []),
        ]);
        restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousPrivacyKeys);
        restoreEnvValue(
          "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
          previousPrivacyCurrentVersion,
        );
        clearHostedOnboardingEnvCache();
        await observer.hostedThreadRoute.deleteMany({
          where: { containerMemberId: { in: [...containerMemberIds] } },
        });
        await observer.hostedGroup.deleteMany({
          where: { runtimeMemberId: { in: [...containerMemberIds] } },
        });
        await observer.hostedThreadContainer.deleteMany({
          where: { memberId: { in: [...containerMemberIds] } },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: {
              in: [
                ...ownerMemberIds,
                ...containerMemberIds,
                ...saturatedDestinationMemberIds,
              ],
            },
          },
        });
        await Promise.all([
          observer.$disconnect(),
          winnerClient.$disconnect(),
          loserClient.$disconnect(),
        ]);
      }
    });

    it("rolls back stale same-owner preparation after the owner lock winner commits", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const fixtureId = randomUUID();
      const threadId = `chat_thread_owner_race_${fixtureId}`;
      const accountLookupKey = `account_thread_owner_race_${fixtureId}`;
      const ownerMemberId = `member_thread_owner_race_${fixtureId}`;
      const containerMemberIds = [
        `member_thread_owner_winner_${fixtureId}`,
        `member_thread_owner_loser_${fixtureId}`,
      ] as const;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const winnerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const loserClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const winnerPreparedState = createDeferred();
      const releaseWinner = createDeferred();
      const loserAttemptedRouteLock = createDeferred();
      const loserPid = createDeferred<number>();
      let winnerTransaction: Promise<unknown> | null = null;
      let loserTransaction: Promise<unknown> | null = null;

      try {
        await observer.hostedMember.create({
          data: {
            billingStatus: "active",
            id: ownerMemberId,
          },
        });
        const [winnerPreparation, loserPreparation] = await Promise.all([
          buildPreparedThreadContainerCreation({
            accountLookupKey,
            containerMemberId: containerMemberIds[0],
            prisma: winnerClient,
            threadId,
          }),
          buildPreparedThreadContainerCreation({
            accountLookupKey,
            containerMemberId: containerMemberIds[1],
            prisma: loserClient,
            threadId,
          }),
        ]);

        winnerTransaction = winnerClient.$transaction(async (tx) => {
          const result = await ensureHostedThreadContainerRouteTx({
            accountLookupKey,
            channel: "linq",
            mailboxDedupeKey: `thread-owner-race:winner:${fixtureId}`,
            occurredAt: new Date("2026-08-09T12:00:00.000Z"),
            ownerMemberId,
            preparedCreation: winnerPreparation,
            prisma: tx,
            threadId,
          });
          winnerPreparedState.resolve();
          await releaseWinner.promise;
          return result;
        });
        await winnerPreparedState.promise;

        loserTransaction = loserClient.$transaction(async (tx) => {
          loserPid.resolve(await readBackendPid(tx));
          return ensureHostedThreadContainerRouteTx({
            accountLookupKey,
            channel: "linq",
            mailboxDedupeKey: `thread-owner-race:loser:${fixtureId}`,
            occurredAt: new Date("2026-08-09T12:00:01.000Z"),
            ownerMemberId,
            preparedCreation: loserPreparation,
            prisma: observeHostedThreadRouteLockAttempt({
              attempted: loserAttemptedRouteLock,
              tx,
            }),
            threadId,
          });
        });
        await waitForBlockedBackend({
          observer,
          pid: await loserPid.promise,
        });

        releaseWinner.resolve();
        await expect(winnerTransaction).resolves.toMatchObject({
          containerMemberId: containerMemberIds[0],
          created: true,
        });
        await expect(loserTransaction).rejects.toMatchObject({
          code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
          retryable: true,
        });
        await loserAttemptedRouteLock.promise;

        await expect(observer.hostedThreadRoute.count({
          where: { containerMemberId: { in: [...containerMemberIds] } },
        })).resolves.toBe(1);
        await expect(observer.hostedThreadContainer.findMany({
          select: { memberId: true, ownerMemberId: true },
          where: { memberId: { in: [...containerMemberIds] } },
        })).resolves.toEqual([{
          memberId: containerMemberIds[0],
          ownerMemberId,
        }]);
        await expect(observer.hostedMember.count({
          where: { id: { in: [...containerMemberIds] } },
        })).resolves.toBe(1);
        await expect(observer.hostedUserCryptoEnvelope.count({
          where: { userId: { in: [...containerMemberIds] } },
        })).resolves.toBe(HOSTED_CRYPTO_DOMAINS.length);
        await expect(observer.hostedMailboxItem.count({
          where: { userId: { in: [...containerMemberIds] } },
        })).resolves.toBe(1);
      } finally {
        releaseWinner.resolve();
        await Promise.allSettled([
          ...(winnerTransaction ? [winnerTransaction] : []),
          ...(loserTransaction ? [loserTransaction] : []),
        ]);
        await observer.hostedThreadRoute.deleteMany({
          where: { containerMemberId: { in: [...containerMemberIds] } },
        });
        await observer.hostedGroup.deleteMany({
          where: { runtimeMemberId: { in: [...containerMemberIds] } },
        });
        await observer.hostedThreadContainer.deleteMany({
          where: { memberId: { in: [...containerMemberIds] } },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: {
              in: [ownerMemberId, ...containerMemberIds],
            },
          },
        });
        await Promise.all([
          observer.$disconnect(),
          winnerClient.$disconnect(),
          loserClient.$disconnect(),
        ]);
      }
    });

    it("consumes an addition that commits before the waiting group message", async () => {
      const fixture = await createRouteFixture();
      const markerWritten = createDeferred();
      const releaseMarker = createDeferred();
      const consumerPid = createDeferred<number>();
      let consumerTransaction: Promise<boolean> | null = null;

      const markerTransaction = fixture.participantClient.$transaction(async (tx) => {
        await markHostedLinqThreadRouteParticipantAdditionPendingTx({
          containerMemberId: fixture.containerMemberId,
          prisma: tx,
          threadId: fixture.threadId,
        });
        markerWritten.resolve();
        await releaseMarker.promise;
      });

      try {
        await markerWritten.promise;
        consumerTransaction = fixture.messageClient.$transaction(async (tx) => {
          consumerPid.resolve(await readBackendPid(tx));
          return consumeHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            threadId: fixture.threadId,
          });
        });

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await consumerPid.promise,
        });

        releaseMarker.resolve();
        await markerTransaction;
        await expect(consumerTransaction).resolves.toBe(true);
        await expect(readPendingParticipantAddition(fixture)).resolves.toBe(false);
      } finally {
        releaseMarker.resolve();
        await Promise.allSettled([
          markerTransaction,
          ...(consumerTransaction ? [consumerTransaction] : []),
        ]);
        await cleanupRouteFixture(fixture);
      }
    });

    it("leaves a later addition pending when the group message locks first", async () => {
      const fixture = await createRouteFixture();
      const messageLocked = createDeferred();
      const releaseMessage = createDeferred();
      const markerPid = createDeferred<number>();
      let markerTransaction: Promise<void> | null = null;

      const messageTransaction = fixture.messageClient.$transaction(async (tx) => {
        const consumed =
          await consumeHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            threadId: fixture.threadId,
          });
        messageLocked.resolve();
        await releaseMessage.promise;
        return consumed;
      });

      try {
        await messageLocked.promise;
        markerTransaction = fixture.participantClient.$transaction(async (tx) => {
          markerPid.resolve(await readBackendPid(tx));
          await markHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            threadId: fixture.threadId,
          });
        });

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await markerPid.promise,
        });

        releaseMessage.resolve();
        await expect(messageTransaction).resolves.toBe(false);
        await markerTransaction;
        await expect(readPendingParticipantAddition(fixture)).resolves.toBe(true);
      } finally {
        releaseMessage.resolve();
        await Promise.allSettled([
          messageTransaction,
          ...(markerTransaction ? [markerTransaction] : []),
        ]);
        await cleanupRouteFixture(fixture);
      }
    });

    it("lets a waiting address-book deletion clear context staged under the owner lock", async () => {
      const restoreAddressBookEnv =
        configureHostedAddressBookLocalCryptoForTest();
      const fixture = await createRouteFixture();
      const participantHandle = "+15559870001";
      const contextCiphertext = createDeferred<string>();
      const participantContextWritten = createDeferred();
      const releaseParticipant = createDeferred();
      let deletion: ReturnType<typeof deleteHostedAddressBookProjection> | null =
        null;
      let participantTransaction: Promise<void> | null = null;

      try {
        await prepareAddressBookLabelFixture(fixture, participantHandle);
        const route = await readHostedThreadRouteByThreadIdentity({
          channel: "linq",
          prisma: fixture.observer,
          threadId: fixture.threadId,
        });
        if (!route) {
          throw new Error("Expected a routed Linq group.");
        }

        participantTransaction = fixture.participantClient.$transaction(
          async (tx) => {
            await applyHostedLinqParticipantChangeToRouteTx({
              event: buildParticipantChangeEvent({
                eventType: "participant.added",
                handle: participantHandle,
                threadId: fixture.threadId,
              }),
              prisma: observeParticipantContextRouteWrite({
                ciphertext: contextCiphertext,
                release: releaseParticipant,
                tx,
              }),
              route,
            });
            participantContextWritten.resolve();
          },
        );

        const stagedValue = readHostedSecureBoxTestValue(
          await contextCiphertext.promise,
        );
        expect(stagedValue).toContain(
          "Participant +15559870001 (address-book name: Taylor R.) was added to the group.",
        );

        const deletionPid = await readBackendPid(fixture.messageClient);
        deletion = deleteHostedAddressBookProjection({
          memberId: fixture.ownerMemberId,
          prisma: fixture.messageClient,
          request: parseHostedAddressBookDeleteRequest({
            baseRevision: 1,
            mutationId: randomUUID(),
            schemaVersion: 1,
          }),
        });
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: deletionPid,
        });

        releaseParticipant.resolve();
        await participantContextWritten.promise;
        await participantTransaction;
        await expect(deletion).resolves.toMatchObject({
          enabled: false,
          revision: 2,
        });
        await expect(fixture.observer.hostedThreadRoute.findFirst({
          select: { pendingGroupReactionContextEncrypted: true },
          where: {
            channel: "linq",
            threadIdentityLookupKey: fixture.threadIdentityLookupKey,
          },
        })).resolves.toEqual({
          pendingGroupReactionContextEncrypted: null,
        });
      } finally {
        releaseParticipant.resolve();
        await Promise.allSettled([
          ...(participantTransaction ? [participantTransaction] : []),
          ...(deletion ? [deletion] : []),
        ]);
        restoreAddressBookEnv();
        await cleanupRouteFixture(fixture);
      }
    });

    it("stages only handle context after a deletion that already holds the owner lock", async () => {
      const restoreAddressBookEnv =
        configureHostedAddressBookLocalCryptoForTest();
      const fixture = await createRouteFixture();
      const participantHandle = "+15559870001";
      const addressBookCleared = createDeferred();
      const releaseDeletion = createDeferred();
      const contextCiphertext = createDeferred<string>();
      const participantPid = createDeferred<number>();
      let deletion: ReturnType<typeof deleteHostedAddressBookProjection> | null =
        null;
      let participantTransaction: Promise<void> | null = null;

      try {
        await prepareAddressBookLabelFixture(fixture, participantHandle);
        const route = await readHostedThreadRouteByThreadIdentity({
          channel: "linq",
          prisma: fixture.observer,
          threadId: fixture.threadId,
        });
        if (!route) {
          throw new Error("Expected a routed Linq group.");
        }

        deletion = deleteHostedAddressBookProjection({
          memberId: fixture.ownerMemberId,
          prisma: pauseAddressBookClearBeforeCommit({
            cleared: addressBookCleared,
            client: fixture.messageClient,
            release: releaseDeletion,
          }),
          request: parseHostedAddressBookDeleteRequest({
            baseRevision: 1,
            mutationId: randomUUID(),
            schemaVersion: 1,
          }),
        });
        await addressBookCleared.promise;

        participantTransaction = fixture.participantClient.$transaction(
          async (tx) => {
            participantPid.resolve(await readBackendPid(tx));
            await applyHostedLinqParticipantChangeToRouteTx({
              event: buildParticipantChangeEvent({
                eventType: "participant.removed",
                handle: participantHandle,
                threadId: fixture.threadId,
              }),
              prisma: observeParticipantContextRouteWrite({
                ciphertext: contextCiphertext,
                tx,
              }),
              route,
            });
          },
        );
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await participantPid.promise,
        });

        releaseDeletion.resolve();
        await expect(deletion).resolves.toMatchObject({
          enabled: false,
          revision: 2,
        });
        await participantTransaction;

        const stagedValue = readHostedSecureBoxTestValue(
          await contextCiphertext.promise,
        );
        expect(stagedValue).toContain(
          "Participant +15559870001 was removed from the group.",
        );
        expect(stagedValue).not.toContain("Taylor R.");
        await expect(fixture.observer.hostedThreadRoute.findFirst({
          select: { pendingGroupReactionContextEncrypted: true },
          where: {
            channel: "linq",
            threadIdentityLookupKey: fixture.threadIdentityLookupKey,
          },
        })).resolves.toMatchObject({
          pendingGroupReactionContextEncrypted: expect.stringMatching(
            /^hsb-test:/u,
          ),
        });
      } finally {
        releaseDeletion.resolve();
        await Promise.allSettled([
          ...(deletion ? [deletion] : []),
          ...(participantTransaction ? [participantTransaction] : []),
        ]);
        restoreAddressBookEnv();
        await cleanupRouteFixture(fixture);
      }
    });

    it("serializes a routed message behind routed usage-limit dispatch without deadlock", async () => {
      const fixture = await createRouteFixture();
      const attemptedAt = new Date("2026-07-13T12:00:00.000Z");
      const periodStart = new Date("2026-07-01T00:00:00.000Z");
      const usageSourceRef = `usage-lock-proof:${fixture.containerMemberId}`;
      const usageIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: fixture.containerMemberId,
        periodStart,
        usageCreditLedgerVersion: 0n,
      });
      const usageDeliveryLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(usageIdempotencyKey);
      if (!usageDeliveryLookupKey) {
        throw new Error("Expected a usage-limit delivery lookup key.");
      }

      await fixture.observer.hostedThreadRoute.updateMany({
        data: { pendingParticipantAddition: true },
        where: {
          channel: "linq",
          containerMemberId: fixture.containerMemberId,
          threadIdentityLookupKey: fixture.threadIdentityLookupKey,
        },
      });
      await fixture.observer.hostedAiUsagePeriod.create({
        data: {
          billingPlanCode: "test",
          blockedAt: attemptedAt,
          limitUsdMicros: 1n,
          memberId: fixture.containerMemberId,
          periodEnd: new Date("2026-08-01T00:00:00.000Z"),
          periodStart,
        },
      });

      const usageOwnerLocked = createDeferred();
      const releaseUsageAuthorityCheck = createDeferred();
      const consumerPid = createDeferred<number>();
      let consumerTransaction: Promise<boolean> | null = null;
      let usageTransaction: Promise<Awaited<ReturnType<
        typeof startHostedAiUsageLimitNoticeDispatchTx
      >>> | null = null;

      try {
        usageTransaction = fixture.participantClient.$transaction(async (tx) => {
          return startHostedAiUsageLimitNoticeDispatchTx({
            assertDispatchAuthority: async (claimTx) => {
              usageOwnerLocked.resolve();
              await releaseUsageAuthorityCheck.promise;
              await lockHostedThreadRouteByThreadIdentityTx({
                authority: {
                  channel: "linq",
                  containerMemberId: fixture.containerMemberId,
                  threadId: fixture.threadId,
                },
                prisma: claimTx,
              });
            },
            attemptedAt,
            linqChatId: fixture.threadId,
            memberId: fixture.containerMemberId,
            periodStart,
            prisma: tx,
            source: "hosted_webhook_side_effect",
            sourceRef: usageSourceRef,
            targetKind: "thread",
            usageCreditLedgerVersion: 0n,
          });
        });

        await usageOwnerLocked.promise;
        consumerTransaction = fixture.messageClient.$transaction(async (tx) => {
          consumerPid.resolve(await readBackendPid(tx));
          return consumeHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            threadId: fixture.threadId,
          });
        });

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await consumerPid.promise,
        });

        releaseUsageAuthorityCheck.resolve();
        await expect(usageTransaction).resolves.toEqual({
          idempotencyKey: usageIdempotencyKey,
          providerIdempotencyKey: expect.stringMatching(
            /^ai-usage-attempt:hld_[A-Za-z0-9_-]{16}$/u,
          ),
          status: "claimed",
        });
        await expect(consumerTransaction).resolves.toBe(true);

        const delivery = await fixture.observer.hostedLinqDelivery.findUnique({
          select: {
            source: true,
            status: true,
            template: true,
          },
          where: { idempotencyKey: usageDeliveryLookupKey },
        });
        expect(delivery).toEqual({
          source: "hosted_webhook_side_effect",
          status: "provider_dispatch_started",
          template: "ai_usage_quota",
        });
        await expect(readPendingParticipantAddition(fixture)).resolves.toBe(false);
      } finally {
        releaseUsageAuthorityCheck.resolve();
        await Promise.allSettled([
          ...(usageTransaction ? [usageTransaction] : []),
          ...(consumerTransaction ? [consumerTransaction] : []),
        ]);
        await fixture.observer.hostedLinqDelivery.deleteMany({
          where: { idempotencyKey: usageDeliveryLookupKey },
        });
        await fixture.observer.hostedAiUsagePeriod.deleteMany({
          where: {
            memberId: fixture.containerMemberId,
            periodStart,
          },
        });
        await cleanupRouteFixture(fixture);
      }
    });

    it("rejects stale candidates and gives a re-exhaustion crossing a fresh delivery identity", async () => {
      const fixture = await createRouteFixture();
      const attemptedAt = new Date("2026-07-13T12:00:00.000Z");
      const retryableAttemptedAt = new Date("2026-07-13T12:05:00.000Z");
      const retryAfterAt = new Date("2026-07-13T12:10:00.000Z");
      const staleRetryAttemptedAt = new Date("2026-07-13T12:15:00.000Z");
      const currentAttemptedAt = new Date("2026-07-13T12:20:00.000Z");
      const periodStart = new Date("2026-07-01T00:00:00.000Z");
      const periodEnd = new Date("2026-08-01T00:00:00.000Z");
      const retryableSourceRef = `retryable-usage:${fixture.containerMemberId}`;
      const usageIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: fixture.containerMemberId,
        periodStart,
        usageCreditLedgerVersion: 0n,
      });
      const reexhaustionSourceRef = `usage-after-plan-change:${fixture.containerMemberId}`;
      const reexhaustionIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: fixture.containerMemberId,
        periodStart,
        usageCreditLedgerVersion: 2n,
      });
      const usageDeliveryLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(usageIdempotencyKey);
      if (!usageDeliveryLookupKey) {
        throw new Error("Expected a usage-limit delivery lookup key.");
      }
      const claimUsageNotice = (input: {
        attemptedAt: Date;
        prisma?: PrismaClient;
        sourceRef: string;
        usageCreditLedgerVersion?: bigint;
      }) => startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
        attemptedAt: input.attemptedAt,
        memberId: fixture.containerMemberId,
        noticeDeliveryTarget: {
          channel: "linq",
          replyToMessageId: input.sourceRef,
          routeAuthority: {
            channel: "linq",
            containerMemberId: fixture.containerMemberId,
            threadId: fixture.threadId,
          },
          target: fixture.threadId,
        },
        periodStart,
        prisma: input.prisma ?? fixture.participantClient,
        source: "hosted_webhook_side_effect",
        sourceRef: input.sourceRef,
        targetKind: "thread",
        usageCreditLedgerVersion: input.usageCreditLedgerVersion ?? 0n,
      });
      const setBlockedAt = (blockedAt: Date | null) =>
        fixture.observer.hostedAiUsagePeriod.update({
          data: { blockedAt },
          where: {
            memberId_periodStart: {
              memberId: fixture.containerMemberId,
              periodStart,
            },
          },
        });

      await fixture.observer.hostedMember.updateMany({
        data: { billingStatus: "active" },
        where: {
          id: {
            in: [fixture.containerMemberId, fixture.ownerMemberId],
          },
        },
      });
      await fixture.observer.hostedAiUsagePeriod.create({
        data: {
          billingPlanCode: "launch_monthly",
          blockedAt: attemptedAt,
          limitUsdMicros: 10_000_000n,
          memberId: fixture.containerMemberId,
          periodEnd,
          periodStart,
          spentUsdMicros: 10_000_000n,
        },
      });

      const candidateReady = createDeferred();
      const releaseClaim = createDeferred();
      let staleClaim: ReturnType<
        typeof startAuthorizedHostedAiUsageLimitNoticeDispatchTx
      > | null = null;

      try {
        await expect(claimUsageNotice({
          attemptedAt: new Date(periodStart.getTime() - 1),
          sourceRef: "usage-before-period",
        })).resolves.toEqual({ status: "already_notified" });
        await expect(claimUsageNotice({
          attemptedAt: periodEnd,
          sourceRef: "usage-at-period-end",
        })).resolves.toEqual({ status: "already_notified" });
        await expect(fixture.observer.hostedLinqDelivery.findUnique({
          where: { idempotencyKey: usageDeliveryLookupKey },
        })).resolves.toBeNull();

        staleClaim = (async () => {
          candidateReady.resolve();
          await releaseClaim.promise;
          return claimUsageNotice({
            attemptedAt,
            sourceRef: `usage-before-plan-change:${fixture.containerMemberId}`,
          });
        })();

        await candidateReady.promise;
        await fixture.observer.hostedAiUsagePeriod.update({
          data: {
            billingPlanCode: "launch_edge_monthly",
            blockedAt: null,
            limitUsdMicros: 25_000_000n,
          },
          where: {
            memberId_periodStart: {
              memberId: fixture.containerMemberId,
              periodStart,
            },
          },
        });
        releaseClaim.resolve();

        await expect(staleClaim).resolves.toEqual({ status: "already_notified" });
        await expect(fixture.observer.hostedLinqDelivery.findUnique({
          where: { idempotencyKey: usageDeliveryLookupKey },
        })).resolves.toBeNull();

        await setBlockedAt(retryableAttemptedAt);

        await expect(startHostedAiUsageLimitNoticeDispatchTx({
          attemptedAt: retryableAttemptedAt,
          memberId: fixture.containerMemberId,
          periodStart,
          prisma: fixture.messageClient,
          source: "hosted_runtime_ai_usage_limit_notice",
          sourceRef: retryableSourceRef,
          targetKind: "telegram_thread",
          usageCreditLedgerVersion: 0n,
        })).resolves.toEqual({
          idempotencyKey: usageIdempotencyKey,
          providerIdempotencyKey: expect.stringMatching(
            /^ai-usage-attempt:hld_[A-Za-z0-9_-]{16}$/u,
          ),
          status: "claimed",
        });
        await expect(markHostedAiUsageLimitNoticeDeliveryRetryableTx({
          expectedAttemptedAt: retryableAttemptedAt,
          failedAt: retryableAttemptedAt,
          idempotencyKey: usageIdempotencyKey,
          prisma: fixture.messageClient,
          retryAfterAt,
        })).resolves.toBe(true);
        await setBlockedAt(null);

        await expect(claimUsageNotice({
          attemptedAt: staleRetryAttemptedAt,
          sourceRef: retryableSourceRef,
        })).resolves.toEqual({ status: "already_notified" });
        await expect(fixture.observer.hostedLinqDelivery.findUnique({
          select: {
            attemptedAt: true,
            retryAfterAt: true,
            status: true,
          },
          where: { idempotencyKey: usageDeliveryLookupKey },
        })).resolves.toEqual({
          attemptedAt: retryableAttemptedAt,
          retryAfterAt,
          status: "failed",
        });
        await setBlockedAt(currentAttemptedAt);
        await fixture.observer.hostedMember.update({
          data: {
            usageCreditBalanceUsdMicros: 0n,
            usageCreditLedgerVersion: 2n,
          },
          where: { id: fixture.containerMemberId },
        });

        await expect(claimUsageNotice({
          attemptedAt: currentAttemptedAt,
          prisma: fixture.messageClient,
          sourceRef: retryableSourceRef,
          usageCreditLedgerVersion: 0n,
        })).resolves.toEqual({ status: "already_notified" });

        await expect(claimUsageNotice({
          attemptedAt: currentAttemptedAt,
          prisma: fixture.messageClient,
          sourceRef: reexhaustionSourceRef,
          usageCreditLedgerVersion: 2n,
        })).resolves.toEqual({
          idempotencyKey: reexhaustionIdempotencyKey,
          providerIdempotencyKey: expect.stringMatching(
            /^ai-usage-attempt:hld_[A-Za-z0-9_-]{16}$/u,
          ),
          status: "claimed",
        });
        expect(reexhaustionIdempotencyKey).not.toBe(usageIdempotencyKey);
      } finally {
        releaseClaim.resolve();
        await Promise.allSettled(staleClaim ? [staleClaim] : []);
        await fixture.observer.hostedLinqDelivery.deleteMany({
          where: {
            idempotencyKey: {
              in: [
                usageDeliveryLookupKey,
                createHostedLinqDeliveryIdempotencyLookupKey(
                  reexhaustionIdempotencyKey,
                ),
              ].filter((value): value is string => value !== null),
            },
          },
        });
        await fixture.observer.hostedAiUsagePeriod.deleteMany({
          where: {
            memberId: fixture.containerMemberId,
            periodStart,
          },
        });
        await cleanupRouteFixture(fixture);
      }
    });

    it("serializes participant-context consumption behind a route authority rekey", async () => {
      const previousPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
      const previousPrivacyCurrentVersion =
        process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
      const routeRekeyed = createDeferred();
      const releaseRouteRekey = createDeferred();
      const consumerPid = createDeferred<number>();
      let fixture: RouteFixture | null = null;
      let consumerTransaction: Promise<boolean> | null = null;
      let rekeyTransaction: ReturnType<
        typeof ensureHostedThreadContainerRouteTx
      > | null = null;

      configureHostedContactPrivacyKeyringForTest("v1");
      try {
        fixture = await createRouteFixture();
        const activeFixture = fixture;
        const priorAccountLookupKey = "account_lookup_prior";
        const priorThreadLookupKey = createHostedExternalThreadLookupKey({
          accountLookupKey: priorAccountLookupKey,
          channel: "linq",
          threadId: activeFixture.threadId,
        });
        if (!priorThreadLookupKey) {
          throw new Error("Expected a prior Linq thread lookup key.");
        }
        await activeFixture.observer.hostedMember.update({
          data: { billingStatus: "active" },
          where: { id: activeFixture.ownerMemberId },
        });
        await activeFixture.observer.hostedThreadRoute.update({
          data: {
            pendingParticipantAddition: true,
            threadLookupKey: priorThreadLookupKey,
          },
          where: {
            channel_threadIdentityLookupKey: {
              channel: "linq",
              threadIdentityLookupKey: activeFixture.threadIdentityLookupKey,
            },
          },
        });

        configureHostedContactPrivacyKeyringForTest("v2");
        const currentAccountLookupKey = "account_lookup_current";
        const currentThreadIdentityLookupKey =
          createHostedExternalThreadIdentityLookupKey({
            channel: "linq",
            threadId: activeFixture.threadId,
          });
        const currentThreadLookupKey = createHostedExternalThreadLookupKey({
          accountLookupKey: currentAccountLookupKey,
          channel: "linq",
          threadId: activeFixture.threadId,
        });
        if (!currentThreadIdentityLookupKey || !currentThreadLookupKey) {
          throw new Error("Expected current Linq thread lookup keys.");
        }
        const observedRoute = await activeFixture.observer.hostedThreadRoute
          .findUniqueOrThrow({
            select: { deliveryRouteEncrypted: true },
            where: {
              channel_threadIdentityLookupKey: {
                channel: "linq",
                threadIdentityLookupKey: activeFixture.threadIdentityLookupKey,
              },
            },
          });
        const preparedRoute = buildHostedThreadDeliveryRoute({
          accountLookupKey: currentAccountLookupKey,
          channel: "linq",
          threadId: activeFixture.threadId,
        });
        const preparedDeliveryRoute = {
          containerMemberId: activeFixture.containerMemberId,
          deliveryRoute: preparedRoute,
          deliveryRouteEncrypted: await sealHostedThreadDeliveryRoute({
            containerMemberId: activeFixture.containerMemberId,
            prisma: activeFixture.participantClient,
            route: preparedRoute,
          }),
          observedDeliveryRouteEncrypted:
            observedRoute.deliveryRouteEncrypted,
        };

        rekeyTransaction = activeFixture.participantClient.$transaction(async (tx) => {
          return ensureHostedThreadContainerRouteTx({
            accountLookupKey: currentAccountLookupKey,
            accountLookupKeys: [
              currentAccountLookupKey,
              priorAccountLookupKey,
            ],
            channel: "linq",
            containerMemberId: activeFixture.containerMemberId,
            occurredAt: new Date("2026-07-13T12:00:00.000Z"),
            ownerMemberId: activeFixture.ownerMemberId,
            preparedDeliveryRoute,
            prisma: pauseHostedThreadRouteUpdateAfterWrite({
              release: releaseRouteRekey,
              tx,
              updated: routeRekeyed,
            }),
            threadId: activeFixture.threadId,
          });
        });

        await routeRekeyed.promise;
        consumerTransaction = activeFixture.messageClient.$transaction(async (tx) => {
          consumerPid.resolve(await readBackendPid(tx));
          return consumeHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: activeFixture.containerMemberId,
            prisma: tx,
            threadId: activeFixture.threadId,
          });
        });

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await consumerPid.promise,
        });

        releaseRouteRekey.resolve();
        await expect(rekeyTransaction).resolves.toMatchObject({
          containerMemberId: activeFixture.containerMemberId,
          created: false,
        });
        await expect(consumerTransaction).resolves.toBe(true);

        await expect(activeFixture.observer.hostedThreadRoute.findUnique({
          select: {
            containerMemberId: true,
            pendingParticipantAddition: true,
            threadLookupKey: true,
          },
          where: {
            channel_threadIdentityLookupKey: {
              channel: "linq",
              threadIdentityLookupKey: currentThreadIdentityLookupKey,
            },
          },
        })).resolves.toEqual({
          containerMemberId: activeFixture.containerMemberId,
          pendingParticipantAddition: false,
          threadLookupKey: currentThreadLookupKey,
        });
      } finally {
        releaseRouteRekey.resolve();
        await Promise.allSettled([
          ...(rekeyTransaction ? [rekeyTransaction] : []),
          ...(consumerTransaction ? [consumerTransaction] : []),
        ]);
        restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousPrivacyKeys);
        restoreEnvValue(
          "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
          previousPrivacyCurrentVersion,
        );
        clearHostedOnboardingEnvCache();
        if (fixture) {
          await fixture.observer.hostedThreadRoute.deleteMany({
            where: { containerMemberId: fixture.containerMemberId },
          });
          await cleanupRouteFixture(fixture);
        }
      }
    });
  },
);
