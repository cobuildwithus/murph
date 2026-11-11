import { HOSTED_RUNTIME_REPLICA_POST_STOP_DRAIN_MS } from "@murphai/hosted-execution/runtime-resources";
import { randomUUID } from "node:crypto";

import { Prisma, type HostedRuntimeOwner as StoredHostedRuntimeOwner, type PrismaClient } from "@prisma/client";
import type { HostedWorkspaceInvocationProcessingMode } from "@murphai/hosted-execution/runtime-control";

import { activeHostedMemberAccessWithParticipantsWhere, hostedRuntimeMemberEligibleWhere, readGameChatAllowanceBeneficiary } from "../hosted-onboarding/member-access";
import { isGameEnabled } from "../game/access";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";

export type HostedRuntimeOwner = StoredHostedRuntimeOwner;

export interface HostedRuntimeIdentity {
  userId: string;
  attemptId: string;
  generation: string;
}

type OwnerTransaction = Prisma.TransactionClient;
const OWNER_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 5_000 };

/** Retirement disposition for one exact attempt and generation. Retiring is warm
 * with completedAt and cold without it; read phase first because idle rows keep
 * a historical completedAt. Warm may become cold, which clears completedAt so a
 * delayed warm release loses. Cold never becomes warm: its stop may still be in
 * flight and would interrupt a successor reusing the slot. Warm cannot veto
 * destruction: a completed child with a lost outer response still needs a stop
 * to clear its native fence. */
const COLD_RETIREMENT = { phase: "retiring", completedAt: null, platformAiUsageAllowed: false } as const;
const WARM_RETIREMENT = { phase: "retiring", completedAt: { not: null } } as const;
const IDLE_OWNER = {
  phase: "idle", attemptId: null, processingMode: null, workspaceVersion: null,
  providerEgressTokenHash: null, platformAiUsageAllowed: false, recapMediaScope: Prisma.DbNull,
} as const;
const IDLE_OWNER_WITHOUT_ASSIGNMENT = { ...IDLE_OWNER, allocationId: null, runnerContainerName: null } as const;

export async function claimHostedRuntime(input: {
  prisma: PrismaClient;
  userId: string;
  processingMode: HostedWorkspaceInvocationProcessingMode;
  now?: Date;
}): Promise<
  | { cutover: "postgres"; status: "claimed" | "existing"; owner: HostedRuntimeOwner }
  | { cutover: "postgres"; status: "blocked"; reason: "admission" }
> {
  return input.prisma.$transaction(async (tx) => {
    const cutover = "postgres" as const;
    await lockHostedMemberRow(tx, input.userId);
    const now = input.now ?? new Date();
    const admission = await readRuntimeAdmissionTx(tx, input.userId, input.processingMode, now);
    if (!admission) {
      return { cutover, status: "blocked", reason: "admission" };
    }
    const existing = await lockHostedRuntimeOwnerRowTx(tx, input.userId);
    if (existing && existing.phase !== "idle") {
      // Launch preparation takes these same locks. Once workspaceVersion is
      // bound, foreground must wake the admitted child instead of replacing it.
      // Before that point, revoke launch authority and let the existing exact
      // retirement protocol stop preparation before admitting a new writer.
      if (input.processingMode === "default" && existing.processingMode === "system_mailbox"
        && existing.phase === "starting" && existing.workspaceVersion === null) {
        const owner = await tx.hostedRuntimeOwner.update({
          where: { userId: input.userId },
          data: COLD_RETIREMENT,
        });
        return { cutover, status: "existing", owner };
      }
      return { cutover, status: "existing", owner: existing };
    }
    // Attribution belongs to the admitted invocation, not later game/room state.
    // Existing owners above retain their frozen beneficiary on every retry.
    const attemptId = `rt_${randomUUID()}`;
    const data = {
      generation: (existing?.generation ?? 0n) + 1n,
      attemptId,
      recapMediaScope: Prisma.DbNull,
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
      allowanceBeneficiaryMemberId: admission.allowanceBeneficiaryMemberId,
      workspaceVersion: null,
      providerEgressTokenHash: null,
    };
    const owner = existing
      ? await tx.hostedRuntimeOwner.update({ where: { userId: input.userId }, data })
      : await tx.hostedRuntimeOwner.create({ data: { ...data, userId: input.userId } });
    return { cutover, status: "claimed", owner };
  }, OWNER_TRANSACTION_OPTIONS);
}

/** Advisory snapshot only. Never claim, lock or write before direct dispatch.
 * A stale read still has to pass the native attempt/generation wake fence. */
export async function readHostedRuntimeDirectWakeOwner(input: {
  prisma: PrismaClient; userId: string;
}): Promise<HostedRuntimeOwner | null> {
  const owner = await readRuntimeEffectOwner(input.prisma, input.userId);
  if (!owner?.runnerContainerName || owner.workspaceVersion === null
    || owner.processingMode === "inbox_media_retention") return null;
  return await readRuntimeAdmissionTx(input.prisma, input.userId, "default", new Date()) ? owner : null;
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
        || owner.processingMode !== (input.processingMode ?? owner.processingMode)) {
        throw staleRuntimeError();
      }
      // Usage revocation is monotonic for this attempt; retries never restore it.
      return owner;
    }
    if (owner.phase !== "starting" || !input.runnerContainerName || workspaceVersion < 0n) {
      throw staleRuntimeError();
    }
    let platformAiUsageAllowed = input.platformAiUsageAllowed;
    if (platformAiUsageAllowed && owner.allowanceBeneficiaryMemberId !== null) {
      const { readHostedAiUsageGateForFrozenBeneficiary } = await import("./usage-allowance");
      // Workspace preparation may have observed newer sponsorship or routing.
      // Charge and admit against the same frozen beneficiary, without granting
      // permission when the caller already denied source access or consent.
      platformAiUsageAllowed = (await readHostedAiUsageGateForFrozenBeneficiary({
        beneficiaryMemberId: owner.allowanceBeneficiaryMemberId, prisma: tx,
      })).allowed;
    }
    return tx.hostedRuntimeOwner.update({
      where: { userId: input.identity.userId },
      data: {
        runnerContainerName: input.runnerContainerName,
        workspaceVersion,
        providerEgressTokenHash: input.providerEgressTokenHash,
        platformAiUsageAllowed,
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

/** Called within the canonical publication transaction, never as its preflight.
 * Access and consent belong to claim admission; admitted work retains its exact
 * ownership until completion or retirement, even when account policy changes.
 */
export async function requireHostedRuntimeOwnerTx(
  tx: OwnerTransaction,
  identity: HostedRuntimeIdentity,
): Promise<HostedRuntimeOwner> {
  const members = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM hosted_member WHERE id = ${identity.userId} FOR UPDATE
  `;
  const owner = await lockHostedRuntimeOwnerRowTx(tx, identity.userId);
  // Cleanup retains the owner row after account deletion; it is no longer authority.
  if (!members[0] || !owner || owner.attemptId !== identity.attemptId
    || owner.generation.toString() !== identity.generation
    || (owner.phase !== "starting" && owner.phase !== "active")) {
    throw staleRuntimeError();
  }
  return owner;
}

/** Bind callbacks to the authenticated member. The member lock
 * remains held through canonical publication.
 */
export async function requireHostedRuntimeCallbackTx(
  tx: OwnerTransaction,
  userId: string,
  identity: HostedRuntimeIdentity | null,
): Promise<HostedRuntimeOwner> {
  if (!identity || identity.userId !== userId) throw staleRuntimeError();
  return requireHostedRuntimeOwnerTx(tx, identity);
}

/** Preflight only: a lock released before the handler cannot fence its work.
 * Canonical publications still use requireHostedRuntimeCallbackTx. */
export async function requireHostedRuntimeCallback(
  prisma: PrismaClient,
  userId: string,
  identity: HostedRuntimeIdentity | null,
): Promise<void> {
  if (identity && identity.userId !== userId) throw staleRuntimeError();
  const owner = await readRuntimeEffectOwner(prisma, userId);
  if (!identity || !owner
    || owner.attemptId !== identity.attemptId
    || owner.generation.toString() !== identity.generation) throw staleRuntimeError();
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
  return input.prisma.$transaction(tx => retireHostedRuntimeTx(tx, input), OWNER_TRANSACTION_OPTIONS);
}

export async function retireHostedRuntimeTx(
  tx: Prisma.TransactionClient,
  input: { identity: HostedRuntimeIdentity; completed?: boolean },
): Promise<boolean> {
  const exact = identityWhere(input.identity);
  if (!input.completed) {
    const retired = await tx.hostedRuntimeOwner.updateMany({
      where: { ...exact, phase: { in: ["starting", "active", "retiring"] } }, data: COLD_RETIREMENT,
    });
    return retired.count === 1;
  }
  const entered = await tx.hostedRuntimeOwner.updateMany({
    where: { ...exact, phase: { in: ["starting", "active"] } },
    data: { phase: "retiring", completedAt: new Date(), platformAiUsageAllowed: false },
  });
  return entered.count === 1
    || await tx.hostedRuntimeOwner.count({ where: { ...exact, ...WARM_RETIREMENT } }) === 1;
}

/** Early completion, with a null target, leaves the attempt warm. A settled report
 * also releases it in this transaction; a wrong target changes nothing. */
export async function completeHostedRuntime(input: {
  prisma: PrismaClient;
  identity: HostedRuntimeIdentity;
  settledRunnerContainerName: string | null;
}): Promise<boolean> {
  return input.prisma.$transaction(async tx => {
    const owner = await lockHostedRuntimeOwnerRowTx(tx, input.identity.userId);
    if (input.settledRunnerContainerName !== null && input.settledRunnerContainerName !== owner?.runnerContainerName) return false;
    if (!await retireHostedRuntimeTx(tx, { identity: input.identity, completed: true })) return false;
    return input.settledRunnerContainerName === null || releaseHostedRuntimeAfterCompletionTx(tx, {
      identity: input.identity, runnerContainerName: input.settledRunnerContainerName,
    });
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
  return input.prisma.$transaction(tx => releaseHostedRuntimeTx(tx, input.identity,
    { phase: "retiring", runnerContainerName: input.runnerContainerName }, IDLE_OWNER_WITHOUT_ASSIGNMENT,
  ), OWNER_TRANSACTION_OPTIONS);
}

/** A terminal native invocation receipt permits reuse of the member-bound
 * warm shell. Keep its assignment and cleanup target across the next claim.
 */
export async function releaseHostedRuntimeAfterCompletion(input: {
  prisma: PrismaClient;
  identity: HostedRuntimeIdentity;
  runnerContainerName: string;
}): Promise<boolean> {
  return input.prisma.$transaction(tx => releaseHostedRuntimeAfterCompletionTx(tx, input), OWNER_TRANSACTION_OPTIONS);
}

function releaseHostedRuntimeAfterCompletionTx(
  tx: OwnerTransaction,
  input: { identity: HostedRuntimeIdentity; runnerContainerName: string },
): Promise<boolean> {
  return releaseHostedRuntimeTx(tx, input.identity,
    { ...WARM_RETIREMENT, runnerContainerName: input.runnerContainerName }, IDLE_OWNER,
  );
}

async function releaseHostedRuntimeTx(
  tx: OwnerTransaction,
  identity: HostedRuntimeIdentity,
  where: Prisma.HostedRuntimeOwnerWhereInput,
  data: Prisma.HostedRuntimeOwnerUpdateManyMutationInput,
): Promise<boolean> {
  const result = await tx.hostedRuntimeOwner.updateMany({ where: { ...where, ...identityWhere(identity) }, data });
  if (result.count === 1) await drainHostedRuntimeReplicaPutsTx(tx, identity);
  return result.count === 1;
}

async function drainHostedRuntimeReplicaPutsTx(tx: OwnerTransaction, identity: HostedRuntimeIdentity): Promise<void> {
  await tx.hostedRuntimePutDrain.updateMany({
    where: { ...identityWhere(identity), kind: "replica", uploadId: null, completedAt: null, drainUntil: null },
    data: { drainUntil: new Date(Date.now() + HOSTED_RUNTIME_REPLICA_POST_STOP_DRAIN_MS) },
  });
}

export async function revokeHostedRuntimeAiUsageTx(
  tx: OwnerTransaction,
  identity: HostedRuntimeIdentity,
): Promise<void> {
  await tx.hostedRuntimeOwner.updateMany({
    where: identityWhere(identity), data: { platformAiUsageAllowed: false },
  });
}

async function readRuntimeAdmissionTx(
  tx: OwnerTransaction,
  userId: string,
  processingMode: string | null,
  now: Date,
): Promise<{ allowanceBeneficiaryMemberId: string | null } | null> {
  // Keep this statement after the member lock: a waiting claim must observe
  // consent withdrawal committed by the previous lock holder.
  const member = await tx.hostedMember.findUnique({
    select: { id: true },
    where: {
      id: userId,
      AND: [
        hostedRuntimeMemberEligibleWhere(),
        ...(processingMode === "inbox_media_retention" ? [] : [activeHostedMemberAccessWithParticipantsWhere(now, false)]),
      ],
    },
  });
  if (member) return { allowanceBeneficiaryMemberId: null };
  if (processingMode === "inbox_media_retention" || !isGameEnabled()) return null;
  // Exact-pair game access is a correlated read rather than a Prisma predicate.
  // Preserve the ordinary fast path and the source member's consent boundary.
  const eligibleMember = await tx.hostedMember.findUnique({
    select: { id: true },
    where: { id: userId, threadContainer: { isNot: null }, AND: [hostedRuntimeMemberEligibleWhere()] },
  });
  if (!eligibleMember) return null;
  const allowanceBeneficiaryMemberId = await readGameChatAllowanceBeneficiary({ memberId: userId, now, prisma: tx });
  return allowanceBeneficiaryMemberId === null ? null : { allowanceBeneficiaryMemberId };
}

const runtimeOwnerColumns = Prisma.sql`
  owner.user_id AS "userId", owner.generation, owner.attempt_id AS "attemptId", owner.phase,
  owner.processing_mode AS "processingMode", owner.allocation_id AS "allocationId",
  owner.runner_container_name AS "runnerContainerName", owner.workspace_version AS "workspaceVersion",
  owner.provider_egress_token_hash AS "providerEgressTokenHash",
  owner.recap_media_scope AS "recapMediaScope",
  owner.platform_ai_usage_allowed AS "platformAiUsageAllowed", owner.started_at AS "startedAt",
  owner.allowance_beneficiary_member_id AS "allowanceBeneficiaryMemberId",
  owner.accepted_at AS "acceptedAt", owner.completed_at AS "completedAt",
  owner.failure_count AS "failureCount", owner.last_error_code AS "lastErrorCode", owner.updated_at AS "updatedAt"
`;

export async function lockHostedRuntimeOwnerRowTx(tx: OwnerTransaction, userId: string): Promise<HostedRuntimeOwner | null> {
  const owners = await tx.$queryRaw<HostedRuntimeOwner[]>`
    SELECT ${runtimeOwnerColumns}
    FROM hosted_runtime_owner AS owner WHERE owner.user_id = ${userId} FOR UPDATE
  `;
  return owners[0] ?? null;
}

/** External effects cannot hold a database lock through provider I/O. Read their
 * authority in one statement snapshot; canonical publications still lock it. */
async function readRuntimeEffectOwner(prisma: PrismaClient, userId: string) {
  const rows = await prisma.$queryRaw<HostedRuntimeOwner[]>`
    SELECT ${runtimeOwnerColumns}
    FROM hosted_runtime_owner AS owner
    JOIN hosted_member AS member ON member.id = owner.user_id
    WHERE owner.user_id = ${userId} AND owner.phase IN ('starting', 'active')
  `;
  return rows[0] ?? null;
}

export async function authorizeHostedRuntimeEffect(input: {
  prisma: PrismaClient; userId: string; attemptId: string; generation: string;
  runnerContainerName: string | null; managedAi: boolean;
}): Promise<{ cutover: "postgres"; owner: HostedRuntimeOwner | null }> {
  const owner = await readRuntimeEffectOwner(input.prisma, input.userId);
  if (!owner || owner.attemptId !== input.attemptId
    || owner.generation.toString() !== input.generation) throw staleRuntimeError();
  return { cutover: "postgres", owner: owner && (input.runnerContainerName === null
    || owner.runnerContainerName === input.runnerContainerName)
    && (!input.managedAi || owner.platformAiUsageAllowed) ? owner : null };
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
}): Promise<{ cutover: "postgres"; owner: HostedRuntimeOwner | null }> {
  const owner = await readRuntimeEffectOwner(input.prisma, input.userId);
  if (!owner?.attemptId || !owner.runnerContainerName || owner.workspaceVersion === null) return { cutover: "postgres", owner: null };
  if (input.runnerContainerName !== null) {
    if (owner.runnerContainerName !== input.runnerContainerName || !["mapbox", "murph_data_api", "openai", "workers_ai_transcribe"].includes(input.providerKind)) return { cutover: "postgres", owner: null };
  } else if (!input.providerEgressTokenHash || owner.providerEgressTokenHash !== input.providerEgressTokenHash) return { cutover: "postgres", owner: null };
  return { cutover: "postgres", owner };
}

/** Trusted native notification after irreversible slot retirement. Exact target
 * matching makes delayed notifications harmless to a replacement assignment. */
export async function recordHostedRuntimeTargetRetired(input: { prisma: PrismaClient; userId: string; runnerContainerName: string }): Promise<boolean> {
  return input.prisma.$transaction(async tx => {
    const current = await lockHostedRuntimeOwnerRowTx(tx, input.userId);
    if (!current || current.runnerContainerName !== input.runnerContainerName) return false;
    await tx.hostedRuntimeOwner.update({ where: { userId: input.userId }, data: IDLE_OWNER_WITHOUT_ASSIGNMENT });
    if (current.attemptId) await drainHostedRuntimeReplicaPutsTx(tx, {
      userId: input.userId, attemptId: current.attemptId, generation: current.generation.toString(),
    });
    return true;
  }, OWNER_TRANSACTION_OPTIONS);
}

/** Account deletion removes membership before dispatching external cleanup.
 * Keep the high-water row and resource tombstones; neither can grant admission.
 * An uncertain PUT remains blocking until its adapter completion is recorded. */
export async function isHostedRuntimeDeletionReady(input: { prisma: PrismaClient; userId: string }): Promise<boolean> {
  return input.prisma.$transaction(async tx => {
    const members = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM hosted_member WHERE id = ${input.userId} FOR UPDATE
    `;
    if (members[0]) return false;
    const owner = await lockHostedRuntimeOwnerRowTx(tx, input.userId);
    if (owner && (owner.phase !== "idle" || owner.runnerContainerName !== null)) return false;
    return await tx.hostedRuntimePutDrain.findFirst({ where: { userId: input.userId, completedAt: null,
      OR: [{ drainUntil: null }, { drainUntil: { gt: new Date() } }],
    }, select: { writeId: true } }) === null;
  }, OWNER_TRANSACTION_OPTIONS);
}
