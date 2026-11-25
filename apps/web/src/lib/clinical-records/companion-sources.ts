import "server-only";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { getPrisma } from "../prisma";
import { classifyClinicalSource, hasImportCapacity } from "./source-state";
import { lastRunActivity, lifecycleRunSelect } from "./run-lifecycle";
import logos from "./provider-logos.json";

export function clinicalLogoPath(id: string) {
  const value = (logos as Record<string, string>)[id];
  return typeof value === "string" && /^\/clinical-provider-logos\/[a-f0-9]{24}\.png$/u.test(value) ? value : undefined;
}

export async function readCompanionSources(auth: HostedNativeMemberAuth) {
  // Removal stamps disconnectedAt. NULLS FIRST keeps all counted rows ahead of history.
  const rows = await getPrisma().clinicalRecordConnection.findMany({
    where: { memberId: auth.member.id },
    orderBy: [{ disconnectedAt: { sort: "desc", nulls: "first" } }, { updatedAt: "desc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true, providerDirectoryEntryId: true, displayName: true, status: true,
      refreshTokenEncrypted: true, connectedAt: true, lastCheckedAt: true, lastErrorCode: true,
      retrievalRuns: { orderBy: { generation: "desc" }, take: 1, select: lifecycleRunSelect },
    },
  });
  const canAdd = hasImportCapacity(rows.filter(row => row.status !== "disconnected").length);
  const sources = rows.map(row => {
    const run = row.retrievalRuns[0];
    const { unknownStatus, ...projection } = classifyClinicalSource(row.status, run, row.lastErrorCode, canAdd);
    if (unknownStatus) console.warn("Unknown clinical source status.");
    return {
      ...projection, id: row.id, providerId: row.providerDirectoryEntryId, name: row.displayName,
      logoPath: clinicalLogoPath(row.providerDirectoryEntryId),
      connectedAt: row.connectedAt.toISOString(), lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      lastActivityAt: projection.actions.includes("start_over") && run
        ? lastRunActivity(run).toISOString() : null,
      updates: row.refreshTokenEncrypted ? "daily" as const : "one_time" as const,
    };
  });
  return { sources, canAdd };
}
