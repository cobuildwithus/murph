import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeProductFeedbackRecordResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedRuntimeProductFeedbackRecord,
} from "@murphai/hosted-execution/runtime-control";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

const HOSTED_PRODUCT_FEEDBACK_RECORD_TIMEOUT_MS = 2_000;
const HOSTED_PRODUCT_SUPPORT_RECORD_TIMEOUT_MS = 12_000;
const HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX = "Support escalation:";
const HOSTED_PRODUCT_FEEDBACK_RESPONSE_MAX_BYTES = 4 * 1024;

export function createHostedRuntimeProductFeedbackPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["productFeedbackPort"]> {
  return {
    async recordProductFeedback(feedback) {
      const timeoutMs = resolveHostedProductFeedbackRecordTimeoutMs({
        feedback,
        timeoutMs: input.timeoutMs,
      });
      const payload = await fetchHostedWebControlPlaneJson({
        body: { feedback },
        boundUserId: input.boundUserId,
        description: "Hosted product feedback recording",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH,
        sensitiveResponseBody: {
          maxBytes: HOSTED_PRODUCT_FEEDBACK_RESPONSE_MAX_BYTES,
        },
        signal: AbortSignal.timeout(timeoutMs),
        timeoutMs,
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

export function resolveHostedProductFeedbackRecordTimeoutMs(input: {
  feedback: Pick<HostedRuntimeProductFeedbackRecord, "summary">;
  timeoutMs: number;
}): number {
  const operationTimeoutMs = input.feedback.summary.startsWith(
    HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
  )
    ? HOSTED_PRODUCT_SUPPORT_RECORD_TIMEOUT_MS
    : HOSTED_PRODUCT_FEEDBACK_RECORD_TIMEOUT_MS;

  return Math.min(input.timeoutMs, operationTimeoutMs);
}
