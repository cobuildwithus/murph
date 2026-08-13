import { Buffer } from "node:buffer";

import { Prisma, PrismaClient } from "@prisma/client";
import {
  COMPANION_HRV_RMSSD_RESOURCE,
  parseCompanionHrvRmssdAdmissionId,
  parseSerializedCompanionHrvRmssdObservation,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import {
  isDeviceSyncCredentialIndependentImportJob,
  isHostedDeviceSyncEventToProviderSendBucket,
  mergeHostedDeviceSyncEventToProviderSendBuckets,
  serializeHostedExecutionDeviceSyncDirtyPayloadIdentity,
  type DeviceSyncCredentialIndependentImportJobClassifier,
  type HostedExecutionDeviceSyncStagedDirtyAck,
} from "@murphai/device-syncd/hosted-runtime";

import {
  normalizeNullableString,
  sha256Hex,
  toIsoTimestamp,
} from "../shared";
import { HostedDomainRootPreparationMismatchError } from "../../hosted-crypto/domain-root-store";
import { toNullablePrismaJsonValue } from "./prisma-json";
import {
  openHostedDeviceSyncDirtyPayloadJson,
  prepareHostedDeviceSyncDirtyPayloadCrypto,
  revalidatePreparedHostedDeviceSyncDirtyPayloadCryptoTx,
  sealHostedDeviceSyncDirtyPayloadJson,
  sealHostedDeviceSyncDirtyPayloadJsonFromPreparedCrypto,
  type PreparedHostedDeviceSyncDirtyPayloadCrypto,
} from "./dirty-payloads";
import type {
  HostedDeviceSyncDirtyConnectionAckRecord,
  HostedDeviceSyncDirtyConnectionRecord,
  HostedDeviceSyncDirtyResource,
  HostedPrismaTransactionClient,
  UpsertHostedDeviceSyncDirtyConnectionInput,
  UpsertHostedDeviceSyncDirtyConnectionResult,
} from "./types";

type DeviceSyncDirtyConnectionPrismaRecord =
  Prisma.DeviceSyncDirtyConnectionGetPayload<Prisma.DeviceSyncDirtyConnectionDefaultArgs>;

type DeviceSyncDirtyPayloadPrismaRecord = {
  connectionId: string;
  dirtyRevision: bigint;
  id: string;
  provider: string;
  resourceEncrypted: string;
};

interface DirtyResourceBatch {
  allResources: Record<string, HostedDeviceSyncDirtyResource>;
  compactResources: Record<string, HostedDeviceSyncDirtyResource>;
  payloadResources: HostedDeviceSyncDirtyResource[];
}

interface DirtyPayloadCreateResult {
  resources: HostedDeviceSyncDirtyResource[];
}

interface PreparedDirtyPayloadRow {
  connectionId: string;
  credentialIndependent: boolean;
  dirtyRevision: bigint;
  id: string;
  provider: string;
  resourceEncrypted: string;
  userId: string;
}

interface PreparedDirtyPayloadRows {
  dirtyRevision: bigint;
  resources: HostedDeviceSyncDirtyResource[];
  rows: PreparedDirtyPayloadRow[];
}

type DirtyConnectionPreparationSnapshot =
  | { exists: false }
  | {
      dirtyRevision: bigint;
      exists: true;
      processedRevision: bigint;
      provider: string;
      updatedAt: string;
      userId: string;
    };

interface PreparedHostedDeviceSyncDirtyConnectionUpsertDetails {
  dirtyRevision: bigint;
  input: Omit<UpsertHostedDeviceSyncDirtyConnectionInput, "tx">;
  payloadCrypto?: PreparedHostedDeviceSyncDirtyPayloadCrypto;
  payloadRows?: PreparedDirtyPayloadRows;
  resourceBatch: DirtyResourceBatch;
  snapshot: DirtyConnectionPreparationSnapshot;
}

const preparedHostedDeviceSyncDirtyConnectionUpserts = new WeakMap<
  PreparedHostedDeviceSyncDirtyConnectionUpsert,
  PreparedHostedDeviceSyncDirtyConnectionUpsertDetails
>();

export interface PreparedHostedDeviceSyncDirtyConnectionUpsert {
  readonly connectionId: string;
  readonly dirtyRevision: bigint;
  readonly provider: string;
  readonly shouldRequestWake: boolean;
  readonly userId: string;
}

export function hasHostedDeviceSyncDirtyResourcePayload(
  resource: HostedDeviceSyncDirtyResource,
): boolean {
  return hasDirtyResourceInputPayload(resource.payload);
}

export class HostedDeviceSyncDirtyPreparationMismatchError extends Error {
  readonly code = "HOSTED_DEVICE_SYNC_DIRTY_PREPARATION_MISMATCH";

  constructor() {
    super("Hosted device-sync dirty preparation is stale.");
    this.name = "HostedDeviceSyncDirtyPreparationMismatchError";
  }
}

const DIRTY_COUNTER_KEY_MAX_LENGTH = 96;
const DIRTY_RESOURCE_KEY_MAX_LENGTH = 256;
const DIRTY_RESOURCE_PAYLOAD_STRING_MAX_LENGTH = 512;
const DIRTY_RESOURCE_PAYLOAD_WEBHOOK_DATA_JSON_MAX_BYTES = 64_000;
const DIRTY_RESOURCE_PAYLOAD_BLOCKED_KEY_PATTERN =
  /(?:authorization|authheader|bearer|clientsecret|cookie|credential|password|secret|token|apikey)/iu;
const DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS = 12;
const DIRTY_PAYLOAD_HYDRATE_LIMIT_PER_CONNECTION = 500;
const DIRTY_PAYLOAD_HYDRATE_LIMIT_PER_RESPONSE = 1_000;
const DIRTY_PAYLOAD_HYDRATE_RESPONSE_MAX_ESTIMATED_BYTES = 8 * 1024 * 1024;
const DIRTY_PAYLOAD_PRESEAL_CONCURRENCY = 16;
const DIRTY_PAYLOAD_LEGACY_CLASSIFICATION_BATCH_LIMIT = 100;
const DIRTY_PAYLOAD_LEGACY_CLASSIFICATION_MAX_BATCHES = 8;
const HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_CLASSIFICATION_PENDING_CODE =
  "HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_CLASSIFICATION_PENDING";
const HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION_CODE = "HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION";
const COMPANION_HRV_NIGHT_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const COMPANION_HRV_NIGHT_RECEIPT_MAX_PER_CONNECTION = 64;

export type CompanionHrvNightReceiptInspection = "conflict" | "exact" | "missing";

export async function classifyHostedUnclassifiedDirtyPayloadsForConnection(input: {
  connectionId: string;
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<void> {
  const classifyResource = createDirtyPayloadCredentialClassifier();

  for (
    let batch = 0;
    batch < DIRTY_PAYLOAD_LEGACY_CLASSIFICATION_MAX_BATCHES;
    batch += 1
  ) {
    const rows = await input.tx.deviceSyncDirtyPayload.findMany({
      orderBy: [
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: {
        connectionId: true,
        dirtyRevision: true,
        id: true,
        provider: true,
        resourceEncrypted: true,
      },
      take: DIRTY_PAYLOAD_LEGACY_CLASSIFICATION_BATCH_LIMIT + 1,
      where: {
        connectionId: input.connectionId,
        credentialIndependent: null,
        userId: input.userId,
      },
    });
    if (rows.length === 0) {
      return;
    }

    const classified = await mapLimit(
      rows.slice(0, DIRTY_PAYLOAD_LEGACY_CLASSIFICATION_BATCH_LIMIT),
      DIRTY_PAYLOAD_PRESEAL_CONCURRENCY,
      async (row) => {
        const resource = await readDirtyPayloadResourceJson({
          row,
          tx: input.tx,
          userId: input.userId,
        });
        return {
          credentialIndependent: resource
            ? await classifyResource({
                provider: row.provider,
                resource,
              })
            : false,
          id: row.id,
        };
      },
    );

    for (const credentialIndependent of [false, true] as const) {
      const ids = classified
        .filter((entry) => entry.credentialIndependent === credentialIndependent)
        .map((entry) => entry.id);
      if (ids.length === 0) {
        continue;
      }
      await input.tx.deviceSyncDirtyPayload.updateMany({
        data: { credentialIndependent },
        where: {
          connectionId: input.connectionId,
          credentialIndependent: null,
          id: { in: ids },
          userId: input.userId,
        },
      });
    }

    if (rows.length <= DIRTY_PAYLOAD_LEGACY_CLASSIFICATION_BATCH_LIMIT) {
      return;
    }
  }

  throw createDirtyPayloadClassificationPendingError();
}

export function isHostedDirtyPayloadClassificationPendingError(
  error: unknown,
): boolean {
  return Boolean(
    typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code
        === HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_CLASSIFICATION_PENDING_CODE,
  );
}

export async function supersedeHostedCredentialScopedDirtyStateForConnectionTx(input: {
  connectionId: string;
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<void> {
  const [existing] = await input.tx.$queryRaw<Array<{
    dirtyRevision: bigint;
    latestDirtyAt: Date;
    processedRevision: bigint;
  }>>(Prisma.sql`
    SELECT
      dirty_revision AS "dirtyRevision",
      latest_dirty_at AS "latestDirtyAt",
      processed_revision AS "processedRevision"
    FROM device_sync_dirty_connection
    WHERE connection_id = ${input.connectionId}
      AND user_id = ${input.userId}
    FOR UPDATE
  `);
  if (!existing) {
    return;
  }

  let unclassifiedPayloadCount = await input.tx.deviceSyncDirtyPayload.count({
    where: {
      connectionId: input.connectionId,
      credentialIndependent: null,
      userId: input.userId,
    },
  });
  if (unclassifiedPayloadCount > 0) {
    // Acknowledgement takes this dirty-marker lock before deleting payload
    // rows. Keep reconnect on the same marker-before-payload order while
    // mixed-version nullable rows are classified behind the consent fence.
    await classifyHostedUnclassifiedDirtyPayloadsForConnection(input);
    unclassifiedPayloadCount = await input.tx.deviceSyncDirtyPayload.count({
      where: {
        connectionId: input.connectionId,
        credentialIndependent: null,
        userId: input.userId,
      },
    });
  }
  if (unclassifiedPayloadCount > 0) {
    throw createDirtyPayloadClassificationPendingError();
  }

  const updated = await input.tx.deviceSyncDirtyConnection.updateMany({
    data: {
      dirtyResourcesJson: toNullablePrismaJsonValue({}),
      firstDirtyAt: existing.latestDirtyAt,
      processedRevision: existing.dirtyRevision,
      resourceCategoryCountsJson: toNullablePrismaJsonValue({}),
      sourceProviderCountsJson: toNullablePrismaJsonValue({}),
      windowEnd: null,
      windowStart: null,
    },
    where: {
      connectionId: input.connectionId,
      dirtyRevision: existing.dirtyRevision,
      processedRevision: existing.processedRevision,
      userId: input.userId,
    },
  });
  if (updated.count === 0) {
    throw createDirtyStateContentionError("ack");
  }

  await input.tx.deviceSyncDirtyPayload.deleteMany({
    where: {
      connectionId: input.connectionId,
      credentialIndependent: false,
      userId: input.userId,
    },
  });
}

interface DirtyPayloadHydrationBudget {
  exhausted: boolean;
  maxEstimatedBytes: number;
  maxResources: number;
  usedEstimatedBytes: number;
  usedResources: number;
}

interface StagedDirtyAckOverlayEntry {
  processedDirtyPayloadIds: Set<string>;
  processedRevision: bigint | null;
}

type StagedDirtyAckOverlay = Map<string, StagedDirtyAckOverlayEntry>;

interface DirtyConnectionHydrationResult {
  hasMorePayloads: boolean;
  items: HostedDeviceSyncDirtyConnectionRecord[];
}

export class PrismaHostedDirtyConnectionStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async inspectCompanionHrvNightReceipt(input: {
    connectionIds: readonly string[];
    nightDate: string;
    now: string;
    resource: HostedDeviceSyncDirtyResource;
    userId: string;
  }): Promise<CompanionHrvNightReceiptInspection> {
    const connectionIds = [...new Set(input.connectionIds)];
    if (connectionIds.length === 0) {
      return "missing";
    }
    if (readCompanionHrvDirtyResourceNightDate(input.resource) !== input.nightDate) {
      throw createCompanionHrvResourceInvalidError();
    }

    const cutoff = resolveCompanionHrvNightReceiptCutoff(input.now);
    await this.prisma.deviceSyncCompanionCaptureReceipt.deleteMany({
      where: {
        connectionId: { in: connectionIds },
        createdAt: { lt: cutoff },
        userId: input.userId,
      },
    });

    const receiptIds = connectionIds.map((connectionId) =>
      createCompanionHrvNightReceiptId({
        connectionId,
        nightDate: input.nightDate,
      })
    );
    const receipts = await this.prisma.deviceSyncCompanionCaptureReceipt.findMany({
      select: {
        connectionId: true,
        envelopeHash: true,
        userId: true,
      },
      where: {
        createdAt: { gte: cutoff },
        id: { in: receiptIds },
        userId: input.userId,
      },
    });
    if (receipts.length === 0) {
      return "missing";
    }

    const envelopeHash = sha256Hex(buildStrictDirtyResourceIdentity(input.resource));
    return receipts.every((receipt) =>
      connectionIds.includes(receipt.connectionId)
      && receipt.envelopeHash === envelopeHash
      && receipt.userId === input.userId
    )
      ? "exact"
      : "conflict";
  }

  private async prepareStoreOwnedDirtyPayloadRows(input: {
    connectionId: string;
    provider: string;
    resources?: readonly HostedDeviceSyncDirtyResource[];
    traceId?: string | null;
    userId: string;
  }): Promise<PreparedDirtyPayloadRows | undefined> {
    const resourceBatch = buildDirtyResourceBatch(input.resources ?? []);
    if (resourceBatch.payloadResources.length === 0) {
      return undefined;
    }

    const existing = await this.prisma.deviceSyncDirtyConnection.findUnique({
      where: {
        connectionId: input.connectionId,
      },
    });
    if (existing && existing.userId !== input.userId) {
      throw new TypeError("Dirty payload preparation owner did not match the dirty connection.");
    }

    return prepareDirtyPayloadRows({
      connectionId: input.connectionId,
      dirtyRevision: resolveDirtyPayloadRevision({
        existing,
        resourceBatch,
      }),
      provider: input.provider,
      resources: resourceBatch.payloadResources,
      traceId: input.traceId,
      userId: input.userId,
      prisma: this.prisma,
    });
  }

  async prepareDirtyConnectionUpsert(
    input: Omit<UpsertHostedDeviceSyncDirtyConnectionInput, "tx">,
  ): Promise<PreparedHostedDeviceSyncDirtyConnectionUpsert> {
    const resourceBatch = buildDirtyResourceBatch(input.resources ?? []);
    const existing = await this.prisma.deviceSyncDirtyConnection.findUnique({
      where: {
        connectionId: input.connectionId,
      },
    });
    if (existing && existing.userId !== input.userId) {
      throw new TypeError("Dirty connection preparation owner did not match the dirty connection.");
    }

    const dirtyRevision = resolveDirtyPayloadRevision({
      existing,
      resourceBatch,
    });
    const payloadCrypto = resourceBatch.payloadResources.length === 0
      ? undefined
      : await prepareHostedDeviceSyncDirtyPayloadCrypto({
          prisma: this.prisma,
          userId: input.userId,
        });
    const payloadRows = payloadCrypto
      ? await prepareDirtyPayloadRows({
          connectionId: input.connectionId,
          dirtyRevision,
          preparedCrypto: payloadCrypto,
          provider: input.provider,
          resources: resourceBatch.payloadResources,
          traceId: input.traceId,
          userId: input.userId,
        })
      : undefined;
    const preparedInput = Object.freeze({
      connectionId: input.connectionId,
      dirtyAt: input.dirtyAt,
      eventType: input.eventType,
      provider: input.provider,
      resourceCategory: input.resourceCategory,
      traceId: input.traceId,
      userId: input.userId,
    });
    const prepared = Object.freeze({
      connectionId: input.connectionId,
      dirtyRevision,
      provider: input.provider,
      shouldRequestWake: !existing
        || existing.processedRevision >= existing.dirtyRevision,
      userId: input.userId,
    });
    preparedHostedDeviceSyncDirtyConnectionUpserts.set(prepared, {
      dirtyRevision,
      input: preparedInput,
      payloadCrypto,
      payloadRows,
      resourceBatch,
      snapshot: createDirtyConnectionPreparationSnapshot(existing),
    });
    return prepared;
  }

  async upsertDirtyConnectionWithPreparedPlanTx(input: {
    prepared: PreparedHostedDeviceSyncDirtyConnectionUpsert;
    tx: HostedPrismaTransactionClient;
  }): Promise<UpsertHostedDeviceSyncDirtyConnectionResult> {
    const details = requirePreparedDirtyConnectionUpsert(input.prepared);
    if (
      input.prepared.connectionId !== details.input.connectionId
      || input.prepared.dirtyRevision !== details.dirtyRevision
      || input.prepared.provider !== details.input.provider
      || input.prepared.shouldRequestWake !== (
        !details.snapshot.exists
        || details.snapshot.processedRevision >= details.snapshot.dirtyRevision
      )
      || input.prepared.userId !== details.input.userId
    ) {
      throw new TypeError("Dirty connection prepared identity does not match its request.");
    }

    return this.upsertDirtyConnectionOnce({
      ...details.input,
      expectedPreparationSnapshot: details.snapshot,
      preparedPayloadCrypto: details.payloadCrypto,
      precomputedPayloadRows: details.payloadRows,
      resourceBatch: details.resourceBatch,
      tx: input.tx,
    });
  }

  async upsertDirtyConnection(
    input: UpsertHostedDeviceSyncDirtyConnectionInput,
  ): Promise<UpsertHostedDeviceSyncDirtyConnectionResult> {
    const resourceBatch = buildDirtyResourceBatch(input.resources ?? []);
    if (input.tx) {
      return this.upsertDirtyConnectionOnce({
        ...input,
        resourceBatch,
        tx: input.tx,
      });
    }

    for (let attempt = 0; attempt < DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS; attempt += 1) {
      try {
        const precomputedPayloadRows = await this.prepareStoreOwnedDirtyPayloadRows(input);

        return await this.prisma.$transaction((tx) =>
          this.upsertDirtyConnectionOnce({
            ...input,
            precomputedPayloadRows,
            resourceBatch,
            tx,
          }),
        );
      } catch (error) {
        if (
          !isDirtyStateContentionError(error)
          || attempt === DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS - 1
        ) {
          throw error;
        }

        await waitForDirtyStateRetry(attempt);
      }
    }

    throw createDirtyStateContentionError("update");
  }

  private async upsertDirtyConnectionOnce(
    input: UpsertHostedDeviceSyncDirtyConnectionInput & {
      expectedPreparationSnapshot?: DirtyConnectionPreparationSnapshot;
      preparedPayloadCrypto?: PreparedHostedDeviceSyncDirtyPayloadCrypto;
      precomputedPayloadRows?: PreparedDirtyPayloadRows;
      resourceBatch: DirtyResourceBatch;
      tx: HostedPrismaTransactionClient;
    },
  ): Promise<UpsertHostedDeviceSyncDirtyConnectionResult> {
    const prisma = input.tx;
    const dirtyAt = new Date(input.dirtyAt);

    let existing = await prisma.deviceSyncDirtyConnection.findUnique({
      where: {
        connectionId: input.connectionId,
      },
    });
    if (input.preparedPayloadCrypto) {
      try {
        await revalidatePreparedHostedDeviceSyncDirtyPayloadCryptoTx({
          prepared: input.preparedPayloadCrypto,
          tx: prisma,
        });
      } catch (error) {
        if (error instanceof HostedDomainRootPreparationMismatchError) {
          throw new HostedDeviceSyncDirtyPreparationMismatchError();
        }
        throw error;
      }
    }
    if (input.expectedPreparationSnapshot?.exists === true) {
      const locked = await lockDirtyConnectionForCompanionReceipt({
        connectionId: input.connectionId,
        tx: prisma,
      });
      if (!locked) {
        throw new HostedDeviceSyncDirtyPreparationMismatchError();
      }
      existing = await prisma.deviceSyncDirtyConnection.findUnique({
        where: {
          connectionId: input.connectionId,
        },
      });
    }
    if (
      input.expectedPreparationSnapshot
      && !dirtyConnectionMatchesPreparationSnapshot(
        existing,
        input.expectedPreparationSnapshot,
      )
    ) {
      throw new HostedDeviceSyncDirtyPreparationMismatchError();
    }
    const hasCompanionNightResource = input.resourceBatch.payloadResources.some(
      (resource) => readCompanionHrvDirtyResourceNightDate(resource) !== null,
    );
    let preparedDirtyPayloadRows = input.precomputedPayloadRows;
    if (
      input.resourceBatch.payloadResources.length > 0
      && !preparedDirtyPayloadRows
    ) {
      preparedDirtyPayloadRows = await prepareDirtyPayloadRows({
        connectionId: input.connectionId,
        dirtyRevision: resolveDirtyPayloadRevision({
          existing,
          resourceBatch: input.resourceBatch,
        }),
        provider: input.provider,
        resources: input.resourceBatch.payloadResources,
        traceId: input.traceId,
        userId: input.userId,
        prisma,
      });
    }
    if (
      hasCompanionNightResource
      && existing
      && input.expectedPreparationSnapshot?.exists !== true
    ) {
      // Companion replay receipts reference the parent connection. Lock the
      // dirty marker first so account deletion and ingress retain one lock
      // order without holding that lock during payload encryption.
      const locked = await lockDirtyConnectionForCompanionReceipt({
        connectionId: input.connectionId,
        tx: prisma,
      });
      if (!locked) {
        throw createDirtyStateContentionError("update");
      }
      existing = await prisma.deviceSyncDirtyConnection.findUnique({
        where: {
          connectionId: input.connectionId,
        },
      });
      if (
        !existing
        || preparedDirtyPayloadRows?.dirtyRevision !== resolveDirtyPayloadRevision({
          existing,
          resourceBatch: input.resourceBatch,
        })
      ) {
        throw createDirtyStateContentionError("update");
      }
    }
    const companionNightClaims = await claimCompanionHrvNightReceipts({
      claimedAt: dirtyAt,
      connectionId: input.connectionId,
      resources: input.resourceBatch.payloadResources,
      tx: prisma,
      userId: input.userId,
    });
    const resourceBatch = filterDirtyResourceBatch(
      input.resourceBatch,
      companionNightClaims,
    );
    const filteredPayloadRows = filterPreparedDirtyPayloadRows(
      preparedDirtyPayloadRows,
      companionNightClaims,
    );

    if (
      companionNightClaims.some((claimed) => !claimed)
      && Object.keys(resourceBatch.allResources).length === 0
    ) {
      if (!existing) {
        throw createDirtyStateContentionError("update");
      }
      return {
        dirty: mapDirtyConnectionRecord(existing),
        shouldRequestWake: false,
      };
    }

    if (!existing) {
      const counters = buildDirtyCounters(resourceBatch.allResources);
      const created = await prisma.deviceSyncDirtyConnection.createMany({
        data: {
          connectionId: input.connectionId,
          userId: input.userId,
          provider: input.provider,
          dirtyRevision: 1n,
          processedRevision: 0n,
          firstDirtyAt: dirtyAt,
          latestDirtyAt: dirtyAt,
          windowStart: resolveDirtyWindowStart(resourceBatch.allResources),
          windowEnd: resolveDirtyWindowEnd(resourceBatch.allResources),
          eventCount: 1n,
          latestTraceId: normalizeNullableString(input.traceId),
          latestEventType: normalizeNullableString(input.eventType),
          latestResourceCategory: normalizeNullableString(input.resourceCategory),
          sourceProviderCountsJson: toNullablePrismaJsonValue(counters.sourceProviderCounts),
          resourceCategoryCountsJson: toNullablePrismaJsonValue(counters.resourceCategoryCounts),
          dirtyResourcesJson: toNullablePrismaJsonValue(resourceBatch.compactResources),
        },
        skipDuplicates: true,
      });

      if (created.count === 0) {
        throw createDirtyStateContentionError("update");
      }

      const payloadCreateResult = await createDirtyPayloadRows({
        connectionId: input.connectionId,
        dirtyRevision: 1n,
        provider: input.provider,
        precomputed: filteredPayloadRows,
        resources: resourceBatch.payloadResources,
        traceId: input.traceId,
        tx: prisma,
        userId: input.userId,
      });

      const record = await prisma.deviceSyncDirtyConnection.findUnique({
        where: {
          connectionId: input.connectionId,
        },
      });
      if (!record) {
        throw createDirtyStateContentionError("update");
      }

      return {
        dirty: withDirtyPayloadResources(
          mapDirtyConnectionRecord(record),
          payloadCreateResult.resources,
        ),
        shouldRequestWake: true,
      };
    }

    const becameDirty = existing.processedRevision >= existing.dirtyRevision;
    if (
      !becameDirty
      && isPayloadOnlyDirtyAppend(resourceBatch)
    ) {
      const payloadCreateResult = await createDirtyPayloadRows({
        connectionId: input.connectionId,
        dirtyRevision: existing.dirtyRevision,
        provider: input.provider,
        precomputed: filteredPayloadRows,
        resources: resourceBatch.payloadResources,
        traceId: input.traceId,
        tx: prisma,
        userId: input.userId,
      });

      return {
        dirty: withDirtyPayloadResources(
          mapDirtyConnectionRecord(existing),
          payloadCreateResult.resources,
        ),
        shouldRequestWake: false,
      };
    }

    const priorResources = becameDirty ? {} : readDirtyResourcesJson(existing.dirtyResourcesJson);
    const resources = mergeDirtyResources(
      priorResources,
      Object.values(resourceBatch.compactResources),
    );
    const currentCounters = buildDirtyCounters(resourceBatch.allResources);
    const counters = becameDirty
      ? currentCounters
      : addDirtyCounters(
          {
            resourceCategoryCounts: readCounterJson(existing.resourceCategoryCountsJson),
            sourceProviderCounts: readCounterJson(existing.sourceProviderCountsJson),
          },
          currentCounters,
        );
    const dirtyWindowStart = resolveDirtyWindowStart(resourceBatch.allResources);
    const dirtyWindowEnd = resolveDirtyWindowEnd(resourceBatch.allResources);
    const nextDirtyRevision = existing.dirtyRevision + 1n;
    // Compression and encryption are the expensive preparation. Complete them
    // before taking the dirty-marker row lock, but keep the foreign-key-backed
    // payload insert after the compare-and-swap to preserve account-deletion
    // lock order.
    const payloadRowsForCreate = resourceBatch.payloadResources.length === 0
      ? undefined
      : filteredPayloadRows ?? (await prepareDirtyPayloadRows({
          connectionId: input.connectionId,
          dirtyRevision: nextDirtyRevision,
          provider: input.provider,
          resources: resourceBatch.payloadResources,
          traceId: input.traceId,
          userId: input.userId,
          prisma,
        }));
    if (
      payloadRowsForCreate
      && payloadRowsForCreate.dirtyRevision !== nextDirtyRevision
    ) {
      throw createDirtyStateContentionError("update");
    }
    const updated = await prisma.deviceSyncDirtyConnection.updateMany({
      where: {
        connectionId: input.connectionId,
        dirtyRevision: existing.dirtyRevision,
        processedRevision: existing.processedRevision,
      },
      data: {
        userId: input.userId,
        provider: input.provider,
        dirtyRevision: nextDirtyRevision,
        firstDirtyAt: becameDirty ? dirtyAt : existing.firstDirtyAt,
        latestDirtyAt: dirtyAt,
        windowStart: becameDirty ? dirtyWindowStart : minDate(existing.windowStart, dirtyWindowStart),
        windowEnd: becameDirty ? dirtyWindowEnd : maxDate(existing.windowEnd, dirtyWindowEnd),
        eventCount: existing.eventCount + 1n,
        latestTraceId: normalizeNullableString(input.traceId),
        latestEventType: normalizeNullableString(input.eventType),
        latestResourceCategory: normalizeNullableString(input.resourceCategory),
        sourceProviderCountsJson: toNullablePrismaJsonValue(counters.sourceProviderCounts),
        resourceCategoryCountsJson: toNullablePrismaJsonValue(counters.resourceCategoryCounts),
        dirtyResourcesJson: toNullablePrismaJsonValue(resources),
      },
    });

    if (updated.count === 0) {
      throw createDirtyStateContentionError("update");
    }

    const payloadCreateResult = await createDirtyPayloadRows({
      connectionId: input.connectionId,
      dirtyRevision: nextDirtyRevision,
      provider: input.provider,
      precomputed: payloadRowsForCreate,
      resources: resourceBatch.payloadResources,
      traceId: input.traceId,
      tx: prisma,
      userId: input.userId,
    });

    const record = await prisma.deviceSyncDirtyConnection.findUnique({
      where: {
        connectionId: input.connectionId,
      },
    });
    if (!record) {
      throw createDirtyStateContentionError("update");
    }

    return {
      dirty: withDirtyPayloadResources(
        mapDirtyConnectionRecord(record),
        payloadCreateResult.resources,
      ),
      shouldRequestWake: becameDirty,
    };
  }

  async getDirtyConnection(input: {
    connectionId: string;
    userId: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedDeviceSyncDirtyConnectionRecord | null> {
    const prisma = input.tx ?? this.prisma;
    const record = await prisma.deviceSyncDirtyConnection.findFirst({
      where: {
        connectionId: input.connectionId,
        userId: input.userId,
      },
    });

    return record
      ? hydrateDirtyConnectionRecord({
          prisma,
          record,
          userId: input.userId,
        })
      : null;
  }

  async hasPendingDirtyConnection(
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<boolean> {
    const prisma = tx ?? this.prisma;
    const rows = await prisma.$queryRaw<Array<{ pending: boolean }>>(Prisma.sql`
      select exists(
        select 1
        from "device_sync_dirty_connection" as "dirty"
        where "dirty"."connection_id" = ${connectionId}
          and (
            "dirty"."dirty_revision" > "dirty"."processed_revision"
            or exists(
              select 1
              from "device_sync_dirty_payload" as "payload"
              where "payload"."connection_id" = "dirty"."connection_id"
                and "payload"."user_id" = "dirty"."user_id"
            )
          )
      ) as "pending"
    `);

    return rows.some((row) => row.pending === true);
  }

  async shouldRequestWakeForDirtyConnectionUpsert(input: {
    connectionId: string;
    tx: HostedPrismaTransactionClient;
    userId: string;
  }): Promise<boolean> {
    const existing = await input.tx.deviceSyncDirtyConnection.findUnique({
      select: {
        dirtyRevision: true,
        processedRevision: true,
        userId: true,
      },
      where: {
        connectionId: input.connectionId,
      },
    });
    if (existing && existing.userId !== input.userId) {
      throw new TypeError("Dirty connection wake inspection owner did not match the connection.");
    }

    return !existing || existing.processedRevision >= existing.dirtyRevision;
  }

  async hasPendingDirtyConnectionForUser(
    userId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<boolean> {
    const prisma = tx ?? this.prisma;
    const rows = await prisma.$queryRaw<Array<{ pending: boolean }>>(Prisma.sql`
      select exists(
        select 1
        from "device_sync_dirty_connection" as "dirty"
        where "dirty"."user_id" = ${userId}
          and (
            "dirty"."dirty_revision" > "dirty"."processed_revision"
            or exists(
              select 1
              from "device_sync_dirty_payload" as "payload"
              where "payload"."connection_id" = "dirty"."connection_id"
                and "payload"."user_id" = "dirty"."user_id"
            )
          )
      ) as "pending"
    `);

    return rows.some((row) => row.pending === true);
  }

  async listPendingDirtyConnectionsForUser(input: {
    limit: number;
    stagedDirtyAcks?: readonly HostedExecutionDeviceSyncStagedDirtyAck[];
    userId: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<{
    hasMore: boolean;
    items: HostedDeviceSyncDirtyConnectionRecord[];
  }> {
    const prisma = input.tx ?? this.prisma;
    const limit = Math.max(1, Math.min(input.limit, 50));
    const stagedOverlay = buildStagedDirtyAckOverlay(input.stagedDirtyAcks ?? []);
    const candidateLimit = Math.max(
      limit,
      Math.min(limit + stagedOverlay.size, 250),
    );
    const rows = await prisma.$queryRaw<Array<{ connection_id: string }>>(Prisma.sql`
      select "connection_id"
      from "device_sync_dirty_connection"
      where "user_id" = ${input.userId}
        and (
          "dirty_revision" > "processed_revision"
          or exists(
            select 1
            from "device_sync_dirty_payload" as "payload"
            where "payload"."connection_id" = "device_sync_dirty_connection"."connection_id"
              and "payload"."user_id" = "device_sync_dirty_connection"."user_id"
          )
        )
      order by "first_dirty_at" asc, "connection_id" asc
      limit ${candidateLimit + 1}
    `);
    const selectedIds = rows.slice(0, candidateLimit).map((row) => row.connection_id);
    if (selectedIds.length === 0) {
      return {
        hasMore: false,
        items: [],
      };
    }

    const records = await prisma.deviceSyncDirtyConnection.findMany({
      where: {
        connectionId: {
          in: selectedIds,
        },
        userId: input.userId,
      },
    });
    const recordById = new Map(records.map((record) => [record.connectionId, record]));

    const selectedRecords = selectedIds
      .map((id) => recordById.get(id) ?? null)
      .filter((record): record is DeviceSyncDirtyConnectionPrismaRecord => record !== null);

    const hydrated = await hydrateDirtyConnectionRecords({
      budget: createDirtyPayloadHydrationBudget(),
      prisma,
      records: selectedRecords,
      stagedOverlay,
      userId: input.userId,
    });
    const items = hydrated.items.slice(0, limit);

    return {
      hasMore: rows.length > candidateLimit
        || hydrated.hasMorePayloads
        || hydrated.items.length > limit,
      items,
    };
  }

  async markDirtyConnectionProcessed(input: {
    connectionId: string;
    processedDirtyPayloadIds?: readonly string[];
    processedRevision: bigint;
    userId: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedDeviceSyncDirtyConnectionAckRecord | null> {
    if (input.tx) {
      return this.markDirtyConnectionProcessedOnce({
        ...input,
        tx: input.tx,
      });
    }

    for (let attempt = 0; attempt < DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction((tx) =>
          this.markDirtyConnectionProcessedOnce({
            ...input,
            tx,
          }),
        );
      } catch (error) {
        if (
          !isDirtyStateContentionError(error)
          || attempt === DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS - 1
        ) {
          throw error;
        }

        await waitForDirtyStateRetry(attempt);
      }
    }

    throw createDirtyStateContentionError("ack");
  }

  private async markDirtyConnectionProcessedOnce(input: {
    connectionId: string;
    processedDirtyPayloadIds?: readonly string[];
    processedRevision: bigint;
    userId: string;
    tx: HostedPrismaTransactionClient;
  }): Promise<HostedDeviceSyncDirtyConnectionAckRecord | null> {
    const prisma = input.tx;
    const existing = await prisma.deviceSyncDirtyConnection.findFirst({
      where: {
        connectionId: input.connectionId,
        userId: input.userId,
      },
    });

    if (!existing) {
      return null;
    }

    const requestedProcessedRevision =
      input.processedRevision > existing.processedRevision
        ? input.processedRevision
        : existing.processedRevision;
    const nextProcessedRevision =
      requestedProcessedRevision > existing.dirtyRevision
        ? existing.dirtyRevision
        : requestedProcessedRevision;
    const fullyProcessed = nextProcessedRevision >= existing.dirtyRevision;
    const updated = await prisma.deviceSyncDirtyConnection.updateMany({
      where: {
        connectionId: input.connectionId,
        dirtyRevision: existing.dirtyRevision,
        processedRevision: existing.processedRevision,
        userId: input.userId,
      },
      data: {
        processedRevision: nextProcessedRevision,
        ...(fullyProcessed
          ? {
              dirtyResourcesJson: toNullablePrismaJsonValue({}),
              firstDirtyAt: existing.latestDirtyAt,
              resourceCategoryCountsJson: toNullablePrismaJsonValue({}),
              sourceProviderCountsJson: toNullablePrismaJsonValue({}),
              windowEnd: null,
              windowStart: null,
            }
          : {}),
      },
    });

    if (updated.count === 0) {
      throw createDirtyStateContentionError("ack");
    }

    if (input.processedDirtyPayloadIds !== undefined) {
      const processedDirtyPayloadIds = [...new Set(input.processedDirtyPayloadIds)]
        .filter((id) => normalizeNullableString(id));
      if (processedDirtyPayloadIds.length > 0) {
        await prisma.deviceSyncDirtyPayload.deleteMany({
          where: {
            connectionId: input.connectionId,
            id: {
              in: processedDirtyPayloadIds,
            },
            userId: input.userId,
          },
        });
      }
    }

    const stillDirty = nextProcessedRevision < existing.dirtyRevision
      || await hasPendingDirtyPayloadForConnection({
        connectionId: input.connectionId,
        tx: prisma,
        userId: input.userId,
      });

    return {
      connectionId: input.connectionId,
      dirtyRevision: existing.dirtyRevision,
      processedRevision: nextProcessedRevision,
      stillDirty,
      userId: input.userId,
    };
  }
}

function createDirtyStateContentionError(operation: "ack" | "update"): Error {
  return deviceSyncError({
    code: HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION_CODE,
    httpStatus: 503,
    message:
      operation === "ack"
        ? "Hosted device-sync dirty state was updated concurrently while marking work processed. Retry the request."
        : "Hosted device-sync dirty state was updated concurrently. Retry the request.",
    retryable: true,
  });
}

function createDirtyPayloadClassificationPendingError(): Error {
  return deviceSyncError({
    code: HOSTED_DEVICE_SYNC_DIRTY_PAYLOAD_CLASSIFICATION_PENDING_CODE,
    httpStatus: 503,
    message:
      "Hosted device-sync payload classification did not converge before reconnect. Retry the request.",
    retryable: true,
  });
}

function isDirtyStateContentionError(error: unknown): boolean {
  return Boolean(
    typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION_CODE,
  );
}

async function waitForDirtyStateRetry(attempt: number): Promise<void> {
  const delayMs = Math.min(25, 2 + attempt * 2 + Math.floor(Math.random() * 3));
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function hasPendingDirtyPayloadForConnection(input: {
  connectionId: string;
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<boolean> {
  const rows = await input.tx.$queryRaw<Array<{ pending: boolean }>>(Prisma.sql`
    select exists(
      select 1
      from "device_sync_dirty_payload" as "payload"
      where "payload"."connection_id" = ${input.connectionId}
        and "payload"."user_id" = ${input.userId}
    ) as "pending"
  `);

  return rows.some((row) => row.pending === true);
}

async function createDirtyPayloadRows(input: {
  connectionId: string;
  dirtyRevision: bigint;
  precomputed?: PreparedDirtyPayloadRows;
  provider: string;
  resources: readonly HostedDeviceSyncDirtyResource[];
  traceId?: string | null;
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<DirtyPayloadCreateResult> {
  if (input.resources.length === 0) {
    return {
      resources: [],
    };
  }

  const prepared = input.precomputed ?? (await prepareDirtyPayloadRows({
    connectionId: input.connectionId,
    dirtyRevision: input.dirtyRevision,
    provider: input.provider,
    resources: input.resources,
    traceId: input.traceId,
    userId: input.userId,
    prisma: input.tx,
  }));
  if (prepared.dirtyRevision !== input.dirtyRevision) {
    throw createDirtyStateContentionError("update");
  }

  await input.tx.deviceSyncDirtyPayload.createMany({
    data: prepared.rows,
    skipDuplicates: true,
  });

  return {
    resources: prepared.resources,
  };
}

async function prepareDirtyPayloadRows(input: {
  connectionId: string;
  dirtyRevision: bigint;
  preparedCrypto?: PreparedHostedDeviceSyncDirtyPayloadCrypto;
  prisma?: HostedPrismaTransactionClient | PrismaClient;
  provider: string;
  resources: readonly HostedDeviceSyncDirtyResource[];
  traceId?: string | null;
  userId: string;
}): Promise<PreparedDirtyPayloadRows> {
  if (Boolean(input.preparedCrypto) === Boolean(input.prisma)) {
    throw new TypeError(
      "Dirty payload preparation requires exactly one crypto preparation owner.",
    );
  }
  const classifyResource = createDirtyPayloadCredentialClassifier();
  const prepared = await mapLimit(input.resources, DIRTY_PAYLOAD_PRESEAL_CONCURRENCY, async (resource, index) => {
    const payloadId = createDirtyPayloadId({
      connectionId: input.connectionId,
      dirtyRevision: input.dirtyRevision,
      index,
      resource,
      traceId: input.traceId,
    });
    const resourceWithPayloadId = {
      ...resource,
      dirtyPayloadId: payloadId,
    };

    return {
      resource: resourceWithPayloadId,
      row: {
        connectionId: input.connectionId,
        credentialIndependent: await classifyResource({
          provider: input.provider,
          resource: resourceWithPayloadId,
        }),
        dirtyRevision: input.dirtyRevision,
        id: payloadId,
        provider: input.provider,
        resourceEncrypted: input.preparedCrypto
          ? await sealHostedDeviceSyncDirtyPayloadJsonFromPreparedCrypto({
              connectionId: input.connectionId,
              dirtyRevision: input.dirtyRevision,
              payloadId,
              prepared: input.preparedCrypto,
              provider: input.provider,
              userId: input.userId,
              value: resourceWithPayloadId,
            })
          : await sealHostedDeviceSyncDirtyPayloadJson({
              connectionId: input.connectionId,
              dirtyRevision: input.dirtyRevision,
              payloadId,
              prisma: input.prisma,
              provider: input.provider,
              userId: input.userId,
              value: resourceWithPayloadId,
            }),
        userId: input.userId,
      },
    };
  });

  return {
    dirtyRevision: input.dirtyRevision,
    resources: prepared.map((entry) => entry.resource),
    rows: prepared.map((entry) => entry.row),
  };
}

function createDirtyPayloadCredentialClassifier(): (input: {
  provider: string;
  resource: HostedDeviceSyncDirtyResource;
}) => Promise<boolean> {
  let junctionClassifierPromise:
    | Promise<DeviceSyncCredentialIndependentImportJobClassifier>
    | null = null;

  return async (input) => {
    const classifierInput = {
      kind: input.resource.jobKind,
      payload: input.resource.payload,
      provider: input.provider,
    };
    if (isDeviceSyncCredentialIndependentImportJob(classifierInput)) {
      return true;
    }
    if (input.provider !== "junction" || input.resource.jobKind !== "resource") {
      return false;
    }

    junctionClassifierPromise ??= import(
      "@murphai/device-syncd/junction-inline-authority"
    ).then((module) => module.isJunctionCredentialIndependentInlineImportJob);
    return isDeviceSyncCredentialIndependentImportJob(
      classifierInput,
      await junctionClassifierPromise,
    );
  };
}

async function mapLimit<TInput, TOutput>(
  values: readonly TInput[],
  limit: number,
  mapValue: (value: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const results = new Array<TOutput>(values.length);
  let failed = false;
  let firstError: unknown = null;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (!failed && nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapValue(values[index]!, index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  }

  const workerCount = Math.min(normalizedLimit, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failed) {
    throw firstError;
  }
  return results;
}

function resolveDirtyPayloadRevision(input: {
  existing: DeviceSyncDirtyConnectionPrismaRecord | null;
  resourceBatch: DirtyResourceBatch;
}): bigint {
  if (!input.existing) {
    return 1n;
  }

  if (
    input.existing.processedRevision < input.existing.dirtyRevision
    && isPayloadOnlyDirtyAppend(input.resourceBatch)
  ) {
    return input.existing.dirtyRevision;
  }

  return input.existing.dirtyRevision + 1n;
}

function createDirtyConnectionPreparationSnapshot(
  existing: DeviceSyncDirtyConnectionPrismaRecord | null,
): DirtyConnectionPreparationSnapshot {
  if (!existing) {
    return { exists: false };
  }
  return {
    dirtyRevision: existing.dirtyRevision,
    exists: true,
    processedRevision: existing.processedRevision,
    provider: existing.provider,
    updatedAt: existing.updatedAt.toISOString(),
    userId: existing.userId,
  };
}

function dirtyConnectionMatchesPreparationSnapshot(
  existing: DeviceSyncDirtyConnectionPrismaRecord | null,
  snapshot: DirtyConnectionPreparationSnapshot,
): boolean {
  if (!snapshot.exists) {
    return existing === null;
  }
  return existing !== null
    && existing.dirtyRevision === snapshot.dirtyRevision
    && existing.processedRevision === snapshot.processedRevision
    && existing.provider === snapshot.provider
    && existing.updatedAt.toISOString() === snapshot.updatedAt
    && existing.userId === snapshot.userId;
}

function requirePreparedDirtyConnectionUpsert(
  prepared: PreparedHostedDeviceSyncDirtyConnectionUpsert,
): PreparedHostedDeviceSyncDirtyConnectionUpsertDetails {
  if (!prepared || typeof prepared !== "object") {
    throw new TypeError("Dirty connection update requires prepared state.");
  }
  const details = preparedHostedDeviceSyncDirtyConnectionUpserts.get(prepared);
  if (!details) {
    throw new TypeError(
      "Dirty connection prepared state is not the exact request-local capability.",
    );
  }
  return details;
}

function isPayloadOnlyDirtyAppend(resourceBatch: DirtyResourceBatch): boolean {
  return Object.keys(resourceBatch.compactResources).length === 0
    && resourceBatch.payloadResources.length > 0;
}

function createDirtyPayloadId(input: {
  connectionId: string;
  dirtyRevision: bigint;
  index: number;
  resource: HostedDeviceSyncDirtyResource;
  traceId?: string | null;
}): string {
  if (input.resource.payload?.resource === COMPANION_HRV_RMSSD_RESOURCE) {
    const companionAdmissionId = readCompanionHrvDirtyResourceAdmissionId(input.resource);
    return `dsp_${sha256Hex([
      input.connectionId,
      COMPANION_HRV_RMSSD_RESOURCE,
      companionAdmissionId,
    ].join("\0")).slice(0, 40)}`;
  }

  const identity = [
    input.connectionId,
    input.dirtyRevision.toString(),
    normalizeNullableString(input.traceId) ?? "trace",
    String(input.index),
    buildDirtyResourceKey(input.resource),
    serializeHostedExecutionDeviceSyncDirtyPayloadIdentity(input.resource.payload),
  ].join("\0");

  return `dsp_${sha256Hex(identity).slice(0, 40)}`;
}

async function lockDirtyConnectionForCompanionReceipt(input: {
  connectionId: string;
  tx: HostedPrismaTransactionClient;
}): Promise<boolean> {
  const rows = await input.tx.$queryRaw<Array<{ connectionId: string }>>(Prisma.sql`
    SELECT connection_id AS "connectionId"
    FROM device_sync_dirty_connection
    WHERE connection_id = ${input.connectionId}
    FOR UPDATE
  `);
  return rows.length === 1;
}

async function claimCompanionHrvNightReceipts(input: {
  claimedAt: Date;
  connectionId: string;
  resources: readonly HostedDeviceSyncDirtyResource[];
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<boolean[]> {
  const nightDates = input.resources.map(readCompanionHrvDirtyResourceNightDate);
  if (nightDates.every((nightDate) => nightDate === null)) {
    return input.resources.map(() => true);
  }

  const cutoff = new Date(
    input.claimedAt.getTime() - COMPANION_HRV_NIGHT_RECEIPT_RETENTION_MS,
  );
  await input.tx.deviceSyncCompanionCaptureReceipt.deleteMany({
    where: {
      connectionId: input.connectionId,
      createdAt: { lt: cutoff },
      userId: input.userId,
    },
  });
  let retainedReceiptCount = await input.tx.deviceSyncCompanionCaptureReceipt.count({
    where: {
      connectionId: input.connectionId,
      createdAt: { gte: cutoff },
      userId: input.userId,
    },
  });
  const claims: boolean[] = [];

  for (const [index, resource] of input.resources.entries()) {
    const nightDate = nightDates[index] ?? null;
    if (!nightDate) {
      claims.push(true);
      continue;
    }

    const receiptId = createCompanionHrvNightReceiptId({
      connectionId: input.connectionId,
      nightDate,
    });
    const envelopeHash = sha256Hex(buildStrictDirtyResourceIdentity(resource));
    const existingReceipt = await input.tx.deviceSyncCompanionCaptureReceipt.findUnique({
      select: {
        connectionId: true,
        envelopeHash: true,
        userId: true,
      },
      where: { id: receiptId },
    });
    if (existingReceipt) {
      if (
        existingReceipt.connectionId !== input.connectionId
        || existingReceipt.envelopeHash !== envelopeHash
        || existingReceipt.userId !== input.userId
      ) {
        throw createCompanionHrvNightConflictError();
      }
      claims.push(false);
      continue;
    }
    if (retainedReceiptCount >= COMPANION_HRV_NIGHT_RECEIPT_MAX_PER_CONNECTION) {
      throw createCompanionHrvNightReceiptCapacityError();
    }

    const created = await input.tx.deviceSyncCompanionCaptureReceipt.createMany({
      data: {
        connectionId: input.connectionId,
        createdAt: input.claimedAt,
        envelopeHash,
        id: receiptId,
        userId: input.userId,
      },
      skipDuplicates: true,
    });
    const receipt = created.count === 1
      ? {
          connectionId: input.connectionId,
          envelopeHash,
          userId: input.userId,
        }
      : await input.tx.deviceSyncCompanionCaptureReceipt.findUnique({
          select: {
            connectionId: true,
            envelopeHash: true,
            userId: true,
          },
          where: { id: receiptId },
        });
    if (
      !receipt
      || receipt.connectionId !== input.connectionId
      || receipt.envelopeHash !== envelopeHash
      || receipt.userId !== input.userId
    ) {
      throw createCompanionHrvNightConflictError();
    }

    if (created.count === 1) {
      retainedReceiptCount += 1;
    }
    claims.push(created.count === 1);
  }

  return claims;
}

function filterPreparedDirtyPayloadRows(
  prepared: PreparedDirtyPayloadRows | undefined,
  claims: readonly boolean[],
): PreparedDirtyPayloadRows | undefined {
  if (!prepared) {
    return undefined;
  }
  if (prepared.rows.length !== claims.length || prepared.resources.length !== claims.length) {
    throw createDirtyStateContentionError("update");
  }

  return {
    dirtyRevision: prepared.dirtyRevision,
    resources: prepared.resources.filter((_resource, index) => claims[index] === true),
    rows: prepared.rows.filter((_row, index) => claims[index] === true),
  };
}

function filterDirtyResourceBatch(
  batch: DirtyResourceBatch,
  payloadClaims: readonly boolean[],
): DirtyResourceBatch {
  if (batch.payloadResources.length !== payloadClaims.length) {
    throw createDirtyStateContentionError("update");
  }

  const payloadResources = batch.payloadResources.filter(
    (_resource, index) => payloadClaims[index] === true,
  );
  const allResources = mergeDirtyResources(
    batch.compactResources,
    payloadResources,
  );
  return {
    allResources,
    compactResources: batch.compactResources,
    payloadResources,
  };
}

function createCompanionHrvNightReceiptId(input: {
  connectionId: string;
  nightDate: string;
}): string {
  return `dscr_${sha256Hex([
    input.connectionId,
    COMPANION_HRV_RMSSD_RESOURCE,
    input.nightDate,
  ].join("\0")).slice(0, 40)}`;
}

function createCompanionHrvNightConflictError(): Error {
  return deviceSyncError({
    code: "COMPANION_HRV_NIGHT_CONFLICT",
    message: "A different overnight HRV summary was already accepted for this night.",
    retryable: false,
    httpStatus: 409,
  });
}

function createCompanionHrvNightReceiptCapacityError(): Error {
  return deviceSyncError({
    code: "COMPANION_HRV_NIGHT_RECEIPT_CAPACITY_REACHED",
    message: "Companion HRV replay receipts are at capacity. Retry after older receipts expire.",
    retryable: true,
    httpStatus: 429,
  });
}

function createCompanionHrvResourceInvalidError(): Error {
  return deviceSyncError({
    code: "COMPANION_HRV_RESOURCE_INVALID",
    message: "Companion HRV ingestion could not build a runtime resource.",
    retryable: false,
    httpStatus: 400,
  });
}

function resolveCompanionHrvNightReceiptCutoff(now: string): Date {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    throw createCompanionHrvResourceInvalidError();
  }
  return new Date(nowMs - COMPANION_HRV_NIGHT_RECEIPT_RETENTION_MS);
}

function readCompanionHrvDirtyResourceNightDate(
  resource: HostedDeviceSyncDirtyResource,
): string | null {
  if (resource.payload?.resource !== COMPANION_HRV_RMSSD_RESOURCE) {
    return null;
  }

  try {
    return parseSerializedCompanionHrvRmssdObservation(
      resource.payload.companionObservationJson,
    ).nightDate;
  } catch {
    return null;
  }
}

function readCompanionHrvDirtyResourceAdmissionId(
  resource: HostedDeviceSyncDirtyResource,
): string {
  try {
    const observation = parseSerializedCompanionHrvRmssdObservation(
      resource.payload?.companionObservationJson,
    );
    const admissionId = parseCompanionHrvRmssdAdmissionId(
      resource.payload?.companionAdmissionId,
    );
    if (
      sha256Hex(serializeCompanionHrvRmssdObservation(observation))
      !== admissionId
    ) {
      throw new TypeError("Companion HRV admission identity did not match its observation.");
    }
    return admissionId;
  } catch {
    throw createCompanionHrvResourceInvalidError();
  }
}

function buildStrictDirtyResourceIdentity(resource: HostedDeviceSyncDirtyResource): string {
  return JSON.stringify([
    resource.count,
    resource.jobKind,
    resource.resource,
    resource.resourceCategory,
    resource.sourceProviderSlug,
    resource.windowEnd,
    resource.windowStart,
    serializeHostedExecutionDeviceSyncDirtyPayloadIdentity(resource.payload),
  ]);
}

async function hydrateDirtyConnectionRecord(input: {
  prisma: HostedPrismaTransactionClient | PrismaClient;
  record: DeviceSyncDirtyConnectionPrismaRecord;
  userId: string;
}): Promise<HostedDeviceSyncDirtyConnectionRecord> {
  const hydrated = await hydrateDirtyConnectionRecords({
    prisma: input.prisma,
    records: [input.record],
    userId: input.userId,
  });

  return hydrated.items[0] ?? mapDirtyConnectionRecord(input.record);
}

async function hydrateDirtyConnectionRecords(input: {
  budget?: DirtyPayloadHydrationBudget;
  prisma: HostedPrismaTransactionClient | PrismaClient;
  records: readonly DeviceSyncDirtyConnectionPrismaRecord[];
  stagedOverlay?: StagedDirtyAckOverlay;
  userId: string;
}): Promise<DirtyConnectionHydrationResult> {
  if (input.records.length === 0) {
    return {
      hasMorePayloads: false,
      items: [],
    };
  }

  let hasMorePayloads = false;
  const hydratedRecords: DeviceSyncDirtyConnectionPrismaRecord[] = [];
  const payloadsByConnectionId = new Map<string, HostedDeviceSyncDirtyResource[]>();

  for (const dirty of input.records) {
    const overlayEntry = input.stagedOverlay?.get(dirty.connectionId) ?? null;
    const effectiveProcessedRevision = resolveStagedDirtyAckProcessedRevision({
      dirty,
      overlayEntry,
    });
    const markerPending = dirty.dirtyRevision > effectiveProcessedRevision;
    if (input.budget?.exhausted) {
      hasMorePayloads = true;
      break;
    }
    const remainingPayloadSlots = resolveDirtyPayloadHydrationRemainingSlots(input.budget);
    if (remainingPayloadSlots <= 0) {
      hasMorePayloads = true;
      break;
    }
    const payloadRowLimit = Math.min(
      DIRTY_PAYLOAD_HYDRATE_LIMIT_PER_CONNECTION,
      remainingPayloadSlots,
    );
    const excludedPayloadIds = overlayEntry
      ? [...overlayEntry.processedDirtyPayloadIds]
      : [];
    const payloadRows = await input.prisma.deviceSyncDirtyPayload.findMany({
      orderBy: [
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: {
        connectionId: true,
        dirtyRevision: true,
        id: true,
        provider: true,
        resourceEncrypted: true,
      },
      take: payloadRowLimit + 1,
      where: {
        connectionId: dirty.connectionId,
        ...(excludedPayloadIds.length > 0
          ? {
              id: {
                notIn: excludedPayloadIds,
              },
            }
          : {}),
        userId: input.userId,
      },
    });

    if (payloadRows.length > payloadRowLimit) {
      hasMorePayloads = true;
    }

    const payloads: HostedDeviceSyncDirtyResource[] = [];
    for (const row of payloadRows.slice(0, payloadRowLimit)) {
      const resource = await readDirtyPayloadResourceJson({
        row,
        tx: input.prisma,
        userId: input.userId,
      });
      if (!resource) {
        continue;
      }
      if (
        input.budget
        && !tryReserveDirtyPayloadHydrationBudget(input.budget, resource)
      ) {
        hasMorePayloads = true;
        break;
      }

      payloads.push(resource);
    }

    if (payloadRows.length > 0 && payloads.length === 0 && !markerPending) {
      hasMorePayloads = true;
      break;
    }

    if (payloads.length > 0) {
      payloadsByConnectionId.set(dirty.connectionId, payloads);
    }
    if (markerPending || payloads.length > 0) {
      hydratedRecords.push(
        applyStagedDirtyAckMarkerOverlay({
          dirty,
          effectiveProcessedRevision,
          markerPending,
        }),
      );
    }
  }

  const items = hydratedRecords
    .map((record) =>
      withDirtyPayloadResources(
        mapDirtyConnectionRecord(record),
        payloadsByConnectionId.get(record.connectionId) ?? [],
      )
    );

  return {
    hasMorePayloads,
    items,
  };
}

function buildStagedDirtyAckOverlay(
  stagedDirtyAcks: readonly HostedExecutionDeviceSyncStagedDirtyAck[],
): StagedDirtyAckOverlay {
  const overlay: StagedDirtyAckOverlay = new Map();

  for (const ack of stagedDirtyAcks) {
    const connectionId = normalizeNullableString(ack.connectionId);
    if (!connectionId) {
      continue;
    }
    const entry = overlay.get(connectionId) ?? {
      processedDirtyPayloadIds: new Set<string>(),
      processedRevision: null,
    };
    const processedRevision = BigInt(ack.processedRevision);
    if (entry.processedRevision === null || processedRevision > entry.processedRevision) {
      entry.processedRevision = processedRevision;
    }
    for (const id of ack.processedDirtyPayloadIds ?? []) {
      const normalizedId = normalizeNullableString(id);
      if (normalizedId) {
        entry.processedDirtyPayloadIds.add(normalizedId);
      }
    }
    overlay.set(connectionId, entry);
  }

  return overlay;
}

function resolveStagedDirtyAckProcessedRevision(input: {
  dirty: DeviceSyncDirtyConnectionPrismaRecord;
  overlayEntry: StagedDirtyAckOverlayEntry | null;
}): bigint {
  const stagedRevision = input.overlayEntry?.processedRevision ?? null;
  if (stagedRevision === null || stagedRevision <= input.dirty.processedRevision) {
    return input.dirty.processedRevision;
  }
  return stagedRevision > input.dirty.dirtyRevision
    ? input.dirty.dirtyRevision
    : stagedRevision;
}

function applyStagedDirtyAckMarkerOverlay(input: {
  dirty: DeviceSyncDirtyConnectionPrismaRecord;
  effectiveProcessedRevision: bigint;
  markerPending: boolean;
}): DeviceSyncDirtyConnectionPrismaRecord {
  if (
    input.effectiveProcessedRevision === input.dirty.processedRevision
    && input.markerPending
  ) {
    return input.dirty;
  }

  return {
    ...input.dirty,
    processedRevision: input.effectiveProcessedRevision,
    ...(input.markerPending
      ? {}
      : {
          dirtyResourcesJson: {},
          resourceCategoryCountsJson: {},
          sourceProviderCountsJson: {},
          windowEnd: null,
          windowStart: null,
        }),
  };
}

function createDirtyPayloadHydrationBudget(): DirtyPayloadHydrationBudget {
  return {
    exhausted: false,
    maxEstimatedBytes: DIRTY_PAYLOAD_HYDRATE_RESPONSE_MAX_ESTIMATED_BYTES,
    maxResources: DIRTY_PAYLOAD_HYDRATE_LIMIT_PER_RESPONSE,
    usedEstimatedBytes: 0,
    usedResources: 0,
  };
}

function resolveDirtyPayloadHydrationRemainingSlots(
  budget: DirtyPayloadHydrationBudget | undefined,
): number {
  if (!budget) {
    return DIRTY_PAYLOAD_HYDRATE_LIMIT_PER_CONNECTION;
  }
  return Math.max(0, budget.maxResources - budget.usedResources);
}

function tryReserveDirtyPayloadHydrationBudget(
  budget: DirtyPayloadHydrationBudget,
  resource: HostedDeviceSyncDirtyResource,
): boolean {
  if (budget.usedResources >= budget.maxResources) {
    budget.exhausted = true;
    return false;
  }

  const estimatedBytes = estimateDirtyPayloadResourceResponseBytes(resource);
  if (
    budget.usedResources > 0
    && budget.usedEstimatedBytes + estimatedBytes > budget.maxEstimatedBytes
  ) {
    budget.exhausted = true;
    return false;
  }

  budget.usedResources += 1;
  budget.usedEstimatedBytes += estimatedBytes;
  return true;
}

function estimateDirtyPayloadResourceResponseBytes(
  resource: HostedDeviceSyncDirtyResource,
): number {
  return Buffer.byteLength(JSON.stringify(resource), "utf8");
}

export function mapDirtyConnectionRecord(
  record: DeviceSyncDirtyConnectionPrismaRecord,
): HostedDeviceSyncDirtyConnectionRecord {
  return {
    connectionId: record.connectionId,
    userId: record.userId,
    provider: record.provider,
    dirtyRevision: record.dirtyRevision,
    processedRevision: record.processedRevision,
    firstDirtyAt: record.firstDirtyAt.toISOString(),
    latestDirtyAt: record.latestDirtyAt.toISOString(),
    windowStart: record.windowStart?.toISOString() ?? null,
    windowEnd: record.windowEnd?.toISOString() ?? null,
    eventCount: record.eventCount,
    latestTraceId: record.latestTraceId,
    latestEventType: record.latestEventType,
    latestResourceCategory: record.latestResourceCategory,
    sourceProviderCounts: readCounterJson(record.sourceProviderCountsJson),
    resourceCategoryCounts: readCounterJson(record.resourceCategoryCountsJson),
    dirtyResources: readDirtyResourcesJson(record.dirtyResourcesJson),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  } satisfies HostedDeviceSyncDirtyConnectionRecord;
}

function withDirtyPayloadResources(
  record: HostedDeviceSyncDirtyConnectionRecord,
  payloadResources: readonly HostedDeviceSyncDirtyResource[],
): HostedDeviceSyncDirtyConnectionRecord {
  if (payloadResources.length === 0) {
    return record;
  }

  return {
    ...record,
    dirtyResources: mergeDirtyResources(record.dirtyResources, payloadResources),
  };
}

function buildDirtyResourceBatch(
  resources: readonly HostedDeviceSyncDirtyResource[],
): DirtyResourceBatch {
  const allResources: Record<string, HostedDeviceSyncDirtyResource> = {};
  const compactResources: Record<string, HostedDeviceSyncDirtyResource> = {};
  const payloadResources: HostedDeviceSyncDirtyResource[] = [];

  for (const resource of resources) {
    const normalized = withDirtyResourceWindowPayload(normalizeDirtyResource(resource));
    mergeDirtyResourceInto(allResources, normalized);

    if (hasHostedDeviceSyncDirtyResourcePayload(resource)) {
      payloadResources.push(normalized);
    } else {
      mergeDirtyResourceInto(compactResources, normalized);
    }
  }

  return {
    allResources,
    compactResources,
    payloadResources,
  };
}

function hasDirtyResourceInputPayload(value: unknown): boolean {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length > 0;
}

function mergeDirtyResources(
  existing: Record<string, HostedDeviceSyncDirtyResource>,
  updates: readonly HostedDeviceSyncDirtyResource[],
): Record<string, HostedDeviceSyncDirtyResource> {
  const merged: Record<string, HostedDeviceSyncDirtyResource> = {};

  for (const resource of Object.values(existing)) {
    mergeDirtyResourceInto(merged, resource);
  }
  for (const update of updates) {
    mergeDirtyResourceInto(merged, update);
  }

  return merged;
}

function mergeDirtyResourceInto(
  merged: Record<string, HostedDeviceSyncDirtyResource>,
  resource: HostedDeviceSyncDirtyResource,
): void {
  const normalized = normalizeDirtyResource(resource);
  const key = buildDirtyResourceKey(normalized);
  const previous = merged[key] ?? null;
  merged[key] = withDirtyResourceWindowPayload(previous
      ? {
        ...normalized,
        count: previous.count + normalized.count,
        ...mergeDirtyResourceTiming(previous, normalized),
        windowStart: minIso(previous.windowStart, normalized.windowStart),
        windowEnd: maxIso(previous.windowEnd, normalized.windowEnd),
      }
    : normalized);
}

function normalizeDirtyResource(
  resource: HostedDeviceSyncDirtyResource,
): HostedDeviceSyncDirtyResource {
  const eventToProviderSendBucket = resource.eventToProviderSendBucket ?? null;
  const firstWebhookReceivedAt = normalizeIso(resource.firstWebhookReceivedAt);
  const providerSendToWebhookMs = normalizeDurationMs(resource.providerSendToWebhookMs);
  return {
    count: Math.max(1, Math.min(1_000_000, Math.trunc(resource.count))),
    ...(resource.dirtyPayloadId
      ? { dirtyPayloadId: truncateDirtyKey(normalizeNullableString(resource.dirtyPayloadId)) ?? resource.dirtyPayloadId }
      : {}),
    ...(eventToProviderSendBucket || firstWebhookReceivedAt || providerSendToWebhookMs !== null
      ? {
          eventToProviderSendBucket,
          firstWebhookReceivedAt,
          providerSendToWebhookMs,
        }
      : {}),
    jobKind: truncateDirtyKey(normalizeNullableString(resource.jobKind) ?? "reconcile") ?? "reconcile",
    payload: readDirtyResourcePayload(resource.payload),
    resource: truncateDirtyKey(normalizeNullableString(resource.resource)),
    resourceCategory: truncateDirtyKey(normalizeNullableString(resource.resourceCategory)),
    sourceProviderSlug: truncateDirtyKey(normalizeNullableString(resource.sourceProviderSlug)),
    ...(resource.timingSourceProviderSlug === undefined
      ? {}
      : {
          timingSourceProviderSlug: truncateDirtyKey(
            normalizeNullableString(resource.timingSourceProviderSlug),
          ),
        }),
    windowEnd: normalizeIso(resource.windowEnd),
    windowStart: normalizeIso(resource.windowStart),
  };
}

function mergeDirtyResourceTiming(
  previous: HostedDeviceSyncDirtyResource,
  next: HostedDeviceSyncDirtyResource,
): Pick<
  HostedDeviceSyncDirtyResource,
  | "eventToProviderSendBucket"
  | "firstWebhookReceivedAt"
  | "providerSendToWebhookMs"
  | "timingSourceProviderSlug"
> | Record<string, never> {
  const eventToProviderSendBucket = mergeHostedDeviceSyncEventToProviderSendBuckets(
    previous.eventToProviderSendBucket,
    next.eventToProviderSendBucket,
  );
  const firstWebhookReceivedAt = minIso(
    previous.firstWebhookReceivedAt,
    next.firstWebhookReceivedAt,
  );
  const providerSendToWebhookMs = maxDurationMs(
    previous.providerSendToWebhookMs,
    next.providerSendToWebhookMs,
  );
  const timingSourceProviderSlug = mergeDirtyTimingSourceProviderSlug(
    previous.timingSourceProviderSlug,
    next.timingSourceProviderSlug,
  );
  const hasTiming = eventToProviderSendBucket
    || firstWebhookReceivedAt
    || providerSendToWebhookMs !== null
    || timingSourceProviderSlug !== undefined;
  return hasTiming
    ? {
        eventToProviderSendBucket,
        firstWebhookReceivedAt,
        providerSendToWebhookMs,
        ...(timingSourceProviderSlug === undefined ? {} : { timingSourceProviderSlug }),
      }
    : {};
}

function mergeDirtyTimingSourceProviderSlug(
  previous: string | null | undefined,
  next: string | null | undefined,
): string | null | undefined {
  if (previous === undefined && next === undefined) {
    return undefined;
  }
  return previous === next ? previous : null;
}

function buildDirtyResourceKey(resource: HostedDeviceSyncDirtyResource): string {
  return [
    resource.dirtyPayloadId ?? "marker",
    buildDirtyResourcePayloadKey(resource.payload),
    resource.sourceProviderSlug ?? "provider",
    resource.resourceCategory ?? "category",
    resource.resource ?? resource.jobKind,
  ].join(":").slice(0, DIRTY_RESOURCE_KEY_MAX_LENGTH);
}

function buildDirtyCounters(resources: Record<string, HostedDeviceSyncDirtyResource>): {
  resourceCategoryCounts: Record<string, number>;
  sourceProviderCounts: Record<string, number>;
} {
  const resourceCategoryCounts: Record<string, number> = {};
  const sourceProviderCounts: Record<string, number> = {};

  for (const resource of Object.values(resources)) {
    incrementCounter(sourceProviderCounts, resource.sourceProviderSlug ?? "unknown", resource.count);
    incrementCounter(resourceCategoryCounts, resource.resourceCategory ?? resource.jobKind, resource.count);
  }

  return {
    resourceCategoryCounts,
    sourceProviderCounts,
  };
}

function addDirtyCounters(
  existing: ReturnType<typeof buildDirtyCounters>,
  updates: ReturnType<typeof buildDirtyCounters>,
): ReturnType<typeof buildDirtyCounters> {
  const sourceProviderCounts = { ...existing.sourceProviderCounts };
  const resourceCategoryCounts = { ...existing.resourceCategoryCounts };

  for (const [key, value] of Object.entries(updates.sourceProviderCounts)) {
    incrementCounter(sourceProviderCounts, key, value);
  }
  for (const [key, value] of Object.entries(updates.resourceCategoryCounts)) {
    incrementCounter(resourceCategoryCounts, key, value);
  }

  return {
    resourceCategoryCounts,
    sourceProviderCounts,
  };
}

function incrementCounter(
  counters: Record<string, number>,
  rawKey: string,
  increment: number,
): void {
  const key = truncateDirtyKey(rawKey) ?? "unknown";
  counters[key] = (counters[key] ?? 0) + increment;
}

function readDirtyResourcesJson(value: Prisma.JsonValue): Record<string, HostedDeviceSyncDirtyResource> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const next: Record<string, HostedDeviceSyncDirtyResource> = {};
  for (const entry of Object.values(value)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    mergeDirtyResourceInto(next, {
      count: typeof record.count === "number" ? record.count : 1,
      ...(typeof record.dirtyPayloadId === "string" ? { dirtyPayloadId: record.dirtyPayloadId } : {}),
      eventToProviderSendBucket: isHostedDeviceSyncEventToProviderSendBucket(
        record.eventToProviderSendBucket,
      )
        ? record.eventToProviderSendBucket
        : null,
      firstWebhookReceivedAt: typeof record.firstWebhookReceivedAt === "string"
        ? record.firstWebhookReceivedAt
        : null,
      providerSendToWebhookMs: normalizeDurationMs(record.providerSendToWebhookMs),
      jobKind: typeof record.jobKind === "string" ? record.jobKind : "reconcile",
      payload: readDirtyResourcePayload(record.payload),
      resource: typeof record.resource === "string" ? record.resource : null,
      resourceCategory: typeof record.resourceCategory === "string" ? record.resourceCategory : null,
      sourceProviderSlug: typeof record.sourceProviderSlug === "string" ? record.sourceProviderSlug : null,
      ...(record.timingSourceProviderSlug === undefined
        ? {}
        : {
            timingSourceProviderSlug: typeof record.timingSourceProviderSlug === "string"
              ? record.timingSourceProviderSlug
              : null,
          }),
      windowEnd: typeof record.windowEnd === "string" ? record.windowEnd : null,
      windowStart: typeof record.windowStart === "string" ? record.windowStart : null,
    });
  }

  return next;
}

async function readDirtyPayloadResourceJson(input: {
  row: DeviceSyncDirtyPayloadPrismaRecord;
  tx: HostedPrismaTransactionClient | PrismaClient;
  userId: string;
}): Promise<HostedDeviceSyncDirtyResource | null> {
  const value = await openHostedDeviceSyncDirtyPayloadJson({
    connectionId: input.row.connectionId,
    dirtyRevision: input.row.dirtyRevision,
    payloadId: input.row.id,
    prisma: input.tx,
    provider: input.row.provider,
    userId: input.userId,
    value: input.row.resourceEncrypted,
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const merged: Record<string, HostedDeviceSyncDirtyResource> = {};
  mergeDirtyResourceInto(merged, {
    count: typeof record.count === "number" ? record.count : 1,
    dirtyPayloadId: input.row.id,
    eventToProviderSendBucket: isHostedDeviceSyncEventToProviderSendBucket(
      record.eventToProviderSendBucket,
    )
      ? record.eventToProviderSendBucket
      : null,
    firstWebhookReceivedAt: typeof record.firstWebhookReceivedAt === "string"
      ? record.firstWebhookReceivedAt
      : null,
    providerSendToWebhookMs: normalizeDurationMs(record.providerSendToWebhookMs),
    jobKind: typeof record.jobKind === "string" ? record.jobKind : "reconcile",
    payload: readDirtyResourcePayload(record.payload),
    resource: typeof record.resource === "string" ? record.resource : null,
    resourceCategory: typeof record.resourceCategory === "string" ? record.resourceCategory : null,
    sourceProviderSlug: typeof record.sourceProviderSlug === "string" ? record.sourceProviderSlug : null,
    ...(record.timingSourceProviderSlug === undefined
      ? {}
      : {
          timingSourceProviderSlug: typeof record.timingSourceProviderSlug === "string"
            ? record.timingSourceProviderSlug
            : null,
        }),
    windowEnd: typeof record.windowEnd === "string" ? record.windowEnd : null,
    windowStart: typeof record.windowStart === "string" ? record.windowStart : null,
  });

  return Object.values(merged)[0] ?? null;
}

function withDirtyResourceWindowPayload(
  resource: HostedDeviceSyncDirtyResource,
): HostedDeviceSyncDirtyResource {
  const payload = resource.payload;
  if (!payload) {
    return resource;
  }

  return {
    ...resource,
    payload: readDirtyResourcePayload({
      ...payload,
      ...(resource.windowEnd ? { windowEnd: resource.windowEnd } : {}),
      ...(resource.windowStart ? { windowStart: resource.windowStart } : {}),
    }),
  };
}

function readDirtyResourcePayload(value: unknown): HostedDeviceSyncDirtyResource["payload"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const payload: Record<string, boolean | number | string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = truncateDirtyKey(normalizeNullableString(key));
    if (!normalizedKey) {
      continue;
    }
    if (DIRTY_RESOURCE_PAYLOAD_BLOCKED_KEY_PATTERN.test(normalizedKey.replace(/[^a-z0-9]/giu, ""))) {
      continue;
    }
    if (typeof entry === "string") {
      const normalizedEntry = normalizeDirtyResourcePayloadString(normalizedKey, entry);
      if (normalizedEntry === null) {
        continue;
      }
      payload[normalizedKey] = normalizedEntry;
    } else if (typeof entry === "boolean") {
      payload[normalizedKey] = entry;
    } else if (typeof entry === "number" && Number.isFinite(entry)) {
      payload[normalizedKey] = entry;
    }
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

function normalizeDirtyResourcePayloadString(key: string, value: string): string | null {
  if (key.toLowerCase() !== "webhookdatajson") {
    return value.slice(0, DIRTY_RESOURCE_PAYLOAD_STRING_MAX_LENGTH);
  }

  return Buffer.byteLength(value, "utf8") <= DIRTY_RESOURCE_PAYLOAD_WEBHOOK_DATA_JSON_MAX_BYTES
    ? value
    : null;
}

function buildDirtyResourcePayloadKey(
  payload: HostedDeviceSyncDirtyResource["payload"],
): string {
  const identity = serializeHostedExecutionDeviceSyncDirtyPayloadIdentity(payload);
  return identity ? sha256Hex(identity).slice(0, 24) : "payload";
}

function readCounterJson(value: Prisma.JsonValue): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const next: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      next[key.slice(0, DIRTY_COUNTER_KEY_MAX_LENGTH)] = Math.max(0, Math.trunc(rawValue));
    }
  }
  return next;
}

function normalizeIso(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }
  try {
    return toIsoTimestamp(normalized);
  } catch {
    return null;
  }
}

function normalizeDurationMs(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

function resolveDirtyWindowStart(resources: Record<string, HostedDeviceSyncDirtyResource>): Date | null {
  const value = Object.values(resources).reduce<string | null>(
    (earliest, resource) => minIso(earliest, resource.windowStart),
    null,
  );
  return value ? new Date(value) : null;
}

function resolveDirtyWindowEnd(resources: Record<string, HostedDeviceSyncDirtyResource>): Date | null {
  const value = Object.values(resources).reduce<string | null>(
    (latest, resource) => maxIso(latest, resource.windowEnd),
    null,
  );
  return value ? new Date(value) : null;
}

function minDate(left: Date | null, right: Date | null): Date | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left.getTime() <= right.getTime() ? left : right;
}

function maxDate(left: Date | null, right: Date | null): Date | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left.getTime() >= right.getTime() ? left : right;
}

function minIso(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function maxIso(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function maxDurationMs(
  left: number | null | undefined,
  right: number | null | undefined,
): number | null {
  const normalizedLeft = normalizeDurationMs(left);
  const normalizedRight = normalizeDurationMs(right);
  if (normalizedLeft === null) {
    return normalizedRight;
  }
  if (normalizedRight === null) {
    return normalizedLeft;
  }
  return Math.max(normalizedLeft, normalizedRight);
}

function truncateDirtyKey(value: string | null): string | null {
  const normalized = normalizeNullableString(value ?? undefined);
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, DIRTY_COUNTER_KEY_MAX_LENGTH);
}
