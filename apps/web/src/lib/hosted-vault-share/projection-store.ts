import "server-only";

import { createHash } from "node:crypto";

import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_ACTIVE_DESTINATIONS_PER_SCOPE_MAX,
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionKind,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";
import type { Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { readActiveHostedMemberAccessIds } from "../hosted-onboarding/member-access";
import {
  isHostedRuntimeInactiveAccessError,
  requireHostedRuntimeActiveAccessForUpdateTx,
} from "../hosted-mailbox/runtime-access";
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
    take: HOSTED_VAULT_SHARE_ACTIVE_DESTINATIONS_PER_SCOPE_MAX + 1,
    where: {
      grantorMemberId: input.grantorMemberId,
      projectionScopeKey,
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

export async function readDeliverableHostedVaultShareProjectionScopeGenerations(input: {
  grantorMemberId: string;
  prisma?: PrismaClient;
}): Promise<Array<{
  projectionScope: HostedVaultShareProjectionScope;
  generationToken: string;
}>> {
  const prisma = input.prisma ?? getPrisma();
  const shares = await prisma.hostedVaultShare.findMany({
    orderBy: [{ projectionScopeKey: "asc" }, { id: "asc" }],
    select: {
      destinationMemberId: true,
      id: true,
      projectionKind: true,
      projectionScopeJson: true,
      projectionScopeKey: true,
    },
    take: HOSTED_VAULT_SHARE_ACTIVE_ALL_SCOPES_MAX + 1,
    where: {
      grantorMemberId: input.grantorMemberId,
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
  for (const share of shares) {
    if (!activeDestinationMemberIds.has(share.destinationMemberId)) {
      continue;
    }
    const projectionScope = parseHostedVaultShareRowProjectionScope(share);
    if (
      !projectionScope
      || projectionScope.projectionKind
        === HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND
    ) {
      continue;
    }
    const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);
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
  return [...generations.values()].map((generation) => ({
    generationToken: buildHostedVaultShareGenerationToken(generation.shareIds),
    projectionScope: generation.projectionScope,
  }));
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
    throw new Error("Hosted vault-share candidate read exceeded its admitted bound.");
  }
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
