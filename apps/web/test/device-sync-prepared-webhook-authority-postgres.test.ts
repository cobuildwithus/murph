import { createHmac, generateKeyPairSync, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import {
  createDeviceSyncRegistry,
  createStravaDeviceSyncProvider,
} from "@murphai/device-syncd/public-ingress";
import { createConfiguredDeviceSyncRegistryFromConfigs } from "@murphai/device-syncd/config";
import { buildJunctionProviderSourceInstanceKey } from "@murphai/device-syncd/connect-config";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
} from "@murphai/device-syncd/public-account";
import {
  addJunctionExtendedTimeseriesHistoryBackfillCoverage,
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
  JUNCTION_SCHEDULE_TIME_EXTENDED_HISTORY_RESOURCE_VERSIONS,
  resolveJunctionExtendedTimeseriesHistoryBackfillVersion,
} from "@murphai/device-syncd/junction-historical-backfill-progress";
import type { PreparedDeviceSyncWebhookV1 } from "@murphai/device-syncd/prepared-webhook";
import type { DeviceSyncRegistry } from "@murphai/device-syncd/types";
import { describe, expect, it, vi } from "vitest";

import type { HostedDeviceSyncControlPlaneContext } from "@/src/lib/device-sync/control-plane-context";
import { completeHostedGoogleHealthFitbitMigration } from "@/src/lib/device-sync/fitbit-migration-cutover";
import {
  mapHostedConnectionRecord,
  PrismaDeviceSyncControlPlaneStore,
} from "@/src/lib/device-sync/prisma-store";
import { HostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import {
  beginHostedDeviceSyncConnectionSourceReconnect,
  captureHostedDeviceSyncConnectionSourceReconnect,
  disconnectHostedDeviceSyncConnectionSource,
} from "@/src/lib/device-sync/wake-service";
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
  return createConfiguredDeviceSyncRegistryFromConfigs({
    junction: {
      apiKey: "sk_us_test_123",
      clientUserIdSecret: "prepared-webhook-client-user-secret",
      environment: "sandbox",
      fetchImpl,
      region: "us",
      webhookSecret: junctionWebhookSecret,
    },
  });
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
  eventAt?: Date;
  fixture: Fixture;
  messageId?: string;
  receivedAt?: Date;
  registry: DeviceSyncRegistry;
  sourceProviderSlug: string;
}): Promise<PreparedDeviceSyncWebhookV1> {
  const eventAt = input.eventAt ?? input.fixture.receivedAt;
  const receivedAt = input.receivedAt ?? input.fixture.receivedAt;
  const signed = signJunctionWebhook({
    body: {
      data: {
        data: [{
          end: eventAt.toISOString(),
          start: new Date(eventAt.getTime() - 60_000).toISOString(),
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
    messageId: input.messageId
      ?? `msg_prepared_daily_${randomUUID().replaceAll("-", "")}`,
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

async function prepareTimestampLessDailyHint(input: {
  fixture: Fixture;
  messageId?: string;
  objectId?: string;
  receivedAt: Date;
  registry: DeviceSyncRegistry;
  sourceProviderSlug: string;
}): Promise<PreparedDeviceSyncWebhookV1> {
  const signed = signJunctionWebhook({
    body: {
      data: {
        id: input.objectId ?? `sleep-hint-${randomUUID().replaceAll("-", "")}`,
        source: {
          provider: input.sourceProviderSlug,
          type: "watch",
        },
        user_id: input.fixture.externalAccountId,
      },
      event_type: "daily.data.sleep.created",
      user_id: input.fixture.externalAccountId,
    },
    messageId: input.messageId
      ?? `msg_prepared_daily_hint_${randomUUID().replaceAll("-", "")}`,
    receivedAt: input.receivedAt,
  });
  const service = createIngressService({
    headers: signed.headers,
    registry: input.registry,
    store: input.fixture.store,
  });
  const prepared = await service.prepareWebhookForDurableEnqueue(
    "junction",
    signed.rawBody,
    input.receivedAt,
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

function historyCoverageVersion(resource: string): number {
  const version = resolveJunctionExtendedTimeseriesHistoryBackfillVersion(resource);
  if (version === null) {
    throw new TypeError(`Expected an extended-history version for ${resource}.`);
  }
  return version;
}

function addHistoryCoverage(
  metadata: Record<string, unknown>,
  providerSlug: string,
  resource: string,
  version: number,
): Record<string, unknown> {
  const update = addJunctionExtendedTimeseriesHistoryBackfillCoverage({
    metadata,
    providerSlug,
    resource,
    version,
  });
  if (!update) {
    throw new TypeError("Expected representable Junction history coverage.");
  }
  return { ...metadata, [update.metadataKey]: update.value };
}

describe.skipIf(!runPostgresProof)(
  "prepared device-webhook authority revalidation (real PostgreSQL)",
  () => {
    it("reconstructs a missing Junction source row only after live provider proof", async () => {
      const sourceProviderSlug = "apple_health_kit";
      const fixture = await createFixture({ sourceLastErrorCode: null });
      const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
        connectionId: fixture.connectionId,
        sourceProviderSlug,
      });
      if (!sourceInstanceKey) {
        throw new TypeError("Expected a canonical Junction source identity.");
      }
      const providerFetch = vi.fn(async () => new Response(JSON.stringify({
        data: [{ slug: sourceProviderSlug, status: "connected" }],
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }));
      const registry = createJunctionRegistry(providerFetch);

      try {
        await fixture.prisma.deviceConnectionSource.delete({
          where: { id: fixture.sourceId },
        });
        const prepared = await prepareRegistration({ fixture, registry });
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
        await expect(fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: {
            firstSeenAt: true,
            lastErrorCode: true,
            lastErrorMessage: true,
            lastSeenAt: true,
            lifecycleEpoch: true,
            status: true,
          },
          where: {
            connectionId_sourceInstanceKey: {
              connectionId: fixture.connectionId,
              sourceInstanceKey,
            },
          },
        })).resolves.toEqual({
          firstSeenAt: fixture.receivedAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSeenAt: fixture.receivedAt,
          lifecycleEpoch: 2,
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
        await expect(fixture.prisma.deviceSyncSignal.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(1);
        await expect(fixture.prisma.hostedMailboxItem.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(1);
      } finally {
        await cleanupFixture(fixture);
      }
    });

    it("keeps one established Apple lifecycle through native connect, webhook, disconnect, and reconnect", async () => {
      const fixture = await createFixture({ sourceLastErrorCode: null });
      const canonicalSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
        connectionId: fixture.connectionId,
        sourceProviderSlug: "apple_health_kit",
      });
      const siblingSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
        connectionId: fixture.connectionId,
        sourceProviderSlug: "garmin",
      });
      if (!canonicalSourceInstanceKey || !siblingSourceInstanceKey) {
        throw new TypeError("Expected canonical Junction source identities.");
      }
      const opaqueSourceInstanceKey = "opaque-established-apple-health";
      let metadata: Record<string, unknown> = {};
      for (const [resource, version] of JUNCTION_SCHEDULE_TIME_EXTENDED_HISTORY_RESOURCE_VERSIONS) {
        metadata = addHistoryCoverage(metadata, "apple_health_kit", resource, version);
      }
      metadata = addHistoryCoverage(
        metadata,
        "apple_health_kit",
        "blood_pressure",
        historyCoverageVersion("blood_pressure"),
      );
      metadata = addHistoryCoverage(
        metadata,
        "garmin",
        "weight",
        historyCoverageVersion("weight"),
      );
      expect(JUNCTION_SCHEDULE_TIME_EXTENDED_HISTORY_RESOURCE_VERSIONS).toHaveLength(12);

      const providerFetch = vi.fn(async (requestInput: string | URL | Request, init?: RequestInit) => {
        const request = requestInput instanceof Request
          ? requestInput
          : new Request(requestInput, init);
        if (request.method === "DELETE") {
          return new Response(JSON.stringify({ success: true }), {
            headers: { "content-type": "application/json" },
            status: 200,
          });
        }
        return new Response(JSON.stringify({
          data: [{ slug: "apple_health_kit", status: "connected" }],
        }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      });
      const registry = createJunctionRegistry(providerFetch);

      try {
        await fixture.store.syncDurableConnectionMetadata(fixture.connectionId, metadata);
        await fixture.prisma.deviceConnectionSource.update({
          data: {
            firstSeenAt: new Date(fixture.receivedAt.getTime() - 120_000),
            sourceInstanceKey: opaqueSourceInstanceKey,
            status: "connected",
          },
          where: { id: fixture.sourceId },
        });
        await fixture.store.upsertConnectionSource({
          connectionId: fixture.connectionId,
          firstSeenAt: fixture.receivedAt.toISOString(),
          lastSeenAt: fixture.receivedAt.toISOString(),
          sourceInstanceKey: siblingSourceInstanceKey,
          sourceProviderSlug: "garmin",
          status: "connected",
        });

        const firstParentBefore = await fixture.prisma.deviceConnection.findUniqueOrThrow({
          select: { updatedAt: true },
          where: { id: fixture.connectionId },
        });
        const firstReconnect = await captureHostedDeviceSyncConnectionSourceReconnect({
          connectionId: fixture.connectionId,
          sourceProviderSlug: "apple_health_kit",
          store: fixture.store,
          userId: fixture.memberId,
        });
        await beginHostedDeviceSyncConnectionSourceReconnect({
          proof: firstReconnect,
          store: fixture.store,
          userId: fixture.memberId,
        });
        const firstParentAfter = await fixture.prisma.deviceConnection.findUniqueOrThrow({
          select: { updatedAt: true },
          where: { id: fixture.connectionId },
        });
        expect(firstParentAfter.updatedAt.getTime()).toBeGreaterThan(
          firstParentBefore.updatedAt.getTime(),
        );

        fixture.receivedAt = new Date(Date.now() + 1_000);
        const firstPrepared = await prepareRegistration({ fixture, registry });
        await expect(createIngressService({
          headers: new Headers(),
          registry,
          store: fixture.store,
        }).handlePreparedWebhook(firstPrepared)).resolves.toMatchObject({
          accepted: true,
          duplicate: false,
        });

        let rows = await fixture.prisma.deviceConnectionSource.findMany({
          orderBy: { sourceInstanceKey: "asc" },
          where: { connectionId: fixture.connectionId },
        });
        expect(rows).toEqual(expect.arrayContaining([
          expect.objectContaining({
            lifecycleEpoch: 2,
            sourceInstanceKey: opaqueSourceInstanceKey,
            sourceProviderSlug: "apple_health_kit",
            status: "connected",
          }),
          expect.objectContaining({
            sourceInstanceKey: siblingSourceInstanceKey,
            sourceProviderSlug: "garmin",
            status: "connected",
          }),
        ]));
        expect(rows).toHaveLength(2);

        await expect(disconnectHostedDeviceSyncConnectionSource({
          connectionId: fixture.connectionId,
          registry,
          sourceProviderSlug: "apple_health_kit",
          store: fixture.store,
          userId: fixture.memberId,
        })).resolves.toEqual({
          sourceProviderSlug: "apple_health_kit",
          status: "disconnected",
        });
        await fixture.store.upsertConnectionSource({
          connectionId: fixture.connectionId,
          firstSeenAt: fixture.receivedAt.toISOString(),
          lastSeenAt: fixture.receivedAt.toISOString(),
          lifecycleEpoch: 1,
          sourceInstanceKey: canonicalSourceInstanceKey,
          sourceProviderSlug: "apple_health_kit",
          status: "connected",
        });
        await expect(fixture.store.resolveConnectionSourceAdmissionCandidate({
          connectionId: fixture.connectionId,
          sourceProviderSlug: "apple_health_kit",
        })).resolves.toEqual(expect.objectContaining({
          lifecycleEpoch: 2,
          sourceInstanceKey: canonicalSourceInstanceKey,
          status: "disconnected",
        }));

        const secondParentBefore = await fixture.prisma.deviceConnection.findUniqueOrThrow({
          select: { updatedAt: true },
          where: { id: fixture.connectionId },
        });
        const secondReconnect = await captureHostedDeviceSyncConnectionSourceReconnect({
          connectionId: fixture.connectionId,
          sourceProviderSlug: "apple_health_kit",
          store: fixture.store,
          userId: fixture.memberId,
        });
        await beginHostedDeviceSyncConnectionSourceReconnect({
          proof: secondReconnect,
          store: fixture.store,
          userId: fixture.memberId,
        });
        const secondParentAfter = await fixture.prisma.deviceConnection.findUniqueOrThrow({
          select: { updatedAt: true },
          where: { id: fixture.connectionId },
        });
        expect(secondParentAfter.updatedAt.getTime()).toBeGreaterThan(
          secondParentBefore.updatedAt.getTime(),
        );

        const currentRecord = await fixture.store.getConnectionRecordForUser(
          fixture.memberId,
          fixture.connectionId,
        );
        if (!currentRecord) {
          throw new TypeError("Expected the Junction account before reconnect admission.");
        }
        let reopenedMetadata = mapHostedConnectionRecord(currentRecord).metadata;
        for (const [resource, version] of JUNCTION_SCHEDULE_TIME_EXTENDED_HISTORY_RESOURCE_VERSIONS) {
          reopenedMetadata = addHistoryCoverage(
            reopenedMetadata,
            "apple_health_kit",
            resource,
            version,
          );
        }
        await fixture.store.syncDurableConnectionMetadata(
          fixture.connectionId,
          reopenedMetadata,
        );

        fixture.receivedAt = new Date(Date.now() + 3_000);
        const secondPrepared = await prepareRegistration({ fixture, registry });
        await expect(createIngressService({
          headers: new Headers(),
          registry,
          store: fixture.store,
        }).handlePreparedWebhook(secondPrepared)).resolves.toMatchObject({
          accepted: true,
          duplicate: false,
        });

        rows = await fixture.prisma.deviceConnectionSource.findMany({
          orderBy: { sourceInstanceKey: "asc" },
          where: { connectionId: fixture.connectionId },
        });
        expect(rows).toEqual(expect.arrayContaining([
          expect.objectContaining({
            lifecycleEpoch: 3,
            sourceInstanceKey: canonicalSourceInstanceKey,
            status: "connected",
          }),
          expect.objectContaining({
            sourceInstanceKey: siblingSourceInstanceKey,
            status: "connected",
          }),
        ]));
        expect(rows).toHaveLength(2);

        const finalRecord = await fixture.store.getConnectionRecordForUser(
          fixture.memberId,
          fixture.connectionId,
        );
        if (!finalRecord) {
          throw new TypeError("Expected the Junction account after reconnect admission.");
        }
        const finalMetadata = mapHostedConnectionRecord(finalRecord).metadata;
        for (const [resource, version] of JUNCTION_SCHEDULE_TIME_EXTENDED_HISTORY_RESOURCE_VERSIONS) {
          expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
            finalMetadata,
            "apple_health_kit",
            resource,
            version,
          )).toBe(false);
        }
        expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
          finalMetadata,
          "apple_health_kit",
          "blood_pressure",
          historyCoverageVersion("blood_pressure"),
        )).toBe(true);
        expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
          finalMetadata,
          "garmin",
          "weight",
          historyCoverageVersion("weight"),
        )).toBe(true);
      } finally {
        await cleanupFixture(fixture);
      }
    });

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
            lifecycleEpoch: true,
            lastSeenAt: true,
            status: true,
          },
          where: { id: fixture.sourceId },
        })).resolves.toEqual({
          lastDataAt: fixture.receivedAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          lifecycleEpoch: 2,
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

    it("does not let a repeated pre-reauthorization Google daily fact certify the new source epoch", async () => {
      const sourceProviderSlug = "google_health";
      const fixture = await createFixture({
        sourceLastErrorCode: null,
        sourceProviderSlug,
      });
      let cutoverEnabled = false;
      const cutoverRequests: Array<{ method: string; url: string }> = [];
      const providerFetch = vi.fn(async (input, init) => {
        if (!cutoverEnabled) {
          throw new Error("An admitted exact source must not require a provider read.");
        }
        const request = new Request(input, init);
        cutoverRequests.push({ method: request.method, url: request.url });
        if (
          request.method === "GET"
          && request.url.endsWith(`/v2/user/providers/${fixture.externalAccountId}`)
        ) {
          return new Response(JSON.stringify({
            data: [
              { slug: "fitbit", status: "connected" },
              { slug: sourceProviderSlug, status: "connected" },
            ],
          }), {
            headers: { "content-type": "application/json" },
            status: 200,
          });
        }
        if (
          request.method === "DELETE"
          && request.url.endsWith(`/v2/user/${fixture.externalAccountId}/fitbit`)
        ) {
          return new Response(JSON.stringify({ success: true }), {
            headers: { "content-type": "application/json" },
            status: 200,
          });
        }
        throw new Error(`Unexpected migration cutover request: ${request.method}`);
      });
      const registry = createJunctionRegistry(providerFetch);
      const firstMessageId = `msg_google_replay_${randomUUID().replaceAll("-", "")}`;
      const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
        connectionId: fixture.connectionId,
        sourceProviderSlug,
      });
      const fitbitInstanceKey = buildJunctionProviderSourceInstanceKey({
        connectionId: fixture.connectionId,
        sourceProviderSlug: "fitbit",
      });
      if (!sourceInstanceKey || !fitbitInstanceKey) {
        throw new Error("Expected exact Google Health and Fitbit source keys.");
      }
      const initialSourceAt = new Date(fixture.receivedAt.getTime() - 72 * 60 * 60_000);
      const logicalEventAt = new Date(fixture.receivedAt.getTime() - 48 * 60 * 60_000);

      try {
        await fixture.store.upsertConnectionSource({
          connectionId: fixture.connectionId,
          firstSeenAt: initialSourceAt.toISOString(),
          lastSeenAt: fixture.receivedAt.toISOString(),
          sourceInstanceKey,
          sourceProviderSlug,
          status: "connected",
        });
        await fixture.store.upsertConnectionSource({
          connectionId: fixture.connectionId,
          firstSeenAt: new Date(fixture.receivedAt.getTime() - 120_000).toISOString(),
          lastSeenAt: fixture.receivedAt.toISOString(),
          sourceInstanceKey: fitbitInstanceKey,
          sourceProviderSlug: "fitbit",
          status: "connected",
        });
        const firstPrepared = await prepareDailyData({
          eventAt: logicalEventAt,
          fixture,
          messageId: firstMessageId,
          receivedAt: fixture.receivedAt,
          registry,
          sourceProviderSlug,
        });
        const consumeService = createIngressService({
          headers: new Headers(),
          registry,
          store: fixture.store,
        });

        await expect(consumeService.handlePreparedWebhook(firstPrepared)).rejects.toMatchObject({
          code: "WEBHOOK_SOURCE_NOT_READY",
          retryable: true,
        });
        await expect(fixture.prisma.deviceWebhookTrace.findUnique({
          where: {
            provider_traceId: {
              provider: "junction",
              traceId: firstPrepared.traceId,
            },
          },
        })).resolves.toBeNull();
        await expect(fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: { lastDataAt: true },
          where: { id: fixture.sourceId },
        })).resolves.toEqual({
          lastDataAt: logicalEventAt,
        });
        await expect(fixture.prisma.hostedMailboxItem.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(1);

        await fixture.store.upsertConnectionSource({
          connectionId: fixture.connectionId,
          lastSeenAt: new Date(fixture.receivedAt.getTime() + 1).toISOString(),
          sourceInstanceKey,
          sourceProviderSlug,
          status: "disconnected",
        });
        const reconnectProof = await captureHostedDeviceSyncConnectionSourceReconnect({
          connectionId: fixture.connectionId,
          sourceProviderSlug,
          store: fixture.store,
          userId: fixture.memberId,
        });
        await beginHostedDeviceSyncConnectionSourceReconnect({
          proof: reconnectProof,
          store: fixture.store,
          userId: fixture.memberId,
        });
        const reconnectingSource = await fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: { firstSeenAt: true, lastDataAt: true },
          where: { id: fixture.sourceId },
        });
        expect(reconnectingSource.lastDataAt).toBeNull();
        expect(reconnectingSource.firstSeenAt.getTime()).toBeGreaterThan(
          fixture.receivedAt.getTime(),
        );
        await fixture.store.upsertConnectionSource({
          connectionId: fixture.connectionId,
          lastSeenAt: reconnectingSource.firstSeenAt.toISOString(),
          sourceInstanceKey,
          sourceProviderSlug,
          status: "connected",
        });
        const reauthorizedSource = await fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: { firstSeenAt: true, lastDataAt: true },
          where: { id: fixture.sourceId },
        });

        const timestampLessReceivedAt = new Date(
          reauthorizedSource.firstSeenAt.getTime() + 500,
        );
        const timestampLessObjectId = `sleep-hint-${randomUUID().replaceAll("-", "")}`;
        const timestampLessPrepared = await prepareTimestampLessDailyHint({
          fixture,
          objectId: timestampLessObjectId,
          receivedAt: timestampLessReceivedAt,
          registry,
          sourceProviderSlug,
        });
        expect(timestampLessPrepared.occurredAt).toBeUndefined();
        expect(timestampLessPrepared.jobs).toHaveLength(1);
        expect(timestampLessPrepared.jobs[0]).toMatchObject({
          kind: "resource",
          payload: {
            eventType: "daily.data.sleep.created",
            resource: "sleep",
            sourceProviderSlug,
          },
        });
        await expect(
          consumeService.handlePreparedWebhook(timestampLessPrepared),
        ).rejects.toMatchObject({
          code: "WEBHOOK_SOURCE_NOT_READY",
          retryable: true,
        });
        await expect(fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: { firstSeenAt: true, lastDataAt: true },
          where: { id: fixture.sourceId },
        })).resolves.toEqual(reauthorizedSource);
        await expect(fixture.prisma.hostedMailboxItem.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(1);

        const migrationMailboxItemBeforeRestart =
          await fixture.prisma.hostedMailboxItem.findFirstOrThrow({
            select: { id: true },
            where: { userId: fixture.memberId },
          });
        await fixture.prisma.hostedMailboxItem.update({
          data: { consumedAt: timestampLessReceivedAt },
          where: { id: migrationMailboxItemBeforeRestart.id },
        });
        const restartedTimestampLessConsumeService = createIngressService({
          headers: new Headers(),
          registry,
          store: fixture.store,
        });
        const repeatedTimestampLessPrepared = await prepareTimestampLessDailyHint({
          fixture,
          objectId: timestampLessObjectId,
          receivedAt: new Date(timestampLessReceivedAt.getTime() + 1_000),
          registry,
          sourceProviderSlug,
        });
        expect(repeatedTimestampLessPrepared.traceId).not.toBe(
          timestampLessPrepared.traceId,
        );
        expect(
          repeatedTimestampLessPrepared.jobs.map((job) => job.dedupeKey),
        ).not.toEqual(timestampLessPrepared.jobs.map((job) => job.dedupeKey));
        await expect(
          restartedTimestampLessConsumeService.handlePreparedWebhook(
            repeatedTimestampLessPrepared,
          ),
        ).rejects.toMatchObject({
          code: "WEBHOOK_SOURCE_NOT_READY",
          retryable: true,
        });
        await expect(fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: { firstSeenAt: true, lastDataAt: true },
          where: { id: fixture.sourceId },
        })).resolves.toEqual(reauthorizedSource);
        await expect(fixture.prisma.hostedMailboxItem.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(1);

        const retryReceivedAt = new Date(reauthorizedSource.firstSeenAt.getTime() + 1_000);
        const retryPrepared = await prepareDailyData({
          eventAt: logicalEventAt,
          fixture,
          receivedAt: retryReceivedAt,
          registry,
          sourceProviderSlug,
        });
        expect(retryPrepared.traceId).not.toBe(firstPrepared.traceId);
        expect(retryPrepared.jobs.map((job) => job.dedupeKey)).toEqual(
          firstPrepared.jobs.map((job) => job.dedupeKey),
        );
        await expect(consumeService.handlePreparedWebhook(retryPrepared)).rejects.toMatchObject({
          code: "WEBHOOK_SOURCE_NOT_READY",
          retryable: true,
        });
        await expect(fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: { firstSeenAt: true, lastDataAt: true },
          where: { id: fixture.sourceId },
        })).resolves.toEqual(reauthorizedSource);
        await expect(fixture.prisma.hostedMailboxItem.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(1);

        const migrationMailboxItem = await fixture.prisma.hostedMailboxItem.findFirstOrThrow({
          select: { id: true },
          where: { userId: fixture.memberId },
        });
        await fixture.prisma.hostedMailboxItem.update({
          data: { consumedAt: retryReceivedAt },
          where: { id: migrationMailboxItem.id },
        });
        const restartedConsumeService = createIngressService({
          headers: new Headers(),
          registry,
          store: fixture.store,
        });
        const consumedRetryPrepared = await prepareDailyData({
          eventAt: logicalEventAt,
          fixture,
          receivedAt: new Date(retryReceivedAt.getTime() + 1_000),
          registry,
          sourceProviderSlug,
        });
        expect(consumedRetryPrepared.jobs.map((job) => job.dedupeKey)).toEqual(
          firstPrepared.jobs.map((job) => job.dedupeKey),
        );
        await expect(
          restartedConsumeService.handlePreparedWebhook(consumedRetryPrepared),
        ).rejects.toMatchObject({
          code: "WEBHOOK_SOURCE_NOT_READY",
          retryable: true,
        });
        await expect(fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: { firstSeenAt: true, lastDataAt: true },
          where: { id: fixture.sourceId },
        })).resolves.toEqual(reauthorizedSource);
        await expect(fixture.prisma.hostedMailboxItem.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(1);
        await expect(completeHostedGoogleHealthFitbitMigration({
          connectionId: fixture.connectionId,
          registry,
          store: fixture.store,
          userId: fixture.memberId,
        })).resolves.toMatchObject({ status: "pending" });
        await expect(fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: { status: true },
          where: {
            connectionId_sourceInstanceKey: {
              connectionId: fixture.connectionId,
              sourceInstanceKey: fitbitInstanceKey,
            },
          },
        })).resolves.toEqual({ status: "connected" });
        expect(providerFetch).not.toHaveBeenCalled();

        const currentEventAt = new Date(reauthorizedSource.firstSeenAt.getTime() + 120_000);
        const currentReceivedAt = new Date(currentEventAt.getTime() + 1_000);
        const currentPrepared = await prepareDailyData({
          eventAt: currentEventAt,
          fixture,
          receivedAt: currentReceivedAt,
          registry,
          sourceProviderSlug,
        });
        await expect(
          restartedConsumeService.handlePreparedWebhook(currentPrepared),
        ).rejects.toMatchObject({
          code: "WEBHOOK_SOURCE_NOT_READY",
          retryable: true,
        });
        await expect(fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: { firstSeenAt: true, lastDataAt: true },
          where: { id: fixture.sourceId },
        })).resolves.toEqual({
          firstSeenAt: reauthorizedSource.firstSeenAt,
          lastDataAt: currentEventAt,
        });
        await expect(fixture.prisma.hostedMailboxItem.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(2);
        expect(providerFetch).not.toHaveBeenCalled();

        await fixture.store.upsertConnectionSource({
          connectionId: fixture.connectionId,
          lastSeenAt: currentReceivedAt.toISOString(),
          resourceAvailabilitySummary: {
            historicalBackfillCompletedAt: currentReceivedAt.toISOString(),
          },
          sourceInstanceKey: fitbitInstanceKey,
          sourceProviderSlug: "fitbit",
          status: "connected",
        });
        await fixture.store.upsertConnectionSource({
          connectionId: fixture.connectionId,
          lastSeenAt: currentReceivedAt.toISOString(),
          resourceAvailabilitySummary: {
            historicalBackfillCompletedAt: currentReceivedAt.toISOString(),
            steps: true,
          },
          sourceInstanceKey,
          sourceProviderSlug,
          status: "connected",
        });
        cutoverEnabled = true;
        await expect(completeHostedGoogleHealthFitbitMigration({
          connectionId: fixture.connectionId,
          registry,
          store: fixture.store,
          userId: fixture.memberId,
        })).resolves.toMatchObject({ status: "complete" });
        await expect(completeHostedGoogleHealthFitbitMigration({
          connectionId: fixture.connectionId,
          registry,
          store: fixture.store,
          userId: fixture.memberId,
        })).resolves.toMatchObject({ status: "complete" });
        await expect(fixture.prisma.deviceConnectionSource.findUniqueOrThrow({
          select: { lastErrorCode: true, status: true },
          where: {
            connectionId_sourceInstanceKey: {
              connectionId: fixture.connectionId,
              sourceInstanceKey: fitbitInstanceKey,
            },
          },
        })).resolves.toEqual({
          lastErrorCode: DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
          status: "disconnected",
        });
        expect(cutoverRequests.filter((request) => request.method === "DELETE")).toHaveLength(1);
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

    it("admits a registration when the source owner physically canonicalizes the same Apple lifecycle during provider I/O", async () => {
      const fixture = await createFixture({ sourceLastErrorCode: null });
      const canonicalSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
        connectionId: fixture.connectionId,
        sourceProviderSlug: "apple_health_kit",
      });
      const siblingSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
        connectionId: fixture.connectionId,
        sourceProviderSlug: "garmin",
      });
      if (!canonicalSourceInstanceKey || !siblingSourceInstanceKey) {
        throw new TypeError("Expected canonical Junction source identities.");
      }

      let metadata: Record<string, unknown> = {};
      for (const [resource, version] of JUNCTION_SCHEDULE_TIME_EXTENDED_HISTORY_RESOURCE_VERSIONS) {
        metadata = addHistoryCoverage(metadata, "apple_health_kit", resource, version);
      }
      metadata = addHistoryCoverage(
        metadata,
        "apple_health_kit",
        "blood_pressure",
        historyCoverageVersion("blood_pressure"),
      );
      metadata = addHistoryCoverage(
        metadata,
        "garmin",
        "weight",
        historyCoverageVersion("weight"),
      );

      await fixture.store.syncDurableConnectionMetadata(fixture.connectionId, metadata);
      await fixture.prisma.deviceConnectionSource.update({
        data: {
          sourceInstanceKey: "jxn_src_legacy_apple_health",
          sourceProviderSlug: "apple_health",
        },
        where: { id: fixture.sourceId },
      });
      await fixture.store.upsertConnectionSource({
        connectionId: fixture.connectionId,
        firstSeenAt: fixture.receivedAt.toISOString(),
        lastSeenAt: fixture.receivedAt.toISOString(),
        sourceInstanceKey: siblingSourceInstanceKey,
        sourceProviderSlug: "garmin",
        status: "connected",
      });

      const providerFetch = vi.fn(async () => {
        await fixture.store.withHealthDataAdmissionLock(
          fixture.memberId,
          fixture.connectionId,
          async (tx) => {
            const sources = await fixture.store.listConnectionSources(
              fixture.connectionId,
              tx,
            );
            expect(sources).toEqual(expect.arrayContaining([
              expect.objectContaining({
                lifecycleEpoch: 1,
                sourceInstanceKey: canonicalSourceInstanceKey,
                sourceProviderSlug: "apple_health_kit",
                status: "disconnected",
              }),
            ]));
          },
        );
        await expect(fixture.prisma.deviceConnectionSource.findUnique({
          where: { id: fixture.sourceId },
        })).resolves.toBeNull();
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
        const sources = await fixture.prisma.deviceConnectionSource.findMany({
          orderBy: { sourceProviderSlug: "asc" },
          where: { connectionId: fixture.connectionId },
        });
        expect(sources).toEqual(expect.arrayContaining([
          expect.objectContaining({
            lifecycleEpoch: 2,
            sourceInstanceKey: canonicalSourceInstanceKey,
            sourceProviderSlug: "apple_health_kit",
            status: "connected",
          }),
          expect.objectContaining({
            sourceInstanceKey: siblingSourceInstanceKey,
            sourceProviderSlug: "garmin",
            status: "connected",
          }),
        ]));
        expect(sources).toHaveLength(2);

        const connectionRecord = await fixture.store.getConnectionRecordForUser(
          fixture.memberId,
          fixture.connectionId,
        );
        if (!connectionRecord) {
          throw new TypeError("Expected the Junction account after webhook admission.");
        }
        const durableMetadata = mapHostedConnectionRecord(connectionRecord).metadata;
        for (const [resource, version] of JUNCTION_SCHEDULE_TIME_EXTENDED_HISTORY_RESOURCE_VERSIONS) {
          expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
            durableMetadata,
            "apple_health_kit",
            resource,
            version,
          )).toBe(false);
        }
        expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
          durableMetadata,
          "apple_health_kit",
          "blood_pressure",
          historyCoverageVersion("blood_pressure"),
        )).toBe(true);
        expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
          durableMetadata,
          "garmin",
          "weight",
          historyCoverageVersion("weight"),
        )).toBe(true);
        await expect(fixture.prisma.deviceWebhookTrace.findUniqueOrThrow({
          select: { claimToken: true, processingExpiresAt: true, status: true },
          where: {
            provider_traceId: {
              provider: "junction",
              traceId: prepared.traceId,
            },
          },
        })).resolves.toEqual({
          claimToken: null,
          processingExpiresAt: null,
          status: "processed",
        });
        await expect(fixture.prisma.deviceSyncDirtyConnection.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(1);
        await expect(fixture.prisma.deviceSyncSignal.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(1);
        await expect(fixture.prisma.hostedMailboxItem.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(1);
        expect(runtimeMocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledOnce();
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
