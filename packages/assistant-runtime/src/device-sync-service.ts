import path from "node:path";

import { DEVICE_SYNC_DB_RELATIVE_PATH } from "@murphai/runtime-state/node/runtime-paths";
import {
  areJunctionDeviceConnectProviderSlugsEquivalent,
  buildJunctionProviderSourceInstanceKey,
  canonicalizeJunctionProviderSlug,
} from "@murphai/device-syncd/connect-config";

import {
  createDefaultImporterPort,
  createDeviceSyncService,
  SqliteDeviceSyncStore,
} from "@murphai/device-syncd/service";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import {
  compareDeviceSyncSourceIdentity,
  dedupeDeviceSyncSourcesByIdentity,
} from "@murphai/device-syncd/public-account";

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
import { hostedSourceStateUnavailable } from "./hosted-device-sync-source-state.ts";

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
  const projectedSources = connection.sources
    .filter((source) =>
      !input.sourceProviderSlug || areHostedJunctionSourcesEquivalent(
        input.provider,
        source.sourceProviderSlug,
        input.sourceProviderSlug,
      )
    )
    .map((source) => {
      const exactLocalSource = localSources.find(
        (candidate) => candidate.sourceInstanceKey === source.sourceInstanceKey,
      );
      const routeEquivalentLocalSource = selectHostedJunctionSource(
        input.provider,
        localSources,
        source.sourceProviderSlug,
      );
      const localSource = input.provider === "junction"
        ? routeEquivalentLocalSource ?? exactLocalSource
        : exactLocalSource ?? routeEquivalentLocalSource;
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
        firstSeenAt: localSource?.firstSeenAt ?? source.firstSeenAt,
        ...(sourceInstanceKey ? { sourceInstanceKey } : {}),
        sourceProviderSlug: localSource?.sourceProviderSlug ?? source.sourceProviderSlug,
      };
    });
  const dedupedSources = dedupeHostedJobConnectionSources(
    input.provider,
    projectedSources,
  );
  return input.status
    ? dedupedSources.filter((source) => source.status === input.status)
    : dedupedSources;
}

function areHostedJunctionSourcesEquivalent(
  provider: string,
  left: string,
  right: string,
): boolean {
  if (provider !== "junction") {
    return left === right;
  }
  return areJunctionDeviceConnectProviderSlugsEquivalent(left, right);
}

function selectHostedJunctionSource(
  provider: string,
  sources: readonly ProviderJobConnectionSource[],
  sourceProviderSlug: string,
): ProviderJobConnectionSource | undefined {
  return sources
    .filter((source) => areHostedJunctionSourcesEquivalent(
      provider,
      source.sourceProviderSlug,
      sourceProviderSlug,
    ))
    .sort(compareDeviceSyncSourceIdentity)[0];
}

interface HostedJobConnectionSource extends ProviderJobConnectionSource {
  lastDataAt: string | null;
  lastSeenAt: string;
}

function dedupeHostedJobConnectionSources(
  provider: string,
  sources: readonly HostedJobConnectionSource[],
): HostedJobConnectionSource[] {
  if (provider !== "junction") {
    return [...sources];
  }
  return dedupeDeviceSyncSourcesByIdentity(
    sources,
    (left, right) => areHostedJunctionSourcesEquivalent(
      provider,
      left.sourceProviderSlug,
      right.sourceProviderSlug,
    ),
    hostedSourceStateUnavailable,
  );
}

type CanonicalizableHostedJunctionSource = Omit<
  ProviderJobConnectionSource,
  "lastDataAt" | "lastSeenAt"
> & {
  lastDataAt?: string | null;
  lastSeenAt?: string;
};

export function canonicalizeHostedJunctionSources<
  T extends CanonicalizableHostedJunctionSource,
>(
  sources: readonly T[],
  connectionId?: string,
): T[] {
  const canonicalSources: T[] = [];
  for (const source of sources) {
    const sourceProviderSlug = canonicalizeJunctionProviderSlug(
      source.sourceProviderSlug,
    );
    if (!sourceProviderSlug) {
      continue;
    }
    const sourceInstanceKey = connectionId
      ? buildJunctionProviderSourceInstanceKey({ connectionId, sourceProviderSlug })
      : source.sourceInstanceKey;
    canonicalSources.push({
      ...source,
      sourceProviderSlug,
      ...(sourceInstanceKey ? { sourceInstanceKey } : {}),
    });
  }
  return dedupeDeviceSyncSourcesByIdentity(
    canonicalSources,
    (left, right) => left.sourceProviderSlug === right.sourceProviderSlug,
    hostedSourceStateUnavailable,
  );
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
