import "server-only";

import { Prisma } from "@prisma/client";

import { lockHostedMemberRow } from "../hosted-onboarding/shared";

import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { requireHostedAppSessionFromRequest } from "../hosted-onboarding/app-session";
import { getPrisma } from "../prisma";
import {
  CLINICAL_RECORD_CONNECTION_STATUSES,
  CLINICAL_RECORD_MAX_IMPORTS_PER_SOURCE,
  CLINICAL_RECORD_RUN_STATUSES,
  type ClinicalRecordConnectionContract,
} from "./client-contracts";
import { clinicalRecordsError } from "./errors";

export async function listClinicalRecordConnections(
  request: Request,
): Promise<ClinicalRecordConnectionContract[]> {
  const auth = await requireHostedAppSessionFromRequest(request);
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
      retrievalGeneration: true,
      retrievalRuns: {
        orderBy: [{ generation: "desc" }],
        select: {
          completedAt: true,
          id: true,
          importedCount: true,
          outcomeCountsJson: true,
          reviewCount: true,
          status: true,
        },
        take: 1,
      },
      sourceSystem: true,
      status: true,
    },
    take: 100,
    where: { memberId },
  });
  return connections.map((connection) => {
    const latestRun = connection.retrievalRuns[0] ?? null;
    return {
      canImport: Boolean(
        latestRun?.completedAt &&
          (latestRun.status !== "needs_reauth" || latestRun.outcomeCountsJson !== null) &&
          connection.retrievalGeneration < CLINICAL_RECORD_MAX_IMPORTS_PER_SOURCE,
      ),
      importsRemaining: Math.max(
        0,
        CLINICAL_RECORD_MAX_IMPORTS_PER_SOURCE - connection.retrievalGeneration,
      ),
      connectedAt: connection.connectedAt.toISOString(),
      connectionId: connection.id,
      displayName: connection.displayName,
      lastErrorCode: sanitizeErrorCode(connection.lastErrorCode),
      lastSyncCompletedAt: connection.lastSyncCompletedAt?.toISOString() ?? null,
      latestRun: latestRun
        ? {
            completedAt: latestRun.completedAt?.toISOString() ?? null,
            importedCount: latestRun.importedCount,
            labResultCount: outcomeCount(latestRun.outcomeCountsJson, "labResultCount"),
            skippedExistingCount: outcomeCount(latestRun.outcomeCountsJson, "skippedExistingCount"),
            reviewCount: latestRun.reviewCount,
            runId: latestRun.id,
            status: requireKnownStatus(latestRun.status, CLINICAL_RECORD_RUN_STATUSES, "run"),
          }
        : null,
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
  const auth = await requireHostedAppSessionFromRequest(input.request);
  const now = input.now ?? new Date();
  return getPrisma().$transaction(async (tx) => {
    await lockHostedMemberRow(tx, auth.member.id);
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
        connectionId: input.connectionId,
        memberId: auth.member.id,
        OR: [
          { completedAt: null, status: { in: ["queued", "retrieving", "importing"] } },
          { status: "needs_reauth", outcomeCountsJson: { equals: Prisma.DbNull } },
        ],
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

function outcomeCount(value: unknown, key: string): number {
  if (!value || typeof value !== "object") return 0;
  const count: unknown = Reflect.get(value, key);
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : 0;
}
