import { createHmac, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import {
  createDeviceSyncRegistry,
  createJunctionDeviceSyncProvider,
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
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { revokeHostedConsentScope } from "@/src/lib/legal/consent";
import { createPrismaClient } from "@/src/lib/prisma";

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

function createVoidDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

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
  receivedAt?: Date;
  registry: DeviceSyncRegistry;
}): Promise<PreparedDeviceSyncWebhookV1> {
  const receivedAt = input.receivedAt ?? input.fixture.receivedAt;
  const signed = signJunctionSourceRegistration({
    externalAccountId: input.fixture.externalAccountId,
    messageId: `msg_prepared_authority_${randomUUID().replaceAll("-", "")}`,
    receivedAt,
  });
  const service = createIngressService({
    fixture: input.fixture,
    headers: signed.headers,
    registry: input.registry,
  });
  const prepared = await service.prepareWebhookForDurableEnqueue(
    "junction",
    signed.rawBody,
    receivedAt,
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
}

describe.skipIf(!runPostgresProof)(
  "prepared device-webhook authority revalidation (real PostgreSQL)",
  () => {
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
          fixture: activeFixture,
          headers: new Headers(),
          registry,
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
          fixture: activeFixture,
          headers: new Headers(),
          registry,
        });

        vi.setSystemTime(new Date(setupExpiresAt.getTime() - 1));
        await expect(consumeService.handlePreparedWebhook(prepared)).rejects.toMatchObject({
          code: "WEBHOOK_ACCOUNT_NOT_READY",
          httpStatus: 503,
          retryable: true,
        });
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

        expect(providerRequests).toHaveLength(2);
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
