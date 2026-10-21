import { readHostedRuntimeMemberBackend } from "./runtime-cutover";
import type { HostedRuntimeOwner, PrismaClient } from "@prisma/client";
import { parseHostedRuntimeOwnerResponse, type HostedRuntimeOwnerCommand, type HostedRuntimeOwnerResponse } from "@murphai/hosted-execution/runtime-owner";
import {
  recordHostedRuntimeFailure, isHostedRuntimeDeletionReady, recordHostedRuntimeTargetRetired, authorizeHostedRuntimeProvider,
  claimHostedRuntime, prepareHostedRuntimeLaunch, recordHostedRuntimeAccepted,
  releaseHostedRuntimeAfterRetirement, authorizeHostedRuntimeEffect, retireHostedRuntime,
  revokeHostedRuntimeAiUsageTx, selectHostedRuntimeTarget, releaseHostedRuntimeAfterCompletion,
} from "./runtime-owner";

type CommandInput = { prisma: PrismaClient; userId: string; command: HostedRuntimeOwnerCommand };
type CommandResult = { cutover?: HostedRuntimeOwnerResponse["cutover"]; status: HostedRuntimeOwnerResponse["status"]; owner: HostedRuntimeOwner | null;
  blockedReason?: HostedRuntimeOwnerResponse["blockedReason"] };
type IdentityCommand = Exclude<Extract<HostedRuntimeOwnerCommand, { attemptId: string }>, { operation: "authorize_effect" }>;

/** Durable ownership commands. The HTTP boundary owns advisory completion hints. */
export async function executeHostedRuntimeOwnerCommand(input: CommandInput): Promise<HostedRuntimeOwnerResponse> {
  if (input.command.operation === "resolve_legacy") {
    const { resolveHostedLegacyMaterialization } = await import("./runtime-materialization");
    const result = await resolveHostedLegacyMaterialization({ ...input.command, prisma: input.prisma, userId: input.userId });
    return parseHostedRuntimeOwnerResponse({ cutover: result.cutover, status: "observed", owner: projectOwner(result.owner) });
  }
  if (input.command.operation === "authorize_provider" || input.command.operation === "authorize_effect") {
    const result = input.command.operation === "authorize_provider"
      ? await authorizeHostedRuntimeProvider({ ...input.command, prisma: input.prisma, userId: input.userId })
      : await authorizeHostedRuntimeEffect({ ...input.command, prisma: input.prisma, userId: input.userId });
    return parseHostedRuntimeOwnerResponse({ cutover: result.cutover,
      status: result.owner ? "authorized" : "blocked", owner: projectOwner(result.owner) });
  }
  const result = await executeCommand({ ...input, command: input.command });
  const cutover = result.cutover ?? await readHostedRuntimeMemberBackend(input.prisma, input.userId);
  return parseHostedRuntimeOwnerResponse({ cutover, status: result.status, owner: projectOwner(result.owner),
    blockedReason: result.blockedReason });
}

async function executeCommand(input: Omit<CommandInput, "command"> & { command: Exclude<HostedRuntimeOwnerCommand, { operation: "resolve_legacy" | "authorize_provider" | "authorize_effect" }> }): Promise<CommandResult> {
  const { prisma, userId, command } = input;
  switch (command.operation) {
    case "reconcile":
      return { status: "observed", owner: await prisma.hostedRuntimeOwner.findUnique({ where: { userId } }) };
    case "deletion_ready": {
      const { reconcileHostedRuntimeUploads } = await import("./runtime-upload-recovery");
      await reconcileHostedRuntimeUploads({ prisma, now: new Date(), deadlineAtMs: Date.now() + 5_000, deletedUserId: userId });
      return authorized(await isHostedRuntimeDeletionReady(input));
    }
    case "claim": {
      const result = await claimHostedRuntime({ prisma, userId, processingMode: command.processingMode });
      return result.status === "blocked"
        ? { cutover: result.cutover, status: result.status, owner: null, blockedReason: result.reason }
        : { cutover: result.cutover, status: result.status, owner: result.owner };
    }
    case "target_retired":
      return mutated(await recordHostedRuntimeTargetRetired({ ...command, prisma, userId }));
    default:
      return executeIdentityCommand({ ...input, command });
  }
}

async function executeIdentityCommand(input: Omit<CommandInput, "command"> & { command: IdentityCommand }): Promise<CommandResult> {
  const { prisma, userId, command } = input;
  const identity = { userId, attemptId: command.attemptId, generation: command.generation };
  switch (command.operation) {
    case "select_target":
      return { cutover: "postgres", status: "updated", owner: await selectHostedRuntimeTarget({ prisma, identity, runnerContainerName: command.runnerContainerName }) };
    case "prepare_launch":
      return { cutover: "postgres", status: "updated", owner: await prepareHostedRuntimeLaunch({ ...command, prisma, identity }) };
    case "accepted":
      return mutated(await recordHostedRuntimeAccepted({ prisma, identity }));
    case "record_failure":
      return mutated(await recordHostedRuntimeFailure({ prisma, identity, errorCode: command.errorCode }));
    case "complete": {
      if (!await retireHostedRuntime({ prisma, identity, completed: true })) return mutated(false);
      if (command.settledRunnerContainerName !== null && !await releaseHostedRuntimeAfterCompletion({
        prisma, identity, runnerContainerName: command.settledRunnerContainerName,
      })) return mutated(false);
      return mutated(true);
    }
    case "retire":
      return mutated(await retireHostedRuntime({ prisma, identity, completed: command.completed }));
    case "release":
      return mutated(await releaseHostedRuntimeAfterRetirement({ prisma, identity, runnerContainerName: command.runnerContainerName }));
    case "release_completed":
      return mutated(await releaseHostedRuntimeAfterCompletion({ prisma, identity, runnerContainerName: command.runnerContainerName }));
    case "revoke_ai_usage":
      await prisma.$transaction((tx) => revokeHostedRuntimeAiUsageTx(tx, identity));
      return mutated(true);
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
