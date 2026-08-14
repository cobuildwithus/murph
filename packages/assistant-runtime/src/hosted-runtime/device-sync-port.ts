import type {
  HostedExecutionDeviceSyncConnectLinkResponse,
  HostedExecutionDeviceSyncDirtyAckRequest,
  HostedExecutionDeviceSyncDirtyAckResponse,
  HostedExecutionDeviceSyncDirtyPendingRequest,
  HostedExecutionDeviceSyncDirtyPendingResponse,
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncReconcileResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotCursor,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

export type HostedRuntimeDeviceSyncMessagingReturnTarget = "imessage" | "telegram";

export interface HostedRuntimeDeviceSyncPort {
  applyUpdates(input: {
    occurredAt?: string | null;
    signal?: AbortSignal | null;
    updates: HostedExecutionDeviceSyncRuntimeApplyRequest["updates"];
  }): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse>;
  createConnectLink(input: {
    connectTarget: string;
    messagingReturnTarget?: HostedRuntimeDeviceSyncMessagingReturnTarget | null;
  }): Promise<HostedExecutionDeviceSyncConnectLinkResponse>;
  reconcileAccount?(input: {
    connectionId: string;
    signal?: AbortSignal | null;
  }): Promise<HostedExecutionDeviceSyncReconcileResponse>;
  fetchSnapshot(input?: {
    connectionId?: string | null;
    cursor?: HostedExecutionDeviceSyncRuntimeSnapshotCursor | null;
    includeCredentialMaterial?: boolean | null;
    limit?: number | null;
    provider?: string | null;
    signal?: AbortSignal | null;
    sourceProviderSlug?: string | null;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
  fetchDirtyStates(input?: Omit<HostedExecutionDeviceSyncDirtyPendingRequest, "userId"> & {
    signal?: AbortSignal | null;
  }): Promise<HostedExecutionDeviceSyncDirtyPendingResponse>;
  ackDirtyStateProcessed(
    input: Omit<HostedExecutionDeviceSyncDirtyAckRequest, "userId"> & {
      signal?: AbortSignal | null;
    },
  ): Promise<HostedExecutionDeviceSyncDirtyAckResponse>;
}
