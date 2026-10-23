import type { HostedRuntimeOwner } from "@prisma/client";

export function projectHostedRuntimeOwner(owner: HostedRuntimeOwner | null) {
  if (!owner) return null;
  // Accounting authority stays on Web; the runtime cannot select a beneficiary.
  return { userId: owner.userId, generation: owner.generation.toString(),
    attemptId: owner.attemptId, phase: owner.phase, processingMode: owner.processingMode,
    allocationId: owner.allocationId, runnerContainerName: owner.runnerContainerName,
    platformAiUsageAllowed: owner.platformAiUsageAllowed,
    failureCount: owner.failureCount, lastErrorCode: owner.lastErrorCode,
    workspaceVersion: owner.workspaceVersion?.toString() ?? null,
    startedAt: owner.startedAt?.toISOString() ?? null,
    acceptedAt: owner.acceptedAt?.toISOString() ?? null,
    completedAt: owner.completedAt?.toISOString() ?? null };
}
