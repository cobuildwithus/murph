import "server-only";

import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { requireActiveHostedAppSessionFromRequest } from "../hosted-onboarding/app-session";
import { getPrisma } from "../prisma";
import {
  CLINICAL_RECORD_CONNECTION_STATUSES,
  CLINICAL_RECORD_RUN_STATUSES,
  type ClinicalRecordConnectionContract,
} from "./client-contracts";
import { clinicalRecordsError } from "./errors";

export async function listClinicalRecordConnections(
  request: Request,
): Promise<ClinicalRecordConnectionContract[]> {
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  return listClinicalRecordConnectionsForMember(auth.member.id);
}

export async function listClinicalRecordConnectionsForMember(
  memberId: string,
): Promise<ClinicalRecordConnectionContract[]> {
  const connections = await getPrisma().clinicalRecordConnection.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: {
      connectedAt: true,
      displayName: true,
      id: true,
      lastErrorCode: true,
      lastSyncCompletedAt: true,
      providerDirectoryEntryId: true,
      retrievalRuns: {
        orderBy: [{ generation: "desc" }],
        select: {
          completedAt: true,
          id: true,
          importedCount: true,
          reviewCount: true,
          status: true,
        },
        take: 1,
      },
      sourceSystem: true,
      status: true,
    },
    take: 100,
    where: { memberId, status: { not: "disconnected" } },
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
        status: requireKnownStatus(
          latestRun.status,
          CLINICAL_RECORD_RUN_STATUSES,
          "run",
        ),
      } : null,
      providerDirectoryEntryId: connection.providerDirectoryEntryId,
      sourceSystem: requireEpicSourceSystem(connection.sourceSystem),
      status: requireKnownStatus(
        connection.status,
        CLINICAL_RECORD_CONNECTION_STATUSES,
        "connection",
      ),
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

function requireKnownStatus<Status extends string>(
  value: string,
  allowed: readonly Status[],
  label: string,
): Status {
  const match = allowed.find((candidate) => candidate === value);
  if (!match) throw new TypeError(`Stored Clinical Records ${label} status is invalid.`);
  return match;
}

function requireEpicSourceSystem(value: string): "epic-fhir" {
  if (value !== "epic-fhir") {
    throw new TypeError("Stored Clinical Records source system is invalid.");
  }
  return value;
}

function connectionNotFoundError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_CONNECTION_NOT_FOUND",
    httpStatus: 404,
    message: "The Clinical Records connection was not found.",
  });
}
