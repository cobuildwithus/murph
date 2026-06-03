import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { parseHostedRuntimeLatencyTraceResponse } from "@murphai/hosted-execution/parsers";
import { HOSTED_RUNTIME_LATENCY_TRACE_PATH } from "@murphai/hosted-execution/routes";
import type { HostedRuntimeLatencyTraceResponse } from "@murphai/hosted-execution/runtime-control";

import type { HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import { writeRunnerRuntimeWriteFenceHeaders } from "../runner-outbound/write-fence.ts";
import { fetchHostedWebControlPlaneJson, type HostedWebControlTransport } from "./web-control-transport.ts";

const HOSTED_RUNTIME_LATENCY_TRACE_SKIPPED_RESPONSE: HostedRuntimeLatencyTraceResponse = {
  matchedCount: 0,
  recorded: false,
  unmatchedCount: 0,
};

export function createHostedWebRuntimeLatencyTracePort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
}) {
  return {
    async record(
      request: Parameters<NonNullable<HostedRuntimePlatform["latencyTracePort"]>["record"]>[0],
    ) {
      const headers = input.workspaceCheckpointBridge
        ? await createHostedRuntimeLatencyTraceWriteFenceHeaders({
          request,
          workspaceCheckpointBridge: input.workspaceCheckpointBridge,
        })
        : undefined;
      if (headers === null) {
        return HOSTED_RUNTIME_LATENCY_TRACE_SKIPPED_RESPONSE;
      }
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted runtime latency trace",
        fetchImpl: input.fetchImpl,
        headers,
        path: HOSTED_RUNTIME_LATENCY_TRACE_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeLatencyTraceResponse(payload);
      } catch (error) {
        throw new Error("Hosted runtime latency trace returned invalid JSON.", {
          cause: error,
        });
      }
    },
  };
}

async function createHostedRuntimeLatencyTraceWriteFenceHeaders(input: {
  request: Parameters<NonNullable<HostedRuntimePlatform["latencyTracePort"]>["record"]>[0];
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}): Promise<Headers | null> {
  const eventRuntimeAttemptId = input.request.event.runtimeAttemptId?.trim() ?? "";
  if (!eventRuntimeAttemptId) {
    return null;
  }

  const lease = await input.workspaceCheckpointBridge.readCurrentLease();
  if (!lease || lease.attemptId !== eventRuntimeAttemptId) {
    return null;
  }

  const headers = new Headers();
  writeRunnerRuntimeWriteFenceHeaders(headers, lease);
  return headers;
}
