import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeUsageRecordResponse,
  type HostedRuntimeUsageRecordResponse,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import type {
  HostedRuntimeUsageNoticeDeliveryTarget,
  HostedRuntimeUsageAttribution,
} from "@murphai/hosted-execution/runtime-control";
import { HOSTED_RUNTIME_USAGE_RECORD_PATH } from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeUsageRecordPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
  usageAttribution?: HostedRuntimeUsageAttribution | null;
}): NonNullable<HostedRuntimePlatform["usageRecordPort"]> {
  return {
    async recordUsage(record, noticeDeliveryTarget, usageAttribution) {
      const effectiveUsageAttribution = usageAttribution === undefined
        ? input.usageAttribution
        : usageAttribution;
      return recordHostedRuntimeUsageRecord({
        boundUserId: input.boundUserId,
        fetchImpl: input.fetchImpl,
        ...(noticeDeliveryTarget === undefined ? {} : { noticeDeliveryTarget }),
        record,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
        ...(effectiveUsageAttribution
          ? { usageAttribution: effectiveUsageAttribution }
          : {}),
      });
    },
  };
}

export async function recordHostedRuntimeUsageRecord(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  noticeDeliveryTarget?: HostedRuntimeUsageNoticeDeliveryTarget | null;
  record: AssistantUsageRecord;
  timeoutMs: number;
  transport: HostedWebControlTransport;
  usageAttribution?: HostedRuntimeUsageAttribution | null;
}): Promise<HostedRuntimeUsageRecordResponse> {
  const payload = await fetchHostedWebControlPlaneJson({
    body: {
      ...(input.noticeDeliveryTarget === undefined
        ? {}
        : { noticeDeliveryTarget: input.noticeDeliveryTarget }),
      ...(input.usageAttribution == null
        ? {}
        : { usageAttribution: input.usageAttribution }),
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
