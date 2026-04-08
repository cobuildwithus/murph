import type {
  HostedExecutionDeviceSyncConnectLinkResponse,
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedAssistantDeliveryRecord,
  HostedAssistantDeliverySideEffect,
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

type HostedRuntimeEffectsPortBase = {
  commit(input: {
    eventId: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  readRawEmailMessage(rawMessageKey: string): Promise<Uint8Array | null>;
  sendEmail(request: HostedEmailSendRequest): Promise<{ target: string } | void>;
};

type HostedRuntimeAssistantDeliveryJournalPort = {
  deletePreparedAssistantDelivery(
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ): Promise<void>;
  readAssistantDeliveryRecord(
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ): Promise<HostedAssistantDeliveryRecord | null>;
  writeAssistantDeliveryRecord(
    record: HostedAssistantDeliveryRecord,
  ): Promise<HostedAssistantDeliveryRecord>;
  deletePreparedSideEffect?: (
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ) => Promise<void>;
  readSideEffect?: (
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ) => Promise<HostedAssistantDeliveryRecord | null>;
  writeSideEffect?: (record: HostedAssistantDeliveryRecord) => Promise<HostedAssistantDeliveryRecord>;
};

type HostedRuntimeLegacyJournalPort = {
  deletePreparedSideEffect(
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ): Promise<void>;
  readSideEffect(
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ): Promise<HostedAssistantDeliveryRecord | null>;
  writeSideEffect(record: HostedAssistantDeliveryRecord): Promise<HostedAssistantDeliveryRecord>;
  deletePreparedAssistantDelivery?: (
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ) => Promise<void>;
  readAssistantDeliveryRecord?: (
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ) => Promise<HostedAssistantDeliveryRecord | null>;
  writeAssistantDeliveryRecord?: (
    record: HostedAssistantDeliveryRecord,
  ) => Promise<HostedAssistantDeliveryRecord>;
};

export type HostedRuntimeEffectsPort =
  HostedRuntimeEffectsPortBase
  & (HostedRuntimeAssistantDeliveryJournalPort | HostedRuntimeLegacyJournalPort);

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
  recordUsage(usage: readonly object[]): Promise<HostedRuntimeUsageRecordResponse>;
}

export interface HostedRuntimePlatform {
  artifactStore: HostedRuntimeArtifactStore;
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  effectsPort: HostedRuntimeEffectsPort;
  usageExportPort?: HostedRuntimeUsageExportPort | null;
}

export interface HostedRuntimeUsageRecordResponse {
  recorded: number;
  usageIds: string[];
}
