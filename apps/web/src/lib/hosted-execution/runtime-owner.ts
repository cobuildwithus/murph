import { HOSTED_RUNTIME_REPLICA_POST_STOP_DRAIN_MS } from "@murphai/hosted-execution/runtime-resources";
import { randomUUID } from "node:crypto";

import type { HostedRuntimeOwner, Prisma, PrismaClient } from "@prisma/client";
import type { HostedWorkspaceInvocationProcessingMode } from "@murphai/hosted-execution/runtime-control";

import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { readHostedHealthDataConsentState } from "../legal/consent";
import { lockHostedRuntimeMemberCutoverTx } from "./runtime-cutover";

export interface HostedRuntimeIdentity {
  userId: string;
  attemptId: string;
  generation: string;
}

type OwnerTransaction = Prisma.TransactionClient;
const OWNER_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 5_000 };

export async function claimHostedRuntime(input: {
  prisma: PrismaClient;
  userId: string;
  processingMode: HostedWorkspaceInvocationProcessingMode;
  now?: Date;
}): Promise<
  | { status: "claimed" | "existing"; owner: HostedRuntimeOwner }
  | { status: "blocked"; reason: "cutover" | "admission" }
> {
  return input.prisma.$transaction(async (tx) => {
    if (await lockHostedRuntimeMemberCutoverTx(tx, input.userId) !== "postgres") {
      return { status: "blocked", reason: "cutover" };
    }
    await lockHostedMemberRow(tx, input.userId);
    if (!await runtimeAdmissionAllowedTx(tx, input.userId, input.processingMode)) {
      return { status: "blocked", reason: "admission" };
    }
    await lockHostedRuntimeOwnerRowTx(tx, input.userId);
    const existing = await tx.hostedRuntimeOwner.findUnique({ where: { userId: input.userId } });
    if (existing && existing.phase !== "idle") {
      return { status: "existing", owner: existing };
    }
    const now = input.now ?? new Date();
    const attemptId = `rt_${randomUUID()}`;
    const data = {
      generation: (existing?.generation ?? 0n) + 1n,
      attemptId,
      phase: "starting",
      processingMode: input.processingMode,
      allocationId: existing?.runnerContainerName
        ? existing.allocationId
        : `standby-claim-${randomUUID()}`,
      startedAt: now,
      completedAt: null,
      acceptedAt: null,
      lastErrorCode: null,
      platformAiUsageAllowed: false,
      workspaceVersion: null,
      providerEgressTokenHash: null,
      customInferenceEnvelope: null,
    };
    const owner = existing
      ? await tx.hostedRuntimeOwner.update({ where: { userId: input.userId }, data })
      : await tx.hostedRuntimeOwner.create({ data: { ...data, userId: input.userId, migrationPhase: "postgres" } });
    return { status: "claimed", owner };
  }, OWNER_TRANSACTION_OPTIONS);
}

/** Persist the immutable target and invocation facts before any launch effect.
 * A retry may repeat these facts; it cannot change an admitted invocation.
 */
export async function prepareHostedRuntimeLaunch(input: {
  prisma: PrismaClient;
  identity: HostedRuntimeIdentity;
  runnerContainerName: string;
  workspaceVersion: string;
  providerEgressTokenHash: string | null;
  customInferenceEnvelope: string | null;
  platformAiUsageAllowed: boolean;
  processingMode?: HostedWorkspaceInvocationProcessingMode | null;
}): Promise<HostedRuntimeOwner> {
  return input.prisma.$transaction(async (tx) => {
    const owner = await requireHostedRuntimeOwnerTx(tx, input.identity);
    const workspaceVersion = BigInt(input.workspaceVersion);
    if (owner.runnerContainerName !== null && owner.runnerContainerName !== input.runnerContainerName) {
      throw staleRuntimeError();
    }
    if (owner.workspaceVersion !== null) {
      if (owner.runnerContainerName !== input.runnerContainerName
        || owner.workspaceVersion !== workspaceVersion
        || owner.providerEgressTokenHash !== input.providerEgressTokenHash
        || owner.customInferenceEnvelope !== input.customInferenceEnvelope
        || owner.processingMode !== (input.processingMode ?? owner.processingMode)) {
        throw staleRuntimeError();
      }
      // Usage revocation is monotonic for this attempt; retries never restore it.
      return owner;
    }
    if (owner.phase !== "starting" || !input.runnerContainerName || workspaceVersion < 0n) {
      throw staleRuntimeError();
    }
    return tx.hostedRuntimeOwner.update({
      where: { userId: input.identity.userId },
      data: {
        runnerContainerName: input.runnerContainerName,
        workspaceVersion,
        providerEgressTokenHash: input.providerEgressTokenHash,
        customInferenceEnvelope: input.customInferenceEnvelope,
        platformAiUsageAllowed: input.platformAiUsageAllowed,
        processingMode: input.processingMode ?? owner.processingMode,
      },
    });
  }, OWNER_TRANSACTION_OPTIONS);
}

/** Once selected, the target cannot change even if its bind acknowledgment is lost. */
export async function selectHostedRuntimeTarget(input: {
  prisma: PrismaClient;
  identity: HostedRuntimeIdentity;
  runnerContainerName: string;
}): Promise<HostedRuntimeOwner> {
  return input.prisma.$transaction(async (tx) => {
    const owner = await requireHostedRuntimeOwnerTx(tx, input.identity);
    if (owner.runnerContainerName !== null) return owner;
    if (owner.phase !== "starting" || !input.runnerContainerName) throw staleRuntimeError();
    return tx.hostedRuntimeOwner.update({
      where: { userId: input.identity.userId },
      data: { runnerContainerName: input.runnerContainerName },
    });
  }, OWNER_TRANSACTION_OPTIONS);
}

export async function recordHostedRuntimeAccepted(input: {
  prisma: PrismaClient;
  identity: HostedRuntimeIdentity;
}): Promise<boolean> {
  const result = await input.prisma.hostedRuntimeOwner.updateMany({
    where: { ...identityWhere(input.identity), phase: "starting", runnerContainerName: { not: null }, workspaceVersion: { not: null } },
    data: { phase: "active", acceptedAt: new Date() },
  });
  return result.count === 1;
}

/** Called within the canonical publication transaction, never as its preflight. */
export async function requireHostedRuntimeOwnerTx(
  tx: OwnerTransaction,
  identity: HostedRuntimeIdentity,
): Promise<HostedRuntimeOwner> {
  if (await lockHostedRuntimeMemberCutoverTx(tx, identity.userId) !== "postgres") throw staleRuntimeError();
  return requireOwnerAfterCutoverLockTx(tx, identity);
}

/** Bind even legacy callbacks to the authenticated member. The member lock
 * remains held through canonical publication and fences that member's seal.
 */
export async function requireHostedRuntimeCallbackTx(
  tx: OwnerTransaction,
  userId: string,
  identity: HostedRuntimeIdentity | null,
): Promise<HostedRuntimeOwner | null> {
  if (identity && identity.userId !== userId) throw staleRuntimeError();
  const backend = await lockHostedRuntimeMemberCutoverTx(tx, userId);
  if (backend === "legacy") return null;
  if (backend !== "postgres" || !identity || identity.userId !== userId) throw staleRuntimeError();
  return requireOwnerAfterCutoverLockTx(tx, identity);
}

async function requireOwnerAfterCutoverLockTx(
  tx: OwnerTransaction,
  identity: HostedRuntimeIdentity,
): Promise<HostedRuntimeOwner> {
  await lockHostedMemberRow(tx, identity.userId);
  await lockHostedRuntimeOwnerRowTx(tx, identity.userId);
  const owner = await tx.hostedRuntimeOwner.findUnique({ where: { userId: identity.userId } });
  if (!owner || owner.attemptId !== identity.attemptId
    || owner.generation.toString() !== identity.generation
    || (owner.phase !== "starting" && owner.phase !== "active")
    || !await runtimeAdmissionAllowedTx(tx, identity.userId, owner.processingMode)) {
    throw staleRuntimeError();
  }
  return owner;
}

/** Metadata only: never releases or grants runtime authority. The first failure
 * of an exact attempt is durable and duplicate native reports are idempotent. */
export async function recordHostedRuntimeFailure(input: {
  prisma: PrismaClient; identity: HostedRuntimeIdentity; errorCode: string;
}): Promise<boolean> {
  const result = await input.prisma.hostedRuntimeOwner.updateMany({
    where: { ...identityWhere(input.identity), phase: { in: ["starting", "active", "retiring"] }, lastErrorCode: null },
    data: { lastErrorCode: input.errorCode, failureCount: { increment: 1 } },
  });
  return result.count === 1;
}

/** Completion revokes effects but retains the exact target until adapter proof.
 * No replacement can claim while launch or stop outcomes remain uncertain.
 */
export async function retireHostedRuntime(input: {
  prisma: PrismaClient;
  identity: HostedRuntimeIdentity;
  completed?: boolean;
}): Promise<boolean> {
  return input.prisma.$transaction(async tx => {
    const where = { ...identityWhere(input.identity), phase: { in: ["starting", "active", "retiring"] } };
    const result = await tx.hostedRuntimeOwner.updateMany({ where, data: { phase: "retiring", platformAiUsageAllowed: false } });
    if (result.count === 1 && input.completed) await tx.hostedRuntimeOwner.updateMany({
      where: { ...identityWhere(input.identity), phase: "retiring", completedAt: null }, data: { completedAt: new Date() },
    });
    return result.count === 1;
  }, OWNER_TRANSACTION_OPTIONS);
}

/** The trusted adapter must first prove this exact target cannot execute again.
 * A null target is releasable only after its allocation intent is reconciled.
 */
export async function releaseHostedRuntimeAfterRetirement(input: {
  prisma: PrismaClient;
  identity: HostedRuntimeIdentity;
  runnerContainerName: string | null;
}): Promise<boolean> {
  return input.prisma.$transaction(async tx => {
    const result = await tx.hostedRuntimeOwner.updateMany({
      where: { ...identityWhere(input.identity), phase: "retiring", runnerContainerName: input.runnerContainerName },
      data: {
        phase: "idle", attemptId: null, allocationId: null, runnerContainerName: null,
        processingMode: null, workspaceVersion: null, providerEgressTokenHash: null,
        customInferenceEnvelope: null, platformAiUsageAllowed: false,
      },
    });
    if (result.count === 1) await tx.hostedRuntimePutDrain.updateMany({
      where: { ...identityWhere(input.identity), kind: "replica", uploadId: null, completedAt: null, drainUntil: null },
      data: { drainUntil: new Date(Date.now() + HOSTED_RUNTIME_REPLICA_POST_STOP_DRAIN_MS) },
    });
    return result.count === 1;
  }, OWNER_TRANSACTION_OPTIONS);
}

/** A terminal native invocation receipt permits reuse of the member-bound
 * warm shell. Keep its assignment and cleanup target across the next claim.
 */
export async function releaseHostedRuntimeAfterCompletion(input: {
  prisma: PrismaClient;
  identity: HostedRuntimeIdentity;
  runnerContainerName: string;
}): Promise<boolean> {
  return input.prisma.$transaction(async tx => {
    const result = await tx.hostedRuntimeOwner.updateMany({
      where: {
        ...identityWhere(input.identity), phase: "retiring", completedAt: { not: null },
        runnerContainerName: input.runnerContainerName,
      },
      data: {
        phase: "idle", attemptId: null, processingMode: null,
        workspaceVersion: null, providerEgressTokenHash: null,
        customInferenceEnvelope: null, platformAiUsageAllowed: false,
      },
    });
    if (result.count === 1) await tx.hostedRuntimePutDrain.updateMany({
      where: { ...identityWhere(input.identity), kind: "replica", uploadId: null, completedAt: null, drainUntil: null },
      data: { drainUntil: new Date(Date.now() + HOSTED_RUNTIME_REPLICA_POST_STOP_DRAIN_MS) },
    });
    return result.count === 1;
  }, OWNER_TRANSACTION_OPTIONS);
}

export async function revokeHostedRuntimeAiUsageTx(
  tx: OwnerTransaction,
  identity: HostedRuntimeIdentity,
): Promise<void> {
  await tx.hostedRuntimeOwner.updateMany({
    where: identityWhere(identity), data: { platformAiUsageAllowed: false },
  });
}

async function runtimeAdmissionAllowedTx(
  tx: OwnerTransaction,
  userId: string,
  processingMode: string | null,
): Promise<boolean> {
  const member = await tx.hostedMember.findUnique({ where: { id: userId }, select: { suspendedAt: true } });
  if (!member || member.suspendedAt !== null
    || await readHostedHealthDataConsentState({ prisma: tx, memberId: userId }) === "revoked") {
    return false;
  }
  return processingMode === "inbox_media_retention"
    || await readActiveHostedMemberAccess({ prisma: tx, memberId: userId });
}

export async function lockHostedRuntimeOwnerRowTx(tx: OwnerTransaction, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT user_id FROM hosted_runtime_owner WHERE user_id = ${userId} FOR UPDATE`;
}

function identityWhere(identity: HostedRuntimeIdentity) {
  return { userId: identity.userId, attemptId: identity.attemptId, generation: BigInt(identity.generation) };
}

function staleRuntimeError() {
  return hostedOnboardingError({
    code: "HOSTED_RUNTIME_OWNER_STALE", httpStatus: 409,
    message: "This hosted runtime no longer owns the operation.",
  });
}

export async function authorizeHostedRuntimeProvider(input: {
  prisma: PrismaClient; userId: string; runnerContainerName: string | null; providerEgressTokenHash: string | null; providerKind: string;
}): Promise<HostedRuntimeOwner | null> {
  return input.prisma.$transaction(async tx => {
    if (await lockHostedRuntimeMemberCutoverTx(tx, input.userId) !== "postgres") return null;
    await lockHostedMemberRow(tx, input.userId);
    await lockHostedRuntimeOwnerRowTx(tx, input.userId);
    const current = await tx.hostedRuntimeOwner.findUnique({ where: { userId: input.userId } });
    if (!current || !current.attemptId || !current.runnerContainerName || current.workspaceVersion === null
      || (current.phase !== "starting" && current.phase !== "active")
      || !await runtimeAdmissionAllowedTx(tx, input.userId, current.processingMode)) return null;
    if (input.runnerContainerName !== null) {
      if (current.runnerContainerName !== input.runnerContainerName || !["exa", "mapbox", "murph_data_api", "openai", "venice", "workers_ai_transcribe"].includes(input.providerKind)) return null;
    } else if (!input.providerEgressTokenHash || current.providerEgressTokenHash !== input.providerEgressTokenHash) return null;
    return current;
  }, OWNER_TRANSACTION_OPTIONS);
}

/** Trusted native notification after irreversible slot retirement. Exact target
 * matching makes delayed notifications harmless to a replacement assignment. */
export async function recordHostedRuntimeTargetRetired(input: { prisma: PrismaClient; userId: string; runnerContainerName: string }): Promise<boolean> {
  return input.prisma.$transaction(async tx => {
    if (await lockHostedRuntimeMemberCutoverTx(tx, input.userId) !== "postgres") return false;
    await lockHostedRuntimeOwnerRowTx(tx, input.userId);
    const current = await tx.hostedRuntimeOwner.findUnique({ where: { userId: input.userId } });
    if (!current || current.runnerContainerName !== input.runnerContainerName) return false;
    await tx.hostedRuntimeOwner.update({ where: { userId: input.userId }, data: {
      phase: "idle", attemptId: null, allocationId: null, runnerContainerName: null, processingMode: null,
      workspaceVersion: null, providerEgressTokenHash: null, customInferenceEnvelope: null, platformAiUsageAllowed: false,
    } });
    if (current.attemptId) await tx.hostedRuntimePutDrain.updateMany({ where: {
      userId: input.userId, attemptId: current.attemptId, generation: current.generation, kind: "replica", uploadId: null, completedAt: null, drainUntil: null,
    }, data: { drainUntil: new Date(Date.now() + HOSTED_RUNTIME_REPLICA_POST_STOP_DRAIN_MS) } });
    return true;
  }, OWNER_TRANSACTION_OPTIONS);
}

/** Account deletion removes membership before dispatching external cleanup.
 * Keep the high-water row and resource tombstones; neither can grant admission.
 * An uncertain PUT remains blocking until its adapter completion is recorded. */
export async function isHostedRuntimeDeletionReady(input: { prisma: PrismaClient; userId: string }): Promise<boolean> {
  return input.prisma.$transaction(async tx => {
    if (await lockHostedRuntimeMemberCutoverTx(tx, input.userId) !== "postgres") return false;
    await lockHostedMemberRow(tx, input.userId);
    if (await tx.hostedMember.findUnique({ where: { id: input.userId }, select: { id: true } })) return false;
    await lockHostedRuntimeOwnerRowTx(tx, input.userId);
    const owner = await tx.hostedRuntimeOwner.findUnique({ where: { userId: input.userId } });
    if (owner && (owner.phase !== "idle" || owner.runnerContainerName !== null)) return false;
    return await tx.hostedRuntimePutDrain.findFirst({ where: { userId: input.userId, completedAt: null,
      OR: [{ drainUntil: null }, { drainUntil: { gt: new Date() } }],
    }, select: { writeId: true } }) === null;
  }, OWNER_TRANSACTION_OPTIONS);
}
