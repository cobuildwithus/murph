import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildHostedVaultShareProjectionScopeKey,
  parseHostedVaultShareProjectionScope,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { generateHostedVaultShareId } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import { parseHostedVaultShareRowProjectionScope } from "./row-projection-scope";

export type HostedVaultShareGrantClient = PrismaClient | Prisma.TransactionClient;

export interface HostedVaultShareGrantResult {
  id: string;
  requiresProjection: boolean;
}

export async function grantHostedVaultShareTx(input: {
  tx: Prisma.TransactionClient;
  grantorMemberId: string;
  destinationMemberId: string;
  projectionScope: HostedVaultShareProjectionScope;
  refreshMaterializedProjection?: boolean;
  now: Date;
}): Promise<HostedVaultShareGrantResult> {
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
    select: { id: true, projectionSnapshotCiphertext: true, status: true },
  });

  if (!existing) {
    try {
      const created = await input.tx.hostedVaultShare.create({
        data: {
          id: generateHostedVaultShareId(),
          destinationMemberId: input.destinationMemberId,
          grantedAt: input.now,
          grantorMemberId: input.grantorMemberId,
          projectionKind,
          projectionSnapshotCiphertext: null,
          projectionScopeJson: toPrismaJsonValue(projectionScope),
          projectionScopeKey,
          revokedAt: null,
          status: "granted",
        },
        select: { id: true },
      });
      return { id: created.id, requiresProjection: true };
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
        select: { id: true, projectionSnapshotCiphertext: true, status: true },
      });
      if (!existing) {
        throw error;
      }
    }
  }

  const refreshMaterializedProjection = existing.status === "granted"
    && input.refreshMaterializedProjection === true
    && existing.projectionSnapshotCiphertext !== null;
  if (existing.status === "granted" && !refreshMaterializedProjection) {
    return {
      id: existing.id,
      requiresProjection: existing.projectionSnapshotCiphertext === null,
    };
  }

  const nextGenerationId = generateHostedVaultShareId();
  await input.tx.hostedVaultShare.update({
    where: {
      grantorMemberId_projectionScopeKey_destinationMemberId: {
        destinationMemberId: input.destinationMemberId,
        grantorMemberId: input.grantorMemberId,
        projectionScopeKey,
      },
    },
    data: {
      id: nextGenerationId,
      grantedAt: input.now,
      projectionKind,
      projectionSnapshotCiphertext: null,
      projectionScopeJson: toPrismaJsonValue(projectionScope),
      projectionScopeKey,
      revokedAt: null,
      status: "granted",
    },
  });
  return { id: nextGenerationId, requiresProjection: true };
}

export async function revokeHostedVaultSharesTx(input: {
  tx: Prisma.TransactionClient;
  destinationMemberId: string;
  grantorMemberId?: string | null;
  projectionScopes?: readonly HostedVaultShareProjectionScope[] | null;
  now: Date;
}): Promise<number> {
  const projectionScopeKeys = input.projectionScopes?.map((scope) => {
    const supported = assertSupportedProjectionScope(scope);
    return buildHostedVaultShareProjectionScopeKey(supported);
  }) ?? null;
  if (projectionScopeKeys && projectionScopeKeys.length === 0) {
    return 0;
  }

  const result = await input.tx.hostedVaultShare.updateMany({
    data: {
      projectionSnapshotCiphertext: null,
      revokedAt: input.now,
      status: "revoked",
      updatedAt: input.now,
    },
    where: {
      destinationMemberId: input.destinationMemberId,
      ...(input.grantorMemberId ? { grantorMemberId: input.grantorMemberId } : {}),
      ...(projectionScopeKeys && projectionScopeKeys.length > 0
        ? { projectionScopeKey: { in: [...projectionScopeKeys] } }
        : {}),
      status: "granted",
    },
  });
  return result.count;
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

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function isPrismaUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}
