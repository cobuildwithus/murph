import { HOSTED_RUNTIME_REPLICA_POST_STOP_DRAIN_MS } from "@murphai/hosted-execution/runtime-resources";
import { randomUUID } from "node:crypto";

import { Prisma, type HostedRuntimeOwner, type PrismaClient } from "@prisma/client";
import type { HostedWorkspaceInvocationProcessingMode } from "@murphai/hosted-execution/runtime-control";

import { activeHostedMemberAccessWithParticipantsWhere } from "../hosted-onboarding/member-access";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { hostedHealthDataConsentNotRevokedWhere } from "../legal/consent";
import { resolveHostedRuntimeMemberBackend, type HostedRuntimeBackend } from "@murphai/hosted-execution/runtime-migration";
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
  | { cutover: "postgres"; status: "claimed" | "existing"; owner: HostedRuntimeOwner }
  | { cutover: HostedRuntimeBackend; status: "blocked"; reason: "cutover" | "admission" }
> {
  return input.prisma.$transaction(async (tx) => {
    const cutover = await lockHostedRuntimeMemberCutoverTx(tx, input.userId);
    if (cutover !== "postgres") return { cutover, status: "blocked", reason: "cutover" };
    await lockHostedMemberRow(tx, input.userId);
    if (!await runtimeAdmissionAllowedTx(tx, input.userId, input.processingMode)) {
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
          data: { phase: "retiring", platformAiUsageAllowed: false },
        });
        return { cutover, status: "existing", owner };
      }
      return { cutover, status: "existing", owner: existing };
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
    return { cutover, status: "claimed", owner };
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

/** Called within the canonical publication transaction, never as its preflight.
 * Access and consent belong to claim admission; admitted work retains its exact
 * ownership until completion or retirement, even when account policy changes.
 */
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

/** Preflight only: a lock released before the handler cannot fence its work.
 * Canonical publications still use requireHostedRuntimeCallbackTx. */
export async function requireHostedRuntimeCallback(
  prisma: PrismaClient,
  userId: string,
  identity: HostedRuntimeIdentity | null,
): Promise<void> {
  if (identity && identity.userId !== userId) throw staleRuntimeError();
  const { cutover, owner } = await readRuntimeEffectOwner(prisma, userId);
  if (cutover === "legacy") return;
  if (cutover !== "postgres" || !identity || !owner
    || owner.attemptId !== identity.attemptId
    || owner.generation.toString() !== identity.generation) throw staleRuntimeError();
}

async function requireOwnerAfterCutoverLockTx(
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
  const where = { ...identityWhere(input.identity), phase: { in: ["starting", "active", "retiring"] } };
  const result = await tx.hostedRuntimeOwner.updateMany({ where, data: { phase: "retiring", platformAiUsageAllowed: false } });
  if (result.count === 1 && input.completed) await tx.hostedRuntimeOwner.updateMany({
    where: { ...identityWhere(input.identity), phase: "retiring", completedAt: null }, data: { completedAt: new Date() },
  });
  return result.count === 1;
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
  // Keep this statement after the member lock: a waiting claim must observe
  // consent withdrawal committed by the previous lock holder.
  const member = await tx.hostedMember.findUnique({
    select: { id: true },
    where: {
      id: userId,
      suspendedAt: null,
      AND: [
        hostedHealthDataConsentNotRevokedWhere(),
        ...(processingMode === "inbox_media_retention" ? [] : [activeHostedMemberAccessWithParticipantsWhere()]),
      ],
    },
  });
  return member !== null;
}

const runtimeOwnerColumns = Prisma.sql`
  owner.user_id AS "userId", owner.migration_phase AS "migrationPhase",
  owner.migration_id AS "migrationId", owner.generation, owner.attempt_id AS "attemptId", owner.phase,
  owner.processing_mode AS "processingMode", owner.allocation_id AS "allocationId",
  owner.runner_container_name AS "runnerContainerName", owner.workspace_version AS "workspaceVersion",
  owner.provider_egress_token_hash AS "providerEgressTokenHash",
  owner.custom_inference_envelope AS "customInferenceEnvelope",
  owner.platform_ai_usage_allowed AS "platformAiUsageAllowed", owner.started_at AS "startedAt",
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
  type Snapshot = { cutoverPhase: string; memberExists: boolean }
    & (HostedRuntimeOwner | { [K in keyof HostedRuntimeOwner]: null });
  const rows = await prisma.$queryRaw<Snapshot[]>`
    SELECT gate.phase AS "cutoverPhase",
      EXISTS (SELECT 1 FROM hosted_member WHERE id = ${userId}) AS "memberExists",
      ${runtimeOwnerColumns}
    FROM hosted_runtime_cutover AS gate
    LEFT JOIN hosted_runtime_owner AS owner ON owner.user_id = ${userId}
    WHERE gate.id = 'runtime'
  `;
  const snapshot = rows[0];
  if (!snapshot) throw new Error("Hosted runtime cutover state is missing.");
  const { cutoverPhase, memberExists, ...owner } = snapshot;
  const cutover = resolveHostedRuntimeMemberBackend(cutoverPhase, owner.migrationPhase);
  return { cutover, owner: cutover === "postgres" && memberExists && owner.userId !== null
    && (owner.phase === "starting" || owner.phase === "active") ? owner : null };
}

export async function authorizeHostedRuntimeEffect(input: {
  prisma: PrismaClient; userId: string; attemptId: string; generation: string;
  runnerContainerName: string | null; managedAi: boolean;
}): Promise<{ cutover: HostedRuntimeBackend; owner: HostedRuntimeOwner | null }> {
  const { cutover, owner } = await readRuntimeEffectOwner(input.prisma, input.userId);
  if (cutover === "postgres" && (!owner || owner.attemptId !== input.attemptId
    || owner.generation.toString() !== input.generation)) throw staleRuntimeError();
  return { cutover, owner: owner && (input.runnerContainerName === null
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
}): Promise<{ cutover: HostedRuntimeBackend; owner: HostedRuntimeOwner | null }> {
  const { cutover, owner } = await readRuntimeEffectOwner(input.prisma, input.userId);
  if (!owner?.attemptId || !owner.runnerContainerName || owner.workspaceVersion === null) return { cutover, owner: null };
  if (input.runnerContainerName !== null) {
    if (owner.runnerContainerName !== input.runnerContainerName || !["exa", "mapbox", "murph_data_api", "openai", "venice", "workers_ai_transcribe"].includes(input.providerKind)) return { cutover, owner: null };
  } else if (!input.providerEgressTokenHash || owner.providerEgressTokenHash !== input.providerEgressTokenHash) return { cutover, owner: null };
  return { cutover, owner };
}

/** Trusted native notification after irreversible slot retirement. Exact target
 * matching makes delayed notifications harmless to a replacement assignment. */
export async function recordHostedRuntimeTargetRetired(input: { prisma: PrismaClient; userId: string; runnerContainerName: string }): Promise<boolean> {
  return input.prisma.$transaction(async tx => {
    if (await lockHostedRuntimeMemberCutoverTx(tx, input.userId) !== "postgres") return false;
    const current = await lockHostedRuntimeOwnerRowTx(tx, input.userId);
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
