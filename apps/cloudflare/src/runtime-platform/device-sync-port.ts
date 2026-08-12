import type { HostedRuntimeDeviceSyncMessagingReturnTarget } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RECONCILE_PATH,
  buildHostedExecutionDeviceSyncConnectLinkPath,
  parseHostedExecutionDeviceSyncConnectLinkResponse,
  parseHostedExecutionDeviceSyncDirtyAckResponse,
  parseHostedExecutionDeviceSyncDirtyPendingResponse,
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
}) {
  return {
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
      updates: unknown;
    }) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          ...(runtimeInput.occurredAt ? { occurredAt: runtimeInput.occurredAt } : {}),
          updates: runtimeInput.updates,
          userId: input.boundUserId,
        },
        boundUserId: input.boundUserId,
        description: "Hosted device-sync runtime apply",
        fetchImpl: input.fetchImpl,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
        signal: runtimeInput.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedExecutionDeviceSyncRuntimeApplyResponse(payload);
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
