import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeUsageAllowanceResponse,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeUsageAllowanceRequest,
  HostedRuntimeUsageAllowanceResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_RUNTIME_USAGE_RESERVATION_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeUsageAllowancePort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["usageAllowancePort"]> {
  return {
    applyUsageAllowance(request) {
      return applyHostedRuntimeUsageAllowance({
        boundUserId: input.boundUserId,
        fetchImpl: input.fetchImpl,
        request,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });
    },
  };
}

export async function applyHostedRuntimeUsageAllowance(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  request: HostedRuntimeUsageAllowanceRequest;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): Promise<HostedRuntimeUsageAllowanceResponse> {
  const payload = await fetchHostedWebControlPlaneJson({
    body: input.request,
    boundUserId: input.boundUserId,
    description: "Hosted usage allowance reservation",
    fetchImpl: input.fetchImpl,
    path: HOSTED_RUNTIME_USAGE_RESERVATION_PATH,
    timeoutMs: input.timeoutMs,
    transport: input.transport,
  });

  try {
    const response = parseHostedRuntimeUsageAllowanceResponse(payload);
    if (
      response.action !== input.request.action
      || response.requestId !== input.request.requestId
    ) {
      throw new TypeError(
        "Hosted usage allowance response did not match its request.",
      );
    }
    return response;
  } catch (error) {
    throw new Error(
      "Hosted usage allowance reservation returned invalid JSON.",
      { cause: error },
    );
  }
}
