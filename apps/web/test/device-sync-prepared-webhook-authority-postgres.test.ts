import { createHmac, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { createConfiguredDeviceSyncRegistryFromConfigs } from "@murphai/device-syncd/config";
import { buildJunctionProviderSourceInstanceKey } from "@murphai/device-syncd/connect-config";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
} from "@murphai/device-syncd/public-account";
import {
  addJunctionExtendedTimeseriesHistoryBackfillCoverage,
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
  JUNCTION_SCHEDULE_TIME_EXTENDED_HISTORY_RESOURCE_VERSIONS,
} from "@murphai/device-syncd/junction-historical-backfill-progress";
import type { PreparedDeviceSyncWebhookV1 } from "@murphai/device-syncd/prepared-webhook";
import type { DeviceSyncRegistry } from "@murphai/device-syncd/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedDeviceSyncControlPlaneContext } from "@/src/lib/device-sync/control-plane-context";
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
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { revokeHostedConsentScope } from "@/src/lib/legal/consent";
import { createPrismaClient } from "@/src/lib/prisma";

const orchestrationMocks = vi.hoisted(() => ({
  signalHostedDeviceSyncMailboxRuntime: vi.fn(async () => ({
    signalAccepted: true as const,
    workflowId: "hosted-device-sync-webhook-authority-test",
  })),
}));
const mailboxCryptoMocks = vi.hoisted(() => ({
  encryptHostedMailboxPayloadStringFromPreparedRoot: vi.fn(async (input: {
    value: string | null | undefined;
  }) => input.value === null || input.value === undefined
    ? null
    : `test-ciphertext:${input.value}`),
  prepareHostedDomainRootForWeb: vi.fn(async (input: {
    domain: string;
    userId: string;
  }) => Object.freeze({
    domain: input.domain,
    rootKeyId: "test-ingress-root",
    userId: input.userId,
  })),
  revalidatePreparedHostedDomainRootForWebTx: vi.fn(async (input: {
    prepared: { rootKeyId: string };
  }) => ({
    root: Promise.resolve({}),
    rootKeyId: input.prepared.rootKeyId,
  })),
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedDeviceSyncMailboxRuntime:
    orchestrationMocks.signalHostedDeviceSyncMailboxRuntime,
}));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >("@/src/lib/hosted-crypto/domain-root-store");
  return {
    ...actual,
    prepareHostedDomainRootForWeb: mailboxCryptoMocks.prepareHostedDomainRootForWeb,
    revalidatePreparedHostedDomainRootForWebTx:
      mailboxCryptoMocks.revalidatePreparedHostedDomainRootForWebTx,
  };
});
vi.mock("@/src/lib/hosted-mailbox/encryption", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-mailbox/encryption")
  >("@/src/lib/hosted-mailbox/encryption");
  return {
    ...actual,
    encryptHostedMailboxPayloadStringFromPreparedRoot:
      mailboxCryptoMocks.encryptHostedMailboxPayloadStringFromPreparedRoot,
  };
});

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const junctionWebhookSecret = "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==";
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
  sourceId: string;
  store: PrismaDeviceSyncControlPlaneStore;
  traceIds: string[];
};

async function createFixture(input: {
  sourceLastErrorCode: string | null;
}): Promise<Fixture> {
  const suffix = randomUUID().replaceAll("-", "");
  const memberId = `member_prepared_webhook_authority_${suffix}`;
  const externalAccountId = `junction_prepared_webhook_${suffix}`;
  const receivedAt = new Date();
  const connectedAt = new Date(receivedAt.getTime() - 120_000).toISOString();
  const sourceObservedAt = new Date(receivedAt.getTime() - 60_000).toISOString();
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
    setupPhase: "source_confirmed",
    status: "active",
  });
  const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: connection.id,
    sourceProviderSlug: "apple_health_kit",
  });
  if (!sourceInstanceKey) {
    throw new Error("Expected an Apple Health source instance key.");
  }
  const source = await store.upsertConnectionSource({
    connectionId: connection.id,
    firstSeenAt: sourceObservedAt,
    lastDataAt: null,
    lastErrorCode: input.sourceLastErrorCode,
    lastErrorMessage: null,
    lastSeenAt: sourceObservedAt,
    sourceInstanceKey,
    sourceProviderSlug: "apple_health_kit",
    status: "disconnected",
  });

  return {
    connectionId: connection.id,
    externalAccountId,
    memberId,
    observer,
    prisma,
    receivedAt,
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
  fixture: Fixture;
  headers: Headers;
  registry: DeviceSyncRegistry;
}): HostedDeviceSyncPublicIngressService {
  const request = new Request(
    "https://control.example.test/api/device-sync/webhooks/junction",
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
    store: input.fixture.store,
  };

  return new HostedDeviceSyncPublicIngressService(
    context,
    new HostedDeviceSyncWebhookAdminService(context),
    input.registry,
  );
}

function signJunctionSourceRegistration(input: {
  externalAccountId: string;
  messageId: string;
  receivedAt: Date;
}): { headers: Headers; rawBody: Buffer } {
  const timestamp = Math.floor(input.receivedAt.getTime() / 1_000).toString();
  const rawBody = Buffer.from(JSON.stringify({
    data: {
      provider: "apple_health_kit",
      updated_at: input.receivedAt.toISOString(),
    },
    event_type: "provider.connection.updated",
    user_id: input.externalAccountId,
  }));
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

async function prepareRegistration(input: {
  fixture: Fixture;
  registry: DeviceSyncRegistry;
}): Promise<PreparedDeviceSyncWebhookV1> {
  const signed = signJunctionSourceRegistration({
    externalAccountId: input.fixture.externalAccountId,
    messageId: `msg_prepared_authority_${randomUUID().replaceAll("-", "")}`,
    receivedAt: input.fixture.receivedAt,
  });
  const service = createIngressService({
    fixture: input.fixture,
    headers: signed.headers,
    registry: input.registry,
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
  await fixture.prisma.hostedMember.deleteMany({
    where: { id: fixture.memberId },
  });
  await Promise.all([
    fixture.observer.$disconnect(),
    fixture.prisma.$disconnect(),
  ]);
  setHostedSecureBoxStringTestCodecForTests(null);
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
    beforeEach(() => {
      orchestrationMocks.signalHostedDeviceSyncMailboxRuntime.mockClear();
      mailboxCryptoMocks.encryptHostedMailboxPayloadStringFromPreparedRoot.mockClear();
      mailboxCryptoMocks.prepareHostedDomainRootForWeb.mockClear();
      mailboxCryptoMocks.revalidatePreparedHostedDomainRootForWebTx.mockClear();
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
      metadata = addHistoryCoverage(metadata, "apple_health_kit", "blood_pressure", 1);
      metadata = addHistoryCoverage(metadata, "garmin", "weight", 1);
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
          fixture,
          headers: new Headers(),
          registry,
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
        await expect(fixture.store.listConnectionSourceAdmissionCandidates({
          connectionId: fixture.connectionId,
          sourceProviderSlug: "apple_health_kit",
        })).resolves.toEqual([expect.objectContaining({
          lifecycleEpoch: 2,
          sourceInstanceKey: opaqueSourceInstanceKey,
          status: "disconnected",
        })]);

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
          fixture,
          headers: new Headers(),
          registry,
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
            sourceInstanceKey: opaqueSourceInstanceKey,
            status: "connected",
          }),
          expect.objectContaining({
            lifecycleEpoch: 1,
            sourceInstanceKey: canonicalSourceInstanceKey,
          }),
          expect.objectContaining({
            sourceInstanceKey: siblingSourceInstanceKey,
            status: "connected",
          }),
        ]));
        expect(rows).toHaveLength(3);

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
          1,
        )).toBe(true);
        expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
          finalMetadata,
          "garmin",
          "weight",
          1,
        )).toBe(true);
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
          fixture,
          headers: new Headers(),
          registry,
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
          fixture,
          headers: new Headers(),
          registry,
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
      metadata = addHistoryCoverage(metadata, "apple_health_kit", "blood_pressure", 1);
      metadata = addHistoryCoverage(metadata, "garmin", "weight", 1);

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
          fixture,
          headers: new Headers(),
          registry,
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
          1,
        )).toBe(true);
        expect(hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
          durableMetadata,
          "garmin",
          "weight",
          1,
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
        expect(orchestrationMocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledOnce();
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
