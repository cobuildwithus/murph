import path from "node:path";

import { DEVICE_SYNC_DB_RELATIVE_PATH } from "@murphai/runtime-state/node/runtime-paths";
import {
  buildJunctionProviderSourceInstanceKey,
  canonicalizeJunctionProviderSlug,
} from "@murphai/device-syncd/connect-config";

import {
  createDefaultImporterPort,
  createDeviceSyncService,
  SqliteDeviceSyncStore,
} from "@murphai/device-syncd/service";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import { isDeviceSyncSourceDisconnectFenced } from "@murphai/device-syncd/public-account";

import type {
  CreateDeviceSyncServiceInput,
  DeviceSyncService,
} from "@murphai/device-syncd/service";
import type {
  DeviceSyncImporterPort,
  ProviderJobConnectionSource,
} from "@murphai/device-syncd/types";
import {
  HostedRuntimeArtifactWriteError,
  type HostedRuntimeDeviceSyncPort,
} from "./hosted-runtime/platform.ts";

const storeByService = new WeakMap<DeviceSyncService, SqliteDeviceSyncStore>();

export function createHostedRuntimeDeviceSyncService(
  input: Omit<CreateDeviceSyncServiceInput, "listConnectionSourcesForJob" | "store"> & {
    deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  },
): DeviceSyncService {
  const store = new SqliteDeviceSyncStore(
    input.config.stateDatabasePath
      ?? path.join(path.resolve(input.config.vaultRoot), DEVICE_SYNC_DB_RELATIVE_PATH),
  );

  try {
    const { deviceSyncPort, importer, ...serviceInput } = input;
    const service = createDeviceSyncService({
      ...serviceInput,
      importer: createHostedRuntimeDeviceSyncImporter(
        importer ?? createDefaultImporterPort(),
      ),
      ...(deviceSyncPort
        ? {
            listConnectionSourcesForJob: async (sourceInput) =>
              listHostedJobConnectionSources({
                ...sourceInput,
                deviceSyncPort,
                store,
              }),
          }
        : {}),
      store,
    });
    storeByService.set(service, store);
    return service;
  } catch (error) {
    store.close();
    throw error;
  }
}

function createHostedRuntimeDeviceSyncImporter(
  importer: DeviceSyncImporterPort,
): DeviceSyncImporterPort {
  return {
    async importDeviceProviderSnapshot(input) {
      try {
        return await importer.importDeviceProviderSnapshot(input);
      } catch (error) {
        throw translateHostedRuntimeDeviceSyncImporterError(error);
      }
    },
    ...(importer.resolveDeviceProviderSnapshotDefaultTimeZone
      ? {
          async resolveDeviceProviderSnapshotDefaultTimeZone(input) {
            try {
              return await importer.resolveDeviceProviderSnapshotDefaultTimeZone?.(input);
            } catch (error) {
              throw translateHostedRuntimeDeviceSyncImporterError(error);
            }
          },
        }
      : {}),
  };
}

function translateHostedRuntimeDeviceSyncImporterError(error: unknown): unknown {
  if (!(error instanceof HostedRuntimeArtifactWriteError)) {
    return error;
  }
  return deviceSyncError({
    cause: error,
    code: "HOSTED_DEVICE_SYNC_ARTIFACT_WRITE_FAILED",
    httpStatus: error.retryable ? 503 : 500,
    message: "Hosted device-sync artifact persistence failed. Retry shortly.",
    retryable: error.retryable,
  });
}

async function listHostedJobConnectionSources(input: {
  accountId: string;
  deviceSyncPort: HostedRuntimeDeviceSyncPort;
  provider: string;
  signal?: AbortSignal;
  sourceProviderSlug?: string | null;
  status?: ProviderJobConnectionSource["status"] | null;
  store: SqliteDeviceSyncStore;
}): Promise<ProviderJobConnectionSource[]> {
  const hostedConnectionId = input.store.getHostedConnectionIdForAccountId(input.accountId);
  if (!hostedConnectionId) {
    throw hostedSourceStateUnavailable();
  }

  let snapshot: Awaited<ReturnType<HostedRuntimeDeviceSyncPort["fetchSnapshot"]>>;
  try {
    snapshot = await input.deviceSyncPort.fetchSnapshot({
      connectionId: hostedConnectionId,
      includeCredentialMaterial: false,
      signal: input.signal ?? null,
    });
  } catch (error) {
    if (input.signal?.aborted) {
      throw input.signal.reason ?? error;
    }
    throw hostedSourceStateUnavailable(error);
  }

  const connection = snapshot.connections.find(
    (entry) => entry.connection.id === hostedConnectionId,
  );
  if (!connection || connection.sources === undefined) {
    throw hostedSourceStateUnavailable();
  }

  const localSources = input.store.listConnectionSources({
    connectionId: input.accountId,
  });
  const requestedSourceProviderSlug = input.provider === "junction"
    ? canonicalizeJunctionProviderSlug(input.sourceProviderSlug)
    : input.sourceProviderSlug;
  const sources = input.provider === "junction"
    ? canonicalizeHostedJunctionSources(connection.sources, hostedConnectionId)
    : connection.sources;
  return sources
    .filter((source) =>
      (!requestedSourceProviderSlug || source.sourceProviderSlug === requestedSourceProviderSlug)
      && (!input.status || source.status === input.status)
    )
    .map((source) => {
      const localSource = localSources.find(
        (candidate) =>
          input.provider === "junction"
            ? canonicalizeJunctionProviderSlug(candidate.sourceProviderSlug)
                === source.sourceProviderSlug
            : candidate.sourceProviderSlug === source.sourceProviderSlug,
      );
      const sourceInstanceKey = localSource?.sourceInstanceKey
        ?? source.sourceInstanceKey
        ?? (
          input.provider === "junction"
            ? buildJunctionProviderSourceInstanceKey({
                connectionId: input.accountId,
                sourceProviderSlug: source.sourceProviderSlug,
              })
            : null
        );

      return {
        ...source,
        ...(sourceInstanceKey ? { sourceInstanceKey } : {}),
      };
    });
}

type HostedJunctionSource = ProviderJobConnectionSource & {
  firstSeenAt?: string;
  lastDataAt?: string | null;
  lastSeenAt?: string;
};
const HOSTED_JUNCTION_SOURCE_AVAILABILITY_LIMIT = 64;
const HOSTED_JUNCTION_SOURCE_STATUS_AUTHORITY = {
  connected: 0,
  unavailable: 1,
  error: 2,
  disconnected: 3,
} as const satisfies Record<ProviderJobConnectionSource["status"], number>;

export function canonicalizeHostedJunctionSources<T extends HostedJunctionSource>(
  sources: readonly T[],
  connectionId?: string,
): T[] {
  const sourcesByProvider = new Map<string, T[]>();
  for (const source of sources) {
    const sourceProviderSlug = canonicalizeJunctionProviderSlug(source.sourceProviderSlug);
    if (!sourceProviderSlug) {
      continue;
    }
    const matchingSources = sourcesByProvider.get(sourceProviderSlug);
    if (matchingSources) {
      matchingSources.push(source);
    } else {
      sourcesByProvider.set(sourceProviderSlug, [source]);
    }
  }
  return [...sourcesByProvider].map(([sourceProviderSlug, candidates]) =>
    mergeHostedJunctionSourceLifecycle(sourceProviderSlug, candidates, connectionId)
  );
}

function mergeHostedJunctionSourceLifecycle<T extends HostedJunctionSource>(
  sourceProviderSlug: string,
  candidates: readonly T[],
  connectionId: string | undefined,
): T {
  const lifecycleEpoch = Math.max(...candidates.map((source) => source.lifecycleEpoch ?? 1));
  const lifecycleEpochWasObserved = candidates.some(
    (source) => source.lifecycleEpoch !== undefined,
  );
  const ordered = [...candidates].sort((left, right) =>
    (right.lifecycleEpoch ?? 1) - (left.lifecycleEpoch ?? 1)
    || HOSTED_JUNCTION_SOURCE_STATUS_AUTHORITY[right.status]
      - HOSTED_JUNCTION_SOURCE_STATUS_AUTHORITY[left.status]
    || hostedSourceTimestamp(right.lastSeenAt) - hostedSourceTimestamp(left.lastSeenAt)
    || Number(right.sourceProviderSlug === sourceProviderSlug)
      - Number(left.sourceProviderSlug === sourceProviderSlug)
    || left.sourceProviderSlug.localeCompare(right.sourceProviderSlug)
    || (left.sourceInstanceKey ?? "").localeCompare(right.sourceInstanceKey ?? "")
  );
  const current = ordered.filter((source) =>
    (source.lifecycleEpoch ?? 1) === lifecycleEpoch
  );
  const state = current[0]!;
  const disconnectFence = current.find(isDeviceSyncSourceDisconnectFenced) ?? null;
  const resourceAvailabilitySummary: NonNullable<
    ProviderJobConnectionSource["resourceAvailabilitySummary"]
  > = {};
  let availabilityCount = 0;
  for (const source of ordered) {
    for (const [key, value] of Object.entries(source.resourceAvailabilitySummary ?? {}).sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      if (
        availabilityCount >= HOSTED_JUNCTION_SOURCE_AVAILABILITY_LIMIT
        || Object.hasOwn(resourceAvailabilitySummary, key)
      ) {
        continue;
      }
      resourceAvailabilitySummary[key] = value;
      availabilityCount += 1;
    }
  }
  const sourceInstanceKey = connectionId
    ? buildJunctionProviderSourceInstanceKey({ connectionId, sourceProviderSlug })
    : current.find((source) => source.sourceProviderSlug === sourceProviderSlug)
        ?.sourceInstanceKey ?? state.sourceInstanceKey;
  const firstSeenAt = selectHostedSourceTimestamp(ordered, "firstSeenAt", false);
  const lastSeenAt = selectHostedSourceTimestamp(ordered, "lastSeenAt", true);
  const lastDataAt = selectHostedSourceTimestamp(ordered, "lastDataAt", true);

  return {
    ...state,
    sourceProviderSlug,
    ...(lifecycleEpochWasObserved ? { lifecycleEpoch } : {}),
    resourceAvailabilitySummary,
    ...(sourceInstanceKey ? { sourceInstanceKey } : {}),
    ...(firstSeenAt ? { firstSeenAt } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
    ...(ordered.some((source) => source.lastDataAt !== undefined)
      ? { lastDataAt: lastDataAt ?? null }
      : {}),
    ...(disconnectFence
      ? {
          lastErrorCode: disconnectFence.lastErrorCode,
          lastErrorMessage: disconnectFence.lastErrorMessage,
        }
      : {}),
  };
}

function hostedSourceTimestamp(value: string | undefined): number {
  return Date.parse(value ?? "") || 0;
}

function selectHostedSourceTimestamp(
  sources: readonly HostedJunctionSource[],
  field: "firstSeenAt" | "lastDataAt" | "lastSeenAt",
  latest: boolean,
): string | null {
  const values = sources.flatMap((source) => {
    const value = source[field];
    return value && Number.isFinite(Date.parse(value)) ? [value] : [];
  }).sort((left, right) => Date.parse(left) - Date.parse(right));
  return (latest ? values.at(-1) : values[0]) ?? null;
}

function hostedSourceStateUnavailable(cause?: unknown) {
  return deviceSyncError({
    code: "HOSTED_DEVICE_SYNC_SOURCE_STATE_UNAVAILABLE",
    message: "Current hosted device source state is unavailable. Retry shortly.",
    retryable: true,
    httpStatus: 503,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function requireHostedRuntimeDeviceSyncStore(service: DeviceSyncService): SqliteDeviceSyncStore {
  const store = storeByService.get(service);

  if (!store) {
    throw new TypeError("Unknown hosted-runtime device sync service instance.");
  }

  return store;
}

export function closeHostedRuntimeDeviceSyncService(service: DeviceSyncService): void {
  const store = requireHostedRuntimeDeviceSyncStore(service);
  storeByService.delete(service);
  service.close();
  store.close();
}
