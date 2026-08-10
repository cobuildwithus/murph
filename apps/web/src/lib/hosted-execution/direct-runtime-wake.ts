import { randomUUID } from "node:crypto";

import type {
  CloudflareHostedControlRuntimeEnsureProcessingTiming,
} from "@murphai/cloudflare-hosted-control/client";

import { readHostedExecutionControlClientIfConfigured } from "./control";
import { describeHostedExecutionSafeLogErrorCode } from "./logging";

export type HostedDirectRuntimeWakeSource =
  | "assistant-ask-completion"
  | "assistant-ask-request"
  | "linq";

/**
 * Issues a consent-serialized container start hint and always settles. This
 * does not create a write fence, resolve processing ownership, or invoke
 * workspace work; the ordinary post-Temporal ensure remains authoritative for
 * all of those steps.
 */
export function startHostedRuntimeShellPrewarmBestEffort(input: {
  source: "linq-instant-start" | "linq-typing-started";
  userId: string;
}): Promise<void> {
  const wakeSource = input.source;
  let client: ReturnType<typeof readHostedExecutionControlClientIfConfigured>;
  try {
    client = readHostedExecutionControlClientIfConfigured();
  } catch (error) {
    console.warn("Hosted runtime shell prewarm client is misconfigured.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      source: wakeSource,
    });
    return Promise.resolve();
  }
  if (!client) {
    return Promise.resolve();
  }

  try {
    return client
      .prewarmRuntimeShell({
        source: input.source,
        userId: input.userId,
      })
      .then((result) => {
        console.info("Hosted runtime shell prewarm accepted.", {
          accepted: result.accepted,
          source: wakeSource,
        });
      })
      .catch((error: unknown) => {
        console.warn("Hosted runtime shell prewarm failed.", {
          errorName: describeHostedExecutionSafeLogErrorCode(error),
          source: wakeSource,
        });
      });
  } catch (error) {
    console.warn("Hosted runtime shell prewarm failed.", {
      errorName: describeHostedExecutionSafeLogErrorCode(error),
      source: wakeSource,
    });
    return Promise.resolve();
  }
}

/**
 * Starts the payloadless Cloudflare latency hint and always settles. Temporal
 * must accept the durable mailbox signal before a caller invokes this helper.
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
