import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { parseHostedRuntimeLogResponse } from "@murphai/hosted-execution/parsers";
import { HOSTED_RUNTIME_LOG_PATH } from "@murphai/hosted-execution/routes";

import {
  HOSTED_WEB_CONTROL_ROUTE_NOT_ALLOWLISTED_ERROR_CODE,
} from "../runner-outbound/shared-web-control-policy.ts";
import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedWebRuntimeLogPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async write(
      request: Parameters<NonNullable<HostedRuntimePlatform["logPort"]>["write"]>[0],
      context?: Parameters<NonNullable<HostedRuntimePlatform["logPort"]>["write"]>[1],
    ) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted runtime log write",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_LOG_PATH,
        signal: context?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedRuntimeLogResponse(payload);
    },
  };
}

export function createHostedWebControlLoggingTransport(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport | null;
}): {
  logPort: ReturnType<typeof createHostedWebRuntimeLogPort> | null;
  transport: HostedWebControlTransport | null;
} {
  if (!input.transport) {
    return {
      logPort: null,
      transport: null,
    };
  }

  const logPort = createHostedWebRuntimeLogPort({
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    transport: input.transport,
  });
  return {
    logPort,
    transport: {
      ...input.transport,
      async reportPreflightRejection(rejection) {
        await logPort.write({
          entries: [{
            at: new Date().toISOString(),
            component: "runner",
            errorCode: HOSTED_WEB_CONTROL_ROUTE_NOT_ALLOWLISTED_ERROR_CODE,
            eventCode: "runner.web_control_preflight_rejected",
            level: "warn",
            phase: "invoke",
            redactedJson: {
              method: rejection.method,
              operation: rejection.operation,
              reason: "not_allowlisted",
              transport: rejection.transport,
            },
          }],
        });
      },
    },
  };
}
