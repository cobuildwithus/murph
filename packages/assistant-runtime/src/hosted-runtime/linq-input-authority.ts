import {
  writeAssistantAutoReplySuppressionEvidence,
  type AssistantInputCandidateBatch,
} from "@murphai/assistant-engine";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

import type {
  HostedRuntimeEffectsPort,
} from "./platform.ts";

const REVOKED_LINQ_INPUT_AUTHORITY_CODES = new Set([
  "HOSTED_LINQ_EGRESS_BOUND_USER_MISMATCH",
  "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
  "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
]);

export async function filterHostedAssistantInputBatchByLinqRouteAuthority(input: {
  batch: AssistantInputCandidateBatch;
  effectsPort?: Pick<HostedRuntimeEffectsPort, "assertLinqRecentInboundEngagement"> | null;
  signal?: AbortSignal;
  userId: string;
  vaultRoot: string;
}): Promise<AssistantInputCandidateBatch> {
  const inputs: AssistantInputCandidateBatch["inputs"] = [];

  for (const candidate of input.batch.inputs) {
    const replyTarget = candidate.event.replyTarget;
    if (replyTarget?.channel !== "linq") {
      inputs.push(candidate);
      continue;
    }

    const threadId = replyTarget.threadId?.trim() ?? "";
    const assertAuthority = input.effectsPort?.assertLinqRecentInboundEngagement;
    if (!threadId || !assertAuthority) {
      throw new VaultCliError(
        "ASSISTANT_LINQ_INPUT_AUTHORITY_ASSERT_UNAVAILABLE",
        "Hosted Linq input requires a route-authority assertion before model admission.",
        { retryable: true },
      );
    }

    const hostedMailboxItemId = candidate.event.hostedMailboxItemId?.trim() ?? "";
    if (!hostedMailboxItemId) {
      await writeAssistantAutoReplySuppressionEvidence({
        captureIds: candidate.projection.captureId
          ? [candidate.projection.captureId]
          : [],
        inputIds: [candidate.event.inputId],
        reason: "hosted-linq-route-authority-revoked",
        vault: input.vaultRoot,
      });
      continue;
    }

    const routeAuthority =
      candidate.event.sourceMetadata?.kind === "linq"
      && candidate.event.sourceMetadata.externalThreadRouteAuthorityPresent === true
        ? {
            channel: "linq" as const,
            containerMemberId: input.userId,
            threadId,
          }
        : null;
    try {
      await assertAuthority({
        answeredMailboxItemIds: [hostedMailboxItemId],
        authorityCheckOnly: true,
        idempotencyKey: null,
        replyToMessageId: replyTarget.messageId,
        routeAuthority,
        target: threadId,
        targetKind: "thread",
      }, {
        signal: input.signal,
      });
      inputs.push(candidate);
    } catch (error) {
      if (!isRevokedHostedLinqInputAuthorityError(error)) {
        throw error;
      }
      await writeAssistantAutoReplySuppressionEvidence({
        captureIds: candidate.projection.captureId
          ? [candidate.projection.captureId]
          : [],
        inputIds: [candidate.event.inputId],
        reason: "hosted-linq-route-authority-revoked",
        vault: input.vaultRoot,
      });
    }
  }

  return {
    ...input.batch,
    inputs,
  };
}

function isRevokedHostedLinqInputAuthorityError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if (
    "code" in error
    && typeof error.code === "string"
    && REVOKED_LINQ_INPUT_AUTHORITY_CODES.has(error.code)
  ) {
    return true;
  }

  return "status" in error
    && error.status === 403
    && "retryable" in error
    && error.retryable === false;
}
