import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeUsageRecordResponse,
  type HostedRuntimeUsageRecordResponse,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import { HOSTED_RUNTIME_USAGE_RECORD_PATH } from "@murphai/hosted-execution/routes";
import type {
  HostedRuntimeUsageNoticeDeliveryTarget,
  HostedWorkspaceInvocationProcessingMode,
} from "@murphai/hosted-execution/runtime-control";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeUsageRecordPort(input: {
  acceptedConversationAt?: string | null;
  acceptedConversationSeq?: string | null;
  boundUserId: string;
  fetchImpl: typeof fetch;
  processingMode?: HostedWorkspaceInvocationProcessingMode | null;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["usageRecordPort"]> {
  return {
    async recordUsage(record, noticeDeliveryTarget) {
      return recordHostedRuntimeUsageRecord({
        acceptedConversationAt: input.acceptedConversationAt ?? null,
        acceptedConversationSeq: input.acceptedConversationSeq ?? null,
        boundUserId: input.boundUserId,
        fetchImpl: input.fetchImpl,
        processingMode: input.processingMode ?? null,
        ...(noticeDeliveryTarget === undefined ? {} : { noticeDeliveryTarget }),
        record,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });
    },
  };
}

export async function recordHostedRuntimeUsageRecord(input: {
  acceptedConversationAt?: string | null;
  acceptedConversationSeq?: string | null;
  boundUserId: string;
  fetchImpl: typeof fetch;
  noticeDeliveryTarget?: HostedRuntimeUsageNoticeDeliveryTarget | null;
  processingMode?: HostedWorkspaceInvocationProcessingMode | null;
  record: AssistantUsageRecord;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): Promise<HostedRuntimeUsageRecordResponse> {
  const payload = await fetchHostedWebControlPlaneJson({
    body: {
      ...(input.acceptedConversationAt
        ? { acceptedConversationAt: input.acceptedConversationAt }
        : {}),
      ...(input.acceptedConversationSeq
        ? { acceptedConversationSeq: input.acceptedConversationSeq }
        : {}),
      ...(input.processingMode ? { processingMode: input.processingMode } : {}),
      ...(input.noticeDeliveryTarget === undefined
        ? {}
        : { noticeDeliveryTarget: input.noticeDeliveryTarget }),
      usage: input.record,
    },
    boundUserId: input.boundUserId,
    description: "Hosted usage recording",
    fetchImpl: input.fetchImpl,
    path: HOSTED_RUNTIME_USAGE_RECORD_PATH,
    timeoutMs: input.timeoutMs,
    transport: input.transport,
  });

  try {
    return parseHostedRuntimeUsageRecordResponse(payload);
  } catch (error) {
    throw new Error("Hosted usage recording returned invalid JSON.", {
      cause: error,
    });
  }
}
