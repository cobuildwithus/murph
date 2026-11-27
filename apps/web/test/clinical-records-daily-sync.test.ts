import * as hostedControl from "@/src/lib/hosted-execution/control";
import { createCloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";
import { signerPem } from "./clinical-records-synthetic-signer";

vi.mock("../public/.well-known/epic/sandbox.jwks.json", async () => ({
  default: { keys: [(await import("./clinical-records-synthetic-signer")).sandboxPublicKey] },
}));
vi.mock("../public/.well-known/oracle/production.jwks.json", async () => ({
  default: { keys: [(await import("./clinical-records-synthetic-signer")).sandboxPublicKey] },
}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";
import { buildEpicBetaRetrievalPlan } from "@/src/lib/clinical-records/epic-policy";
import { buildOracleRetrievalPlan } from "@/src/lib/clinical-records/oracle-policy";

const mocks = vi.hoisted(() => ({
  prisma: vi.fn(), access: vi.fn(), consent: vi.fn(), suspension: vi.fn(),
  append: vi.fn(), signal: vi.fn(), open: vi.fn(), seal: vi.fn(), base: vi.fn(),
}));
vi.mock("@/src/lib/clinical-records/provider-directory-store", () => ({
  resolveClinicalProviderDirectoryEntry: () => null,
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.prisma }));
vi.mock("@/src/lib/clinical-records/transport-access", () => ({ readClinicalTransportAccess: mocks.access }));
vi.mock("@/src/lib/legal/consent", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/legal/consent")>(),
  readHostedConsentStatus: mocks.consent,
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/shared", () => ({ lockHostedMemberRow: vi.fn(), readHostedMemberSuspensionAfterLockTx: mocks.suspension }));
vi.mock("@/src/lib/hosted-crypto/domain-root-unwrap-cache", () => ({ runWithHostedDomainRootUnwrapCache: (fn: () => Promise<unknown>) => fn() }));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({ unwrapHostedDomainRootForWeb: async () => ({ rootKey: Buffer.alloc(32) }) }));
vi.mock("@/src/lib/clinical-records/retrieval", () => ({ appendClinicalRetrievalWakeTx: mocks.append, signalClinicalRetrievalWake: mocks.signal }));
vi.mock("@/src/lib/clinical-records/secrets", () => ({ openClinicalConnectionFhirBaseUrl: mocks.base, openClinicalConnectionSecret: mocks.open, sealClinicalConnectionSecret: mocks.seal }));

import { admitClinicalDailySync, runClinicalDailySyncSweep } from "@/src/lib/clinical-records/daily-sync";
import { resolveEpicClient } from "@/src/lib/clinical-records/epic-import-config";
import { renewClinicalAccess } from "@/src/lib/clinical-records/persistent-access";

const now = new Date("2026-09-17T12:00:00Z");
function fixture() {
  const row = {
    id: "crc_synthetic", memberId: "member_synthetic", providerDirectoryEntryId: "epic-synthetic",
    sourceSystem: "epic-fhir", status: "active", tokenVersion: 1, retrievalGeneration: 1, nextSyncAt: now,
    refreshTokenEncrypted: "refresh-sealed", patientIdEncrypted: "patient-sealed", patientBindingEncrypted: "binding-sealed",
    accessTokenEncrypted: "access-sealed", accessTokenExpiresAt: new Date(0),
    refreshLeaseId: null as string | null, refreshLeaseExpiresAt: null as Date | null,
    retrievalRuns: [{ completedAt: new Date(now.getTime() - 86_400_000), status: "complete",
      retrievalPlanJson: buildEpicBetaRetrievalPlan({ frozenAt: now, pageCount: "100", resourceTypes: ["Patient", "DocumentReference"] }),
      grantedScopesJson: ["patient/Patient.r", "patient/DocumentReference.s", "offline_access"] }],
  };
  const connection = {
    findFirst: vi.fn(async () => ({ ...row })),
    findMany: vi.fn(async () => [{ id: row.id, memberId: row.memberId, requiresProcessorApprovals: true }]),
    update: vi.fn(async ({ data }: { data: object }) => Object.assign(row, data)),
    updateMany: vi.fn(async ({ where, data }: { where: { refreshLeaseId?: string }; data: object }) => {
      if (where.refreshLeaseId && where.refreshLeaseId !== row.refreshLeaseId) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    }),
  };
  const create = vi.fn();
  const tx = { clinicalRecordConnection: connection, clinicalRecordRetrievalRun: { create, findMany: async () => [], findFirst: async () => null } };
  const prisma = { ...tx, $transaction: async <T>(fn: (value: typeof tx) => Promise<T>) => fn(tx) };
  mocks.prisma.mockReturnValue(prisma);
  return { row, connection, create };
}

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue(true);
  mocks.consent.mockResolvedValue({ launchGranted: true });
  mocks.suspension.mockResolvedValue("active");
  mocks.append.mockResolvedValue({ wake: "synthetic" });
  mocks.signal.mockResolvedValue(undefined);
  mocks.base.mockResolvedValue("https://portal.example.test/FHIR/R4");
  mocks.seal.mockImplementation(async ({ value }: { value: string }) => `sealed:${value}`);
  mocks.open.mockImplementation(async ({ field }: { field: string }) => field === "refreshToken"
    ? '{"schemaVersion":1,"clientId":"client","tokenEndpoint":"https://portal.example.test/token","refreshToken":"old-refresh","grantedScopes":["patient/Patient.r","patient/Observation.s"]}'
    : "existing-access");
  vi.stubEnv("EPIC_SMART_PERSISTENT_CREDENTIALS", JSON.stringify({ "epic-synthetic": { clientId: "client", clientSecret: "secret" } }));
});

describe("daily clinical admission", () => {
  it.each(["fetch_failed", "port_unavailable", "stale_evidence"] as const)("refreshes reader evidence and emits one bounded summary for %s", async reason => {
    const f = fixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let clock = Date.now();
    const time = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const fetchImpl = vi.fn(async (url: URL | RequestInfo) => {
      if (reason === "fetch_failed") throw new Error("synthetic transport failure");
      if (reason === "port_unavailable") return new Response("{}", { status: 503 });
      return Response.json({ nonce: new URL(String(url)).searchParams.get("nonce"), version: "synthetic", runner: 4, cloudflarePort: 4 });
    });
    const control = vi.spyOn(hostedControl, "readHostedExecutionControlClientIfConfigured").mockReturnValue(
      createCloudflareHostedControlClient({ baseUrl: "https://port.example.test", getBearerToken: async () => "synthetic", fetchImpl }));
    f.connection.findMany.mockResolvedValue(Array(2).fill({ id: f.row.id, memberId: f.row.memberId, requiresProcessorApprovals: true }));
    if (reason === "stale_evidence") mocks.signal.mockImplementationOnce(async () => { clock += 30_001; });
    try {
      await runClinicalDailySyncSweep({ now, deadlineMs: clock + 120_000 });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledExactlyOnceWith("Clinical daily admission reader evidence", expect.objectContaining({
        [reason]: reason === "stale_evidence" ? 1 : 2, candidatesWithoutEvidence: reason === "stale_evidence" ? 0 : 2, checked: 2,
      }));
    } finally { warn.mockRestore(); time.mockRestore(); control.mockRestore(); }
  });

  it("does not write a second date after successful admission", async () => {
    const f = fixture();
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: 1, failed: 0 });
    expect(f.connection.updateMany).not.toHaveBeenCalled();
  });

  it("publishes one new generation and makes replay ineligible", async () => {
    const f = fixture();
    const input = { connectionId: f.row.id, memberId: f.row.memberId, now };
    expect(await admitClinicalDailySync(input)).toBe(true);
    expect(await admitClinicalDailySync(input)).toBe(false);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.create.mock.calls[0]![0].data).toMatchObject({ generation: 2, status: "queued" });
    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(mocks.signal).toHaveBeenCalledTimes(1);
  });

  it.each(["disconnected", "needs_reauth"])("does not admit a %s connection", async (status) => {
    const f = fixture(); f.row.status = status;
    expect(await admitClinicalDailySync({ connectionId: f.row.id, memberId: f.row.memberId, now })).toBe(false);
    expect(f.create).not.toHaveBeenCalled();
  });

  it("backs off an ineligible row so it cannot starve the bounded sweep", async () => {
    const f = fixture(); mocks.access.mockResolvedValue(false);
    expect(await runClinicalDailySyncSweep({ now })).toEqual({ checked: 1, queued: 0, failed: 0 });
    expect(f.connection.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
    expect(f.row.nextSyncAt.getTime()).toBe(now.getTime() + 86_400_000);
    expect(f.create).not.toHaveBeenCalled();
  });

  it("fails closed when consent is withdrawn", async () => {
    const f = fixture(); mocks.consent.mockResolvedValue({ launchGranted: false });
    await expect(admitClinicalDailySync({ connectionId: f.row.id, memberId: f.row.memberId, now })).resolves.toBe(false);
    expect(f.create).not.toHaveBeenCalled();
  });
});

describe("rotating clinical refresh lease", () => {
  it("renews a stored signed grant after starts switch back to public", async () => {
    vi.stubEnv("EPIC_SMART_NON_PRODUCTION_CLIENT_ID", "legacy");
    vi.stubEnv("EPIC_SMART_NON_PRODUCTION_PUBLIC_CLIENT_ID", "legacy");
    vi.stubEnv("EPIC_SMART_NON_PRODUCTION_ASYMMETRIC_CLIENT_ID", "client");
    vi.stubEnv("EPIC_SMART_NON_PRODUCTION_PRIVATE_KEY_PEM", signerPem);
    vi.stubEnv("EPIC_SMART_PERSISTENT_CREDENTIALS", "");
    const f = fixture();
    f.row.providerDirectoryEntryId = "epic-sandbox";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      access_token: "renewed", token_type: "Bearer", expires_in: 300,
    }));
    const input = { connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now, fetchImpl };
    await expect(renewClinicalAccess(input)).resolves.toBe("renewed");
    expect(f.row.refreshTokenEncrypted).toContain("old-refresh");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://portal.example.test/token");
    expect(new URLSearchParams(String(init?.body)).has("client_assertion")).toBe(true);
  });

  it("reads a historical signed Epic refresh payload with the writer off", async () => {
    const f = fixture();
    f.row.providerDirectoryEntryId = "epic-sandbox";
    mocks.open.mockResolvedValue('{"schemaVersion":1,"profile":{"environment":"sandbox","method":"private_key_jwt","hospitalApproved":false},"clientId":"signed","tokenEndpoint":"https://portal.example.test/token","refreshToken":"saved","grantedScopes":["patient/Patient.r","patient/DocumentReference.s","offline_access"]}');
    vi.stubEnv("EPIC_SMART_NON_PRODUCTION_ASYMMETRIC_CLIENT_ID", "signed");
    vi.stubEnv("EPIC_SMART_NON_PRODUCTION_PRIVATE_KEY_PEM", signerPem);
    vi.stubEnv("CLINICAL_RECORDS_WRITE_GRANT_PROFILES", "0");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: "renewed", expires_in: 300, token_type: "Bearer" }));
    await expect(renewClinicalAccess({ connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now, fetchImpl })).resolves.toBe("renewed");
  });

  it("releases the lease without egress when the stored client is unknown", async () => {
    vi.stubEnv("EPIC_SMART_PERSISTENT_CREDENTIALS", "");
    const f = fixture();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(renewClinicalAccess({ connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now, fetchImpl }))
      .rejects.toMatchObject({ code: "CLINICAL_RECORD_REFRESH_PREPARATION_FAILED" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(f.row.refreshLeaseId).toBeNull();
  });

  it("keeps a bound Basic grant on its saved endpoint and rejects a replacement secret before egress", async () => {
    const f = fixture();
    vi.stubEnv("EPIC_SMART_CLIENT_ID", "client");
    const { profile } = resolveEpicClient({ id: f.row.providerDirectoryEntryId, clientIdEnvironmentKey: "EPIC_SMART_CLIENT_ID",
      fhirBaseUrl: "https://portal.example.test/FHIR/R4", brandName: "Sample", aliases: [], facilities: [], policyId: "sample",
      requestedBaseScopes: [], resourceTypes: ["Patient"], sourceSystem: "epic-fhir" });
    mocks.open.mockResolvedValue(JSON.stringify({ schemaVersion: 1, profile, clientId: "client",
      tokenEndpoint: "https://portal.example.test/token", refreshToken: "old-refresh", grantedScopes: ["patient/Patient.r", "patient/Observation.s"] }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: "new-access", expires_in: 300, token_type: "Bearer" }));
    const input = { connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now, fetchImpl };
    await expect(renewClinicalAccess(input)).resolves.toBe("new-access");
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://portal.example.test/token");
    f.row.accessTokenExpiresAt = new Date(0);
    vi.stubEnv("EPIC_SMART_PERSISTENT_CREDENTIALS", JSON.stringify({ "epic-synthetic": { clientId: "client", clientSecret: "replacement" } }));
    fetchImpl.mockClear();
    await expect(renewClinicalAccess(input)).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_REAUTH_REQUIRED", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(f.row).toMatchObject({ refreshLeaseId: null, refreshLeaseExpiresAt: null });
  });

  it("renews expired access once and seals the rotated grant", async () => {
    const f = fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, token_type: "Bearer" }));
    expect(await renewClinicalAccess({ connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now, fetchImpl })).toBe("new-access");
    expect(f.row.refreshTokenEncrypted).toContain("new-refresh");
    expect(f.row.accessTokenEncrypted).toBe("sealed:new-access");
    expect(f.row.refreshLeaseId).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("releases the lease after an unwrap failure and retries with the saved grant", async () => {
    const f = fixture();
    const before = structuredClone(f.row);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, token_type: "Bearer",
    }));
    const input = { connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now, fetchImpl };
    mocks.open.mockRejectedValueOnce(new Error("synthetic unwrap failure"));
    await expect(renewClinicalAccess(input)).rejects.toMatchObject({ retryable: true, httpStatus: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(f.row).toEqual(before);
    await expect(renewClinicalAccess(input)).resolves.toBe("new-access");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not replay a token while another refresh owns the lease", async () => {
    const f = fixture(); f.row.refreshLeaseId = "other"; f.row.refreshLeaseExpiresAt = new Date(now.getTime() + 60_000);
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(renewClinicalAccess({ connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now, fetchImpl })).rejects.toMatchObject({ retryable: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cannot restore access after disconnect wins during the network exchange", async () => {
    const f = fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      f.row.status = "disconnected"; f.row.refreshLeaseId = null; f.row.refreshTokenEncrypted = ""; f.row.accessTokenEncrypted = "";
      return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, token_type: "Bearer" });
    });
    await expect(renewClinicalAccess({ connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now, fetchImpl })).rejects.toBeDefined();
    expect(f.row.status).toBe("disconnected"); expect(f.row.accessTokenEncrypted).toBe("");
  });

  it("keeps an ambiguous exchange leased for the retrieval owner to terminalize", async () => {
    const f = fixture();
    await expect(renewClinicalAccess({ connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now,
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("connection reset")) })).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_REAUTH_REQUIRED" });
    expect(f.row.status).toBe("active");
    expect(f.row.refreshLeaseId).toEqual(expect.any(String));
    const replay = vi.fn<typeof fetch>();
    await expect(renewClinicalAccess({ connectionId: f.row.id, memberId: f.row.memberId, generation: 1,
      now: new Date(now.getTime() + 60_001), fetchImpl: replay })).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_REAUTH_REQUIRED" });
    expect(replay).not.toHaveBeenCalled();
  });
});

describe("Oracle grants", () => {
  const BASE = "https://fhir-myrecord.cerner.com/r4/0aB1cD2e-synthetic";
  const TOKEN = "https://authorization.cerner.com/tenants/0aB1cD2e-synthetic/hosts/fhir-myrecord.cerner.com/protocols/oauth2/profiles/smart-v1/token";
  const PROFILE = { integration: "oracle-millennium-r4", environment: "production", method: "private_key_jwt" };
  const SCOPES = ["patient/Patient.read", "patient/Immunization.read", "patient/MedicationRequest.read", "offline_access"];
  function oracleFixture(payload: Record<string, unknown> = {}) {
    const f = fixture();
    Object.assign(f.row, { sourceSystem: "cerner-fhir", providerDirectoryEntryId: "oracle-0123456789abcdef0123" });
    f.row.retrievalRuns[0]!.retrievalPlanJson = buildOracleRetrievalPlan({ resourceTypes: ["Patient", "Immunization", "MedicationRequest"] });
    f.row.retrievalRuns[0]!.grantedScopesJson = SCOPES;
    mocks.base.mockResolvedValue(BASE);
    mocks.open.mockImplementation(async ({ field }: { field: string }) => field === "refreshToken" ? JSON.stringify({ schemaVersion: 1,
      profile: PROFILE, clientId: "oracle-millennium-r4", tokenEndpoint: TOKEN, refreshToken: "oracle-refresh", grantedScopes: SCOPES,
      ...payload }) : "existing-access");
    vi.stubEnv("ORACLE_SMART_CLIENT_ID", "synthetic-oracle-client");
    vi.stubEnv("ORACLE_SMART_PRIVATE_KEY_PEM", signerPem);
    return f;
  }
  const renew = (f: ReturnType<typeof fixture>, fetchImpl: typeof fetch, at = now) =>
    renewClinicalAccess({ connectionId: f.row.id, memberId: f.row.memberId, generation: 1, now: at, fetchImpl });

  it("renews with the Oracle signer and exact token URL, and re-seals the non-rotating token", async () => {
    const f = oracleFixture();
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_STARTS", "0");
    vi.stubEnv("CLINICAL_RECORDS_WRITE_GRANT_PROFILES", "0");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      access_token: "oracle-access", token_type: "Bearer", expires_in: 570, scope: SCOPES.join(" "),
    }));
    const before = Date.now();
    await expect(renew(f, fetchImpl)).resolves.toBe("oracle-access");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(TOKEN);
    const assertion = new URLSearchParams(String(init?.body)).get("client_assertion")!;
    expect(decodeJwt(assertion)).toMatchObject({ aud: TOKEN, iss: "synthetic-oracle-client", sub: "synthetic-oracle-client" });
    const sealed = JSON.parse(f.row.refreshTokenEncrypted.slice("sealed:".length));
    expect(sealed).toMatchObject({ profile: PROFILE, clientId: "oracle-millennium-r4", refreshToken: "oracle-refresh", tokenEndpoint: TOKEN });
    expect(f.row.refreshTokenEncrypted).not.toContain("synthetic-oracle-client");
    expect(f.row).toMatchObject({ accessTokenEncrypted: "sealed:oracle-access", refreshLeaseId: null });
    expect((f.row.accessTokenExpiresAt as Date).getTime()).toBeGreaterThanOrEqual(before + 570_000);
  });

  it.each([
    ["an Oracle row without its profile", { profile: undefined }, "cerner-fhir"],
    ["an Epic row with an Oracle profile", {}, "epic-fhir"],
    ["another tenant's token URL", { tokenEndpoint: TOKEN.replace("0aB1cD2e-synthetic", "another-tenant") }, "cerner-fhir"],
    ["a raw client ID in the payload", { clientId: "synthetic-oracle-client" }, "cerner-fhir"],
    ["a sandbox grant on a production entry", { profile: { ...PROFILE, environment: "sandbox" } }, "sandbox-credentials"],
    ["the kill switch", {}, "disabled"],
    ["the kill switch spelled true", {}, "disabled-true"],
  ])("releases the lease without egress for %s", async (_label, payload, sourceSystem) => {
    const f = oracleFixture(payload);
    if (sourceSystem === "epic-fhir") f.row.sourceSystem = "epic-fhir";
    if (sourceSystem === "sandbox-credentials") {
      vi.stubEnv("ORACLE_SANDBOX_SMART_CLIENT_ID", "synthetic-sandbox");
      vi.stubEnv("ORACLE_SANDBOX_SMART_PRIVATE_KEY_PEM", signerPem);
    }
    if (sourceSystem.startsWith("disabled")) vi.stubEnv("CLINICAL_RECORDS_ORACLE_DISABLED", sourceSystem === "disabled" ? "1" : " true ");
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(renew(f, fetchImpl)).rejects.toMatchObject({ code: "CLINICAL_RECORD_REFRESH_PREPARATION_FAILED", retryable: true });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(f.row).toMatchObject({ refreshLeaseId: null, refreshTokenEncrypted: "refresh-sealed" });
  });

  it("keeps the shared lease and ambiguous-exchange fencing on cerner-fhir rows", async () => {
    const leased = oracleFixture();
    leased.row.refreshLeaseId = "other";
    leased.row.refreshLeaseExpiresAt = new Date(now.getTime() + 60_000);
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(renew(leased, fetchImpl)).rejects.toMatchObject({ code: "CLINICAL_RECORD_REFRESH_IN_PROGRESS", retryable: true });
    const ambiguous = oracleFixture();
    await expect(renew(ambiguous, vi.fn<typeof fetch>().mockRejectedValue(new Error("connection reset"))))
      .rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_REAUTH_REQUIRED" });
    expect(ambiguous.row.refreshLeaseId).toEqual(expect.any(String));
    await expect(renew(ambiguous, fetchImpl, new Date(now.getTime() + 60_001))).rejects.toMatchObject({ code: "CLINICAL_RECORD_SMART_REAUTH_REQUIRED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("admits an Oracle daily plan with its own windows and backs off while disabled", async () => {
    const f = oracleFixture();
    const input = { connectionId: f.row.id, memberId: f.row.memberId, now };
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_DISABLED", "1");
    expect(await admitClinicalDailySync(input)).toBe(false);
    expect(f.create).not.toHaveBeenCalled();
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_DISABLED", "");
    expect(await admitClinicalDailySync(input)).toBe(true);
    expect(f.create.mock.calls[0]![0].data.retrievalPlanJson.slices.map((slice: { queryScopeId: string; coverage: string }) =>
      [slice.queryScopeId, slice.coverage])).toEqual([
      ["patient-demographics", "whole-family"], ["immunizations", "whole-family"], ["medication-requests", "bounded-window"],
    ]);
  });
});
