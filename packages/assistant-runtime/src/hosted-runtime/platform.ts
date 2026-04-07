import type {
  HostedExecutionDeviceSyncConnectLinkResponse,
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedExecutionAiUsageRecordResponse,
  HostedExecutionSideEffectRecord,
} from "@murphai/hosted-execution";

import type {
  HostedEmailSendRequest,
} from "../hosted-email.ts";

export interface HostedRuntimeArtifactStore {
  get(sha256: string): Promise<Uint8Array | null>;
  put(input: {
    bytes: Uint8Array;
    sha256: string;
  }): Promise<void>;
}

export interface HostedRuntimeEffectsPort {
  commit(input: {
    eventId: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  deletePreparedSideEffect(input: {
    effectId: string;
    fingerprint: string;
    kind: string;
  }): Promise<void>;
  readRawEmailMessage(rawMessageKey: string): Promise<Uint8Array | null>;
  readSideEffect(input: {
    effectId: string;
    fingerprint: string;
    kind: string;
  }): Promise<HostedExecutionSideEffectRecord | null>;
  sendEmail(request: HostedEmailSendRequest): Promise<{ target: string } | void>;
  writeSideEffect(record: HostedExecutionSideEffectRecord): Promise<HostedExecutionSideEffectRecord>;
}

export interface HostedRuntimeDeviceSyncPort {
  applyUpdates(input: {
    occurredAt?: string | null;
    updates: HostedExecutionDeviceSyncRuntimeApplyRequest["updates"];
  }): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse>;
  createConnectLink(input: {
    provider: string;
  }): Promise<HostedExecutionDeviceSyncConnectLinkResponse>;
  fetchSnapshot(input?: {
    connectionId?: string | null;
    provider?: string | null;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
}

export interface HostedRuntimeUsageExportPort {
  recordUsage(usage: readonly object[]): Promise<HostedExecutionAiUsageRecordResponse>;
}

export interface HostedRuntimePlatform {
  artifactStore: HostedRuntimeArtifactStore;
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  effectsPort: HostedRuntimeEffectsPort;
  usageExportPort?: HostedRuntimeUsageExportPort | null;
}
