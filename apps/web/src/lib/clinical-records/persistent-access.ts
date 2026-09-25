import "server-only";

import { randomUUID } from "node:crypto";
import { hashClinicalFhirPatientId } from "@murphai/clinical-records";
import * as z from "@murphai/contracts/zod-runtime";

import { lockHostedMemberRow, readHostedMemberSuspensionAfterLockTx } from "../hosted-onboarding/shared";
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { getPrisma } from "../prisma";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { clinicalRecordsError, isClinicalRecordsControlPlaneError } from "./errors";
import { readEpicPersistentCredentials } from "./epic-import-config";
import { openClinicalConnectionSecret, sealClinicalConnectionSecret } from "./secrets";
import { refreshSmartAccessToken, type SmartTokenResponse } from "./smart";

export const CLINICAL_DAILY_SYNC_MS = 24 * 60 * 60 * 1000;
export const CLEAR_CLINICAL_PERSISTENT_ACCESS = {
  refreshTokenEncrypted: null, refreshLeaseId: null, refreshLeaseExpiresAt: null, nextSyncAt: null,
} as const;
const refreshPayloadSchema = z.object({
  schemaVersion: z.literal(1), clientId: z.string().min(1).max(512),
  tokenEndpoint: z.string().url().max(2048), refreshToken: z.string().min(1).max(65_536),
  grantedScopes: z.array(z.string().min(1).max(200)).max(50),
}).strict();

export async function prepareClinicalPersistentAccess(input: {
  connectionId: string; memberId: string; tokenVersion: number; clientId: string;
  tokenEndpoint: string; requestedScopes: readonly string[]; token: SmartTokenResponse; now: Date;
}) {
  if (!input.requestedScopes.includes("offline_access") || !input.token.grantedScopes.includes("offline_access") || !input.token.refreshToken) {
    return CLEAR_CLINICAL_PERSISTENT_ACCESS;
  }
  const refreshTokenEncrypted = await sealClinicalConnectionSecret({
    connectionId: input.connectionId, memberId: input.memberId, tokenVersion: input.tokenVersion, field: "refreshToken",
    value: JSON.stringify({ schemaVersion: 1, clientId: input.clientId, tokenEndpoint: input.tokenEndpoint,
      refreshToken: input.token.refreshToken, grantedScopes: input.token.grantedScopes }),
  });
  if (!refreshTokenEncrypted) throw new TypeError("Persistent access encryption returned an empty value.");
  return { ...CLEAR_CLINICAL_PERSISTENT_ACCESS, refreshTokenEncrypted,
    nextSyncAt: new Date(input.now.getTime() + CLINICAL_DAILY_SYNC_MS) };
}

export function clinicalCredentialsAfterCheck(hasPersistentAccess: boolean, now: Date) {
  return hasPersistentAccess ? { nextSyncAt: new Date(now.getTime() + CLINICAL_DAILY_SYNC_MS) }
    : { accessTokenEncrypted: null, accessTokenExpiresAt: null, patientIdEncrypted: null };
}

/** A refresh lease owns exactly one rotating-token exchange, outside database locks. */
export async function renewClinicalAccess(input: {
  connectionId: string; memberId: string; generation: number; fetchImpl?: typeof fetch; now?: Date;
}): Promise<string> {
  return runWithHostedDomainRootUnwrapCache(async () => {
    const now = input.now ?? new Date();
    const prisma = getPrisma();
    const leaseId = randomUUID();
    const connection = await prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, input.memberId);
      if (await readHostedMemberSuspensionAfterLockTx(tx, input.memberId) !== "active") throw authorizationRequired();
      await assertHostedLaunchRequiredConsentGranted({ memberId: input.memberId, prisma: tx });
      const current = await tx.clinicalRecordConnection.findFirst({ where: {
        id: input.connectionId, memberId: input.memberId, retrievalGeneration: input.generation,
        status: { in: ["active", "error"] },
      } });
      if (!current?.refreshTokenEncrypted || !current.patientIdEncrypted) throw authorizationRequired();
      if (current.accessTokenEncrypted && current.accessTokenExpiresAt
        && current.accessTokenExpiresAt.getTime() > now.getTime() + 60_000) return { current, claimed: false };
      if (current.refreshLeaseId) {
        // An abandoned exchange may have consumed its token; never race or replay it.
        if (!current.refreshLeaseExpiresAt || current.refreshLeaseExpiresAt <= now) throw authorizationRequired();
        throw clinicalRecordsError({ code: "CLINICAL_RECORD_REFRESH_IN_PROGRESS", httpStatus: 503,
          retryable: true, message: "Medical-record access is being renewed." });
      }
      await tx.clinicalRecordConnection.update({ where: { id: current.id }, data: {
        refreshLeaseId: leaseId, refreshLeaseExpiresAt: new Date(now.getTime() + 60_000),
      } });
      return { current, claimed: true };
    });
    const { current, claimed } = connection;
    const identity = { connectionId: current.id, memberId: input.memberId, tokenVersion: current.tokenVersion };
    if (!claimed) {
      const token = await openClinicalConnectionSecret({ ...identity, field: "accessToken", encrypted: current.accessTokenEncrypted });
      if (!token) throw authorizationRequired();
      return token;
    }
    try {
      const value = await openClinicalConnectionSecret({ ...identity, field: "refreshToken", encrypted: current.refreshTokenEncrypted });
      const payload = refreshPayloadSchema.parse(JSON.parse(value ?? "null"));
      const credentials = readEpicPersistentCredentials(current.providerDirectoryEntryId);
      if (!credentials || credentials.clientId !== payload.clientId) throw authorizationRequired();
      const token = await refreshSmartAccessToken({ ...payload, clientSecret: credentials.clientSecret, fetchImpl: input.fetchImpl });
      if (token.patientId) {
        const binding = await openClinicalConnectionSecret({ ...identity, field: "patientBinding", encrypted: current.patientBindingEncrypted });
        if (binding !== hashClinicalFhirPatientId(token.patientId)) throw authorizationRequired();
      }
      const accessTokenEncrypted = await sealClinicalConnectionSecret({ ...identity, field: "accessToken", value: token.accessToken });
      const refreshTokenEncrypted = await sealClinicalConnectionSecret({ ...identity, field: "refreshToken",
        value: JSON.stringify({ ...payload, refreshToken: token.refreshToken, grantedScopes: token.grantedScopes }) });
      if (!accessTokenEncrypted || !refreshTokenEncrypted) throw authorizationRequired();
      const accepted = await prisma.$transaction(async (tx) => {
        await lockHostedMemberRow(tx, input.memberId);
        if (await readHostedMemberSuspensionAfterLockTx(tx, input.memberId) !== "active") return false;
        await assertHostedLaunchRequiredConsentGranted({ memberId: input.memberId, prisma: tx });
        const updated = await tx.clinicalRecordConnection.updateMany({ where: {
          id: current.id, memberId: input.memberId, tokenVersion: current.tokenVersion,
          retrievalGeneration: input.generation, refreshLeaseId: leaseId, status: { in: ["active", "error"] },
        }, data: { accessTokenEncrypted, refreshTokenEncrypted,
          accessTokenExpiresAt: new Date(Date.now() + token.expiresInSeconds * 1000),
          refreshLeaseId: null, refreshLeaseExpiresAt: null } });
        return updated.count === 1;
      });
      if (!accepted) throw authorizationRequired();
      return token.accessToken;
    } catch (error) {
      const retryable = isClinicalRecordsControlPlaneError(error) && error.code === "CLINICAL_RECORD_SMART_REFRESH_TEMPORARILY_UNAVAILABLE";
      if (retryable) {
        await prisma.clinicalRecordConnection.updateMany({ where: {
          id: current.id, memberId: input.memberId, tokenVersion: current.tokenVersion,
          retrievalGeneration: input.generation, refreshLeaseId: leaseId,
        }, data: { refreshLeaseId: null, refreshLeaseExpiresAt: null } });
        throw error;
      }
      // Keep a possibly consumed token leased until retrieval atomically ends
      // both the connection and run through its generation-fenced reauth owner.
      throw authorizationRequired();
    }
  });
}

function authorizationRequired() {
  return clinicalRecordsError({ code: "CLINICAL_RECORD_SMART_REAUTH_REQUIRED",
    httpStatus: 401, message: "Reconnect this patient portal to continue updating records." });
}
