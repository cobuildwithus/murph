import "server-only";

import {
  isHostedRuntimeVaultShareDeliverContinuation,
} from "@murphai/hosted-execution/routes";
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
  requireHostedRuntimeActiveAccess,
  requireHostedRuntimeMembersActiveAccessForUpdateTx,
} from "../hosted-mailbox/runtime-access";
import {
  HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE,
} from "./delivery-limits";
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

export interface ActiveHostedVaultSharePage {
  continuation: string | null;
  shares: ActiveHostedVaultShare[];
}

/**
 * Reads one deterministic, hard-bounded page. The stable share-generation id is an opaque
 * callback cursor, so successful pages need no parallel recovery state and malformed rows
 * still advance the cursor instead of pinning delivery forever.
 */
export async function findActiveHostedVaultSharePage(input: {
  continuation?: unknown;
  grantorMemberId: string;
  prisma?: PrismaClient;
  projectionScope: HostedVaultShareProjectionScope;
}): Promise<ActiveHostedVaultSharePage> {
  const prisma = input.prisma ?? getPrisma();
  const continuation = parseHostedVaultShareDeliveryContinuation(input.continuation);
  const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(
    input.projectionScope,
  );
  const rows = await prisma.hostedVaultShare.findMany({
    orderBy: { id: "asc" },
    select: {
      destinationMemberId: true,
      grantorMemberId: true,
      id: true,
      projectionKind: true,
      projectionScopeJson: true,
      projectionScopeKey: true,
    },
    take: HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE + 1,
    where: {
      grantorMemberId: input.grantorMemberId,
      ...(continuation ? { id: { gt: continuation } } : {}),
      projectionScopeKey,
      status: "granted",
    },
  });
  const pageRows = rows.slice(0, HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE);

  return {
    continuation: rows.length > HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE
      ? pageRows[pageRows.length - 1]?.id ?? null
      : null,
    shares: pageRows.flatMap((row) => {
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
    }),
  };
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
 * data, so ciphertext cannot be replayed across a revoke/regrant generation. Crypto is
 * completed before the transaction opens; the short transaction then takes the canonical
 * sorted member locks, revalidates access, and conditionally updates the exact active row.
 */
export async function replaceHostedVaultShareProjectionSnapshot(input: {
  prisma?: PrismaClient;
  records: readonly HostedVaultShareDeliveryRecord[];
  share: ActiveHostedVaultShare;
}): Promise<"replaced" | "no-active-share"> {
  const prisma = input.prisma ?? getPrisma();
  if (!await hasHostedVaultShareRuntimeActiveAccessBeforePreparation(
    [input.share.grantorMemberId, input.share.destinationMemberId],
    prisma,
  )) {
    return "no-active-share";
  }
  const projectionSnapshotCiphertext =
    await encryptHostedVaultShareProjectionSnapshot({
      prisma,
      records: input.records,
      share: input.share,
    });

  return prisma.$transaction(async (tx) => {
    if (!await hasHostedVaultShareRuntimeActiveAccessForUpdateTx(
      [input.share.grantorMemberId, input.share.destinationMemberId],
      tx,
    )) {
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
  });
}

async function hasHostedVaultShareRuntimeActiveAccessBeforePreparation(
  memberIds: readonly string[],
  prisma: PrismaClient,
): Promise<boolean> {
  try {
    for (const memberId of memberIds) {
      await requireHostedRuntimeActiveAccess(memberId, { prisma });
    }
    return true;
  } catch (error) {
    if (isHostedRuntimeInactiveAccessError(error)) {
      return false;
    }
    throw error;
  }
}

function parseHostedVaultShareDeliveryContinuation(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (!isHostedRuntimeVaultShareDeliverContinuation(value)) {
    throw new TypeError("Hosted vault-share delivery continuation is invalid.");
  }
  return value;
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
    if (isHostedRuntimeInactiveAccessError(error)) {
      return false;
    }
    throw error;
  }
}
