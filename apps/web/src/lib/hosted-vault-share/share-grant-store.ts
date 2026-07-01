import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionVaultShareRevokeWake,
} from "@murphai/hosted-execution";
import {
  buildHostedVaultShareRevokeDedupeKey,
  HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA,
  isHostedVaultShareProjectionKind,
  type HostedVaultShareProjectionKind,
} from "@murphai/hosted-execution/vault-share";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { generateHostedVaultShareId } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";

export type HostedVaultShareGrantClient = PrismaClient | Prisma.TransactionClient;

export interface HostedVaultShareCleanupSignal {
  mailboxItemId: string;
  memberId: string;
}

export interface HostedVaultShareRevocationResult {
  cleanupSignals: HostedVaultShareCleanupSignal[];
  revokedCount: number;
}

interface RevocableHostedVaultShare {
  destinationMemberId: string;
  grantorMemberId: string;
  id: string;
  projectionKind: HostedVaultShareProjectionKind;
}

interface RevokedHostedVaultShare extends RevocableHostedVaultShare {
  revokedAt: Date;
}

export async function grantHostedVaultShareTx(input: {
  tx: Prisma.TransactionClient;
  grantorMemberId: string;
  destinationMemberId: string;
  projectionKind: HostedVaultShareProjectionKind;
  now: Date;
}): Promise<void> {
  assertSupportedProjectionKind(input.projectionKind);
  if (input.grantorMemberId === input.destinationMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SHARE_SELF_GRANT_UNSUPPORTED",
      httpStatus: 400,
      message: "A member cannot share a vault projection to themselves.",
      retryable: false,
    });
  }

  let existing = await input.tx.hostedVaultShare.findUnique({
    where: {
      grantorMemberId_projectionKind_destinationMemberId: {
        destinationMemberId: input.destinationMemberId,
        grantorMemberId: input.grantorMemberId,
        projectionKind: input.projectionKind,
      },
    },
    select: { id: true, status: true },
  });

  if (!existing) {
    try {
      await input.tx.hostedVaultShare.create({
        data: {
          id: generateHostedVaultShareId(),
          destinationMemberId: input.destinationMemberId,
          grantedAt: input.now,
          grantorMemberId: input.grantorMemberId,
          projectionKind: input.projectionKind,
          revokedAt: null,
          status: "granted",
        },
      });
      return;
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) {
        throw error;
      }
      existing = await input.tx.hostedVaultShare.findUnique({
        where: {
          grantorMemberId_projectionKind_destinationMemberId: {
            destinationMemberId: input.destinationMemberId,
            grantorMemberId: input.grantorMemberId,
            projectionKind: input.projectionKind,
          },
        },
        select: { id: true, status: true },
      });
      if (!existing) {
        throw error;
      }
    }
  }

  if (existing.status === "granted") {
    return;
  }

  await input.tx.hostedVaultShare.update({
    where: {
      grantorMemberId_projectionKind_destinationMemberId: {
        destinationMemberId: input.destinationMemberId,
        grantorMemberId: input.grantorMemberId,
        projectionKind: input.projectionKind,
      },
    },
    data: {
      id: generateHostedVaultShareId(),
      grantedAt: input.now,
      revokedAt: null,
      status: "granted",
    },
  });
}

export async function revokeHostedVaultSharesTx(input: {
  tx: Prisma.TransactionClient;
  destinationMemberId: string;
  grantorMemberId?: string | null;
  projectionKinds?: readonly HostedVaultShareProjectionKind[] | null;
  now: Date;
}): Promise<number> {
  return (await revokeHostedVaultSharesWithCleanupTx(input)).revokedCount;
}

export async function revokeHostedVaultSharesWithCleanupTx(input: {
  tx: Prisma.TransactionClient;
  destinationMemberId: string;
  grantorMemberId?: string | null;
  projectionKinds?: readonly HostedVaultShareProjectionKind[] | null;
  now: Date;
}): Promise<HostedVaultShareRevocationResult> {
  const projectionKinds = input.projectionKinds?.map((kind) => {
    assertSupportedProjectionKind(kind);
    return kind;
  }) ?? null;
  if (projectionKinds && projectionKinds.length === 0) {
    return { cleanupSignals: [], revokedCount: 0 };
  }

  const shares = await input.tx.hostedVaultShare.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      destinationMemberId: true,
      grantorMemberId: true,
      id: true,
      projectionKind: true,
    },
    where: {
      destinationMemberId: input.destinationMemberId,
      ...(input.grantorMemberId ? { grantorMemberId: input.grantorMemberId } : {}),
      ...(projectionKinds && projectionKinds.length > 0
        ? { projectionKind: { in: [...projectionKinds] } }
        : {}),
      status: "granted",
    },
  }).then((rows) => normalizeRevocableHostedVaultShareRows(rows));

  if (shares.length === 0) {
    return { cleanupSignals: [], revokedCount: 0 };
  }

  return revokeHostedVaultShareRowsTx({
    now: input.now,
    shares,
    tx: input.tx,
  });
}

export async function revokeOutgoingHostedVaultSharesForMemberDeletionTx(input: {
  tx: Prisma.TransactionClient;
  grantorMemberIds: readonly string[];
  now: Date;
}): Promise<{
  cleanupSignals: HostedVaultShareCleanupSignal[];
  revokedCount: number;
}> {
  const grantorMemberIds = [...new Set(input.grantorMemberIds.filter(Boolean))];
  if (grantorMemberIds.length === 0) {
    return { cleanupSignals: [], revokedCount: 0 };
  }

  const shares = await input.tx.hostedVaultShare.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      destinationMemberId: true,
      grantorMemberId: true,
      id: true,
      projectionKind: true,
    },
    where: {
      destinationMemberId: { notIn: grantorMemberIds },
      grantorMemberId: { in: grantorMemberIds },
      status: "granted",
    },
  }).then((rows) => normalizeRevocableHostedVaultShareRows(rows));

  return revokeHostedVaultShareRowsTx({
    now: input.now,
    shares,
    tx: input.tx,
  });
}

async function revokeHostedVaultShareRowsTx(input: {
  tx: Prisma.TransactionClient;
  shares: readonly RevocableHostedVaultShare[];
  now: Date;
}): Promise<{
  cleanupSignals: HostedVaultShareCleanupSignal[];
  revokedCount: number;
}> {
  if (input.shares.length === 0) {
    return { cleanupSignals: [], revokedCount: 0 };
  }

  const rows = await input.tx.$queryRaw<Array<{
    destinationMemberId: string;
    grantorMemberId: string;
    id: string;
    projectionKind: string;
    revokedAt: Date;
  }>>`
    UPDATE hosted_vault_share
    SET
      revoked_at = ${input.now},
      status = 'revoked',
      updated_at = ${input.now}
    WHERE id IN (${Prisma.join(input.shares.map((share) => share.id))})
      AND status = 'granted'
    RETURNING
      destination_member_id AS "destinationMemberId",
      grantor_member_id AS "grantorMemberId",
      id,
      projection_kind AS "projectionKind",
      revoked_at AS "revokedAt"
  `;
  const revokedShares = normalizeRevokedHostedVaultShareRows(rows);
  if (revokedShares.length === 0) {
    return { cleanupSignals: [], revokedCount: 0 };
  }

  const cleanupSignals: HostedVaultShareCleanupSignal[] = [];
  for (const share of revokedShares) {
    const revokedAt = share.revokedAt.toISOString();
    const envelope = buildHostedExecutionVaultShareRevokeWake({
      eventId: buildHostedVaultShareRevokeDedupeKey({
        revokedAt,
        shareId: share.id,
      }),
      memberId: share.destinationMemberId,
      revoke: {
        grantorMemberId: share.grantorMemberId,
        projectionKind: share.projectionKind,
        revokedAt,
        schema: HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA,
        shareId: share.id,
      },
    });
    const append = await appendHostedMailboxEnvelopeTx({
      envelope,
      tx: input.tx,
    });
    if (append.inserted) {
      cleanupSignals.push({
        mailboxItemId: append.item.id,
        memberId: share.destinationMemberId,
      });
    }
  }

  return {
    cleanupSignals,
    revokedCount: revokedShares.length,
  };
}

function normalizeRevocableHostedVaultShareRows(rows: readonly {
  destinationMemberId: string;
  grantorMemberId: string;
  id: string;
  projectionKind: string;
}[]): RevocableHostedVaultShare[] {
  return rows.flatMap((row) => {
    if (!isHostedVaultShareProjectionKind(row.projectionKind)) {
      return [];
    }

    return [{
      destinationMemberId: row.destinationMemberId,
      grantorMemberId: row.grantorMemberId,
      id: row.id,
      projectionKind: row.projectionKind,
    }];
  });
}

function normalizeRevokedHostedVaultShareRows(rows: readonly {
  destinationMemberId: string;
  grantorMemberId: string;
  id: string;
  projectionKind: string;
  revokedAt: Date;
}[]): RevokedHostedVaultShare[] {
  return rows.flatMap((row) => {
    if (!isHostedVaultShareProjectionKind(row.projectionKind)) {
      return [];
    }

    return [{
      destinationMemberId: row.destinationMemberId,
      grantorMemberId: row.grantorMemberId,
      id: row.id,
      projectionKind: row.projectionKind,
      revokedAt: row.revokedAt,
    }];
  });
}

export async function readActiveHostedVaultShareProjectionKinds(input: {
  prisma?: HostedVaultShareGrantClient;
  grantorMemberId: string;
  destinationMemberId: string;
  projectionKinds?: readonly HostedVaultShareProjectionKind[] | null;
}): Promise<HostedVaultShareProjectionKind[]> {
  const prisma = input.prisma ?? getPrisma();
  const projectionKinds = input.projectionKinds?.map((kind) => {
    assertSupportedProjectionKind(kind);
    return kind;
  }) ?? null;
  if (projectionKinds && projectionKinds.length === 0) {
    return [];
  }
  const rows = await prisma.hostedVaultShare.findMany({
    where: {
      destinationMemberId: input.destinationMemberId,
      grantorMemberId: input.grantorMemberId,
      ...(projectionKinds && projectionKinds.length > 0
        ? { projectionKind: { in: [...projectionKinds] } }
        : {}),
      status: "granted",
    },
    select: { projectionKind: true },
  });
  return rows
    .map((row) => row.projectionKind)
    .filter(isHostedVaultShareProjectionKind);
}

function assertSupportedProjectionKind(value: unknown): asserts value is HostedVaultShareProjectionKind {
  if (!isHostedVaultShareProjectionKind(value)) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SHARE_PROJECTION_UNSUPPORTED",
      httpStatus: 400,
      message: "That vault-share projection is not supported.",
      retryable: false,
    });
  }
}
function isPrismaUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}
