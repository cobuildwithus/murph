export const HOSTED_MAILBOX_SYSTEM_AI_USAGE_GATED_KINDS = [
  "runtime.manual-requested",
] as const;

export function hostedMailboxSystemItemKindNeedsAiUsageGate(kind: string): boolean {
  return HOSTED_MAILBOX_SYSTEM_AI_USAGE_GATED_KINDS.some((gatedKind) =>
    gatedKind === kind
  );
}
