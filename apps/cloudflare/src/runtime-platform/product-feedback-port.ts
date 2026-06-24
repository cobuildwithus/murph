import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeProductFeedbackRecordResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeProductFeedbackPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["productFeedbackPort"]> {
  return {
    async recordProductFeedback(feedback) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: { feedback },
        boundUserId: input.boundUserId,
        description: "Hosted product feedback recording",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeProductFeedbackRecordResponse(payload);
      } catch (error) {
        throw new Error("Hosted product feedback recording returned invalid JSON.", {
          cause: error,
        });
      }
    },
  };
}
