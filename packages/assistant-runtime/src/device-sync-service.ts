import path from "node:path";

import { DEVICE_SYNC_DB_RELATIVE_PATH } from "@murphai/runtime-state/node/runtime-paths";
import { buildJunctionProviderSourceInstanceKey } from "@murphai/device-syncd/connect-config";

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
} from "./hosted-runtime/artifact-write-error.ts";
import type {
  HostedRuntimeDeviceSyncPort,
} from "./hosted-runtime/device-sync-port.ts";

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
  return connection.sources
    .filter((source) =>
      (!input.sourceProviderSlug || source.sourceProviderSlug === input.sourceProviderSlug)
      && (!input.status || source.status === input.status)
    )
    .map((source) => {
      const localSource = localSources.find(
        (candidate) => candidate.sourceProviderSlug === source.sourceProviderSlug,
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
