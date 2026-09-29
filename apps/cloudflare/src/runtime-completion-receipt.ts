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
