import { createHmac, generateKeyPairSync, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import {
  createDeviceSyncRegistry,
  createJunctionDeviceSyncProvider,
  createStravaDeviceSyncProvider,
} from "@murphai/device-syncd";
import { buildJunctionProviderSourceInstanceKey } from "@murphai/device-syncd/connect-config";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
} from "@murphai/device-syncd/public-account";
import type { PreparedDeviceSyncWebhookV1 } from "@murphai/device-syncd/prepared-webhook";
import type { DeviceSyncRegistry } from "@murphai/device-syncd/types";
import { describe, expect, it, vi } from "vitest";

import type { HostedDeviceSyncControlPlaneContext } from "@/src/lib/device-sync/control-plane-context";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { HostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { HostedDeviceSyncWebhookAdminService } from "@/src/lib/device-sync/webhook-admin-service";
import { provisionActiveHostedDomainRootEnvelopeForUserOnly } from "@/src/lib/hosted-crypto/domain-root-store";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { readHostedMailboxWakeByItemId } from "@/src/lib/hosted-mailbox/store";
import { runHostedPreferenceHandoffSweeper } from "@/src/lib/hosted-orchestration/preference-handoff-sweeper";
import { revokeHostedConsentScope } from "@/src/lib/legal/consent";
import { createPrismaClient } from "@/src/lib/prisma";

const runtimeMocks = vi.hoisted(() => ({
  signalHostedDeviceSyncMailboxRuntime: vi.fn(async () => ({
    signalAccepted: true as const,
    workflowId: "hosted-user-runtime:test",
  })),
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/src/lib/hosted-orchestration/signal-runtime")
  >()),
  signalHostedDeviceSyncMailboxRuntime: runtimeMocks.signalHostedDeviceSyncMailboxRuntime,
}));

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const junctionWebhookSecret = "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==";
const stravaWebhookSigningSecret = "strava-webhook-signing-secret";
const connectionCodec = {
  decrypt: (value: string) => value.replace(/^enc:/u, ""),
  encrypt: (value: string) => `enc:${value}`,
  keyVersion: "v1",
};

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The prepared device-webhook authority proof requires a local DATABASE_URL.",
  );
}

type Fixture = {
  connectionId: string;
  externalAccountId: string;
  memberId: string;
  observer: PrismaClient;
  prisma: PrismaClient;
  receivedAt: Date;
  restoreCryptoEnvironment: () => void;
  sourceId: string;
  store: PrismaDeviceSyncControlPlaneStore;
  traceIds: string[];
};

function createVoidDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function createFixture(input: {
  setupPhase?: "pending_link" | "source_confirmed";
  sourceLastErrorCode: string | null;
  sourceProviderSlug?: string;
}): Promise<Fixture> {
  const suffix = randomUUID().replaceAll("-", "");
  const restoreCryptoEnvironment = configureLocalCryptoForTest();
  const memberId = `member_prepared_webhook_authority_${suffix}`;
  const externalAccountId = `junction_prepared_webhook_${suffix}`;
  const receivedAt = new Date();
  const connectedAt = new Date(receivedAt.getTime() - 120_000).toISOString();
  const sourceObservedAt = new Date(receivedAt.getTime() - 60_000).toISOString();
  const setupPhase = input.setupPhase ?? "source_confirmed";
  const sourceProviderSlug = input.sourceProviderSlug ?? "apple_health_kit";
  const prisma = createPrismaClient({ databaseUrl, poolMax: 3 });
  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const store = new PrismaDeviceSyncControlPlaneStore({
    codec: connectionCodec,
    prisma,
    providerAccountBlindIndexKey: Buffer.alloc(32, 17),
  });

  setHostedSecureBoxStringTestCodecForTests({
    decrypt: (codecInput) => codecInput.value,
    encrypt: (codecInput) => codecInput.value,
  });
  runtimeMocks.signalHostedDeviceSyncMailboxRuntime.mockClear();
  await prisma.hostedMember.create({ data: { id: memberId } });
  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "ingress",
    prisma,
    reason: "prepared-webhook-authority-test",
    userId: memberId,
  });
  await prisma.hostedConsentGrant.create({
    data: {
      createdAt: receivedAt,
      documentVersionsJson: {},
      grantedAt: receivedAt,
      memberId,
      scope: "launch.health-data",
      source: "prepared-webhook-authority-test",
      status: "granted",
      updatedAt: receivedAt,
    },
  });
  const connection = await store.upsertConnection({
    connectedAt,
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    displayName: "Junction",
    existingAccountPolicy: "replace",
    externalAccountId,
    metadata: {},
    nextReconcileAt: null,
    ownerId: memberId,
    provider: "junction",
    scopes: [],
    setupExpiresAt: setupPhase === "pending_link"
      ? new Date(receivedAt.getTime() + 30 * 60_000).toISOString()
      : null,
    setupPhase,
    status: "active",
  });
  const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: connection.id,
    sourceProviderSlug,
  });
  if (!sourceInstanceKey) {
    throw new Error("Expected a Junction source instance key.");
  }
  const source = await store.upsertConnectionSource({
    connectionId: connection.id,
    firstSeenAt: sourceObservedAt,
    lastDataAt: null,
    lastErrorCode: input.sourceLastErrorCode,
    lastErrorMessage: null,
    lastSeenAt: sourceObservedAt,
    sourceInstanceKey,
    sourceProviderSlug,
    status: "disconnected",
  });

  return {
    connectionId: connection.id,
    externalAccountId,
    memberId,
    observer,
    prisma,
    receivedAt,
    restoreCryptoEnvironment,
    sourceId: source.id,
    store,
    traceIds: [],
  };
}

function createJunctionRegistry(
  fetchImpl: typeof fetch,
): DeviceSyncRegistry {
  return createDeviceSyncRegistry([
    createJunctionDeviceSyncProvider({
      apiKey: "sk_us_test_123",
      clientUserIdSecret: "prepared-webhook-client-user-secret",
      environment: "sandbox",
      fetchImpl,
      region: "us",
      webhookSecret: junctionWebhookSecret,
    }),
  ]);
}

function createIngressService(input: {
  headers: Headers;
  provider?: string;
  registry: DeviceSyncRegistry;
  store: PrismaDeviceSyncControlPlaneStore;
}): HostedDeviceSyncPublicIngressService {
  const request = new Request(
    `https://control.example.test/api/device-sync/webhooks/${input.provider ?? "junction"}`,
    {
      headers: input.headers,
      method: "POST",
    },
  );
  const context: HostedDeviceSyncControlPlaneContext = {
    allowedReturnOrigins: ["https://control.example.test"],
    env: {
      allowedMutationOrigins: ["https://control.example.test"],
      allowedReturnOrigins: ["https://control.example.test"],
      isProduction: false,
      publicBaseUrl: "https://control.example.test/api/device-sync",
      routingIndexKey: Buffer.alloc(32, 19),
      trustedUserAssertionHeader: "x-hosted-user-assertion",
      trustedUserSignatureHeader: "x-hosted-user-signature",
      trustedUserSigningSecret: null,
    },
    publicIngressBaseUrl: "https://control.example.test/api/device-sync",
    publicIngressBaseUrlSource: "configured",
    request,
    store: input.store,
  };

  return new HostedDeviceSyncPublicIngressService(
    context,
    new HostedDeviceSyncWebhookAdminService(context),
    input.registry,
  );
}

function signJunctionWebhook(input: {
  body: Record<string, unknown>;
  messageId: string;
  receivedAt: Date;
}): { headers: Headers; rawBody: Buffer } {
  const timestamp = Math.floor(input.receivedAt.getTime() / 1_000).toString();
  const rawBody = Buffer.from(JSON.stringify(input.body));
  const key = Buffer.from(
    junctionWebhookSecret.slice("whsec_".length),
    "base64",
  );
  const signature = createHmac("sha256", key)
    .update(Buffer.concat([
      Buffer.from(`${input.messageId}.${timestamp}.`),
      rawBody,
    ]))
    .digest("base64");

  return {
    headers: new Headers({
      "svix-id": input.messageId,
      "svix-signature": `v1,${signature}`,
      "svix-timestamp": timestamp,
    }),
    rawBody,
  };
}

function signStravaDeauthorization(input: {
  externalAccountId: string;
  receivedAt: Date;
}): { headers: Headers; rawBody: Buffer } {
  const athleteId = Number(input.externalAccountId);
  if (!Number.isSafeInteger(athleteId)) {
    throw new TypeError("Expected a safe numeric Strava athlete id.");
  }
  const timestamp = Math.floor(input.receivedAt.getTime() / 1_000).toString();
  const rawBody = Buffer.from(JSON.stringify({
    aspect_type: "update",
    event_time: Number(timestamp),
    object_id: athleteId,
    object_type: "athlete",
    owner_id: athleteId,
    subscription_id: 444,
    updates: { authorized: "false" },
  }));
  const signature = createHmac("sha256", stravaWebhookSigningSecret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), rawBody]))
    .digest("hex");

  return {
    headers: new Headers({
      "x-strava-signature": `t=${timestamp},v1=${signature}`,
    }),
    rawBody,
  };
}

async function prepareRegistration(input: {
  fixture: Fixture;
  receivedAt?: Date;
  registry: DeviceSyncRegistry;
}): Promise<PreparedDeviceSyncWebhookV1> {
  const receivedAt = input.receivedAt ?? input.fixture.receivedAt;
  const signed = signJunctionWebhook({
    body: {
      data: {
        provider: "apple_health_kit",
        updated_at: receivedAt.toISOString(),
      },
      event_type: "provider.connection.updated",
      user_id: input.fixture.externalAccountId,
    },
    messageId: `msg_prepared_authority_${randomUUID().replaceAll("-", "")}`,
    receivedAt,
  });
  const service = createIngressService({
    headers: signed.headers,
    registry: input.registry,
    store: input.fixture.store,
  });
  const prepared = await service.prepareWebhookForDurableEnqueue(
    "junction",
    signed.rawBody,
    receivedAt,
  );
  input.fixture.traceIds.push(prepared.traceId);
  return prepared;
}

async function prepareDailyData(input: {
  fixture: Fixture;
  registry: DeviceSyncRegistry;
  sourceProviderSlug: string;
}): Promise<PreparedDeviceSyncWebhookV1> {
  const signed = signJunctionWebhook({
    body: {
      data: {
        data: [{
          end: input.fixture.receivedAt.toISOString(),
          start: new Date(input.fixture.receivedAt.getTime() - 60_000).toISOString(),
          unit: "count",
          value: 321,
        }],
        source: {
          provider: input.sourceProviderSlug,
          type: "watch",
        },
        user_id: input.fixture.externalAccountId,
      },
      event_type: "daily.data.steps.created",
      user_id: input.fixture.externalAccountId,
    },
    messageId: `msg_prepared_daily_${randomUUID().replaceAll("-", "")}`,
    receivedAt: input.fixture.receivedAt,
  });
  const service = createIngressService({
    headers: signed.headers,
    registry: input.registry,
    store: input.fixture.store,
  });
  const prepared = await service.prepareWebhookForDurableEnqueue(
    "junction",
    signed.rawBody,
    input.fixture.receivedAt,
  );
  input.fixture.traceIds.push(prepared.traceId);
  return prepared;
}

async function expectNoWebhookEffects(
  fixture: Fixture,
  input: {
    connectionUpdatedAt: Date;
    expectedSource: {
      lastDataAt: Date | null;
      lastErrorCode: string | null;
      lastErrorMessage: string | null;
      lastSeenAt: Date;
      status: string;
      updatedAt: Date;
    };
    traceId: string;
  },
): Promise<void> {
  await expect(fixture.prisma.deviceWebhookTrace.findUniqueOrThrow({
    select: {
      claimToken: true,
      processingExpiresAt: true,
      status: true,
    },
    where: {
      provider_traceId: {
        provider: "junction",
        traceId: input.traceId,
      },
    },
  })).resolves.toEqual({
    claimToken: null,
    processingExpiresAt: null,
    status: "processed",
  });
  await expect(fixture.prisma.deviceConnection.findUniqueOrThrow({
    select: { lastWebhookAt: true, updatedAt: true },
    where: { id: fixture.connectionId },
  })).resolves.toEqual({
    lastWebhookAt: null,
    updatedAt: input.connectionUpdatedAt,
  });
  await expect(fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
    select: {
      lastDataAt: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      lastSeenAt: true,
      status: true,
      updatedAt: true,
    },
    where: { id: fixture.sourceId },
  })).resolves.toEqual(input.expectedSource);
  await expect(fixture.prisma.deviceSyncDirtyConnection.count({
    where: { connectionId: fixture.connectionId },
  })).resolves.toBe(0);
  await expect(fixture.prisma.deviceSyncDirtyPayload.count({
    where: { connectionId: fixture.connectionId },
  })).resolves.toBe(0);
  await expect(fixture.prisma.deviceSyncSignal.count({
    where: { connectionId: fixture.connectionId },
  })).resolves.toBe(0);
  await expect(fixture.prisma.hostedMailboxItem.count({
    where: { userId: fixture.memberId },
  })).resolves.toBe(0);
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await fixture.prisma.deviceWebhookTrace.deleteMany({
    where: {
      provider: "junction",
      traceId: { in: fixture.traceIds },
    },
  });
  await fixture.prisma.deviceOauthSession.deleteMany({
    where: { userId: fixture.memberId },
  });
  await fixture.prisma.hostedMember.deleteMany({
    where: { id: fixture.memberId },
  });
  await Promise.all([
    fixture.observer.$disconnect(),
    fixture.prisma.$disconnect(),
  ]);
  setHostedSecureBoxStringTestCodecForTests(null);
  fixture.restoreCryptoEnvironment();
}

describe.skipIf(!runPostgresProof)(
  "prepared device-webhook authority revalidation (real PostgreSQL)",
  () => {
    it("confirms pending setup and recovers a missed runtime handoff from durable mailbox state", async () => {
      const sourceProviderSlug = "garmin";
      const fixture = await createFixture({
        setupPhase: "pending_link",
        sourceLastErrorCode: null,
        sourceProviderSlug,
      });
      const providerFetch = vi.fn(async () => new Response(JSON.stringify({
        data: [{ slug: sourceProviderSlug, status: "connected" }],
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }));
      const registry = createJunctionRegistry(providerFetch);
      const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const prepared = await prepareDailyData({
          fixture,
          registry,
          sourceProviderSlug,
        });
        expect(prepared).toMatchObject({
          dataSourceProviderSlug: sourceProviderSlug,
          eventType: "daily.data.steps.created",
          sourceProviderSlug,
        });
        await fixture.prisma.deviceSyncDirtyConnection.create({
          data: {
            connectionId: fixture.connectionId,
            dirtyRevision: 1n,
            eventCount: 1n,
            firstDirtyAt: new Date(fixture.receivedAt.getTime() - 1_000),
            latestDirtyAt: new Date(fixture.receivedAt.getTime() - 1_000),
            processedRevision: 0n,
            provider: "junction",
            userId: fixture.memberId,
          },
        });
        const consumeService = createIngressService({
          headers: new Headers(),
          registry,
          store: fixture.store,
        });
        runtimeMocks.signalHostedDeviceSyncMailboxRuntime.mockRejectedValueOnce(
          new Error("Synthetic Temporal signal outage."),
        );

        await expect(consumeService.handlePreparedWebhook(prepared)).resolves.toMatchObject({
          accepted: true,
          duplicate: false,
        });
        const replayService = createIngressService({
          headers: new Headers(),
          registry,
          store: fixture.store,
        });
        await expect(replayService.handlePreparedWebhook(prepared)).resolves.toMatchObject({
          accepted: true,
          duplicate: true,
        });

        expect(providerFetch).toHaveBeenCalledOnce();
        await expect(fixture.prisma.deviceConnection.findUniqueOrThrow({
          select: {
            lastWebhookAt: true,
            setupExpiresAt: true,
            setupPhase: true,
          },
          where: { id: fixture.connectionId },
        })).resolves.toEqual({
          lastWebhookAt: fixture.receivedAt,
          setupExpiresAt: null,
          setupPhase: "source_confirmed",
        });
        await expect(fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: {
            lastDataAt: true,
            lastErrorCode: true,
            lastErrorMessage: true,
            lastSeenAt: true,
            status: true,
          },
          where: { id: fixture.sourceId },
        })).resolves.toEqual({
          lastDataAt: fixture.receivedAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSeenAt: fixture.receivedAt,
          status: "connected",
        });
        await expect(fixture.prisma.deviceWebhookTrace.findUniqueOrThrow({
          select: { status: true },
          where: {
            provider_traceId: {
              provider: "junction",
              traceId: prepared.traceId,
            },
          },
        })).resolves.toEqual({ status: "processed" });
        await expect(fixture.prisma.deviceSyncDirtyConnection.findUniqueOrThrow({
          select: {
            dirtyRevision: true,
            eventCount: true,
            latestEventType: true,
          },
          where: { connectionId: fixture.connectionId },
        })).resolves.toEqual({
          dirtyRevision: 1n,
          eventCount: 1n,
          latestEventType: null,
        });
        await expect(fixture.prisma.deviceSyncDirtyPayload.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(1);
        await expect(fixture.prisma.deviceSyncSignal.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(2);
        const mailboxItem = await fixture.prisma.hostedMailboxItem.findFirstOrThrow({
          select: { id: true },
          where: { userId: fixture.memberId },
        });
        const sourceWake = await readHostedMailboxWakeByItemId({
          mailboxItemId: mailboxItem.id,
          prisma: fixture.prisma,
        });
        expect(sourceWake).toMatchObject({
          connectionId: fixture.connectionId,
          hint: {
            jobs: [
              expect.objectContaining({
                kind: "backfill",
                payload: expect.objectContaining({ sourceProviderSlug }),
              }),
              expect.objectContaining({
                kind: "reconcile",
                payload: expect.objectContaining({ sourceProviderSlug }),
              }),
            ],
          },
          reason: "connected",
        });
        expect(runtimeMocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
          mailboxItemId: mailboxItem.id,
        });
        expect(runtimeMocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledTimes(1);
        await expect(fixture.prisma.hostedMailboxItem.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(1);

        const requestHandoff = vi.fn(async () => ({
          signalAccepted: true as const,
          workflowId: "hosted-user-runtime:test",
        }));
        await expect(runHostedPreferenceHandoffSweeper({
          hasActiveAccess: vi.fn(async () => true),
          logger: {
            info: vi.fn(),
            warn: vi.fn(),
          },
          requestHandoff,
          store: {
            listCandidates: vi.fn(async () => [{
              mailboxItemId: mailboxItem.id,
              userId: fixture.memberId,
            }]),
          },
        })).resolves.toMatchObject({
          handoffAccepted: 1,
          handoffFailed: 0,
        });
        expect(requestHandoff).toHaveBeenCalledWith({
          abortSignal: expect.any(AbortSignal),
          expectedUserId: fixture.memberId,
          mailboxItemId: mailboxItem.id,
        });
      } finally {
        warningSpy.mockRestore();
        await cleanupFixture(fixture);
      }
    });

    it("keeps pending setup retryable when the exact source status is ambiguous", async () => {
      const sourceProviderSlug = "garmin";
      const fixture = await createFixture({
        setupPhase: "pending_link",
        sourceLastErrorCode: null,
        sourceProviderSlug,
      });
      const providerFetch = vi.fn(async () => new Response(JSON.stringify({
        data: [{ slug: sourceProviderSlug, status: "unknown" }],
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }));
      const registry = createJunctionRegistry(providerFetch);

      try {
        const prepared = await prepareDailyData({
          fixture,
          registry,
          sourceProviderSlug,
        });
        const connectionBefore = await fixture.prisma.deviceConnection.findUniqueOrThrow({
          select: {
            lastWebhookAt: true,
            setupExpiresAt: true,
            setupPhase: true,
            updatedAt: true,
          },
          where: { id: fixture.connectionId },
        });
        const sourceBefore = await fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: {
            lastDataAt: true,
            lastErrorCode: true,
            lastErrorMessage: true,
            lastSeenAt: true,
            status: true,
            updatedAt: true,
          },
          where: { id: fixture.sourceId },
        });
        const consumeService = createIngressService({
          headers: new Headers(),
          registry,
          store: fixture.store,
        });

        await expect(consumeService.handlePreparedWebhook(prepared)).rejects.toMatchObject({
          code: "WEBHOOK_SOURCE_NOT_READY",
          retryable: true,
        });

        expect(providerFetch).toHaveBeenCalledOnce();
        await expect(fixture.prisma.deviceConnection.findUniqueOrThrow({
          select: {
            lastWebhookAt: true,
            setupExpiresAt: true,
            setupPhase: true,
            updatedAt: true,
          },
          where: { id: fixture.connectionId },
        })).resolves.toEqual(connectionBefore);
        await expect(fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: {
            lastDataAt: true,
            lastErrorCode: true,
            lastErrorMessage: true,
            lastSeenAt: true,
            status: true,
            updatedAt: true,
          },
          where: { id: fixture.sourceId },
        })).resolves.toEqual(sourceBefore);
        await expect(fixture.prisma.deviceWebhookTrace.findUnique({
          where: {
            provider_traceId: {
              provider: "junction",
              traceId: prepared.traceId,
            },
          },
        })).resolves.toBeNull();
        await expect(fixture.prisma.deviceSyncDirtyConnection.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(0);
        await expect(fixture.prisma.deviceSyncDirtyPayload.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(0);
        await expect(fixture.prisma.deviceSyncSignal.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(0);
        await expect(fixture.prisma.hostedMailboxItem.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(0);
      } finally {
        await cleanupFixture(fixture);
      }
    });

    it("retries durable daily data when concurrent source admission supersedes live proof", async () => {
      const sourceProviderSlug = "garmin";
      const fixture = await createFixture({
        setupPhase: "pending_link",
        sourceLastErrorCode: null,
        sourceProviderSlug,
      });
      const supersedingLastSeenAt = new Date(fixture.receivedAt.getTime() + 1_000);
      const providerFetch = vi.fn(async () => {
        await fixture.observer.$transaction([
          fixture.observer.deviceConnectionSource.update({
            data: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSeenAt: supersedingLastSeenAt,
              status: "connected",
            },
            where: { id: fixture.sourceId },
          }),
          fixture.observer.deviceConnection.update({
            data: {
              setupExpiresAt: null,
              setupPhase: "source_confirmed",
            },
            where: { id: fixture.connectionId },
          }),
        ]);
        return new Response(JSON.stringify({
          data: [{ slug: sourceProviderSlug, status: "connected" }],
        }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      });
      const registry = createJunctionRegistry(providerFetch);

      try {
        const prepared = await prepareDailyData({
          fixture,
          registry,
          sourceProviderSlug,
        });
        expect(prepared.acceptanceMode).toBe("durable_webhook_work");
        await fixture.prisma.deviceSyncDirtyConnection.create({
          data: {
            connectionId: fixture.connectionId,
            dirtyRevision: 1n,
            eventCount: 1n,
            firstDirtyAt: new Date(fixture.receivedAt.getTime() - 1_000),
            latestDirtyAt: new Date(fixture.receivedAt.getTime() - 1_000),
            processedRevision: 0n,
            provider: "junction",
            userId: fixture.memberId,
          },
        });
        const consumeService = createIngressService({
          headers: new Headers(),
          registry,
          store: fixture.store,
        });

        await expect(consumeService.handlePreparedWebhook(prepared)).rejects.toMatchObject({
          code: "WEBHOOK_SOURCE_NOT_READY",
          retryable: true,
        });

        expect(providerFetch).toHaveBeenCalledOnce();
        await expect(fixture.prisma.deviceWebhookTrace.findUnique({
          where: {
            provider_traceId: {
              provider: "junction",
              traceId: prepared.traceId,
            },
          },
        })).resolves.toBeNull();
        await expect(fixture.prisma.deviceSyncDirtyPayload.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(0);

        await expect(consumeService.handlePreparedWebhook(prepared)).resolves.toMatchObject({
          accepted: true,
          duplicate: false,
        });

        expect(providerFetch).toHaveBeenCalledOnce();
        await expect(fixture.prisma.deviceSyncDirtyPayload.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(1);
        const dirty = await fixture.store.getDirtyConnection({
          connectionId: fixture.connectionId,
          userId: fixture.memberId,
        });
        expect(Object.values(dirty?.dirtyResources ?? {})).toEqual([
          expect.objectContaining({
            jobKind: "resource",
            payload: expect.objectContaining({
              eventType: "daily.data.steps.created",
              resource: "steps",
              resourceCategory: "timeseries",
              sourceProviderSlug,
            }),
          }),
        ]);
        await expect(fixture.prisma.deviceSyncDirtyConnection.findUniqueOrThrow({
          select: {
            dirtyRevision: true,
            eventCount: true,
            latestEventType: true,
          },
          where: { connectionId: fixture.connectionId },
        })).resolves.toEqual({
          dirtyRevision: 1n,
          eventCount: 1n,
          latestEventType: null,
        });
        await expect(fixture.prisma.deviceSyncSignal.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(1);
        await expect(fixture.prisma.deviceWebhookTrace.findUniqueOrThrow({
          select: { status: true },
          where: {
            provider_traceId: {
              provider: "junction",
              traceId: prepared.traceId,
            },
          },
        })).resolves.toEqual({ status: "processed" });
      } finally {
        await cleanupFixture(fixture);
      }
    });

    it("terminally settles a delayed signed Junction registration after consent is revoked during source cleanup", async () => {
      const fixture = await createFixture({
        sourceLastErrorCode: DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      });
      const providerFetch = vi.fn(async () => {
        throw new Error("Revoked prepared work must not call Junction.");
      });
      const registry = createJunctionRegistry(providerFetch);

      try {
        const prepared = await prepareRegistration({ fixture, registry });
        const connectionBefore = await fixture.prisma.deviceConnection.findUniqueOrThrow({
          select: { updatedAt: true },
          where: { id: fixture.connectionId },
        });
        const sourceBefore = await fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: {
            lastDataAt: true,
            lastErrorCode: true,
            lastErrorMessage: true,
            lastSeenAt: true,
            status: true,
            updatedAt: true,
          },
          where: { id: fixture.sourceId },
        });
        await revokeHostedConsentScope({
          memberId: fixture.memberId,
          now: new Date(fixture.receivedAt.getTime() + 1_000),
          prisma: fixture.prisma,
          scope: "launch.health-data",
          source: "prepared-webhook-authority-test",
        });
        const consumeService = createIngressService({
          headers: new Headers(),
          registry,
          store: fixture.store,
        });

        await expect(consumeService.handlePreparedWebhook(prepared)).resolves.toMatchObject({
          accepted: true,
          duplicate: false,
        });

        expect(providerFetch).not.toHaveBeenCalled();
        await expectNoWebhookEffects(fixture, {
          connectionUpdatedAt: connectionBefore.updatedAt,
          expectedSource: sourceBefore,
          traceId: prepared.traceId,
        });
      } finally {
        await cleanupFixture(fixture);
      }
    });

    it("bounds a delayed signed setup-A registration by the real replacement setup lifecycle", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
      let fixture: Fixture | null = null;
      const providerReadStarted = createVoidDeferred();
      const releaseProviderRead = createVoidDeferred();
      let startPromise: Promise<unknown> | null = null;

      try {
        fixture = await createFixture({ sourceLastErrorCode: null });
        const activeFixture = fixture;
        const providerRequests: string[] = [];
        const startAt = new Date(activeFixture.receivedAt.getTime() + 60_000);
        const receivedAt = new Date(startAt.getTime() + 60_000);
        const setupExpiresAt = new Date(startAt.getTime() + 30 * 60_000);
        const providerFetch = vi.fn(async (input: string | URL | Request) => {
          const url = typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
          providerRequests.push(url);
          if (url.startsWith("https://api.sandbox.us.junction.com/v2/user/resolve/")) {
            providerReadStarted.resolve();
            await releaseProviderRead.promise;
            return new Response(JSON.stringify({ id: activeFixture.externalAccountId }), {
              headers: { "content-type": "application/json" },
              status: 200,
            });
          }
          if (url === "https://api.sandbox.us.junction.com/v2/link/token") {
            return new Response(JSON.stringify({
              link_web_url: "https://link.junction.com/session/prepared-authority",
            }), {
              headers: { "content-type": "application/json" },
              status: 200,
            });
          }
          if (
            url
            === `https://api.sandbox.us.junction.com/v2/user/providers/${activeFixture.externalAccountId}`
          ) {
            return new Response(JSON.stringify({
              data: [{ slug: "apple_health_kit", status: "unknown" }],
            }), {
              headers: { "content-type": "application/json" },
              status: 200,
            });
          }
          throw new Error(`Unexpected Junction request: ${url}`);
        });
        const registry = createJunctionRegistry(providerFetch);

        await activeFixture.store.upsertConnection({
          connectedAt: new Date(activeFixture.receivedAt.getTime() - 120_000).toISOString(),
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          displayName: "Junction",
          existingAccountPolicy: "replace",
          externalAccountId: activeFixture.externalAccountId,
          metadata: {},
          nextReconcileAt: null,
          ownerId: activeFixture.memberId,
          provider: "junction",
          scopes: [],
          setupExpiresAt: new Date(startAt.getTime() - 1).toISOString(),
          setupPhase: "pending_link",
          status: "active",
        });
        const original = await activeFixture.prisma.deviceConnection.findUniqueOrThrow({
          select: { connectedAt: true },
          where: { id: activeFixture.connectionId },
        });

        vi.setSystemTime(startAt);
        const startService = createIngressService({
          headers: new Headers(),
          registry,
          store: activeFixture.store,
        });
        startPromise = startService.startConnection(
          activeFixture.memberId,
          "junction",
          null,
        );
        await providerReadStarted.promise;
        await expect(activeFixture.prisma.deviceConnection.findUniqueOrThrow({
          select: { connectedAt: true },
          where: { id: activeFixture.connectionId },
        })).resolves.toEqual(original);

        vi.setSystemTime(receivedAt);
        const prepared = await prepareRegistration({
          fixture: activeFixture,
          receivedAt,
          registry,
        });
        await expect(activeFixture.prisma.deviceConnection.findUniqueOrThrow({
          select: { connectedAt: true },
          where: { id: activeFixture.connectionId },
        })).resolves.toEqual(original);

        releaseProviderRead.resolve();
        await startPromise;
        const replacement = await activeFixture.prisma.deviceConnection.findUniqueOrThrow({
          select: {
            connectedAt: true,
            lastWebhookAt: true,
            setupExpiresAt: true,
            setupPhase: true,
            updatedAt: true,
          },
          where: { id: activeFixture.connectionId },
        });
        expect(replacement).toMatchObject({
          connectedAt: startAt,
          lastWebhookAt: null,
          setupExpiresAt,
          setupPhase: "pending_link",
        });
        expect(replacement.connectedAt.getTime()).toBeLessThan(receivedAt.getTime());
        const sourceBefore = await activeFixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: {
            lastDataAt: true,
            lastErrorCode: true,
            lastErrorMessage: true,
            lastSeenAt: true,
            status: true,
            updatedAt: true,
          },
          where: { id: activeFixture.sourceId },
        });
        const consumeService = createIngressService({
          headers: new Headers(),
          registry,
          store: activeFixture.store,
        });

        vi.setSystemTime(new Date(setupExpiresAt.getTime() - 1));
        await expect(consumeService.handlePreparedWebhook(prepared)).rejects.toMatchObject({
          code: "WEBHOOK_SOURCE_NOT_READY",
          httpStatus: 503,
          retryable: true,
        });
        expect(providerRequests).toHaveLength(3);
        await expect(activeFixture.prisma.deviceWebhookTrace.count({
          where: {
            provider: "junction",
            traceId: prepared.traceId,
          },
        })).resolves.toBe(0);

        vi.setSystemTime(setupExpiresAt);
        await expect(consumeService.handlePreparedWebhook(prepared)).resolves.toMatchObject({
          accepted: true,
          duplicate: false,
        });

        expect(providerRequests).toHaveLength(3);
        await expectNoWebhookEffects(activeFixture, {
          connectionUpdatedAt: replacement.updatedAt,
          expectedSource: sourceBefore,
          traceId: prepared.traceId,
        });
        await expect(activeFixture.prisma.deviceConnection.findUniqueOrThrow({
          select: {
            connectedAt: true,
            setupExpiresAt: true,
            setupPhase: true,
          },
          where: { id: activeFixture.connectionId },
        })).resolves.toEqual({
          connectedAt: startAt,
          setupExpiresAt,
          setupPhase: "pending_link",
        });
        await expect(consumeService.handlePreparedWebhook(prepared)).resolves.toMatchObject({
          accepted: true,
          duplicate: true,
        });
      } finally {
        releaseProviderRead.resolve();
        await startPromise?.catch(() => undefined);
        vi.useRealTimers();
        if (fixture) {
          await cleanupFixture(fixture);
        }
      }
    });

    it(
      "terminally settles a signed pre-reconnect Strava deauthorization against the replacement connection",
      async () => {
        const suffix = randomUUID().replaceAll("-", "");
        const memberId = `member_prepared_strava_authority_${suffix}`;
        const externalAccountId = (BigInt(`0x${suffix.slice(0, 12)}`) + 1_000_000n).toString();
        const receivedAt = new Date(Date.now() - 120_000);
        const originalConnectedAt = new Date(receivedAt.getTime() - 60_000);
        const replacementConnectedAt = new Date(receivedAt.getTime() + 60_000);
        const replacementTokenExpiresAt = new Date(receivedAt.getTime() + 24 * 60 * 60_000);
        const prisma = createPrismaClient({ databaseUrl, poolMax: 3 });
        const store = new PrismaDeviceSyncControlPlaneStore({
          codec: connectionCodec,
          prisma,
          providerAccountBlindIndexKey: Buffer.alloc(32, 23),
        });
        const providerFetch = vi.fn(async () => {
          throw new Error("Superseded Strava work must not call the provider.");
        });
        const registry = createDeviceSyncRegistry([
          createStravaDeviceSyncProvider({
            clientId: "strava-client-id",
            clientSecret: "strava-client-secret",
            fetchImpl: providerFetch,
            webhookSigningSecret: stravaWebhookSigningSecret,
          }),
        ]);
        let traceId: string | null = null;

        setHostedSecureBoxStringTestCodecForTests({
          decrypt: (codecInput) => codecInput.value,
          encrypt: (codecInput) => codecInput.value,
        });
        try {
          await prisma.hostedMember.create({ data: { id: memberId } });
          await prisma.hostedConsentGrant.create({
            data: {
              createdAt: receivedAt,
              documentVersionsJson: {},
              grantedAt: receivedAt,
              memberId,
              scope: "launch.health-data",
              source: "prepared-webhook-authority-test",
              status: "granted",
              updatedAt: receivedAt,
            },
          });
          const original = await store.upsertConnection({
            connectedAt: originalConnectedAt.toISOString(),
            displayName: "Strava A",
            existingAccountPolicy: "replace",
            externalAccountId,
            metadata: { connectionEpoch: "a" },
            nextReconcileAt: null,
            ownerId: memberId,
            provider: "strava",
            scopes: ["activity:read_all"],
            status: "active",
            tokens: {
              accessToken: "access-token-a",
              accessTokenExpiresAt: replacementTokenExpiresAt.toISOString(),
              refreshToken: "refresh-token-a",
            },
          });
          const signed = signStravaDeauthorization({
            externalAccountId,
            receivedAt,
          });
          const prepareService = createIngressService({
            headers: signed.headers,
            provider: "strava",
            registry,
            store,
          });
          const prepared = await prepareService.prepareWebhookForDurableEnqueue(
            "strava",
            signed.rawBody,
            receivedAt,
          );
          traceId = prepared.traceId;
          expect(prepared).toMatchObject({
            acceptanceMode: "durable_webhook_work",
            eventType: "athlete.deauthorized",
            externalAccountId,
            jobs: [expect.objectContaining({ kind: "deauthorize" })],
            receivedAt: receivedAt.toISOString(),
          });

          const replacement = await store.upsertConnection({
            connectedAt: replacementConnectedAt.toISOString(),
            displayName: "Strava B",
            existingAccountPolicy: "replace",
            externalAccountId,
            metadata: { connectionEpoch: "b" },
            nextReconcileAt: null,
            ownerId: memberId,
            provider: "strava",
            scopes: ["activity:read_all"],
            status: "active",
            tokens: {
              accessToken: "access-token-b",
              accessTokenExpiresAt: replacementTokenExpiresAt.toISOString(),
              refreshToken: "refresh-token-b",
            },
          });
          expect(replacement.id).toBe(original.id);
          expect(replacement.connectedAt).toBe(replacementConnectedAt.toISOString());
          expect(replacementConnectedAt.getTime()).toBeGreaterThan(receivedAt.getTime());

          const connectionSelect = {
            accessTokenEncrypted: true,
            accessTokenExpiresAt: true,
            connectedAt: true,
            credentialKind: true,
            keyVersion: true,
            lastErrorCode: true,
            lastErrorMessage: true,
            lastWebhookAt: true,
            metadataJson: true,
            nextReconcileAt: true,
            providerApplicationId: true,
            providerApplicationRevision: true,
            refreshTokenEncrypted: true,
            scopesJson: true,
            setupExpiresAt: true,
            setupPhase: true,
            status: true,
            tokenVersion: true,
            updatedAt: true,
          } as const;
          const replacementBefore = await prisma.deviceConnection.findUniqueOrThrow({
            select: connectionSelect,
            where: { id: replacement.id },
          });
          expect(replacementBefore).toMatchObject({
            accessTokenEncrypted: "enc:access-token-b",
            connectedAt: replacementConnectedAt,
            lastWebhookAt: null,
            metadataJson: { connectionEpoch: "b" },
            refreshTokenEncrypted: "enc:refresh-token-b",
            setupExpiresAt: null,
            setupPhase: null,
            status: "active",
          });

          const consumeService = createIngressService({
            headers: new Headers(),
            provider: "strava",
            registry,
            store,
          });
          await expect(consumeService.handlePreparedWebhook(prepared)).resolves.toMatchObject({
            accepted: true,
            duplicate: false,
          });

          expect(providerFetch).not.toHaveBeenCalled();
          await expect(prisma.deviceWebhookTrace.findUniqueOrThrow({
            select: {
              claimToken: true,
              processingExpiresAt: true,
              receivedAt: true,
              status: true,
            },
            where: {
              provider_traceId: {
                provider: "strava",
                traceId: prepared.traceId,
              },
            },
          })).resolves.toEqual({
            claimToken: null,
            processingExpiresAt: null,
            receivedAt,
            status: "processed",
          });
          await expect(prisma.deviceConnection.findUniqueOrThrow({
            select: connectionSelect,
            where: { id: replacement.id },
          })).resolves.toEqual(replacementBefore);
          await expect(prisma.deviceConnectionSource.count({
            where: { connectionId: replacement.id },
          })).resolves.toBe(0);
          await expect(prisma.deviceSyncDirtyConnection.count({
            where: { connectionId: replacement.id },
          })).resolves.toBe(0);
          await expect(prisma.deviceSyncDirtyPayload.count({
            where: { connectionId: replacement.id },
          })).resolves.toBe(0);
          await expect(prisma.deviceSyncSignal.count({
            where: { connectionId: replacement.id },
          })).resolves.toBe(0);
          await expect(prisma.hostedMailboxItem.count({
            where: { userId: memberId },
          })).resolves.toBe(0);

          await expect(consumeService.handlePreparedWebhook(prepared)).resolves.toMatchObject({
            accepted: true,
            duplicate: true,
          });
          await expect(prisma.deviceConnection.findUniqueOrThrow({
            select: connectionSelect,
            where: { id: replacement.id },
          })).resolves.toEqual(replacementBefore);
        } finally {
          try {
            if (traceId) {
              await prisma.deviceWebhookTrace.deleteMany({
                where: { provider: "strava", traceId },
              });
            }
            await prisma.deviceOauthSession.deleteMany({ where: { userId: memberId } });
            await prisma.hostedMember.deleteMany({ where: { id: memberId } });
          } finally {
            await prisma.$disconnect();
            setHostedSecureBoxStringTestCodecForTests(null);
          }
        }
      },
    );

    it("keeps a newer source epoch when it supersedes delayed authority during provider I/O", async () => {
      const fixture = await createFixture({ sourceLastErrorCode: null });
      const supersedingLastSeenAt = new Date(fixture.receivedAt.getTime() + 1_000);
      const providerFetch = vi.fn(async () => {
        await fixture.observer.deviceConnectionSource.update({
          data: {
            lastErrorCode: DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
            lastSeenAt: supersedingLastSeenAt,
            status: "disconnected",
          },
          where: { id: fixture.sourceId },
        });
        return new Response(JSON.stringify({
          data: [{ slug: "apple_health_kit", status: "connected" }],
        }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      });
      const registry = createJunctionRegistry(providerFetch);

      try {
        const prepared = await prepareRegistration({ fixture, registry });
        const connectionBefore = await fixture.prisma.deviceConnection.findUniqueOrThrow({
          select: { updatedAt: true },
          where: { id: fixture.connectionId },
        });
        const consumeService = createIngressService({
          headers: new Headers(),
          registry,
          store: fixture.store,
        });

        await expect(consumeService.handlePreparedWebhook(prepared)).resolves.toMatchObject({
          accepted: true,
          duplicate: false,
        });

        expect(providerFetch).toHaveBeenCalledOnce();
        const supersededSource = await fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: {
            lastDataAt: true,
            lastErrorCode: true,
            lastErrorMessage: true,
            lastSeenAt: true,
            status: true,
            updatedAt: true,
          },
          where: { id: fixture.sourceId },
        });
        expect(supersededSource).toMatchObject({
          lastDataAt: null,
          lastErrorCode: DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
          lastSeenAt: supersedingLastSeenAt,
          status: "disconnected",
        });
        await expectNoWebhookEffects(fixture, {
          connectionUpdatedAt: connectionBefore.updatedAt,
          expectedSource: supersededSource,
          traceId: prepared.traceId,
        });
      } finally {
        await cleanupFixture(fixture);
      }
    });
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "postgresql:"
      && ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

const LOCAL_CRYPTO_ENV_KEYS = [
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
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "prepared-webhook-authority-test-key",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK:
      JSON.stringify(automationKey.publicKey),
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION:
      "projects/murph-test/locations/global/keyRings/test/cryptoKeys/authority/cryptoKeyVersions/1",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: authorityKey.publicKey,
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
      "projects/murph-test/locations/global/keyRings/test/cryptoKeys/web-wrap",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK:
      JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 23).toString("base64"),
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
