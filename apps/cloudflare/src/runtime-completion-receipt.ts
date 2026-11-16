import type { HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";

/** Optional diagnostics only; completed remains the completion acknowledgment. */
export const HOSTED_RUNTIME_COMPLETION_RECEIPT_REASONS = [
  "already_completed",
  "superseded",
  "owner_unconfirmed",
  "native_receipt_mismatch",
  "canonical_completion_rejected",
] as const;

export type HostedRuntimeCompletionReceiptReason =
  (typeof HOSTED_RUNTIME_COMPLETION_RECEIPT_REASONS)[number];

export type HostedRuntimeCompletionReceipt =
  | { completed: true; reason?: never }
  | { completed: false; reason?: HostedRuntimeCompletionReceiptReason };

export function obsoleteRuntimeCompletionReason(
  owner: HostedRuntimeOwnerSnapshot | null,
  generation: string,
): "already_completed" | "superseded" | undefined {
  if (!owner) return undefined;
  // Release clears the attempt. Idle without completion is not success proof.
  if (owner.generation === generation && owner.phase === "idle"
    && owner.attemptId === null && owner.completedAt) return "already_completed";
  // Callback headers have only presence validation. Malformed generations must
  // neither throw during diagnostics nor suppress a warning.
  if (/^[0-9]{1,19}$/u.test(generation)
    && BigInt(owner.generation) > BigInt(generation)) return "superseded";
  return undefined;
}
