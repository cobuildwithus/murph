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
 * conditional update is the linearization point: a stale writer cannot overwrite a
 * revoked or newly granted share.
 */
export async function replaceHostedVaultShareProjectionSnapshot(input: {
  prisma?: PrismaClient;
  records: readonly HostedVaultShareDeliveryRecord[];
  share: ActiveHostedVaultShare;
}): Promise<"replaced" | "no-active-share"> {
  const prisma = input.prisma ?? getPrisma();

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

    const projectionSnapshotCiphertext =
      await encryptHostedVaultShareProjectionSnapshot({
        prisma: tx,
        records: input.records,
        share: input.share,
      });
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
