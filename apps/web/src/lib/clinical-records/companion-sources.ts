import "server-only";
import { get as readGlobalConfig } from "@vercel/global-config";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { hostedMemberPersonalEmailAddress } from "../hosted-onboarding/hosted-email-reply-alias";
import { getPrisma } from "../prisma";
import { classifyClinicalSource, hasImportCapacity } from "./source-state";
import { lastRunActivity, lifecycleRunSelect } from "./run-lifecycle";
import { hasClinicalProcessorApprovals } from "./processor-registry";
import wideLogos from "./provider-logos.json";
import squareLogos from "./provider-logos-square.json";

// The app draws a square tile, so it gets the square mark when one exists.
// The wide wordmarks were made for the web pages and are the fallback.
const companionLogoMaps: Record<string, string>[] = [squareLogos, wideLogos];
const companionLogoPath = /^\/clinical-provider-logos\/[a-f0-9]{24}\.png$/u;

export function clinicalLogoPath(id: string) {
  for (const logos of companionLogoMaps) {
    const value = logos[id];
    if (typeof value === "string" && companionLogoPath.test(value)) return value;
  }
  return undefined;
}

async function portalForwardingAdvertised() {
  if (!process.env.GLOBAL_CONFIG) return false;
  try {
    return await readGlobalConfig("clinicalPortalForwarding") === true;
  } catch {
    return false;
  }
}

export async function readCompanionSources(auth: HostedNativeMemberAuth) {
  // Removal stamps disconnectedAt. NULLS FIRST keeps all counted rows ahead of history.
  const prisma = getPrisma();
  const rows = await prisma.clinicalRecordConnection.findMany({
    where: { memberId: auth.member.id },
    orderBy: [{ disconnectedAt: { sort: "desc", nulls: "first" } }, { updatedAt: "desc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true, providerDirectoryEntryId: true, displayName: true, status: true,
      requiresProcessorApprovals: true, refreshTokenEncrypted: true, connectedAt: true, lastCheckedAt: true, lastErrorCode: true,
      retrievalRuns: { orderBy: { generation: "desc" }, take: 1, select: lifecycleRunSelect },
    },
  });
  const canAdd = hasImportCapacity(rows.filter(row => row.status !== "disconnected").length);
  const approvalDependentSources = new Set(rows.filter(row =>
    row.requiresProcessorApprovals && ["active", "error"].includes(row.status)
    && (row.refreshTokenEncrypted || row.retrievalRuns.some(run => !run.completedAt)
      || row.lastErrorCode === "processor-admission-blocked")
  ).map(row => row.id));
  const missingApprovals = approvalDependentSources.size > 0 && !await hasClinicalProcessorApprovals(auth.member.id, prisma);
  const sources = rows.map(row => {
    const run = row.retrievalRuns[0];
    const { unknownStatus, ...projection } = classifyClinicalSource(row.status, run, row.lastErrorCode, canAdd);
    if (unknownStatus) console.warn("Unknown clinical source status.");
    return {
      ...projection, id: row.id, providerId: row.providerDirectoryEntryId, name: row.displayName,
      reason: missingApprovals && approvalDependentSources.has(row.id) ? "processor_approval_required" as const : projection.reason,
      logoPath: clinicalLogoPath(row.providerDirectoryEntryId),
      connectedAt: row.connectedAt.toISOString(), lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      lastActivityAt: projection.actions.includes("start_over") && run
        ? lastRunActivity(run).toISOString() : null,
      updates: row.status !== "disconnected" && row.refreshTokenEncrypted ? "daily" as const : "one_time" as const,
    };
  });
  const member = await prisma.hostedMember.findUniqueOrThrow({
    where: { id: auth.member.id },
    select: {
      clinicalRecordMessageMode: true, suspendedAt: true,
      routing: { select: { replyAliasLookupKey: true } },
      emailAuthorization: { select: { verifiedEmailAddressEncrypted: true, verifiedEmailLookupKey: true, verifiedEmailVerifiedAt: true } },
    },
  });
  const forwardTo = await portalForwardingAdvertised() ? await hostedMemberPersonalEmailAddress(member) : null;
  return { sources, canAdd, ...(forwardTo ? { forwardTo } : {}),
    ...(sources.some(source => source.updates === "daily") ? { messageMode: member.clinicalRecordMessageMode } : {}) };
}
