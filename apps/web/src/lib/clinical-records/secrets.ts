import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
} from "../hosted-crypto/secure-box";

type ClinicalSecretPrismaClient = Parameters<typeof sealHostedUserSecureBoxString>[0]["prisma"];
type ClinicalConnectionSecretField = "accessToken" | "patientId";
type ClinicalPageCursorIdentity = {
  queryFingerprint?: string;
  queryScopeId?: string;
  retrievalProtocol?: "query-slices-v2";
  sliceId?: string;
};

export async function sealClinicalConnectionFhirBaseUrl(input: {
  connectionId: string;
  memberId: string;
  prisma?: ClinicalSecretPrismaClient;
  value: string;
}): Promise<string> {
  const sealed = await sealHostedUserSecureBoxString({
    aad: {
      field: "fhirBaseUrl",
      purpose: "clinical-records-provider-endpoint",
      rowId: input.connectionId,
      table: "clinical_record_connection",
    },
    lane: "clinical-records-oauth",
    prisma: input.prisma,
    scope: `clinical-records:${input.connectionId}:fhirBaseUrl`,
    userId: input.memberId,
    value: input.value,
  });
  if (!sealed) throw new TypeError("Clinical Records provider endpoint encryption failed.");
  return sealed;
}

export async function openClinicalConnectionFhirBaseUrl(input: {
  connectionId: string;
  encrypted: string;
  memberId: string;
  prisma?: ClinicalSecretPrismaClient;
}): Promise<string> {
  const opened = await openHostedUserSecureBoxString({
    aad: {
      field: "fhirBaseUrl",
      purpose: "clinical-records-provider-endpoint",
      rowId: input.connectionId,
      table: "clinical_record_connection",
    },
    lane: "clinical-records-oauth",
    prisma: input.prisma,
    scope: `clinical-records:${input.connectionId}:fhirBaseUrl`,
    userId: input.memberId,
    value: input.encrypted,
  });
  if (!opened) throw new TypeError("Clinical Records provider endpoint decryption failed.");
  return opened;
}

export async function sealClinicalPageCursor(input: {
  generation: number;
  memberId: string;
  resourceType: string;
  runId: string;
  value: string;
} & ClinicalPageCursorIdentity): Promise<string> {
  const binding = clinicalPageCursorBinding(input);
  const sealed = await sealHostedUserSecureBoxString({
    aad: {
      field: "pageCursor",
      purpose: binding
        ? `clinical-records-fhir-page:${binding}`
        : `clinical-records-fhir-page:${input.resourceType}`,
      rowId: input.runId,
      sequence: input.generation,
      table: "clinical_record_retrieval_run",
    },
    lane: "clinical-records-page-cursor",
    scope: binding
      ? `clinical-records:${input.runId}:${binding}:pageCursor`
      : `clinical-records:${input.runId}:${input.resourceType}:pageCursor`,
    userId: input.memberId,
    value: input.value,
  });
  if (!sealed) throw new TypeError("Clinical Records page cursor encryption failed.");
  return sealed;
}

export async function openClinicalPageCursor(input: {
  generation: number;
  memberId: string;
  resourceType: string;
  runId: string;
  value: string;
} & ClinicalPageCursorIdentity): Promise<string> {
  const binding = clinicalPageCursorBinding(input);
  const opened = await openHostedUserSecureBoxString({
    aad: {
      field: "pageCursor",
      purpose: binding
        ? `clinical-records-fhir-page:${binding}`
        : `clinical-records-fhir-page:${input.resourceType}`,
      rowId: input.runId,
      sequence: input.generation,
      table: "clinical_record_retrieval_run",
    },
    lane: "clinical-records-page-cursor",
    scope: binding
      ? `clinical-records:${input.runId}:${binding}:pageCursor`
      : `clinical-records:${input.runId}:${input.resourceType}:pageCursor`,
    userId: input.memberId,
    value: input.value,
  });
  if (!opened) throw new TypeError("Clinical Records page cursor decryption failed.");
  return opened;
}

function clinicalPageCursorBinding(input: {
  queryFingerprint?: string;
  queryScopeId?: string;
  resourceType: string;
  retrievalProtocol?: "query-slices-v2";
  sliceId?: string;
}): string | null {
  const fields = [
    input.retrievalProtocol,
    input.queryScopeId,
    input.queryFingerprint,
    input.sliceId,
  ];
  if (fields.every((field) => field === undefined)) return null;
  if (
    input.retrievalProtocol !== "query-slices-v2"
    || typeof input.queryScopeId !== "string"
    || typeof input.queryFingerprint !== "string"
    || typeof input.sliceId !== "string"
  ) {
    throw new TypeError("Clinical Records page cursor retrieval identity is incomplete.");
  }
  return createHash("sha256").update([
    input.queryScopeId,
    input.resourceType,
    input.queryFingerprint,
    input.sliceId,
  ].join("\n"), "utf8").digest("hex");
}

export async function sealClinicalOauthVerifier(input: {
  memberId: string;
  prisma?: ClinicalSecretPrismaClient;
  stateHash: string;
  value: string;
}): Promise<string> {
  const sealed = await sealHostedUserSecureBoxString({
    aad: {
      field: "codeVerifier",
      purpose: "clinical-records-smart-pkce",
      rowId: input.stateHash,
      table: "clinical_record_oauth_session",
    },
    lane: "clinical-records-oauth",
    prisma: input.prisma,
    scope: `clinical-records-oauth:${input.stateHash}:codeVerifier`,
    userId: input.memberId,
    value: input.value,
  });
  if (!sealed) throw new TypeError("Clinical Records OAuth verifier encryption failed.");
  return sealed;
}

export async function openClinicalOauthVerifier(input: {
  encrypted: string;
  memberId: string;
  prisma?: ClinicalSecretPrismaClient;
  stateHash: string;
}): Promise<string> {
  const opened = await openHostedUserSecureBoxString({
    aad: {
      field: "codeVerifier",
      purpose: "clinical-records-smart-pkce",
      rowId: input.stateHash,
      table: "clinical_record_oauth_session",
    },
    lane: "clinical-records-oauth",
    prisma: input.prisma,
    scope: `clinical-records-oauth:${input.stateHash}:codeVerifier`,
    userId: input.memberId,
    value: input.encrypted,
  });
  if (!opened) throw new TypeError("Clinical Records OAuth verifier decryption failed.");
  return opened;
}

export async function sealClinicalConnectionSecret(input: {
  connectionId: string;
  field: ClinicalConnectionSecretField;
  memberId: string;
  prisma?: ClinicalSecretPrismaClient;
  tokenVersion: number;
  value: string | null;
}): Promise<string | null> {
  const isPatientId = input.field === "patientId";
  return sealHostedUserSecureBoxString({
    aad: {
      field: input.field,
      purpose: isPatientId ? "clinical-records-patient-context" : "clinical-records-smart-token",
      rowId: input.connectionId,
      sequence: input.tokenVersion,
      table: "clinical_record_connection",
    },
    lane: isPatientId ? "clinical-records-patient-id" : "clinical-records-token",
    prisma: input.prisma,
    scope: `clinical-records:${input.connectionId}:${input.field}`,
    userId: input.memberId,
    value: input.value,
  });
}

export async function openClinicalConnectionSecret(input: {
  connectionId: string;
  encrypted: string | null;
  field: ClinicalConnectionSecretField;
  memberId: string;
  prisma?: ClinicalSecretPrismaClient;
  tokenVersion: number;
}): Promise<string | null> {
  const isPatientId = input.field === "patientId";
  return openHostedUserSecureBoxString({
    aad: {
      field: input.field,
      purpose: isPatientId ? "clinical-records-patient-context" : "clinical-records-smart-token",
      rowId: input.connectionId,
      sequence: input.tokenVersion,
      table: "clinical_record_connection",
    },
    lane: isPatientId ? "clinical-records-patient-id" : "clinical-records-token",
    prisma: input.prisma,
    scope: `clinical-records:${input.connectionId}:${input.field}`,
    userId: input.memberId,
    value: input.encrypted,
  });
}

export function toClinicalJsonArray(values: readonly string[]): Prisma.InputJsonValue {
  return [...values];
}
