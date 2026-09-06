import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeUsageRecordResponse,
  type HostedRuntimeUsageRecordResponse,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES,
  type HostedRuntimeUsageRecordRequest,
  type HostedRuntimeUsageNoticeDeliveryTarget,
} from "@murphai/hosted-execution/runtime-control";
import { incrementCliTimingDrop, normalizeCliTiming } from "@murphai/runtime-state/cli-timing";
import {
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeUsageRecordPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["usageRecordPort"]> {
  return {
    async recordUsage(record, noticeDeliveryTarget) {
      return recordHostedRuntimeUsageRecord({
        boundUserId: input.boundUserId,
        fetchImpl: input.fetchImpl,
        ...(noticeDeliveryTarget === undefined ? {} : { noticeDeliveryTarget }),
        record,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
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
}): Promise<HostedRuntimeUsageRecordResponse> {
  const payload = await fetchHostedWebControlPlaneJson({
    body: boundUsageRequestCliTiming({
      ...(input.noticeDeliveryTarget === undefined
        ? {}
        : { noticeDeliveryTarget: input.noticeDeliveryTarget }),
      usage: input.record,
    }),
    boundUserId: input.boundUserId,
    description: "Hosted usage recording",
    fetchImpl: input.fetchImpl,
    route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.usageRecording,
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

// Datagram/cardinality caps do not bound the merged HTTP request. Trim only
// optional timing, on a copy, before the shared transport serializes/signs it.
function boundUsageRequestCliTiming(
  input: HostedRuntimeUsageRecordRequest,
): HostedRuntimeUsageRecordRequest {
  const sourceProfile = input.usage.turnProfileJson;
  if (!sourceProfile || !("cliTiming" in sourceProfile)) return input;

  const profile = { ...sourceProfile };
  const timing = normalizeCliTiming(profile.cliTiming);
  delete profile.cliTiming;
  const body = { ...input, usage: { ...input.usage, turnProfileJson: profile } };
  if (!timing) return body;

  profile.cliTiming = timing;
  while (new TextEncoder().encode(JSON.stringify(body)).byteLength > HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES) {
    const dropped = timing.commands.pop();
    if (!dropped) {
      // Even the coverage counters do not fit. Absence means unavailable, not
      // zero calls. Never shrink legacy accounting, even if it is oversized.
      delete profile.cliTiming;
      break;
    }
    timing.droppedCalls = incrementCliTimingDrop(timing.droppedCalls, dropped.calls);
  }
  return body;
}
