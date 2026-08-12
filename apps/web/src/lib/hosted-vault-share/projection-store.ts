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
import {
  lockAndReadActiveHostedDomainRootKeyIdTx,
} from "../hosted-crypto/domain-root-store";
import {
  readHostedUserSecureBoxStringRootReference,
} from "../hosted-crypto/secure-box";
import { activeHostedMemberAccessWhere } from "../hosted-onboarding/member-access";
import {
  isHostedRuntimeInactiveAccessError,
  requireHostedRuntimeActiveAccess,
  requireHostedRuntimeMembersActiveAccessForUpdateTx,
} from "../hosted-mailbox/runtime-access";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION,
  HOSTED_VAULT_SHARE_DELIVER_INVARIANT_READ_LIMIT,
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

/**
 * Reads every legally admitted share plus one invariant-check row. The sole
 * production grant owner atomically caps the exact grantor/scope cohort at 25;
 * a 26th row is corruption and fails closed rather than being silently
 * truncated or normalized into another delivery lifecycle.
 */
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
    orderBy: { destinationMemberId: "asc" },
    select: {
      destinationMemberId: true,
      grantorMemberId: true,
      id: true,
      projectionKind: true,
      projectionScopeJson: true,
      projectionScopeKey: true,
    },
    take: HOSTED_VAULT_SHARE_DELIVER_INVARIANT_READ_LIMIT,
    where: {
      grantorMemberId: input.grantorMemberId,
      projectionScopeKey,
      status: "granted",
    },
  });
  if (
    rows.length
    > HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SHARE_GRANT_LIMIT_INVARIANT_VIOLATION",
      httpStatus: 503,
      message:
        "Hosted vault-share delivery found an invalid active grant cohort.",
      retryable: false,
    });
  }

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
 * data, so ciphertext cannot be replayed across a revoke/regrant generation. Crypto is
 * completed before the transaction opens; the short transaction then takes the canonical
 * sorted member locks, revalidates access and the prepared destination-root identity, and
 * conditionally updates the exact active row.
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
  const projectionSnapshotRootReference =
    readHostedUserSecureBoxStringRootReference({
      lane: "mailbox-payload",
      value: projectionSnapshotCiphertext,
    });

  return prisma.$transaction(async (tx) => {
    if (!await hasHostedVaultShareRuntimeActiveAccessForUpdateTx(
      [input.share.grantorMemberId, input.share.destinationMemberId],
      tx,
    )) {
      return "no-active-share";
    }
    if (projectionSnapshotRootReference) {
      const activeRootKeyId = await lockAndReadActiveHostedDomainRootKeyIdTx({
        domain: projectionSnapshotRootReference.domain,
        tx,
        userId: input.share.destinationMemberId,
      });
      if (activeRootKeyId !== projectionSnapshotRootReference.rootKeyId) {
        throw hostedOnboardingError({
          code: "HOSTED_VAULT_SHARE_PROJECTION_PREPARATION_REQUIRED",
          httpStatus: 503,
          message:
            "Hosted vault-share projection encryption authority changed. Retry the request.",
          retryable: true,
        });
      }
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
