import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionVaultShareRevokeWake,
} from "@murphai/hosted-execution";
import {
  buildHostedVaultShareProjectionScopeKey,
  buildHostedVaultShareRevokeDedupeKey,
  HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA,
  parseHostedVaultShareProjectionScope,
  type HostedVaultShareProjectionScope,
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
  projectionKind: HostedVaultShareProjectionScope["projectionKind"];
  projectionScope: HostedVaultShareProjectionScope;
  projectionScopeKey: string;
}

interface RevokedHostedVaultShare extends RevocableHostedVaultShare {
  revokedAt: Date;
}

export async function grantHostedVaultShareTx(input: {
  tx: Prisma.TransactionClient;
  grantorMemberId: string;
  destinationMemberId: string;
  projectionScope: HostedVaultShareProjectionScope;
  now: Date;
}): Promise<void> {
  const projectionScope = assertSupportedProjectionScope(input.projectionScope);
  const projectionKind = projectionScope.projectionKind;
  const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);
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
      grantorMemberId_projectionScopeKey_destinationMemberId: {
        destinationMemberId: input.destinationMemberId,
        grantorMemberId: input.grantorMemberId,
        projectionScopeKey,
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
          projectionKind,
          projectionScopeJson: toPrismaJsonValue(projectionScope),
          projectionScopeKey,
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
          grantorMemberId_projectionScopeKey_destinationMemberId: {
            destinationMemberId: input.destinationMemberId,
            grantorMemberId: input.grantorMemberId,
            projectionScopeKey,
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
      grantorMemberId_projectionScopeKey_destinationMemberId: {
        destinationMemberId: input.destinationMemberId,
        grantorMemberId: input.grantorMemberId,
        projectionScopeKey,
      },
    },
    data: {
      id: generateHostedVaultShareId(),
      grantedAt: input.now,
      projectionKind,
      projectionScopeJson: toPrismaJsonValue(projectionScope),
      projectionScopeKey,
      revokedAt: null,
      status: "granted",
    },
  });
}

export async function revokeHostedVaultSharesTx(input: {
  tx: Prisma.TransactionClient;
  destinationMemberId: string;
  grantorMemberId?: string | null;
  projectionScopes?: readonly HostedVaultShareProjectionScope[] | null;
  now: Date;
}): Promise<number> {
  return (await revokeHostedVaultSharesWithCleanupTx(input)).revokedCount;
}

export async function revokeHostedVaultSharesWithCleanupTx(input: {
  tx: Prisma.TransactionClient;
  destinationMemberId: string;
  grantorMemberId?: string | null;
  projectionScopes?: readonly HostedVaultShareProjectionScope[] | null;
  now: Date;
}): Promise<HostedVaultShareRevocationResult> {
  const projectionScopeKeys = input.projectionScopes?.map((scope) => {
    const supported = assertSupportedProjectionScope(scope);
    return buildHostedVaultShareProjectionScopeKey(supported);
  }) ?? null;
  if (projectionScopeKeys && projectionScopeKeys.length === 0) {
    return { cleanupSignals: [], revokedCount: 0 };
  }

  const shares = await input.tx.hostedVaultShare.findMany({
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
      destinationMemberId: input.destinationMemberId,
      ...(input.grantorMemberId ? { grantorMemberId: input.grantorMemberId } : {}),
      ...(projectionScopeKeys && projectionScopeKeys.length > 0
        ? { projectionScopeKey: { in: [...projectionScopeKeys] } }
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
      projectionScopeJson: true,
      projectionScopeKey: true,
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
    projectionScopeJson: unknown;
    projectionScopeKey: string;
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
      projection_scope_json AS "projectionScopeJson",
      projection_scope_key AS "projectionScopeKey",
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
        projectionScope: share.projectionScope,
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
  projectionScopeJson: unknown;
  projectionScopeKey: string;
}[]): RevocableHostedVaultShare[] {
  return rows.flatMap((row) => {
    const projectionScope = parseHostedVaultShareRowProjectionScope(row);
    if (!projectionScope) {
      return [];
    }
    const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);

    return [{
      destinationMemberId: row.destinationMemberId,
      grantorMemberId: row.grantorMemberId,
      id: row.id,
      projectionKind: projectionScope.projectionKind,
      projectionScope,
      projectionScopeKey,
    }];
  });
}

function normalizeRevokedHostedVaultShareRows(rows: readonly {
  destinationMemberId: string;
  grantorMemberId: string;
  id: string;
  projectionKind: string;
  projectionScopeJson: unknown;
  projectionScopeKey: string;
  revokedAt: Date;
}[]): RevokedHostedVaultShare[] {
  return rows.flatMap((row) => {
    const projectionScope = parseHostedVaultShareRowProjectionScope(row);
    if (!projectionScope) {
      return [];
    }
    const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);

    return [{
      destinationMemberId: row.destinationMemberId,
      grantorMemberId: row.grantorMemberId,
      id: row.id,
      projectionKind: projectionScope.projectionKind,
      projectionScope,
      projectionScopeKey,
      revokedAt: row.revokedAt,
    }];
  });
}

export async function readActiveHostedVaultShareProjectionScopes(input: {
  prisma?: HostedVaultShareGrantClient;
  grantorMemberId: string;
  destinationMemberId: string;
  projectionScopes?: readonly HostedVaultShareProjectionScope[] | null;
}): Promise<HostedVaultShareProjectionScope[]> {
  const prisma = input.prisma ?? getPrisma();
  const projectionScopeKeys = input.projectionScopes?.map((scope) => {
    const supported = assertSupportedProjectionScope(scope);
    return buildHostedVaultShareProjectionScopeKey(supported);
  }) ?? null;
  if (projectionScopeKeys && projectionScopeKeys.length === 0) {
    return [];
  }
  const rows = await prisma.hostedVaultShare.findMany({
    where: {
      destinationMemberId: input.destinationMemberId,
      grantorMemberId: input.grantorMemberId,
      ...(projectionScopeKeys && projectionScopeKeys.length > 0
        ? { projectionScopeKey: { in: [...projectionScopeKeys] } }
        : {}),
      status: "granted",
    },
    select: {
      projectionKind: true,
      projectionScopeJson: true,
      projectionScopeKey: true,
    },
  });
  return rows
    .map(parseHostedVaultShareRowProjectionScope)
    .filter((scope): scope is HostedVaultShareProjectionScope => scope !== null);
}

function assertSupportedProjectionScope(
  value: unknown,
): HostedVaultShareProjectionScope {
  let scope: HostedVaultShareProjectionScope;
  try {
    scope = parseHostedVaultShareProjectionScope(
      value,
      "Vault-share projection scope",
    );
  } catch {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SHARE_PROJECTION_UNSUPPORTED",
      httpStatus: 400,
      message: "That vault-share projection is not supported.",
      retryable: false,
    });
  }
  return scope;
}

function parseHostedVaultShareRowProjectionScope(row: {
  projectionKind: string;
  projectionScopeJson: unknown;
  projectionScopeKey: string;
}): HostedVaultShareProjectionScope | null {
  try {
    const scope = parseHostedVaultShareProjectionScope(
      row.projectionScopeJson ?? row.projectionKind,
      "Hosted vault-share row projection scope",
    );
    if (
      scope.projectionKind !== row.projectionKind
      || buildHostedVaultShareProjectionScopeKey(scope) !== row.projectionScopeKey
    ) {
      return null;
    }
    return scope;
  } catch {
    return null;
  }
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function isPrismaUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}
