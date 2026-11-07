import "server-only";
import type { PrismaClient } from "@prisma/client";
import { sharesCompanionContact, type HostedVaultShareProjectionKind } from "@murphai/hosted-execution/vault-share";
import { HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS } from "@murphai/hosted-execution/runtime-control";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import { activeHostedMemberAccessWhere } from "../hosted-onboarding/member-access";
import { hostedHealthDataConsentNotRevokedWhere } from "../legal/consent";

/** Shared source freshness only; account details and private diagnostics stay private. */
export async function readSharedCompanionContact(input: {
  prisma: PrismaClient;
  runtimeMemberId: string;
  grants: readonly { id: string; grantorMemberId: string; projectionScope: { projectionKind: HostedVaultShareProjectionKind } }[];
}): Promise<Map<string, string | null>> {
  const grants = input.grants.filter((grant) => sharesCompanionContact(grant.projectionScope.projectionKind));
  if (grants.length === 0) return new Map();
  return input.prisma.$transaction(async (tx) => {
    if (!await hasHostedRuntimeActiveAccess(input.runtimeMemberId, { prisma: tx })) return new Map();
    // Set-based and bounded by the shared-read roster. No per-member queries.
    const connections = await tx.deviceConnection.findMany({
      where: { userId: { in: [...new Set(grants.map((grant) => grant.grantorMemberId))] }, status: "active",
        sources: { some: { sourceProviderSlug: "apple_health_kit", status: "connected" } } },
      select: { userId: true }, distinct: ["userId"], take: HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS + 1,
    });
    if (connections.length > HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS) return new Map();
    const rows = await tx.hostedVaultShare.findMany({
      where: { id: { in: grants.map((grant) => grant.id) }, status: "granted",
        destinationMemberId: input.runtimeMemberId,
        grantorMemberId: { in: connections.map((connection) => connection.userId) },
        grantor: { AND: [activeHostedMemberAccessWhere(), hostedHealthDataConsentNotRevokedWhere()],
          hostedGroupMemberships: { some: { group: { runtimeMemberId: input.runtimeMemberId } } } },
      },
      select: { grantorMemberId: true, grantor: { select: { companionLastContactAt: true } } },
      distinct: ["grantorMemberId"], take: HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS + 1,
    });
    if (rows.length > HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS) return new Map();
    return new Map(rows.map((row) => [row.grantorMemberId, row.grantor.companionLastContactAt?.toISOString() ?? null]));
  }, { maxWait: 5_000, timeout: 5_000 });
}
