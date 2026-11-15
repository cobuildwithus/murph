import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import {
  CLOUDFLARE_HOSTED_RUNTIME_COMPLETION_ENDPOINT,
} from "./internal-hosts.ts";
import {
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
} from "./runner-outbound/headers.ts";
import type {
  HostedExecutionRunnerJobInput,
  HostedExecutionRunnerJobResult,
} from "./runner-job-transport.ts";

import {
  HOSTED_RUNTIME_COMPLETION_RECEIPT_REASONS,
  type HostedRuntimeCompletionReceipt,
} from "./runtime-completion-receipt.ts";

export const HOSTED_CONTAINER_RUNTIME_COMPLETION_TIMEOUT_MS = 1_000;

export async function recordHostedContainerRuntimeCompletionBestEffort(input: {
  fetchImpl?: typeof fetch;
  job: HostedExecutionRunnerJobInput;
  result: HostedExecutionRunnerJobResult;
}): Promise<void> {
  const attemptId = input.job.request.attemptId;
  const userId = input.job.request.userId;
  let receipt: HostedRuntimeCompletionReceipt = { completed: false };
  let failure: unknown;

  try {
    const fetchImpl = input.fetchImpl ?? fetch;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      receipt = await Promise.race([
        fetchImpl(CLOUDFLARE_HOSTED_RUNTIME_COMPLETION_ENDPOINT, {
          body: JSON.stringify({ result: input.result }),
          headers: {
            "content-type": "application/json; charset=utf-8",
            [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: userId,
            [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: attemptId,
            [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]:
              input.job.request.leaseGeneration,
          },
          method: "POST",
          signal: AbortSignal.timeout(
            HOSTED_CONTAINER_RUNTIME_COMPLETION_TIMEOUT_MS,
          ),
        }).then(readHostedContainerRuntimeCompletionReceipt),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(
              "Hosted container runtime completion receipt timed out.",
            ));
          }, HOSTED_CONTAINER_RUNTIME_COMPLETION_TIMEOUT_MS);
          timeoutId.unref?.();
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  } catch (error) {
    failure = error;
  }

  const { completed, reason } = receipt;
  const obsolete = !completed
    && (reason === "already_completed" || reason === "superseded");
  emitHostedExecutionStructuredLog({
    component: "container",
    details: {
      ...(failure ? buildHostedExecutionSafeErrorDiagnostics(failure) : {}),
      runtimeCompletionReceiptOutcome: completed
        ? "recorded"
        : "not_recorded",
      ...(reason ? { runtimeCompletionReceiptReason: reason } : {}),
      workspaceAttemptId: attemptId,
    },
    level: completed || obsolete ? "info" : "warn",
    message: completed
      ? "Hosted container recorded runtime completion with the durable fence owner."
      : obsolete
        ? "Hosted container runtime completion callback is obsolete; preserving completed result."
        : "Hosted container did not record runtime completion; preserving completed result.",
    phase: "checkpoint",
    userId,
  });
}

async function readHostedContainerRuntimeCompletionReceipt(
  response: Response,
): Promise<HostedRuntimeCompletionReceipt> {
  if (!response.ok) {
    throw new Error(
      `Hosted container runtime completion receipt returned HTTP ${response.status}.`,
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
    throw new TypeError("Hosted container runtime completion receipt was invalid.");
  }
  // Boolean-only receipts remain valid during rolling deployments. Never let
  // unknown wire text suppress warnings or attach a rejection to success.
  if (receipt.completed) return { completed: true };
  const reason = "reason" in receipt
    ? HOSTED_RUNTIME_COMPLETION_RECEIPT_REASONS.find(value => value === receipt.reason)
    : undefined;
  return { completed: false, ...(reason ? { reason } : {}) };
}
