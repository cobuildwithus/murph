import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedActionApprovalObservation,
  parseHostedActionApprovalResult,
} from "@murphai/hosted-execution/action-approval";
import {
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedWebActionApprovalPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async consume(
      request: Parameters<
        NonNullable<HostedRuntimePlatform["actionApprovalPort"]>["consume"]
      >[0],
    ) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted action approval consume",
        fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.actionApprovalConsume,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedActionApprovalResult(payload);
    },

    async read(
      request: Parameters<
        NonNullable<HostedRuntimePlatform["actionApprovalPort"]>["read"]
      >[0],
    ) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted action approval read",
        fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.actionApprovalRead,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedActionApprovalObservation(payload);
    },

    async request(
      request: Parameters<
        NonNullable<HostedRuntimePlatform["actionApprovalPort"]>["request"]
      >[0],
    ) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted action approval request",
        fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.actionApprovalRequest,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedActionApprovalResult(payload);
    },
  };
}
