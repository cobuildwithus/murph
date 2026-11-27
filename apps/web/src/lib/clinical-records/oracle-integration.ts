import "server-only";

import * as z from "@murphai/contracts/zod-runtime";
import productionSet from "../../../public/.well-known/oracle/production.jwks.json";
import { epicAssertionSigner, type EpicClientAuth } from "./epic-client-auth";
import { epicProfileSchema } from "./epic-import-config";
import { clinicalRecordsError } from "./errors";
import { isOracleQuery, ORACLE_INTEGRATION_ID } from "./oracle-policy";
import type { SmartEndpointTrust } from "./smart";

// Oracle Health Millennium patient access (`cerner-fhir`). Everything here is
// default-off: no start, search row or egress happens until the flags allow it.

const ORACLE_AUTHORIZATION_ORIGIN = "https://authorization.cerner.com";
const ORACLE_FHIR_HOST = "fhir-myrecord.cerner.com";
const ORACLE_FHIR_BASE_PATH = /^\/r4\/([A-Za-z0-9-]{1,64})$/u;

export const oracleProfileSchema = z.object({
  integration: z.literal(ORACLE_INTEGRATION_ID),
  environment: z.enum(["production", "sandbox"]),
  method: z.literal("private_key_jwt"),
}).strict();
export type OracleProfile = z.infer<typeof oracleProfileSchema>;

/** Saved in the encrypted callback binding and refresh payload; bare Epic profiles keep parsing. */
export const clinicalGrantProfileSchema = z.union([epicProfileSchema, oracleProfileSchema]);
export type ClinicalGrantProfile = z.infer<typeof clinicalGrantProfileSchema>;

export function isOracleProfile(profile: ClinicalGrantProfile | undefined): profile is OracleProfile {
  return profile !== undefined && "integration" in profile;
}

/**
 * The only stop for traffic on existing Oracle grants, so it reads broadly: any
 * value except empty, "0" or "false" turns it on. Enabling flags stay exact.
 */
export function oracleEgressDisabled(): boolean {
  const value = process.env.CLINICAL_RECORDS_ORACLE_DISABLED?.trim().toLowerCase() ?? "";
  return value !== "" && value !== "0" && value !== "false";
}

/**
 * Oracle treats the client ID as a credential, so sessions and refresh payloads
 * save this fixed reference instead. The signer always uses the hosted secret;
 * a grant issued to an earlier registration is rejected by Oracle at refresh.
 */
export const ORACLE_STORED_CLIENT_REFERENCE = ORACLE_INTEGRATION_ID;

export function oracleSearchEnabled(): boolean {
  return process.env.CLINICAL_RECORDS_ORACLE_SEARCH === "1" && !oracleEgressDisabled();
}

/** New Oracle starts need the flag and an exact opaque member ID from the allowlist. */
export function oracleStartsEnabledFor(memberId: string): boolean {
  return process.env.CLINICAL_RECORDS_ORACLE_STARTS === "1" && !oracleEgressDisabled()
    && (process.env.CLINICAL_RECORDS_ORACLE_MEMBER_IDS ?? "").split(",").map((id) => id.trim())
      .filter(Boolean).includes(memberId);
}

/**
 * Page and document gate for frozen plans. The kill switch is a retryable pause,
 * so a first import resumes from its checkpoint once traffic is allowed again.
 */
export function readOracleQueryGate(queryScopeId: string): { code: string; retryable: boolean } | null {
  if (oracleEgressDisabled()) return { code: "integration-disabled", retryable: true };
  return isOracleQuery(queryScopeId) ? null : { code: "query-unavailable", retryable: false };
}

/**
 * Oracle serves OAuth from one shared host, so the same-origin pin cannot apply.
 * Each role must equal its exact template for the FHIR base's own tenant and host.
 */
export function requireOracleSmartEndpoint(role: "authorization" | "token", value: unknown, fhirBase: URL): string {
  const tenant = ORACLE_FHIR_BASE_PATH.exec(fhirBase.pathname)?.[1];
  if (!tenant || fhirBase.href !== `https://${ORACLE_FHIR_HOST}/r4/${tenant}`
    || typeof value !== "string" || value.length > 2_048) {
    throw untrustedEndpoint();
  }
  const path = role === "authorization"
    ? `/tenants/${tenant}/protocols/oauth2/profiles/smart-v1/personas/patient/authorize`
    : `/tenants/${tenant}/hosts/${ORACLE_FHIR_HOST}/protocols/oauth2/profiles/smart-v1/token`;
  let endpoint: URL;
  try {
    endpoint = new URL(value.trim());
  } catch {
    throw untrustedEndpoint();
  }
  // Exact href equality also rejects userinfo, ports, queries, fragments and other schemes.
  if (endpoint.href !== `${ORACLE_AUTHORIZATION_ORIGIN}${path}`) throw untrustedEndpoint();
  return endpoint.href;
}

export const ORACLE_SMART_ENDPOINT_TRUST: SmartEndpointTrust = {
  authorization: (value, fhirBase) => requireOracleSmartEndpoint("authorization", value, fhirBase),
  token: (value, fhirBase) => requireOracleSmartEndpoint("token", value, fhirBase),
};

/** The signer for an Oracle grant; the private key lives only in hosted secrets. */
export function resolveOracleClientAuth(
  profile: OracleProfile,
  stored?: { clientId: string },
): Extract<EpicClientAuth, { method: "private_key_jwt" }> {
  // No sandbox key set is published; the dev app runs only through a local proof.
  if (oracleEgressDisabled() || profile.environment !== "production") throw notConfigured();
  const clientId = process.env.ORACLE_SMART_CLIENT_ID?.trim();
  if (!clientId || clientId.length > 512) throw notConfigured();
  if (stored && stored.clientId !== ORACLE_STORED_CLIENT_REFERENCE) {
    throw clinicalRecordsError({ code: "CLINICAL_RECORD_PROVIDER_CONFIGURATION_CHANGED", httpStatus: 409,
      message: "The provider configuration changed. Start the connection again." });
  }
  try {
    return epicAssertionSigner(clientId, process.env.ORACLE_SMART_PRIVATE_KEY_PEM ?? "", productionSet.keys);
  } catch {
    throw notConfigured();
  }
}

function notConfigured() {
  return clinicalRecordsError({ code: "CLINICAL_RECORD_PROVIDER_NOT_CONFIGURED", httpStatus: 503, retryable: true,
    message: "The selected Clinical Records provider is not configured yet." });
}

function untrustedEndpoint() {
  return clinicalRecordsError({ code: "CLINICAL_RECORD_SMART_ENDPOINT_MISMATCH", httpStatus: 502,
    message: "The provider returned an untrusted SMART endpoint." });
}
