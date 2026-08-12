import "server-only";

import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionKind,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";
import type { Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { activeHostedMemberAccessWhere } from "../hosted-onboarding/member-access";
import {
  isHostedRuntimeInactiveAccessError,
  requireHostedRuntimeActiveAccessForUpdateTx,
} from "../hosted-mailbox/runtime-access";
import { encryptHostedVaultShareProjectionSnapshot } from "./projection-snapshot";
import { parseHostedVaultShareRowProjectionScope } from "./row-projection-scope";

export interface ActiveHostedVaultShare {
  destinationMemberId: string;
  grantorMemberId: string;
  id: string;
  projectionKind: HostedVaultShareProjectionKind;
  projectionScope: HostedVaultShareProjectionScope;
  projectionScopeKey: string;
}

export async function findActiveHostedVaultShares(input: {
  grantorMemberId: string;
  prisma?: PrismaClient;
  projectionScope: HostedVaultShareProjectionScope;
}): Promise<ActiveHostedVaultShare[]> {
  const prisma = input.prisma ?? getPrisma();
  const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(
    input.projectionScope,
  );
  const rows = await prisma.hostedVaultShare.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      destinationMemberId: true,
      grantorMemberId: true,
      id: true,
      projectionKind: true,
      projectionScopeJson: true,
      projectionScopeKey: true,
    },
    where: {
      grantorMemberId: input.grantorMemberId,
      projectionScopeKey,
      status: "granted",
    },
  });

  return rows.flatMap((row) => {
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

export async function readDeliverableHostedVaultShareProjectionScopes(input: {
  grantorMemberId: string;
  prisma?: PrismaClient;
}): Promise<HostedVaultShareProjectionScope[]> {
  const prisma = input.prisma ?? getPrisma();
  const rows = await prisma.hostedVaultShare.findMany({
    distinct: ["projectionScopeKey"],
    orderBy: { projectionScopeKey: "asc" },
    select: {
      projectionKind: true,
      projectionScopeJson: true,
      projectionScopeKey: true,
    },
    where: {
      destination: activeHostedMemberAccessWhere(),
      grantorMemberId: input.grantorMemberId,
      status: "granted",
    },
  });

  return rows
    .map(parseHostedVaultShareRowProjectionScope)
    .filter((scope): scope is HostedVaultShareProjectionScope =>
      scope !== null
      && scope.projectionKind
        !== HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND
    );
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
      input.share.grantorMemberId,
      tx,
    )) {
      return "no-active-share";
    }

    if (!await hasHostedVaultShareRuntimeActiveAccessForUpdateTx(
      input.share.destinationMemberId,
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
  memberId: string,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  try {
    await requireHostedRuntimeActiveAccessForUpdateTx(memberId, {
      prisma: tx,
    });
    return true;
  } catch (error) {
    if (isHostedRuntimeInactiveAccessError(error)) {
      return false;
    }
    throw error;
  }
}
