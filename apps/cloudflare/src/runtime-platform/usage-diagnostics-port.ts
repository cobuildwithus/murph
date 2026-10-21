import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedUsageDiagnosticsResponse,
  type HostedUsageDiagnosticsRequest,
} from "@murphai/hosted-execution/usage-diagnostics";
import {
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeUsageDiagnosticsPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["usageDiagnosticsPort"]> {
  return {
    async read(request: HostedUsageDiagnosticsRequest) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted usage diagnostics",
        fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.usageDiagnostics,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedUsageDiagnosticsResponse(payload);
      } catch (error) {
        throw new Error("Hosted usage diagnostics returned invalid JSON.", {
          cause: error,
        });
      }
    },
  };
}
