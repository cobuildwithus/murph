import "server-only";

import { createHash } from "node:crypto";

import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_ACTIVE_DESTINATIONS_PER_SCOPE_MAX,
  HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
  HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_PAGE_MAX,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  isHostedVaultShareRuntimeProjectedKind,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionKind,
  type HostedVaultShareProjectionMode,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";
import type { Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { readActiveHostedMemberAccessIds } from "../hosted-onboarding/member-access";
import {
  isHostedRuntimeInactiveAccessError,
  requireHostedRuntimeMembersActiveAccessForUpdateTx,
} from "../hosted-mailbox/runtime-access";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import { encryptHostedVaultShareProjectionSnapshot } from "./projection-snapshot";
import { parseHostedVaultShareRowProjectionScope } from "./row-projection-scope";

// Group admission permits at most 25 destinations for one grantor and exact
// scope. The all-scope discovery bound composes that limit with the finite
// projection registry so these reads remain fail-closed as the registry grows.
const HOSTED_VAULT_SHARE_ACTIVE_ALL_SCOPES_MAX =
  HOSTED_VAULT_SHARE_ACTIVE_DESTINATIONS_PER_SCOPE_MAX
  * HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES.length;

export interface ActiveHostedVaultShare {
  destinationMemberId: string;
  grantorMemberId: string;
  id: string;
  projectionKind: HostedVaultShareProjectionKind;
  projectionScope: HostedVaultShareProjectionScope;
  projectionScopeKey: string;
}

/**
 * Reads every legally admitted share plus one invariant-check row. The sole
 * production grant owner atomically caps the exact grantor/scope cohort at 25;
 * a 26th row is corruption and fails closed rather than being silently
 * truncated or normalized into another delivery lifecycle.
 */
export async function findActiveHostedVaultShares(input: {
  grantorMemberId: string;
  prisma?: PrismaClient;
  projectionMode?: HostedVaultShareProjectionMode;
  projectionScope: HostedVaultShareProjectionScope;
}): Promise<ActiveHostedVaultShare[]> {
  const prisma = input.prisma ?? getPrisma();
  const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(
    input.projectionScope,
  );
  const rows = await prisma.hostedVaultShare.findMany({
    orderBy: { destinationMemberId: "asc" },
    select: {
      destinationMemberId: true,
      grantorMemberId: true,
      id: true,
      projectionKind: true,
      projectionScopeJson: true,
      projectionScopeKey: true,
    },
    take: HOSTED_VAULT_SHARE_ACTIVE_DESTINATIONS_PER_SCOPE_MAX + 1,
    where: {
      grantorMemberId: input.grantorMemberId,
      projectionScopeKey,
      ...(input.projectionMode === HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE
        ? { projectionSnapshotCiphertext: null }
        : {}),
      status: "granted",
    },
  });
  assertHostedVaultShareCandidateBound(
    rows.length,
    HOSTED_VAULT_SHARE_ACTIVE_DESTINATIONS_PER_SCOPE_MAX,
  );

  const activeDestinationMemberIds = await readActiveHostedMemberAccessIds({
    memberIds: rows.map((row) => row.destinationMemberId),
    prisma,
  });

  return rows.flatMap((row) => {
    if (!activeDestinationMemberIds.has(row.destinationMemberId)) {
      return [];
    }
    const projectionScope = parseHostedVaultShareRowProjectionScope(row);
    if (!projectionScope) {
      return [];
    }
    const rowScopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);

    return [{
      destinationMemberId: row.destinationMemberId,
      grantorMemberId: row.grantorMemberId,
      id: row.id,
      projectionKind: projectionScope.projectionKind,
      projectionScope,
      projectionScopeKey: rowScopeKey,
    }];
  });
}

export interface DeliverableHostedVaultShareProjectionScopeGenerations {
  generations: Array<{
    generationToken: string;
    projectionScope: HostedVaultShareProjectionScope;
  }>;
  hasDeferredProjectionWork: boolean;
}

export async function readDeliverableHostedVaultShareProjectionScopeGenerations(input: {
  grantorMemberId: string;
  prisma?: PrismaClient;
  projectionMode?: HostedVaultShareProjectionMode;
  supportedProjectionScopeKeys?: ReadonlySet<string>;
}): Promise<DeliverableHostedVaultShareProjectionScopeGenerations> {
  const prisma = input.prisma ?? getPrisma();
  const firstMaterializationOnly = input.projectionMode
    === HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE;
  const shares = await prisma.hostedVaultShare.findMany({
    orderBy: [{ projectionScopeKey: "asc" }, { id: "asc" }],
    select: {
      destinationMemberId: true,
      id: true,
      projectionKind: true,
      projectionSnapshotCiphertext: true,
      projectionScopeJson: true,
      projectionScopeKey: true,
    },
    take: HOSTED_VAULT_SHARE_ACTIVE_ALL_SCOPES_MAX + 1,
    where: {
      grantorMemberId: input.grantorMemberId,
      ...(firstMaterializationOnly
        ? { projectionSnapshotCiphertext: null }
        : {}),
      status: "granted",
    },
  });
  assertHostedVaultShareCandidateBound(
    shares.length,
    HOSTED_VAULT_SHARE_ACTIVE_ALL_SCOPES_MAX,
  );
  const activeDestinationMemberIds = await readActiveHostedMemberAccessIds({
    memberIds: shares.map((share) => share.destinationMemberId),
    prisma,
  });
  const generations = new Map<string, {
    projectionScope: HostedVaultShareProjectionScope;
    shareIds: string[];
  }>();
  let hasDeferredProjectionWork = false;
  const supportedProjectionScopeKeys = input.supportedProjectionScopeKeys
    ?? new Set(
      HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES.map(
        buildHostedVaultShareProjectionScopeKey,
      ),
    );
  for (const share of shares) {
    const projectionScope = parseHostedVaultShareRowProjectionScope(share);
    if (
      !projectionScope
      || !isHostedVaultShareRuntimeProjectedKind(projectionScope.projectionKind)
    ) {
      continue;
    }
    const hasUnmaterializedShare = share.projectionSnapshotCiphertext === null;
    if (firstMaterializationOnly && !hasUnmaterializedShare) {
      continue;
    }
    const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);
    if (!activeDestinationMemberIds.has(share.destinationMemberId)) {
      hasDeferredProjectionWork ||= hasUnmaterializedShare;
      continue;
    }
    if (!supportedProjectionScopeKeys.has(projectionScopeKey)) {
      hasDeferredProjectionWork ||= hasUnmaterializedShare;
      continue;
    }
    const current = generations.get(projectionScopeKey);
    if (current) {
      current.shareIds.push(share.id);
    } else {
      generations.set(projectionScopeKey, {
        projectionScope,
        shareIds: [share.id],
      });
    }
  }
  const selectedGenerations: typeof generations = new Map();
  let selectedShareCount = 0;
  for (const [projectionScopeKey, generation] of generations) {
    if (
      firstMaterializationOnly
      && selectedShareCount + generation.shareIds.length
        > HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_PAGE_MAX
    ) {
      hasDeferredProjectionWork = true;
      continue;
    }
    selectedGenerations.set(projectionScopeKey, generation);
    selectedShareCount += generation.shareIds.length;
  }
  return {
    generations: [...selectedGenerations.values()].map((generation) => ({
      generationToken: buildHostedVaultShareGenerationToken(generation.shareIds),
      projectionScope: generation.projectionScope,
    })),
    hasDeferredProjectionWork,
  };
}

export async function hasUnmaterializedHostedVaultShareProjectionGeneration(input: {
  grantorMemberId: string;
  prisma?: PrismaClient;
  projectionScope: HostedVaultShareProjectionScope;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const share = await prisma.hostedVaultShare.findFirst({
    select: { id: true },
    where: {
      grantorMemberId: input.grantorMemberId,
      projectionScopeKey: buildHostedVaultShareProjectionScopeKey(input.projectionScope),
      projectionSnapshotCiphertext: null,
      status: "granted",
    },
  });
  return share !== null;
}

export function buildHostedVaultShareGenerationToken(
  shareIds: readonly string[],
): string {
  return createHash("sha256")
    .update(JSON.stringify([...shareIds].sort()))
    .digest("base64url");
}

function assertHostedVaultShareCandidateBound(
  count: number,
  maximum: number,
): void {
  if (count > maximum) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SHARE_GRANT_LIMIT_INVARIANT_VIOLATION",
      httpStatus: 503,
      message: "Hosted vault-share candidate read exceeded its admitted bound.",
      retryable: false,
    });
  }
}

/**
 * Replaces the encrypted snapshot on the exact active share generation. Encryption uses
 * the destination member's runtime-ingress root, and the row id is part of authenticated
 * data, so ciphertext cannot be replayed across a revoke/regrant generation. The final
 * source-workspace lock and conditional update are the linearization point: a delivery
 * captured before a newer checkpoint cannot overwrite that checkpoint's projection, and
 * a stale writer cannot overwrite a revoked or newly granted share. Root unwrap and
 * encryption finish before the short database-only replacement transaction starts.
 */
export async function replaceHostedVaultShareProjectionSnapshot(input: {
  deadlineAtEpochMs?: number;
  prisma?: PrismaClient;
  projectionMode?: HostedVaultShareProjectionMode;
  records: readonly HostedVaultShareDeliveryRecord[];
  share: ActiveHostedVaultShare;
  signal?: AbortSignal;
  sourceWorkspaceVersion: string;
}): Promise<"replaced" | "no-active-share"> {
  const prisma = input.prisma ?? getPrisma();
  const projectionSnapshotCiphertext =
    await encryptHostedVaultShareProjectionSnapshot({
      prisma,
      records: input.records,
      share: input.share,
      signal: input.signal,
    });

  input.signal?.throwIfAborted();
  const transactionOptions = resolveHostedVaultShareProjectionTransactionOptions(
    input.deadlineAtEpochMs,
  );
  return prisma.$transaction(async (tx) => {
    if (!await hasHostedVaultShareRuntimeActiveAccessForUpdateTx(
      [input.share.grantorMemberId, input.share.destinationMemberId],
      tx,
    )) {
      return "no-active-share";
    }

    if (!await lockCurrentHostedVaultShareSourceWorkspaceTx({
      grantorMemberId: input.share.grantorMemberId,
      sourceWorkspaceVersion: input.sourceWorkspaceVersion,
      tx,
    })) {
      return "no-active-share";
    }
    const replaced = await tx.hostedVaultShare.updateMany({
      data: { projectionSnapshotCiphertext },
      where: {
        destinationMemberId: input.share.destinationMemberId,
        grantorMemberId: input.share.grantorMemberId,
        id: input.share.id,
        projectionKind: input.share.projectionKind,
        projectionScopeKey: input.share.projectionScopeKey,
        ...(input.projectionMode === HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE
          ? { projectionSnapshotCiphertext: null }
          : {}),
        status: "granted",
      },
    });
    return replaced.count === 1 ? "replaced" : "no-active-share";
  }, transactionOptions);
}

function resolveHostedVaultShareProjectionTransactionOptions(
  deadlineAtEpochMs: number | undefined,
): { maxWait: number; timeout: number } | undefined {
  if (deadlineAtEpochMs === undefined) {
    return undefined;
  }
  const remainingMs = deadlineAtEpochMs - Date.now();
  if (remainingMs < 2) {
    throw new DOMException("Hosted vault-share delivery deadline elapsed.", "TimeoutError");
  }
  const maxWait = Math.min(1_000, remainingMs - 1);
  return {
    maxWait,
    timeout: remainingMs - maxWait,
  };
}

async function lockCurrentHostedVaultShareSourceWorkspaceTx(input: {
  grantorMemberId: string;
  sourceWorkspaceVersion: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const rows = await input.tx.$queryRaw<Array<{ version: bigint }>>`
    SELECT version
    FROM hosted_workspace
    WHERE user_id = ${input.grantorMemberId}
    FOR UPDATE
  `;

  return rows.length === 1
    && rows[0]?.version === BigInt(input.sourceWorkspaceVersion);
}

async function hasHostedVaultShareRuntimeActiveAccessForUpdateTx(
  memberIds: readonly string[],
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  try {
    await requireHostedRuntimeMembersActiveAccessForUpdateTx(memberIds, {
      prisma: tx,
    });
    return true;
  } catch (error) {
    if (
      isHostedRuntimeInactiveAccessError(error)
      || (
        isHostedOnboardingError(error)
        && error.code === "HOSTED_RUNTIME_ACCESS_AUTHORITY_CHANGED"
      )
    ) {
      return false;
    }
    throw error;
  }
}
