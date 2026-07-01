import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
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

export async function grantHostedVaultShareTx(input: {
  tx: Prisma.TransactionClient;
  grantorMemberId: string;
  destinationMemberId: string;
  projectionKind: HostedVaultShareProjectionKind;
  source: string;
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

  const existing = await input.tx.hostedVaultShare.findUnique({
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
          source: input.source,
          status: "granted",
        },
      });
      return;
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) {
        throw error;
      }
    }
  }

  await input.tx.hostedVaultShare.update({
    where: {
      grantorMemberId_projectionKind_destinationMemberId: {
        destinationMemberId: input.destinationMemberId,
        grantorMemberId: input.grantorMemberId,
        projectionKind: input.projectionKind,
      },
    },
    data: existing?.status === "granted"
      ? { source: input.source }
      : {
          grantedAt: input.now,
          revokedAt: null,
          source: input.source,
          status: "granted",
        },
  });
}

export async function revokeHostedVaultSharesTx(input: {
  tx: Prisma.TransactionClient;
  destinationMemberId: string;
  grantorMemberId?: string | null;
  projectionKinds?: readonly HostedVaultShareProjectionKind[] | null;
  source: string;
  now: Date;
}): Promise<number> {
  const projectionKinds = input.projectionKinds?.map((kind) => {
    assertSupportedProjectionKind(kind);
    return kind;
  }) ?? null;
  if (projectionKinds && projectionKinds.length === 0) {
    return 0;
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
  }).then((rows) =>
    rows.flatMap((row) => {
      if (!isHostedVaultShareProjectionKind(row.projectionKind)) {
        return [];
      }

      return [{
        destinationMemberId: row.destinationMemberId,
        grantorMemberId: row.grantorMemberId,
        id: row.id,
        projectionKind: row.projectionKind,
      }];
    })
  );

  if (shares.length === 0) {
    return 0;
  }

  const result = await input.tx.hostedVaultShare.updateMany({
    where: {
      id: { in: shares.map((share) => share.id) },
      status: "granted",
    },
    data: {
      revokedAt: input.now,
      source: input.source,
      status: "revoked",
    },
  });

  const revokedAt = input.now.toISOString();
  for (const share of shares) {
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
    await appendHostedMailboxEnvelopeTx({
      envelope,
      tx: input.tx,
    });
  }

  return result.count;
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
