import { randomUUID } from "node:crypto";

import type {
  CloudflareHostedControlRuntimeEnsureProcessingTiming,
} from "@murphai/cloudflare-hosted-control/client";

import { readHostedExecutionControlClientIfConfigured } from "./control";
import { describeHostedExecutionSafeLogErrorCode } from "./logging";

export type HostedDirectRuntimeWakeSource =
  | "assistant-ask-completion"
  | "assistant-ask-request"
  | "linq"
  | "linq-instant-start";

/**
 * Starts the payloadless Cloudflare latency hint and always settles. Temporal
 * must accept the durable mailbox signal before a caller invokes this helper,
 * with one exception: the `linq-instant-start` prewarm fires right after the
 * planner transaction creating the instant-start member commits, because the
 * same webhook request then performs the ordinary Temporal-then-direct wake
 * and the ensure grants no authority either way.
 */
export function startHostedDirectRuntimeWakeBestEffort(input: {
  onTiming?: (
    timing: CloudflareHostedControlRuntimeEnsureProcessingTiming,
  ) => Promise<void> | void;
  source: HostedDirectRuntimeWakeSource;
  userId: string;
}): Promise<void> {
  const wakeSource = input.source;
  let client: ReturnType<typeof readHostedExecutionControlClientIfConfigured>;
  try {
    client = readHostedExecutionControlClientIfConfigured();
  } catch (error) {
    console.warn("Hosted direct ensure wake client is misconfigured.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      source: wakeSource,
    });
    return Promise.resolve();
  }
  if (!client) {
    return Promise.resolve();
  }

  try {
    let timing: CloudflareHostedControlRuntimeEnsureProcessingTiming | null = null;
    return client
      .ensureRuntimeProcessing({
        onTiming: (value) => {
          timing = value;
        },
        orchestrationAttemptId: `web-ingress-${randomUUID()}`,
        userId: input.userId,
      })
      .then((ensureResult) => {
        if ("kind" in ensureResult) {
          console.info("Hosted direct ensure wake completed.", {
            kind: ensureResult.kind,
            ...(ensureResult.kind === "runtime_processing_accepted"
              ? { action: ensureResult.action }
              : {}),
            source: wakeSource,
          });
          return;
        }

        console.info("Hosted direct ensure wake accepted.", {
          accepted: ensureResult.accepted,
          source: wakeSource,
        });
      })
      .catch((error: unknown) => {
        console.warn("Hosted direct ensure wake failed.", {
          errorName: describeHostedExecutionSafeLogErrorCode(error),
          source: wakeSource,
        });
      })
      .finally(async () => {
        if (!timing || !input.onTiming) {
          return;
        }
        try {
          await input.onTiming(timing);
        } catch (error) {
          console.warn("Hosted direct ensure wake timing callback failed.", {
            errorName: describeHostedExecutionSafeLogErrorCode(error),
            source: wakeSource,
          });
        }
      });
  } catch (error) {
    console.warn("Hosted direct ensure wake failed.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      source: wakeSource,
    });
    return Promise.resolve();
  }
}
