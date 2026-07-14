import "server-only";

import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { requireActiveHostedAppSessionFromRequest } from "../hosted-onboarding/app-session";
import { getPrisma } from "../prisma";
import { clinicalRecordsError } from "./errors";

const CONNECTION_STATUSES = new Set(["active", "disconnected", "needs_reauth", "error"]);
const RUN_STATUSES = new Set([
  "queued",
  "retrieving",
  "importing",
  "complete",
  "partial",
  "needs_reauth",
  "failed",
  "canceled",
]);

export async function listClinicalRecordConnections(request: Request) {
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const connections = await getPrisma().clinicalRecordConnection.findMany({
    include: {
      retrievalRuns: {
        orderBy: [{ generation: "desc" }],
        take: 1,
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    where: { memberId: auth.member.id, status: { not: "disconnected" } },
  });
  return connections.map((connection) => {
    const latestRun = connection.retrievalRuns[0] ?? null;
    return {
      connectedAt: connection.connectedAt.toISOString(),
      connectionId: connection.id,
      displayName: connection.displayName,
      lastErrorCode: sanitizeErrorCode(connection.lastErrorCode),
      lastSyncCompletedAt: connection.lastSyncCompletedAt?.toISOString() ?? null,
      latestRun: latestRun ? {
        completedAt: latestRun.completedAt?.toISOString() ?? null,
        importedCount: latestRun.importedCount,
        reviewCount: latestRun.reviewCount,
        runId: latestRun.id,
        status: requireKnownStatus(latestRun.status, RUN_STATUSES, "run"),
      } : null,
      providerDirectoryEntryId: connection.providerDirectoryEntryId,
      sourceSystem: connection.sourceSystem,
      status: requireKnownStatus(connection.status, CONNECTION_STATUSES, "connection"),
    };
  });
}

export async function disconnectClinicalRecordConnection(input: {
  connectionId: string;
  now?: Date;
  request: Request;
}): Promise<{ connectionId: string; status: "disconnected" }> {
  assertHostedOnboardingMutationOrigin(input.request);
  const auth = await requireActiveHostedAppSessionFromRequest(input.request);
  const now = input.now ?? new Date();
  return getPrisma().$transaction(async (tx) => {
    const connection = await tx.clinicalRecordConnection.findFirst({
      select: { providerDirectoryEntryId: true },
      where: { id: input.connectionId, memberId: auth.member.id },
    });
    if (!connection) throw connectionNotFoundError();
    const updated = await tx.clinicalRecordConnection.updateMany({
      data: {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        disconnectedAt: now,
        patientIdEncrypted: null,
        refreshTokenEncrypted: null,
        status: "disconnected",
      },
      where: { id: input.connectionId, memberId: auth.member.id },
    });
    if (updated.count !== 1) throw connectionNotFoundError();
    await tx.clinicalRecordOauthSession.updateMany({
      data: { consumedAt: now },
      where: {
        consumedAt: null,
        createdAt: { lte: now },
        memberId: auth.member.id,
        providerDirectoryEntryId: connection.providerDirectoryEntryId,
      },
    });
    await tx.clinicalRecordRetrievalRun.updateMany({
      data: { completedAt: now, status: "canceled" },
      where: {
        completedAt: null,
        connectionId: input.connectionId,
        memberId: auth.member.id,
        status: { in: ["queued", "retrieving", "importing"] },
      },
    });
    return { connectionId: input.connectionId, status: "disconnected" as const };
  });
}

function sanitizeErrorCode(value: string | null): string | null {
  return value && /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/u.test(value) && value.length <= 96
    ? value
    : null;
}

function requireKnownStatus(value: string, allowed: ReadonlySet<string>, label: string): string {
  if (!allowed.has(value)) throw new TypeError(`Stored Clinical Records ${label} status is invalid.`);
  return value;
}

function connectionNotFoundError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_CONNECTION_NOT_FOUND",
    httpStatus: 404,
    message: "The Clinical Records connection was not found.",
  });
}
