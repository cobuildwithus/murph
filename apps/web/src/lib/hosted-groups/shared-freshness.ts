import "server-only";

import {
  hostedGroupMemberHasMissingWearableDates,
  parseHostedGroupSharedFreshnessRequirements,
  type HostedRuntimeGroupSharedReadRequest,
  type HostedRuntimeGroupSharedReadResult,
} from "@murphai/hosted-execution/runtime-control";

import { buildHostedVaultShareProjectionScopeKey } from "@murphai/hosted-execution/vault-share";

import { appendHostedDeviceSyncManualReconcileWake } from "../device-sync/wake-service";
import { activeHostedMemberAccessWhere } from "../hosted-onboarding/member-access";
import { hostedHealthDataConsentNotRevokedWhere } from "../legal/consent";
import { getPrisma } from "../prisma";
import { readHostedGroupSharedDataByRuntimeMemberId } from "./group-store";
import { includeSourceAwareHostedGroupSleepProjectionScopes } from "./join-policy";

const MAX_REFRESH_CONNECTIONS = 32;
const REFRESH_BUCKET_MS = 5 * 60_000;
const REFRESH_CONCURRENCY = 4;

type SharedReadInput = Parameters<typeof readHostedGroupSharedDataByRuntimeMemberId>[0]
  & Pick<HostedRuntimeGroupSharedReadRequest, "freshness">;

/** Refresh uses ordinary member ingestion; every result still comes from a new consented read. */
export async function readHostedGroupSharedDataWithFreshness(
  input: SharedReadInput,
): Promise<HostedRuntimeGroupSharedReadResult> {
  const requirements = input.freshness === undefined ? null
    : parseHostedGroupSharedFreshnessRequirements(input.freshness, input.projectionScopes);
  const initial = await readHostedGroupSharedDataByRuntimeMemberId(input);
  if (!requirements || initial.status !== "ok") {
    return initial;
  }
  const missing = initial.members.flatMap((member) => {
    const projectionScopes = member.projections.filter((projection) =>
      hostedGroupMemberHasMissingWearableDates({ ...member, projections: [projection] }, requirements)
    ).map((projection) => projection.projectionScope);
    return projectionScopes.length === 0 ? [] : [{
      grantorMemberId: member.memberId,
      projectionScopeKey: { in: includeSourceAwareHostedGroupSleepProjectionScopes(projectionScopes)
        .map(buildHostedVaultShareProjectionScopeKey) },
    }];
  });
  if (missing.length === 0) {
    return { ...initial, freshness: { checkedAt: new Date().toISOString(), refreshStatus: "not_needed" } };
  }
  // The normal reconcile window can recover recent days, not arbitrary history
  // or future dates. Leave those reads immediate and honest.
  const todayMs = Date.parse(new Date().toISOString().slice(0, 10));
  if (requirements.some(({ date }) => {
    const ageDays = (todayMs - Date.parse(date)) / 86_400_000;
    return ageDays < -1 || ageDays > 2;
  })) {
    return { ...initial, freshness: { checkedAt: new Date().toISOString(), refreshStatus: "unavailable" } };
  }
  let refreshStatus: "requested" | "unavailable" = "unavailable";
  try {
    refreshStatus = await requestSharedWearableSync({
      missing,
      runtimeMemberId: input.runtimeMemberId,
    });
  } catch {
    // A failed request is not proof that no wake was accepted or that no data exists.
  }
  const current = await readHostedGroupSharedDataByRuntimeMemberId(input);
  return current.status === "ok" ? {
    ...current,
    freshness: { checkedAt: new Date().toISOString(), refreshStatus },
  } : current;
}

async function requestSharedWearableSync(input: {
  missing: { grantorMemberId: string; projectionScopeKey: { in: string[] } }[];
  runtimeMemberId: string;
}): Promise<"requested" | "unavailable"> {
  const prisma = getPrisma();
  // Recheck active health access and exact grants; do not return private connection state.
  const grants = await prisma.hostedVaultShare.findMany({
    select: { grantorMemberId: true },
    distinct: ["grantorMemberId"],
    take: MAX_REFRESH_CONNECTIONS + 1,
    where: {
      destinationMemberId: input.runtimeMemberId,
      OR: input.missing,
      status: "granted",
      grantor: { AND: [activeHostedMemberAccessWhere(), hostedHealthDataConsentNotRevokedWhere()],
        hostedGroupMemberships: { some: { group: { runtimeMemberId: input.runtimeMemberId } } },
      },
    },
  });
  if (grants.length === 0 || grants.length > MAX_REFRESH_CONNECTIONS) {
    return "unavailable";
  }
  const connections = await prisma.deviceConnection.findMany({
    select: { id: true, userId: true, provider: true, connectedAt: true },
    orderBy: [{ userId: "asc" }, { id: "asc" }],
    take: MAX_REFRESH_CONNECTIONS + 1,
    where: { userId: { in: grants.map((grant) => grant.grantorMemberId) }, status: "active" },
  });
  if (connections.length === 0 || connections.length > MAX_REFRESH_CONNECTIONS) {
    return "unavailable";
  }
  const bucketAt = Math.floor(Date.now() / REFRESH_BUCKET_MS) * REFRESH_BUCKET_MS;
  let accepted = false;
  for (let offset = 0; offset < connections.length; offset += REFRESH_CONCURRENCY) {
    const results = await Promise.allSettled(connections.slice(offset, offset + REFRESH_CONCURRENCY).map((connection) =>
      appendHostedDeviceSyncManualReconcileWake({
        connectionId: connection.id,
        expectedConnectedAt: connection.connectedAt.toISOString(),
        occurredAt: new Date(Math.max(bucketAt, connection.connectedAt.getTime())).toISOString(),
        provider: connection.provider,
        userId: connection.userId,
      })
    ));
    accepted ||= results.some((result) => result.status === "fulfilled" && result.value.wakeAccepted);
  }
  return accepted ? "requested" : "unavailable";
}
