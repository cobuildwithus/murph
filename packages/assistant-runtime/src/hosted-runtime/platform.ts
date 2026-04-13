import type {
  HostedExecutionDeviceSyncConnectLinkResponse,
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedAssistantDeliveryRecord,
  HostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution/side-effects";

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
};

export type HostedRuntimeEffectsPort =
  HostedRuntimeEffectsPortBase
  & HostedRuntimeAssistantDeliveryJournalPort;

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

export function parseHostedRuntimeUsageRecordResponse(
  value: unknown,
): HostedRuntimeUsageRecordResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime usage response must be an object.");
  }

  const recorded = (value as { recorded?: unknown }).recorded;
  const usageIds = (value as { usageIds?: unknown }).usageIds;

  if (typeof recorded !== "number" || !Number.isSafeInteger(recorded) || recorded < 0) {
    throw new TypeError("Hosted runtime usage response.recorded must be a non-negative integer.");
  }

  if (!Array.isArray(usageIds)) {
    throw new TypeError("Hosted runtime usage response.usageIds must be a string array of non-empty values.");
  }

  const normalizedUsageIds: string[] = []
  for (const entry of usageIds) {
    if (typeof entry !== "string") {
      throw new TypeError("Hosted runtime usage response.usageIds must be a string array of non-empty values.");
    }
    const trimmedEntry = entry.trim()
    if (trimmedEntry.length === 0) {
      throw new TypeError("Hosted runtime usage response.usageIds must be a string array of non-empty values.");
    }
    normalizedUsageIds.push(trimmedEntry)
  }

  return {
    recorded,
    usageIds: normalizedUsageIds,
  };
}
