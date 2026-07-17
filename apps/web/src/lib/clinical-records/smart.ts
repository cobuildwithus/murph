import { createHash, randomBytes } from "node:crypto";

import { clinicalRecordsError } from "./errors";
import {
  buildEpicBetaSmartResourceScope,
  readGrantedEpicBetaResourceTypes,
} from "./epic-beta-policy";
import {
  ClinicalResponseBodyLimitError,
  decodeClinicalResponseUtf8,
  readClinicalResponseBytes,
} from "./response-bytes";

const SMART_CONFIGURATION_TIMEOUT_MS = 10_000;
const SMART_TOKEN_TIMEOUT_MS = 15_000;
const SMART_RESPONSE_MAX_BYTES = 64 * 1_024;

export interface SmartConfiguration {
  authorizationEndpoint: string;
  requestedScopes: readonly string[];
  requestedResourceTypes: readonly string[];
  tokenEndpoint: string;
}

export interface SmartTokenResponse {
  accessToken: string;
  expiresInSeconds: number | null;
  grantedScopes: readonly string[];
  patientId: string;
}

export function createSmartPkce(): {
  challenge: string;
  verifier: string;
} {
  const verifier = randomBytes(32).toString("base64url");
  return {
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    verifier,
  };
}

export function createSmartState(): { state: string; stateHash: string } {
  const state = `crs_${randomBytes(32).toString("base64url")}`;
  return { state, stateHash: hashSmartState(state) };
}

export function normalizeSmartStateHash(state: string): string | null {
  return /^crs_[A-Za-z0-9_-]{43}$/u.test(state) ? hashSmartState(state) : null;
}

export async function discoverSmartConfiguration(input: {
  fetchImpl?: typeof fetch;
  fhirBaseUrl: string;
  requestedBaseScopes: readonly string[];
  resourceTypes: readonly string[];
}): Promise<SmartConfiguration> {
  const fhirBase = new URL(input.fhirBaseUrl);
  const metadataUrl = new URL(`${fhirBase.pathname.replace(/\/$/u, "")}/.well-known/smart-configuration`, fhirBase.origin);
  const response = await fetchWithTimeout(input.fetchImpl ?? fetch, metadataUrl, {
    headers: { Accept: "application/json" },
    method: "GET",
    redirect: "manual",
  }, SMART_CONFIGURATION_TIMEOUT_MS, "CLINICAL_RECORD_SMART_DISCOVERY_FAILED");
  if (!response.ok) {
    throw providerUnavailable("CLINICAL_RECORD_SMART_DISCOVERY_FAILED", "SMART configuration is unavailable.");
  }
  const body = requireRecord(await readBoundedJson(response), "SMART configuration");
  const methods = requireStringArray(body.code_challenge_methods_supported, "SMART PKCE methods", 16);
  if (!methods.includes("S256")) {
    throw providerUnavailable("CLINICAL_RECORD_SMART_PKCE_UNSUPPORTED", "The provider does not support required SMART security.");
  }
  if (body.scopes_supported !== undefined) {
    requireStringArray(body.scopes_supported, "SMART supported scopes", 512);
  }
  const capabilities = requireStringArray(body.capabilities, "SMART capabilities", 128);
  const scopeSelection = selectSmartRequestedScopes({
    capabilities,
    requestedBaseScopes: input.requestedBaseScopes,
    resourceTypes: input.resourceTypes,
  });
  return {
    authorizationEndpoint: requirePinnedEndpoint(body.authorization_endpoint, fhirBase, "SMART authorization endpoint"),
    requestedResourceTypes: scopeSelection.resourceTypes,
    requestedScopes: scopeSelection.scopes,
    tokenEndpoint: requirePinnedEndpoint(body.token_endpoint, fhirBase, "SMART token endpoint"),
  };
}

export function selectSmartRequestedScopes(input: {
  capabilities: readonly string[];
  requestedBaseScopes: readonly string[];
  resourceTypes: readonly string[];
}): { resourceTypes: string[]; scopes: string[] } {
  const capabilities = new Set(input.capabilities);
  if (!capabilities.has("context-standalone-patient")) {
    throw providerUnavailable(
      "CLINICAL_RECORD_SMART_SCOPES_UNSUPPORTED",
      "The provider does not advertise standalone patient launch support.",
    );
  }
  const permissionVersion = capabilities.has("permission-v2")
    ? "v2"
    : capabilities.has("permission-v1")
      ? "v1"
      : null;
  if (!permissionVersion) {
    throw providerUnavailable(
      "CLINICAL_RECORD_SMART_SCOPES_UNSUPPORTED",
      "The provider does not advertise supported SMART patient permissions.",
    );
  }
  const selected = input.resourceTypes.map((resourceType) => ({
    resourceType,
    scope: buildEpicBetaSmartResourceScope({ permissionVersion, resourceType }),
  }));
  const resourceTypes = selected.map((selection) => selection.resourceType);
  if (!resourceTypes.includes("Patient") || resourceTypes.length < 2) {
    throw providerUnavailable(
      "CLINICAL_RECORD_SMART_SCOPES_UNSUPPORTED",
      "The provider must advertise Patient access and at least one clinical record family.",
    );
  }
  return {
    resourceTypes,
    scopes: [
      ...input.requestedBaseScopes,
      ...selected.map((selection) => selection.scope),
    ],
  };
}

export function buildSmartAuthorizationUrl(input: {
  authorizationEndpoint: string;
  audience: string;
  challenge: string;
  clientId: string;
  redirectUri: string;
  requestedScopes: readonly string[];
  state: string;
}): string {
  const url = new URL(input.authorizationEndpoint);
  url.search = new URLSearchParams({
    aud: input.audience,
    client_id: input.clientId,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: input.requestedScopes.join(" "),
    state: input.state,
  }).toString();
  return url.toString();
}

export async function exchangeSmartAuthorizationCode(input: {
  clientId: string;
  code: string;
  fetchImpl?: typeof fetch;
  redirectUri: string;
  requestedScopes: readonly string[];
  tokenEndpoint: string;
  verifier: string;
}): Promise<SmartTokenResponse> {
  const response = await fetchWithTimeout(input.fetchImpl ?? fetch, new URL(input.tokenEndpoint), {
    body: new URLSearchParams({
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.verifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    redirect: "manual",
  }, SMART_TOKEN_TIMEOUT_MS, "CLINICAL_RECORD_SMART_TOKEN_EXCHANGE_FAILED");
  if (!response.ok) {
    throw providerUnavailable("CLINICAL_RECORD_SMART_TOKEN_EXCHANGE_FAILED", "The provider did not complete authorization.");
  }
  const body = requireRecord(await readBoundedJson(response), "SMART token response");
  const tokenType = requireBoundedString(body.token_type, "SMART token type", 40);
  if (tokenType.toLowerCase() !== "bearer") {
    throw providerUnavailable("CLINICAL_RECORD_SMART_TOKEN_INVALID", "The provider returned an unsupported token type.");
  }
  const accessToken = requireBoundedString(body.access_token, "SMART access token", 65_536);
  const patientId = requireBoundedString(body.patient, "SMART patient context", 512);
  const expiresInSeconds = parseExpiresIn(body.expires_in);
  const grantedScopes = body.scope === undefined
    ? [...input.requestedScopes]
    : parseScopeString(body.scope);
  assertUsefulScopesGranted(input.requestedScopes, grantedScopes);
  return { accessToken, expiresInSeconds, grantedScopes, patientId };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  errorCode: string,
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    throw clinicalRecordsError({
      cause,
      code: errorCode,
      httpStatus: 503,
      message: "The Clinical Records provider is temporarily unavailable.",
      retryable: true,
    });
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("json")) {
    throw providerUnavailable("CLINICAL_RECORD_SMART_RESPONSE_INVALID", "The provider returned an invalid response.");
  }
  let bytes: Uint8Array;
  try {
    bytes = await readClinicalResponseBytes(response, SMART_RESPONSE_MAX_BYTES);
  } catch (cause) {
    if (cause instanceof ClinicalResponseBodyLimitError) {
      throw providerUnavailable("CLINICAL_RECORD_SMART_RESPONSE_TOO_LARGE", "The provider response was too large.");
    }
    throw clinicalRecordsError({
      cause,
      code: "CLINICAL_RECORD_SMART_RESPONSE_INVALID",
      httpStatus: 502,
      message: "The provider returned an invalid response.",
    });
  }
  try {
    return JSON.parse(decodeClinicalResponseUtf8(bytes));
  } catch (cause) {
    throw clinicalRecordsError({
      cause,
      code: "CLINICAL_RECORD_SMART_RESPONSE_INVALID",
      httpStatus: 502,
      message: "The provider returned an invalid response.",
    });
  }
}

function assertUsefulScopesGranted(
  requestedScopes: readonly string[],
  grantedScopes: readonly string[],
  requestedResourceTypes: readonly string[] = readGrantedSmartResourceTypes(requestedScopes),
): void {
  const requested = new Set(requestedResourceTypes);
  const grantedResourceTypes = readGrantedSmartResourceTypes(grantedScopes, requestedResourceTypes)
    .filter((resourceType) => requested.has(resourceType));
  if (
    !grantedResourceTypes.includes("Patient")
    || grantedResourceTypes.length < 2
  ) {
    throw providerUnavailable(
      "CLINICAL_RECORD_SMART_SCOPES_INSUFFICIENT",
      "The provider did not grant all required Clinical Records permissions.",
    );
  }
}

export function readGrantedSmartResourceTypes(
  scopes: readonly string[],
  candidateResourceTypes: readonly string[] = [],
): string[] {
  const candidates = candidateResourceTypes.length > 0
    ? candidateResourceTypes
    : scopes.flatMap((scope) => {
        const resourceType = /^patient\/([A-Z][A-Za-z0-9]+)\.[a-z]+$/u.exec(scope)?.[1];
        return resourceType ? [resourceType] : [];
      });
  return readGrantedEpicBetaResourceTypes(scopes, candidates);
}

function requirePinnedEndpoint(value: unknown, fhirBase: URL, label: string): string {
  const text = requireBoundedString(value, label, 2_048);
  const endpoint = new URL(text);
  if (
    endpoint.protocol !== "https:"
    || endpoint.origin !== fhirBase.origin
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
  ) {
    throw providerUnavailable("CLINICAL_RECORD_SMART_ENDPOINT_MISMATCH", "The provider returned an untrusted SMART endpoint.");
  }
  return endpoint.toString();
}

function hashSmartState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function parseExpiresIn(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0 || number > 31_536_000) {
    throw providerUnavailable("CLINICAL_RECORD_SMART_TOKEN_INVALID", "The provider returned an invalid token expiry.");
  }
  return number;
}

function parseScopeString(value: unknown): string[] {
  const text = requireBoundedString(value, "SMART granted scopes", 4_096);
  const scopes = [...new Set(text.split(/\s+/u).filter(Boolean))];
  if (scopes.length === 0 || scopes.length > 64 || scopes.some((scope) => !/^[A-Za-z0-9/*._:-]+$/u.test(scope))) {
    throw providerUnavailable("CLINICAL_RECORD_SMART_TOKEN_INVALID", "The provider returned invalid scopes.");
  }
  return scopes;
}

function requireStringArray(value: unknown, label: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw providerUnavailable("CLINICAL_RECORD_SMART_CONFIGURATION_INVALID", `${label} is invalid.`);
  }
  return value.map((item) => requireBoundedString(item, label, 120));
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw providerUnavailable("CLINICAL_RECORD_SMART_RESPONSE_INVALID", `${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function requireBoundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw providerUnavailable("CLINICAL_RECORD_SMART_RESPONSE_INVALID", `${label} is invalid.`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw providerUnavailable("CLINICAL_RECORD_SMART_RESPONSE_INVALID", `${label} is invalid.`);
  return text;
}

function providerUnavailable(code: string, message: string) {
  return clinicalRecordsError({ code, httpStatus: 502, message });
}
