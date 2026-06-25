import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { parseHostedActionApprovalResult } from "@murphai/hosted-execution/action-approval";
import { HOSTED_RUNTIME_ACTION_APPROVAL_REQUEST_PATH } from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedWebActionApprovalPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
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
        path: HOSTED_RUNTIME_ACTION_APPROVAL_REQUEST_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedActionApprovalResult(payload);
    },
  };
}
