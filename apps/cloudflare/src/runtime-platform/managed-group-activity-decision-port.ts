import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeManagedGroupActivityDecisionResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_MANAGED_GROUP_ACTIVITY_DECISION_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeManagedGroupActivityDecisionPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["managedGroupActivityDecisionPort"]> {
  return {
    async read(request, context) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted managed group activity decision",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_MANAGED_GROUP_ACTIVITY_DECISION_PATH,
        signal: context?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeManagedGroupActivityDecisionResponse(payload);
      } catch (error) {
        throw new Error(
          "Hosted managed group activity decision returned invalid JSON.",
          { cause: error },
        );
      }
    },
  };
}
