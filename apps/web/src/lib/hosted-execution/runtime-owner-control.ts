import { resolveHostedLegacyMaterialization } from "./runtime-materialization";
import { readHostedRuntimeMemberBackend } from "./runtime-cutover";
import { reconcileHostedRuntimeUploads } from "./runtime-upload-recovery";
import type { HostedRuntimeOwner, PrismaClient } from "@prisma/client";
import { parseHostedRuntimeOwnerResponse, type HostedRuntimeOwnerCommand, type HostedRuntimeOwnerResponse } from "@murphai/hosted-execution/runtime-owner";
import {
  recordHostedRuntimeFailure, isHostedRuntimeDeletionReady, recordHostedRuntimeTargetRetired, authorizeHostedRuntimeProvider,
  claimHostedRuntime, prepareHostedRuntimeLaunch, recordHostedRuntimeAccepted,
  releaseHostedRuntimeAfterRetirement, requireHostedRuntimeOwnerTx, retireHostedRuntime,
  revokeHostedRuntimeAiUsageTx, selectHostedRuntimeTarget, releaseHostedRuntimeAfterCompletion,
} from "./runtime-owner";

type CommandInput = { prisma: PrismaClient; userId: string; command: HostedRuntimeOwnerCommand };
type CommandResult = { status: HostedRuntimeOwnerResponse["status"]; owner: HostedRuntimeOwner | null };
type IdentityCommand = Extract<HostedRuntimeOwnerCommand, { attemptId: string }>;

/** Coarse ownership commands. Container and provider work stays in the Worker. */
export async function executeHostedRuntimeOwnerCommand(input: CommandInput): Promise<HostedRuntimeOwnerResponse> {
  if (input.command.operation === "resolve_legacy") {
    const result = await resolveHostedLegacyMaterialization({ ...input.command, prisma: input.prisma, userId: input.userId });
    return parseHostedRuntimeOwnerResponse({ cutover: result.cutover, status: "observed", owner: projectOwner(result.owner) });
  }
  const result = await executeCommand({ ...input, command: input.command });
  const cutover = await readHostedRuntimeMemberBackend(input.prisma, input.userId);
  return parseHostedRuntimeOwnerResponse({ cutover, status: result.status, owner: projectOwner(result.owner) });
}

async function executeCommand(input: Omit<CommandInput, "command"> & { command: Exclude<HostedRuntimeOwnerCommand, { operation: "resolve_legacy" }> }): Promise<CommandResult> {
  const { prisma, userId, command } = input;
  switch (command.operation) {
    case "reconcile":
      return { status: "observed", owner: await prisma.hostedRuntimeOwner.findUnique({ where: { userId } }) };
    case "deletion_ready":
      await reconcileHostedRuntimeUploads({ prisma, now: new Date(), deadlineAtMs: Date.now() + 5_000, deletedUserId: userId });
      return authorized(await isHostedRuntimeDeletionReady(input));
    case "claim": {
      const result = await claimHostedRuntime({ prisma, userId, processingMode: command.processingMode });
      return { status: result.status, owner: result.status === "blocked" ? null : result.owner };
    }
    case "target_retired":
      return mutated(await recordHostedRuntimeTargetRetired({ ...command, prisma, userId }));
    case "authorize_provider": {
      const owner = await authorizeHostedRuntimeProvider({ ...command, prisma, userId });
      return { ...authorized(owner !== null), owner };
    }
    default:
      return executeIdentityCommand({ ...input, command });
  }
}

async function executeIdentityCommand(input: Omit<CommandInput, "command"> & { command: IdentityCommand }): Promise<CommandResult> {
  const { prisma, userId, command } = input;
  const identity = { userId, attemptId: command.attemptId, generation: command.generation };
  switch (command.operation) {
    case "select_target":
      return { status: "updated", owner: await selectHostedRuntimeTarget({ prisma, identity, runnerContainerName: command.runnerContainerName }) };
    case "prepare_launch":
      return { status: "updated", owner: await prepareHostedRuntimeLaunch({ ...command, prisma, identity }) };
    case "accepted":
      return mutated(await recordHostedRuntimeAccepted({ prisma, identity }));
    case "record_failure":
      return mutated(await recordHostedRuntimeFailure({ prisma, identity, errorCode: command.errorCode }));
    case "retire":
      return mutated(await retireHostedRuntime({ prisma, identity, completed: command.completed }));
    case "release":
      return mutated(await releaseHostedRuntimeAfterRetirement({ prisma, identity, runnerContainerName: command.runnerContainerName }));
    case "release_completed":
      return mutated(await releaseHostedRuntimeAfterCompletion({ prisma, identity, runnerContainerName: command.runnerContainerName }));
    case "revoke_ai_usage":
      await prisma.$transaction((tx) => revokeHostedRuntimeAiUsageTx(tx, identity));
      return mutated(true);
    case "authorize_effect": {
      const owner = await prisma.$transaction(async (tx) => {
        const current = await requireHostedRuntimeOwnerTx(tx, identity);
        if ((command.runnerContainerName !== null && current.runnerContainerName !== command.runnerContainerName)
          || (command.managedAi && !current.platformAiUsageAllowed)) return null;
        return current;
      });
      return { ...authorized(owner !== null), owner };
    }
  }
}

function mutated(applied: boolean): CommandResult {
  return { status: applied ? "updated" : "stale", owner: null };
}
function authorized(allowed: boolean): CommandResult {
  return { status: allowed ? "authorized" : "blocked", owner: null };
}
function projectOwner(owner: HostedRuntimeOwner | null) {
  return owner ? { ...owner, generation: owner.generation.toString(),
    workspaceVersion: owner.workspaceVersion?.toString() ?? null,
    startedAt: owner.startedAt?.toISOString() ?? null,
    acceptedAt: owner.acceptedAt?.toISOString() ?? null,
    completedAt: owner.completedAt?.toISOString() ?? null } : null;
}
