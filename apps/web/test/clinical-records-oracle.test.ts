import { generateKeyPairSync } from "node:crypto";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clinicalFhirRetrievalSliceSchema, type ClinicalFhirRetrievalSlice } from "@murphai/clinical-records";

import { sandboxPublicKey, signerPem } from "./clinical-records-synthetic-signer";

vi.mock("../public/.well-known/oracle/production.jwks.json", async () => ({
  default: { keys: [(await import("./clinical-records-synthetic-signer")).sandboxPublicKey] },
}));

import { epicTokenRequest } from "@/src/lib/clinical-records/epic-client-auth";
import { buildEpicBetaRetrievalPlan } from "@/src/lib/clinical-records/epic-policy";
import {
  clinicalGrantProfileSchema,
  isOracleProfile,
  oracleEgressDisabled,
  oracleSearchEnabled,
  oracleSandboxEnabledFor,
  oracleStartsEnabledFor,
  ORACLE_SMART_ENDPOINT_TRUST,
  ORACLE_STORED_CLIENT_REFERENCE,
  readOracleQueryGate,
  requireOracleSmartEndpoint,
  resolveOracleClientAuth,
} from "@/src/lib/clinical-records/oracle-integration";
import {
  buildOracleDailyRetrievalPlan,
  buildOracleInitialFhirPageUrl,
  buildOracleQueryFingerprintInput,
  buildOracleRetrievalPlan,
  ORACLE_ACQUISITION_POLICY,
  ORACLE_REQUESTED_BASE_SCOPES,
  ORACLE_RESOURCE_TYPES,
} from "@/src/lib/clinical-records/oracle-policy";
import {
  discoverSmartConfiguration,
  exchangeSmartAuthorizationCode,
  refreshSmartAccessToken,
} from "@/src/lib/clinical-records/smart";

// Synthetic, mixed-case tenant: Oracle tenants are case-sensitive.
const TENANT = "0aB1cD2e-3F4a-5B6c-7D8e-9F0a1B2c3D4e";
const BASE = `https://fhir-myrecord.cerner.com/r4/${TENANT}`;
const AUTHORIZE = `https://authorization.cerner.com/tenants/${TENANT}/protocols/oauth2/profiles/smart-v1/personas/patient/authorize`;
const TOKEN = `https://authorization.cerner.com/tenants/${TENANT}/hosts/fhir-myrecord.cerner.com/protocols/oauth2/profiles/smart-v1/token`;
const PATIENT = "12724066";
const PROFILE = { integration: "oracle-millennium-r4", environment: "production", method: "private_key_jwt" } as const;
const productionEntry = { id: "oracle-0123456789abcdef0123", fhirBaseUrl: BASE };
const productionCallback = { redirectUri: "https://www.withmurph.ai/api/clinical-records/oauth/callback" };
const FAKE_CLIENT_ID = "synthetic-oracle-client";

afterEach(() => vi.unstubAllEnvs());

describe("Oracle OAuth endpoint trust", () => {
  it("accepts only the exact role templates for the base's own tenant and host", () => {
    expect(requireOracleSmartEndpoint("authorization", AUTHORIZE, new URL(BASE))).toBe(AUTHORIZE);
    expect(requireOracleSmartEndpoint("token", TOKEN, new URL(BASE))).toBe(TOKEN);
  });

  it.each([
    ["tenant case", AUTHORIZE.replace(TENANT, TENANT.toLowerCase())],
    ["other tenant", AUTHORIZE.replace(TENANT, "00000000-0000-0000-0000-000000000000")],
    ["query", `${AUTHORIZE}?next=1`],
    ["empty query", `${AUTHORIZE}?`],
    ["fragment", `${AUTHORIZE}#fragment`],
    ["userinfo", AUTHORIZE.replace("https://", "https://user@")],
    ["plain HTTP", AUTHORIZE.replace("https://", "http://")],
    ["explicit port", AUTHORIZE.replace("cerner.com/", "cerner.com:8443/")],
    ["lookalike origin", AUTHORIZE.replace("authorization.cerner.com", "authorization.cerner.com.example.test")],
    ["FHIR origin", AUTHORIZE.replace("authorization.cerner.com", "fhir-myrecord.cerner.com")],
    ["trailing slash", `${AUTHORIZE}/`],
    ["provider persona", AUTHORIZE.replace("personas/patient", "personas/provider")],
    ["SMART v2 profile", AUTHORIZE.replace("smart-v1", "smart-v2")],
    ["token template", TOKEN],
    ["encoded traversal", AUTHORIZE.replace(`/tenants/${TENANT}`, `/tenants/${TENANT}/..%2F${TENANT}`)],
  ])("rejects an authorization endpoint with %s", (_label, endpoint) => {
    expect(() => requireOracleSmartEndpoint("authorization", endpoint, new URL(BASE)))
      .toThrow(expect.objectContaining({ code: "CLINICAL_RECORD_SMART_ENDPOINT_MISMATCH" }));
  });

  it.each([
    ["another FHIR host", TOKEN.replace("hosts/fhir-myrecord.cerner.com", "hosts/fhir-open.cerner.com")],
    ["host case", TOKEN.replace("hosts/fhir-myrecord", "hosts/FHIR-MYRECORD")],
    ["missing hosts", TOKEN.replace("/hosts/fhir-myrecord.cerner.com", "")],
    ["other tenant", TOKEN.replace(TENANT, "00000000-0000-0000-0000-000000000000")],
    ["query", `${TOKEN}?client_id=x`],
    ["authorization template", AUTHORIZE],
  ])("rejects a token endpoint with %s", (_label, endpoint) => {
    expect(() => requireOracleSmartEndpoint("token", endpoint, new URL(BASE)))
      .toThrow(expect.objectContaining({ code: "CLINICAL_RECORD_SMART_ENDPOINT_MISMATCH" }));
  });

  it.each([
    `https://fhir-open.cerner.com/r4/${TENANT}`,
    `https://fhir-myrecord-sc.cerner.com/r4/${TENANT}`,
    `${BASE}/`,
    `${BASE}/Patient`,
    `${BASE}?tenant=1`,
    `https://fhir-myrecord.cerner.com/dstu2/${TENANT}`,
  ])("trusts no OAuth endpoint for a non-Oracle-patient base %s", (base) => {
    const tenantToken = TOKEN.replace("fhir-myrecord.cerner.com", new URL(base).host);
    expect(() => requireOracleSmartEndpoint("authorization", AUTHORIZE, new URL(base))).toThrow();
    expect(() => requireOracleSmartEndpoint("token", tenantToken, new URL(base))).toThrow();
  });

  it.each([undefined, 42, "not a url", `${TOKEN}${"a".repeat(2_048)}`])("rejects malformed endpoint metadata %s", (value) => {
    expect(() => requireOracleSmartEndpoint("token", value, new URL(BASE))).toThrow();
  });
});

describe("Oracle SMART discovery", () => {
  const metadata = (overrides: Record<string, unknown> = {}) => Response.json({
    authorization_endpoint: AUTHORIZE, token_endpoint: TOKEN,
    capabilities: ["launch-standalone", "client-confidential-asymmetric", "context-standalone-patient",
      "permission-patient", "permission-offline", "permission-v1", "permission-v2"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "private_key_jwt"],
    ...overrides,
  });
  const discover = (fetchImpl: typeof fetch) => discoverSmartConfiguration({
    endpointTrust: ORACLE_SMART_ENDPOINT_TRUST, fetchImpl, fhirBaseUrl: BASE, permissionVersion: "v1",
    requestOfflineAccess: true, requestedBaseScopes: ORACLE_REQUESTED_BASE_SCOPES, resourceTypes: ORACLE_RESOURCE_TYPES,
  });

  it("pins SMART v1 even when v2 is advertised and follows only the trusted templates", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(metadata());
    const configuration = await discover(fetchImpl);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(`${BASE}/.well-known/smart-configuration`);
    expect(configuration).toEqual({
      authorizationEndpoint: AUTHORIZE,
      tokenEndpoint: TOKEN,
      requestedResourceTypes: ORACLE_RESOURCE_TYPES,
      requestedScopes: [
        "openid", "fhirUser", "launch/patient", "offline_access",
        ...ORACLE_RESOURCE_TYPES.map((type) => `patient/${type}.read`),
        "patient/Binary.read", "patient/Media.read",
      ],
    });
  });

  it("fails when the pinned v1 permission is not advertised", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(metadata({
      capabilities: ["context-standalone-patient", "permission-offline", "permission-v2"],
    }));
    await expect(discover(fetchImpl)).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_SCOPES_UNSUPPORTED" });
  });

  it("does not fall back to the FHIR origin and leaves the Epic default pin unchanged", async () => {
    const sameOrigin = { authorization_endpoint: `${BASE}/authorize`, token_endpoint: `${BASE}/token` };
    await expect(discover(vi.fn<typeof fetch>().mockResolvedValue(metadata(sameOrigin))))
      .rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_ENDPOINT_MISMATCH" });
    await expect(discoverSmartConfiguration({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(metadata()),
      fhirBaseUrl: BASE, requestedBaseScopes: ORACLE_REQUESTED_BASE_SCOPES, resourceTypes: ["Patient", "Observation"] }))
      .rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_ENDPOINT_MISMATCH" });
  });
});

describe("Oracle client authentication", () => {
  const configure = () => {
    vi.stubEnv("ORACLE_SMART_CLIENT_ID", FAKE_CLIENT_ID);
    vi.stubEnv("ORACLE_SMART_PRIVATE_KEY_PEM", signerPem);
  };

  it("signs an RS384 assertion with the published Oracle kid and the exact token URL as audience", async () => {
    configure();
    const auth = resolveOracleClientAuth(PROFILE, productionEntry, { ...productionCallback, clientId: ORACLE_STORED_CLIENT_REFERENCE });
    expect(auth).toMatchObject({ method: "private_key_jwt", clientId: FAKE_CLIENT_ID, kid: sandboxPublicKey.kid });
    const request = await epicTokenRequest(auth, TOKEN, { grant_type: "refresh_token", refresh_token: "synthetic-refresh" });
    const body = request.body as URLSearchParams;
    expect(body.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    expect(body.has("client_id")).toBe(false);
    const assertion = body.get("client_assertion")!;
    expect(decodeProtectedHeader(assertion)).toEqual({ alg: "RS384", typ: "JWT", kid: sandboxPublicKey.kid });
    const { payload } = await jwtVerify(assertion, createLocalJWKSet({ keys: [sandboxPublicKey] }), {
      algorithms: ["RS384"], audience: TOKEN, issuer: FAKE_CLIENT_ID, subject: FAKE_CLIENT_ID,
    });
    expect(payload.aud).toBe(TOKEN);
    expect(payload.exp! - payload.iat!).toBe(180);
    expect(request.redirect).toBe("manual");
  });

  it.each([
    ["no client ID", () => vi.stubEnv("ORACLE_SMART_CLIENT_ID", "")],
    ["no private key", () => vi.stubEnv("ORACLE_SMART_PRIVATE_KEY_PEM", "")],
    ["an unpublished key", () => vi.stubEnv("ORACLE_SMART_PRIVATE_KEY_PEM", generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ format: "pem", type: "pkcs8" }).toString())],
    ["the kill switch", () => vi.stubEnv("CLINICAL_RECORDS_ORACLE_DISABLED", "1")],
  ])("fails before egress with %s", (_label, change) => {
    configure();
    change();
    expect(() => resolveOracleClientAuth(PROFILE, productionEntry, productionCallback)).toThrow(expect.objectContaining({
      code: "CLINICAL_RECORD_PROVIDER_NOT_CONFIGURED", retryable: true,
    }));
  });

  it("binds the production registration to the environment and fixed stored reference", () => {
    configure();
    expect(() => resolveOracleClientAuth({ ...PROFILE, environment: "sandbox" }, productionEntry, productionCallback))
      .toThrow(expect.objectContaining({ code: "CLINICAL_RECORD_PROVIDER_NOT_CONFIGURED" }));
    expect(ORACLE_STORED_CLIENT_REFERENCE).not.toContain(FAKE_CLIENT_ID);
    for (const clientId of [FAKE_CLIENT_ID, "synthetic-previous-client", ""]) {
      expect(() => resolveOracleClientAuth(PROFILE, productionEntry, { ...productionCallback, clientId }))
        .toThrow(expect.objectContaining({ code: "CLINICAL_RECORD_PROVIDER_CONFIGURATION_CHANGED" }));
    }
  });
});

describe("Oracle tokens", () => {
  const requestedScopes = ["openid", "fhirUser", "launch/patient", "offline_access", "patient/Patient.read", "patient/Observation.read"];

  it("parses a 570-second access token with numeric patient context and an offline grant", async () => {
    const token = await exchangeSmartAuthorizationCode({
      auth: { method: "public", clientId: FAKE_CLIENT_ID }, code: "synthetic-code", redirectUri: "https://app.example.test/callback",
      requestedScopes, tokenEndpoint: TOKEN, verifier: "synthetic-verifier",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        access_token: "synthetic-access", token_type: "Bearer", expires_in: 570, patient: PATIENT,
        scope: requestedScopes.join(" "), refresh_token: "synthetic-refresh",
      })),
    });
    expect(token).toMatchObject({ expiresInSeconds: 570, patientId: PATIENT, refreshToken: "synthetic-refresh" });
  });

  it("keeps the original refresh token when Oracle returns no successor", async () => {
    const renewed = await refreshSmartAccessToken({
      auth: { method: "basic", clientId: FAKE_CLIENT_ID, clientSecret: "synthetic" }, refreshToken: "synthetic-refresh",
      tokenEndpoint: TOKEN, grantedScopes: requestedScopes,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        access_token: "synthetic-access-2", token_type: "Bearer", expires_in: 570, scope: requestedScopes.join(" "),
      })),
    });
    expect(renewed).toMatchObject({ successorReturned: false, refreshToken: "synthetic-refresh", expiresInSeconds: 570 });
  });
});

describe("Saved grant profiles", () => {
  it("keeps bare Epic profiles and reads the typed Oracle profile", () => {
    const epic = { environment: "production", method: "basic", hospitalApproved: false };
    expect(isOracleProfile(clinicalGrantProfileSchema.parse(epic))).toBe(false);
    expect(isOracleProfile(clinicalGrantProfileSchema.parse(PROFILE))).toBe(true);
    for (const invalid of [
      { ...PROFILE, method: "basic" }, { ...PROFILE, hospitalApproved: false }, { ...PROFILE, kid: "rotating" },
      { ...epic, integration: "oracle-millennium-r4" }, { ...PROFILE, integration: "athena" },
    ]) expect(clinicalGrantProfileSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("Oracle flags", () => {
  it("is off by default and the kill switch overrides every other flag", () => {
    expect([oracleSearchEnabled(), oracleStartsEnabledFor("hm_synthetic"), readOracleQueryGate("observations")])
      .toEqual([false, false, null]);
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_STARTS", "1");
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_SEARCH", "1");
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_MEMBER_IDS", " hm_other , hm_synthetic ");
    expect(oracleStartsEnabledFor("hm_synthetic")).toBe(true);
    for (const memberId of ["hm_synth", "HM_SYNTHETIC", ""]) expect(oracleStartsEnabledFor(memberId)).toBe(false);
    expect(oracleSearchEnabled()).toBe(true);
    expect(readOracleQueryGate("unknown-query")).toEqual({ code: "query-unavailable", retryable: false });
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_DISABLED", "1");
    expect([oracleSearchEnabled(), oracleStartsEnabledFor("hm_synthetic"), readOracleQueryGate("observations")])
      .toEqual([false, false, { code: "integration-disabled", retryable: true }]);
  });

  it.each(["1", " 1 ", "true", "TRUE", "yes", "on", "disabled"])("treats kill switch value %j as on", (value) => {
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_DISABLED", value);
    expect(oracleEgressDisabled()).toBe(true);
  });

  it.each(["", "  ", "0", " 0 ", "false", "False", "FALSE"])("treats kill switch value %j as off", (value) => {
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_DISABLED", value);
    expect(oracleEgressDisabled()).toBe(false);
  });

  it("requires the allowlist even when starts are on", () => {
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_STARTS", "1");
    expect(oracleStartsEnabledFor("hm_synthetic")).toBe(false);
  });

  it("admits every member only when the allowlist is exactly *", () => {
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_MEMBER_IDS", "*");
    expect(oracleStartsEnabledFor("hm_synthetic")).toBe(false);
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_STARTS", "1");
    expect(oracleStartsEnabledFor("hm_synthetic")).toBe(true);
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_MEMBER_IDS", " * ");
    expect(oracleStartsEnabledFor("hm_other")).toBe(true);
    for (const list of ["*,hm_other", "hm_other,*", "**", "*hm_synthetic"]) {
      vi.stubEnv("CLINICAL_RECORDS_ORACLE_MEMBER_IDS", list);
      expect(oracleStartsEnabledFor("hm_synthetic")).toBe(false);
    }
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_MEMBER_IDS", "*");
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_DISABLED", "1");
    expect(oracleStartsEnabledFor("hm_synthetic")).toBe(false);
  });

  it("never opens the hidden sandbox entry to *", () => {
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_STARTS", "1");
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_MEMBER_IDS", "*");
    expect(oracleStartsEnabledFor("hm_synthetic")).toBe(true);
    expect(oracleSandboxEnabledFor("hm_synthetic")).toBe(false);
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_MEMBER_IDS", "hm_synthetic");
    expect(oracleSandboxEnabledFor("hm_synthetic")).toBe(true);
    expect(oracleSandboxEnabledFor("hm_other")).toBe(false);
  });
});

describe("Oracle query catalog", () => {
  const now = new Date("2026-11-26T12:00:00.000Z");
  const plan = buildOracleRetrievalPlan({ resourceTypes: ORACLE_RESOURCE_TYPES });
  const url = (retrievalSlice: ClinicalFhirRetrievalSlice) =>
    buildOracleInitialFhirPageUrl({ fhirBaseUrl: BASE, patientId: PATIENT, retrievalSlice }).href;

  it("pins every versioned interpretation, including date-filter semantics", () => {
    expect(ORACLE_ACQUISITION_POLICY.queries.map(buildOracleQueryFingerprintInput)).toEqual([
      "oracle-millennium-r4:Patient:read-by-launch-patient:v1",
      "oracle-millennium-r4:Observation:search:patient:_count=200:daily=_lastUpdated(ge,lt):v1",
      "oracle-millennium-r4:Condition:search:patient:daily=_lastUpdated(ge,lt):v1",
      "oracle-millennium-r4:DiagnosticReport:search:patient:_count=100:daily=_lastUpdated(ge,lt):v1",
      "oracle-millennium-r4:DocumentReference:search:patient:_count=100:daily=_lastUpdated(ge,lt):v1",
      "oracle-millennium-r4:AllergyIntolerance:search:patient:daily=_lastUpdated(ge,lt):v1",
      "oracle-millennium-r4:Device:search:patient:v1",
      "oracle-millennium-r4:FamilyMemberHistory:search:patient:v1",
      "oracle-millennium-r4:Goal:search:patient:v1",
      "oracle-millennium-r4:CareTeam:search:patient:v1",
      "oracle-millennium-r4:CarePlan:search:patient:category=assess-plan:v1",
      "oracle-millennium-r4:Encounter:search:patient:_count=100:status=planned:daily=_lastUpdated(ge,lt):v1",
      "oracle-millennium-r4:Encounter:search:patient:_count=100:status=in-progress:daily=_lastUpdated(ge,lt):v1",
      "oracle-millennium-r4:Encounter:search:patient:_count=100:status=finished:daily=_lastUpdated(ge,lt):v1",
      "oracle-millennium-r4:Encounter:search:patient:_count=100:status=cancelled:daily=_lastUpdated(ge,lt):v1",
      "oracle-millennium-r4:Procedure:search:patient:daily=_lastUpdated(ge,lt):v1",
      "oracle-millennium-r4:Immunization:search:patient:v1",
      "oracle-millennium-r4:MedicationDispense:search:patient:_count=100:v1",
      "oracle-millennium-r4:MedicationRequest:search:patient:_count=100:daily=_lastUpdated(ge,le):v1",
      "oracle-millennium-r4:ServiceRequest:search:patient:_count=100:daily=_lastUpdated(ge,le):v1",
      "oracle-millennium-r4:ServiceRequest:search:patient:category=http://snomed.info/sct|386053000:_count=100:daily=_lastUpdated(ge,le):v1",
    ]);
    expect(ORACLE_RESOURCE_TYPES).toHaveLength(17);
    expect(plan.slices).toHaveLength(21);
  });

  it("builds exact lifetime requests for a new plan", () => {
    const enc = (value: string) => encodeURIComponent(value);
    expect(plan.slices.map(url)).toEqual([
      `${BASE}/Patient/${PATIENT}`,
      `${BASE}/Observation?patient=${PATIENT}&_count=200`,
      `${BASE}/Condition?patient=${PATIENT}`,
      `${BASE}/DiagnosticReport?patient=${PATIENT}&_count=100`,
      `${BASE}/DocumentReference?patient=${PATIENT}&_count=100`,
      `${BASE}/AllergyIntolerance?patient=${PATIENT}`,
      `${BASE}/Device?patient=${PATIENT}`,
      `${BASE}/FamilyMemberHistory?patient=${PATIENT}`,
      `${BASE}/Goal?patient=${PATIENT}`,
      `${BASE}/CareTeam?patient=${PATIENT}`,
      `${BASE}/CarePlan?patient=${PATIENT}&category=assess-plan`,
      `${BASE}/Encounter?patient=${PATIENT}&_count=100&status=planned`,
      `${BASE}/Encounter?patient=${PATIENT}&_count=100&status=in-progress`,
      `${BASE}/Encounter?patient=${PATIENT}&_count=100&status=finished`,
      `${BASE}/Encounter?patient=${PATIENT}&_count=100&status=cancelled`,
      `${BASE}/Procedure?patient=${PATIENT}`,
      `${BASE}/Immunization?patient=${PATIENT}`,
      `${BASE}/MedicationDispense?patient=${PATIENT}&_count=100`,
      `${BASE}/MedicationRequest?patient=${PATIENT}&_count=100`,
      `${BASE}/ServiceRequest?patient=${PATIENT}&_count=100`,
      `${BASE}/ServiceRequest?patient=${PATIENT}&category=${enc("http://snomed.info/sct|386053000")}&_count=100`,
    ]);
  });

  it("asks each daily family only for the range shape Oracle documents, and lifetime every seventh check", () => {
    const daily = buildOracleDailyRetrievalPlan({ previous: plan, now, generation: 2 })!;
    const ge = "ge2026-11-19T12%3A00%3A00.000Z";
    const lt = "lt2026-11-27T12%3A00%3A00.000Z";
    const le = "le2026-11-27T12%3A00%3A00.000Z";
    const window = (upper: string) => `&_lastUpdated=${ge}&_lastUpdated=${upper}`;
    expect(daily.slices.map((slice) => [slice.queryScopeId, slice.coverage, slice.sliceId, url(slice)])).toEqual([
      ["patient-demographics", "whole-family", "whole", `${BASE}/Patient/${PATIENT}`],
      ["observations", "bounded-window", "daily-2026-11-26", `${BASE}/Observation?patient=${PATIENT}&_count=200${window(lt)}`],
      ["conditions", "bounded-window", "daily-2026-11-26", `${BASE}/Condition?patient=${PATIENT}${window(lt)}`],
      ["diagnostic-reports", "bounded-window", "daily-2026-11-26", `${BASE}/DiagnosticReport?patient=${PATIENT}&_count=100${window(lt)}`],
      ["document-references", "bounded-window", "daily-2026-11-26", `${BASE}/DocumentReference?patient=${PATIENT}&_count=100${window(lt)}`],
      ["allergies", "bounded-window", "daily-2026-11-26", `${BASE}/AllergyIntolerance?patient=${PATIENT}${window(lt)}`],
      ["devices", "whole-family", "whole", `${BASE}/Device?patient=${PATIENT}`],
      ["family-member-history", "whole-family", "whole", `${BASE}/FamilyMemberHistory?patient=${PATIENT}`],
      ["goals", "whole-family", "whole", `${BASE}/Goal?patient=${PATIENT}`],
      ["care-teams", "whole-family", "whole", `${BASE}/CareTeam?patient=${PATIENT}`],
      ["care-plans", "whole-family", "whole", `${BASE}/CarePlan?patient=${PATIENT}&category=assess-plan`],
      ["encounters-planned", "bounded-window", "daily-2026-11-26", `${BASE}/Encounter?patient=${PATIENT}&_count=100&status=planned${window(lt)}`],
      ["encounters-in-progress", "bounded-window", "daily-2026-11-26", `${BASE}/Encounter?patient=${PATIENT}&_count=100&status=in-progress${window(lt)}`],
      ["encounters-finished", "bounded-window", "daily-2026-11-26", `${BASE}/Encounter?patient=${PATIENT}&_count=100&status=finished${window(lt)}`],
      ["encounters-cancelled", "bounded-window", "daily-2026-11-26", `${BASE}/Encounter?patient=${PATIENT}&_count=100&status=cancelled${window(lt)}`],
      ["procedures", "bounded-window", "daily-2026-11-26", `${BASE}/Procedure?patient=${PATIENT}${window(lt)}`],
      // Oracle accepts only one lower bound for these two families, which a bounded slice cannot describe.
      ["immunizations", "whole-family", "whole", `${BASE}/Immunization?patient=${PATIENT}`],
      ["medication-dispenses", "whole-family", "whole", `${BASE}/MedicationDispense?patient=${PATIENT}&_count=100`],
      ["medication-requests", "bounded-window", "daily-2026-11-26", `${BASE}/MedicationRequest?patient=${PATIENT}&_count=100${window(le)}`],
      ["service-requests", "bounded-window", "daily-2026-11-26", `${BASE}/ServiceRequest?patient=${PATIENT}&_count=100${window(le)}`],
      ["service-request-referrals", "bounded-window", "daily-2026-11-26",
        `${BASE}/ServiceRequest?patient=${PATIENT}&category=http%3A%2F%2Fsnomed.info%2Fsct%7C386053000&_count=100${window(le)}`],
    ]);
    for (const slice of daily.slices) {
      const params = new URL(url(slice)).searchParams;
      expect(params.getAll("_lastUpdated")).toHaveLength(slice.coverage === "bounded-window" ? 2 : 0);
      expect(params.has("date")).toBe(false);
    }
    for (const generation of [7, 14]) {
      const lifetime = buildOracleDailyRetrievalPlan({ previous: daily, now, generation })!;
      expect(lifetime.slices.map(url)).toEqual(plan.slices.map(url));
    }
  });

  it("keeps referrals as a separate query identity", () => {
    const [general, referrals] = plan.slices.filter((slice) => slice.resourceType === "ServiceRequest");
    expect([general?.queryScopeId, referrals?.queryScopeId]).toEqual(["service-requests", "service-request-referrals"]);
    expect(general?.queryFingerprint).not.toBe(referrals?.queryFingerprint);
    const partial = buildOracleRetrievalPlan({ resourceTypes: ["Patient", "ServiceRequest"] });
    expect(partial.slices.map((slice) => slice.queryScopeId)).toEqual(["patient-demographics", "service-requests", "service-request-referrals"]);
  });

  it("never reinterprets a frozen slice or resolves another vendor's identity", () => {
    const observations = plan.slices.find((slice) => slice.queryScopeId === "observations")!;
    const immunizations = plan.slices.find((slice) => slice.queryScopeId === "immunizations")!;
    const epicAllergies = buildEpicBetaRetrievalPlan({ frozenAt: now, pageCount: "100", resourceTypes: ["AllergyIntolerance"] }).slices[0]!;
    expect(epicAllergies.queryScopeId).toBe("allergies");
    for (const retrievalSlice of [
      { ...observations, queryFingerprint: "0".repeat(64) },
      { ...observations, resourceType: "Condition" as const },
      epicAllergies,
      { ...observations, sliceId: "daily-2026-11-26" },
      clinicalFhirRetrievalSliceSchema.parse({ ...immunizations, coverage: "bounded-window", sliceId: "daily-2026-11-26",
        from: "2026-11-19T12:00:00.000Z", to: "2026-11-27T12:00:00.000Z" }),
    ]) expect(() => url(retrievalSlice)).toThrow(TypeError);
  });

  it("rejects families outside the catalog and stops polling when every query retired", () => {
    expect(() => buildOracleRetrievalPlan({ resourceTypes: ["Patient", "MedicationStatement"] })).toThrow(/outside the Oracle/u);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const retired = { ...plan, slices: plan.slices.map((slice) => ({ ...slice, queryScopeId: `retired-${slice.queryScopeId}` })) };
      expect(buildOracleDailyRetrievalPlan({ previous: retired, now, generation: 2 })).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});
