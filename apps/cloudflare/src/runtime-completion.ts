import type {
  HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import {
  CLOUDFLARE_HOSTED_RUNTIME_COMPLETION_ENDPOINT,
} from "./internal-hosts.ts";
import {
  createCloudflareHostedInternalFetch,
} from "./runtime-platform/provider-fetch.ts";
import {
  normalizeCloudflareWorkerFetch,
} from "./worker-fetch.ts";

const HOSTED_RUNTIME_COMPLETION_RECEIPT_TIMEOUT_MS = 5_000;

interface HostedRuntimeCompletionLease {
  attemptId: string;
  leaseGeneration: string;
  providerEgressToken?: string | null;
  userId: string;
  workspaceVersion: string;
}

export async function recordHostedRuntimeCompletionFromContainerBestEffort(
  input: {
    lease: HostedRuntimeCompletionLease;
    result: HostedAssistantWorkspaceRuntimeJobResult;
  },
): Promise<"failed" | "recorded" | "superseded"> {
  try {
    const internalFetch = createCloudflareHostedInternalFetch(
      input.lease.userId,
      normalizeCloudflareWorkerFetch(),
      {
        injectBoundUserIdHeader: true,
        readCurrentLease: () => input.lease,
      },
    );
    const response = await internalFetch(
      CLOUDFLARE_HOSTED_RUNTIME_COMPLETION_ENDPOINT,
      {
        body: JSON.stringify({ result: input.result }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
        signal: AbortSignal.timeout(
          HOSTED_RUNTIME_COMPLETION_RECEIPT_TIMEOUT_MS,
        ),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Hosted runtime completion receipt returned HTTP ${response.status}.`,
      );
    }
    const receipt: unknown = await response.json();
    if (
      !receipt
      || typeof receipt !== "object"
      || Array.isArray(receipt)
      || !("completed" in receipt)
      || typeof receipt.completed !== "boolean"
    ) {
      throw new TypeError("Hosted runtime completion receipt was invalid.");
    }
    return receipt.completed ? "recorded" : "superseded";
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "container",
      details: {
        runtimeCompletionReceiptOutcome: "failed",
        workspaceAttemptId: input.lease.attemptId,
      },
      error,
      level: "warn",
      message:
        "Hosted container could not report runtime completion to the durable fence owner.",
      phase: "checkpoint",
      userId: input.lease.userId,
    });
    return "failed";
  }
}
