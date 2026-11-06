import type { HostedLinqChatSummary } from "@/src/lib/hosted-onboarding/linq-client";

/** Synthetic provider observation; callers can pin time or incomplete evidence. */
export function linqRoster(input: Pick<HostedLinqChatSummary, "handles"> & Partial<HostedLinqChatSummary>): HostedLinqChatSummary {
  return { isGroup: true, handleCount: input.handles.length, handlesComplete: true, observedAt: new Date(), ...input };
}
