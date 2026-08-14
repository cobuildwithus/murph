import path from "node:path";

import { DEVICE_SYNC_DB_RELATIVE_PATH } from "@murphai/runtime-state/node/runtime-paths";
import {
  areJunctionDeviceConnectProviderSlugsEquivalent,
  buildJunctionProviderSourceInstanceKey,
} from "@murphai/device-syncd/connect-config";

import {
  createDefaultImporterPort,
  createDeviceSyncService,
  SqliteDeviceSyncStore,
} from "@murphai/device-syncd/service";
import { deviceSyncError } from "@murphai/device-syncd/errors";

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
        if (!(error instanceof HostedRuntimeArtifactWriteError)) {
          throw error;
        }
        throw deviceSyncError({
          cause: error,
          code: "HOSTED_DEVICE_SYNC_ARTIFACT_WRITE_FAILED",
          httpStatus: error.retryable ? 503 : 500,
          message: "Hosted device-sync artifact persistence failed. Retry shortly.",
          retryable: error.retryable,
        });
      }
    },
  };
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
    .sort(compareHostedJobSourceIdentity)[0];
}

function compareHostedJobSourceIdentity(
  left: ProviderJobConnectionSource,
  right: ProviderJobConnectionSource,
): number {
  const leftFirstSeenAt = left.firstSeenAt ? Date.parse(left.firstSeenAt) : Number.NaN;
  const rightFirstSeenAt = right.firstSeenAt ? Date.parse(right.firstSeenAt) : Number.NaN;
  const leftFirstSeenRank = Number.isFinite(leftFirstSeenAt)
    ? leftFirstSeenAt
    : Number.POSITIVE_INFINITY;
  const rightFirstSeenRank = Number.isFinite(rightFirstSeenAt)
    ? rightFirstSeenAt
    : Number.POSITIVE_INFINITY;
  return leftFirstSeenRank !== rightFirstSeenRank
    ? leftFirstSeenRank - rightFirstSeenRank
    : (left.sourceInstanceKey ?? "").localeCompare(right.sourceInstanceKey ?? "")
      || left.sourceProviderSlug.localeCompare(right.sourceProviderSlug);
}

interface HostedJobConnectionSource extends ProviderJobConnectionSource {
  lastDataAt: string | null;
  lastSeenAt: string;
  resourceCount: number;
}

function compareHostedJobSourceLifecycle(
  left: HostedJobConnectionSource,
  right: HostedJobConnectionSource,
): number {
  const leftLastDataAt = parseHostedJobSourceTimestamp(left.lastDataAt);
  const rightLastDataAt = parseHostedJobSourceTimestamp(right.lastDataAt);
  if (leftLastDataAt !== rightLastDataAt) {
    return rightLastDataAt - leftLastDataAt;
  }

  const leftLastSeenAt = parseHostedJobSourceTimestamp(left.lastSeenAt);
  const rightLastSeenAt = parseHostedJobSourceTimestamp(right.lastSeenAt);
  return rightLastSeenAt - leftLastSeenAt;
}

function parseHostedJobSourceTimestamp(value: string | null): number {
  if (value === null) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw hostedSourceStateUnavailable();
  }
  return timestamp;
}

function haveEqualHostedJobSourceLifecycleState(
  left: HostedJobConnectionSource,
  right: HostedJobConnectionSource,
): boolean {
  return left.status === right.status
    && left.lastErrorCode === right.lastErrorCode
    && left.lastErrorMessage === right.lastErrorMessage
    && left.resourceCount === right.resourceCount
    && haveEqualHostedJobSourceAvailability(
      left.resourceAvailabilitySummary,
      right.resourceAvailabilitySummary,
    );
}

function haveEqualHostedJobSourceAvailability(
  left: ProviderJobConnectionSource["resourceAvailabilitySummary"],
  right: ProviderJobConnectionSource["resourceAvailabilitySummary"],
): boolean {
  const leftEntries = Object.entries(left ?? {}).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  );
  const rightEntries = Object.entries(right ?? {}).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  );
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value], index) => {
      const rightEntry = rightEntries[index];
      return rightEntry?.[0] === key && Object.is(rightEntry[1], value);
    });
}

function dedupeHostedJobConnectionSources(
  provider: string,
  sources: readonly HostedJobConnectionSource[],
): HostedJobConnectionSource[] {
  if (provider !== "junction") {
    return [...sources];
  }
  const deduped: HostedJobConnectionSource[] = [];
  for (const source of sources) {
    const existingIndex = deduped.findIndex((candidate) =>
      areHostedJunctionSourcesEquivalent(
        provider,
        candidate.sourceProviderSlug,
        source.sourceProviderSlug,
      )
    );
    if (existingIndex === -1) {
      deduped.push(source);
      continue;
    }
    const existing = deduped[existingIndex];
    if (!existing) {
      continue;
    }
    const identitySource = compareHostedJobSourceIdentity(source, existing) < 0
      ? source
      : existing;
    const lifecycleComparison = compareHostedJobSourceLifecycle(source, existing);
    if (
      lifecycleComparison === 0
      && !haveEqualHostedJobSourceLifecycleState(source, existing)
    ) {
      throw hostedSourceStateUnavailable();
    }
    const lifecycleSource = lifecycleComparison < 0
      ? source
      : lifecycleComparison > 0
        ? existing
        : identitySource;
    deduped[existingIndex] = {
      ...lifecycleSource,
      firstSeenAt: identitySource.firstSeenAt,
      ...(identitySource.sourceInstanceKey
        ? { sourceInstanceKey: identitySource.sourceInstanceKey }
        : {}),
      sourceProviderSlug: identitySource.sourceProviderSlug,
    };
  }
  return deduped;
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
