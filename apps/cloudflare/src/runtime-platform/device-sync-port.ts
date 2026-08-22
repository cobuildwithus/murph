import type {
  HostedRuntimeDeviceSyncMessagingReturnTarget,
  HostedRuntimeDeviceSyncPort,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_FITBIT_MIGRATION_CUTOVER_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RECONCILE_PATH,
  buildHostedExecutionDeviceSyncConnectLinkPath,
  type HostedExecutionDeviceSyncCompletedImport,
  type HostedExecutionDeviceSyncRuntimeApplyRequest,
  type HostedExecutionDeviceSyncRuntimeApplyResponse,
  parseHostedExecutionDeviceSyncConnectLinkResponse,
  parseHostedExecutionDeviceSyncDirtyAckResponse,
  parseHostedExecutionDeviceSyncDirtyPendingResponse,
  parseHostedExecutionDeviceSyncFitbitMigrationCutoverResponse,
  parseHostedExecutionDeviceSyncRuntimeApplyResponse,
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
  parseHostedExecutionDeviceSyncReconcileResponse,
  type HostedExecutionDeviceSyncRuntimeSnapshotCursor,
} from "@murphai/device-syncd/hosted-runtime";

import { fetchHostedWebControlPlaneJson, type HostedWebControlTransport } from "./web-control-transport.ts";

export function createHostedWebDeviceSyncPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): HostedRuntimeDeviceSyncPort {
  return {
    async completeFitbitMigration(runtimeInput: {
      connectionId: string;
      signal?: AbortSignal | null;
    }) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          connectionId: runtimeInput.connectionId,
        },
        boundUserId: input.boundUserId,
        description: "Hosted Fitbit migration cutover",
        fetchImpl: input.fetchImpl,
        path: HOSTED_EXECUTION_DEVICE_SYNC_FITBIT_MIGRATION_CUTOVER_PATH,
        signal: runtimeInput.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncFitbitMigrationCutoverResponse(payload);
    },
    async reconcileAccount(runtimeInput: {
      connectionId: string;
      signal?: AbortSignal | null;
    }) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          connectionId: runtimeInput.connectionId,
        },
        boundUserId: input.boundUserId,
        description: "Hosted device-sync reconcile",
        fetchImpl: input.fetchImpl,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RECONCILE_PATH,
        signal: runtimeInput.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncReconcileResponse(payload);
    },
    async applyUpdates(runtimeInput: {
      occurredAt?: string | null;
      signal?: AbortSignal | null;
      updates: HostedExecutionDeviceSyncRuntimeApplyRequest["updates"];
    }) {
      const bodies = buildHostedRuntimeApplyCallbackBodies({
        occurredAt: runtimeInput.occurredAt,
        updates: runtimeInput.updates,
        userId: input.boundUserId,
      });
      const appliedUpdates: HostedExecutionDeviceSyncRuntimeApplyResponse["updates"] = [];
      let lastResponse: HostedExecutionDeviceSyncRuntimeApplyResponse | null = null;

      for (const body of bodies) {
        const payload = await fetchHostedWebControlPlaneJson({
          body,
          boundUserId: input.boundUserId,
          description: "Hosted device-sync runtime apply",
          fetchImpl: input.fetchImpl,
          path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
          signal: runtimeInput.signal ?? null,
          timeoutMs: input.timeoutMs,
          transport: input.transport,
        });
        const response = parseHostedExecutionDeviceSyncRuntimeApplyResponse(payload);
        lastResponse = response;
        appliedUpdates.push(...response.updates);
      }

      if (!lastResponse) {
        throw new Error("Hosted device-sync runtime apply produced no callback responses.");
      }

      return {
        appliedAt: lastResponse.appliedAt,
        updates: appliedUpdates,
        userId: lastResponse.userId,
      };
    },
    async createConnectLink(runtimeInput: {
      connectTarget: string;
      messagingReturnTarget?: HostedRuntimeDeviceSyncMessagingReturnTarget | null;
    }) {
      const payload = await fetchHostedWebControlPlaneJson({
        ...(runtimeInput.messagingReturnTarget
          ? {
              body: {
                messagingReturnTarget: runtimeInput.messagingReturnTarget,
              },
            }
          : {}),
        boundUserId: input.boundUserId,
        description: `Hosted device-sync connect link ${runtimeInput.connectTarget}`,
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: buildHostedExecutionDeviceSyncConnectLinkPath(runtimeInput.connectTarget),
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncConnectLinkResponse(payload);
    },
    async fetchSnapshot(runtimeInput: {
      connectionId?: string | null;
      cursor?: HostedExecutionDeviceSyncRuntimeSnapshotCursor | null;
      includeCredentialMaterial?: boolean | null;
      limit?: number | null;
      provider?: string | null;
      signal?: AbortSignal | null;
      sourceProviderSlug?: string | null;
    } = {}) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          ...(runtimeInput.connectionId ? { connectionId: runtimeInput.connectionId } : {}),
          ...(runtimeInput.cursor === undefined ? {} : { cursor: runtimeInput.cursor }),
          ...(runtimeInput.includeCredentialMaterial == null
            ? (
                input.transport.mode === "direct"
                  ? { includeCredentialMaterial: true }
                  : {}
              )
            : { includeCredentialMaterial: runtimeInput.includeCredentialMaterial }),
          ...(runtimeInput.limit === undefined ? {} : { limit: runtimeInput.limit }),
          ...(runtimeInput.provider ? { provider: runtimeInput.provider } : {}),
          ...(runtimeInput.sourceProviderSlug ? { sourceProviderSlug: runtimeInput.sourceProviderSlug } : {}),
          userId: input.boundUserId,
        },
        boundUserId: input.boundUserId,
        description: "Hosted device-sync runtime snapshot",
        fetchImpl: input.fetchImpl,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
        signal: runtimeInput.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(payload);
    },
    async fetchDirtyStates(runtimeInput?: {
      connectionId?: string | null;
      limit?: number | null;
      stagedDirtyAcks?: Array<{
        connectionId: string;
        processedDirtyPayloadIds?: string[];
        processedRevision: string;
      }>;
      signal?: AbortSignal | null;
    }) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          ...(runtimeInput?.connectionId === undefined
            ? {}
            : { connectionId: runtimeInput.connectionId }),
          ...(runtimeInput?.limit === undefined ? {} : { limit: runtimeInput.limit }),
          ...(runtimeInput?.stagedDirtyAcks === undefined
            ? {}
            : { stagedDirtyAcks: runtimeInput.stagedDirtyAcks }),
          userId: input.boundUserId,
        },
        boundUserId: input.boundUserId,
        description: "Hosted device-sync pending dirty state",
        fetchImpl: input.fetchImpl,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH,
        signal: runtimeInput?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncDirtyPendingResponse(payload);
    },
    async ackDirtyStateProcessed(runtimeInput: {
      completedImports?: HostedExecutionDeviceSyncCompletedImport[];
      connectionId: string;
      processedDirtyPayloadIds?: string[];
      processedRevision: string;
      signal?: AbortSignal | null;
      stagedDirtyAcks?: Array<{
        connectionId: string;
        processedDirtyPayloadIds?: string[];
        processedRevision: string;
      }>;
    }) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          ...(runtimeInput.completedImports
            ? { completedImports: runtimeInput.completedImports }
            : {}),
          connectionId: runtimeInput.connectionId,
          ...(runtimeInput.processedDirtyPayloadIds
            ? { processedDirtyPayloadIds: runtimeInput.processedDirtyPayloadIds }
            : {}),
          processedRevision: runtimeInput.processedRevision,
          ...(runtimeInput.stagedDirtyAcks === undefined
            ? {}
            : { stagedDirtyAcks: runtimeInput.stagedDirtyAcks }),
          userId: input.boundUserId,
        },
        boundUserId: input.boundUserId,
        description: "Hosted device-sync dirty ack",
        fetchImpl: input.fetchImpl,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH,
        signal: runtimeInput.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncDirtyAckResponse(payload);
    },
  };
}

function buildHostedRuntimeApplyCallbackBodies(input: {
  occurredAt?: string | null;
  updates: HostedExecutionDeviceSyncRuntimeApplyRequest["updates"];
  userId: string;
}): HostedExecutionDeviceSyncRuntimeApplyRequest[] {
  if (!Array.isArray(input.updates)) {
    throw new TypeError("Hosted device-sync runtime apply updates must be an array.");
  }

  const baseBody = {
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    updates: [],
    userId: input.userId,
  } satisfies HostedExecutionDeviceSyncRuntimeApplyRequest;

  if (input.updates.length === 0) {
    return [baseBody];
  }

  const bodies: HostedExecutionDeviceSyncRuntimeApplyRequest[] = [];
  let currentUpdates: HostedExecutionDeviceSyncRuntimeApplyRequest["updates"] = [];

  for (const update of input.updates) {
    const singleUpdateBody = createHostedRuntimeApplyCallbackBody({
      occurredAt: input.occurredAt,
      updates: [update],
      userId: input.userId,
    });
    if (
      measureHostedRuntimeApplyCallbackBodyBytes(singleUpdateBody)
        > HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES
    ) {
      throw new RangeError(
        "Hosted device-sync runtime apply update exceeds the callback body limit.",
      );
    }

    const candidateUpdates = [...currentUpdates, update];
    const candidateBody = createHostedRuntimeApplyCallbackBody({
      occurredAt: input.occurredAt,
      updates: candidateUpdates,
      userId: input.userId,
    });
    const candidateBytes = measureHostedRuntimeApplyCallbackBodyBytes(candidateBody);
    if (
      currentUpdates.length > 0
      && (
        candidateUpdates.length > HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_UPDATE_LIMIT
        || candidateBytes > HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES
      )
    ) {
      bodies.push(createHostedRuntimeApplyCallbackBody({
        occurredAt: input.occurredAt,
        updates: currentUpdates,
        userId: input.userId,
      }));
      currentUpdates = [update];
      continue;
    }

    currentUpdates = candidateUpdates;
  }

  if (currentUpdates.length > 0) {
    bodies.push(createHostedRuntimeApplyCallbackBody({
      occurredAt: input.occurredAt,
      updates: currentUpdates,
      userId: input.userId,
    }));
  }

  return bodies;
}

function createHostedRuntimeApplyCallbackBody(input: {
  occurredAt?: string | null;
  updates: HostedExecutionDeviceSyncRuntimeApplyRequest["updates"];
  userId: string;
}): HostedExecutionDeviceSyncRuntimeApplyRequest {
  return {
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    updates: input.updates,
    userId: input.userId,
  };
}

function measureHostedRuntimeApplyCallbackBodyBytes(
  body: HostedExecutionDeviceSyncRuntimeApplyRequest,
): number {
  return new TextEncoder().encode(JSON.stringify(body)).byteLength;
}
