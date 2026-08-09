import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendClinicalRetrievalWakeTx: vi.fn(),
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  buildSmartAuthorizationUrl: vi.fn(),
  createSmartPkce: vi.fn(),
  createSmartState: vi.fn(),
  discoverSmartConfiguration: vi.fn(),
  exchangeSmartAuthorizationCode: vi.fn(),
  getPrisma: vi.fn(),
  openClinicalOauthVerifier: vi.fn(),
  readGrantedSmartResourceTypes: vi.fn(),
  resolveClinicalProviderDirectoryEntry: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  sealClinicalConnectionFhirBaseUrl: vi.fn(),
  sealClinicalConnectionSecret: vi.fn(),
  sealClinicalOauthVerifier: vi.fn(),
  signalClinicalRetrievalWake: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));
vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));
vi.mock("@/src/lib/clinical-records/provider-directory-store", () => ({
  resolveClinicalProviderDirectoryEntry: mocks.resolveClinicalProviderDirectoryEntry,
}));
vi.mock("@/src/lib/clinical-records/secrets", () => ({
  openClinicalOauthVerifier: mocks.openClinicalOauthVerifier,
  sealClinicalConnectionFhirBaseUrl: mocks.sealClinicalConnectionFhirBaseUrl,
  sealClinicalConnectionSecret: mocks.sealClinicalConnectionSecret,
  sealClinicalOauthVerifier: mocks.sealClinicalOauthVerifier,
  toClinicalJsonArray: (values: readonly string[]) => [...values],
}));
vi.mock("@/src/lib/clinical-records/smart", () => ({
  buildSmartAuthorizationUrl: mocks.buildSmartAuthorizationUrl,
  createSmartPkce: mocks.createSmartPkce,
  createSmartState: mocks.createSmartState,
  discoverSmartConfiguration: mocks.discoverSmartConfiguration,
  exchangeSmartAuthorizationCode: mocks.exchangeSmartAuthorizationCode,
  normalizeSmartStateHash: () => "state-hash",
  readGrantedSmartResourceTypes: mocks.readGrantedSmartResourceTypes,
}));
vi.mock("@/src/lib/clinical-records/retrieval", () => ({
  appendClinicalRetrievalWakeTx: mocks.appendClinicalRetrievalWakeTx,
  signalClinicalRetrievalWake: mocks.signalClinicalRetrievalWake,
}));

import {
  finishClinicalRecordAuthorization,
  startClinicalRecordConnection,
} from "@/src/lib/clinical-records/control-plane";

const MEMBER_ID = "member_clinical_1";
const PROVIDER_ID = "epic-example";
const CONNECT_CLAIM = `cr_${"a".repeat(32)}`;
const productionProvider = {
  aliases: [],
  brandName: "Example Health",
  clientIdEnvironmentKey: "EPIC_SMART_CLIENT_ID" as
    | "EPIC_SMART_CLIENT_ID"
    | "EPIC_SMART_NON_PRODUCTION_CLIENT_ID",
  fhirBaseUrl: "https://fhir.example.test/FHIR/R4",
  id: PROVIDER_ID,
  locations: [],
  requestedBaseScopes: ["openid", "fhirUser", "launch/patient"],
  resourceTypes: ["Patient", "Observation", "DiagnosticReport"],
  sourceSystem: "epic-fhir" as const,
};
let provider = productionProvider;

describe("Clinical Records authorization persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provider = productionProvider;
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: MEMBER_ID },
      sessionId: "hws_clinical_1",
    });
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.buildSmartAuthorizationUrl.mockReturnValue(
      "https://fhir.example.test/oauth2/authorize",
    );
    mocks.createSmartPkce.mockReturnValue({
      challenge: "pkce-challenge",
      verifier: "pkce-verifier",
    });
    mocks.createSmartState.mockReturnValue({ state: "opaque-state", stateHash: "state-hash" });
    mocks.discoverSmartConfiguration.mockResolvedValue({
      authorizationEndpoint: "https://fhir.example.test/oauth2/authorize",
      requestedScopes: [
        "openid",
        "fhirUser",
        "launch/patient",
        "patient/Patient.r",
        "patient/Observation.s",
        "patient/DiagnosticReport.s",
      ],
      tokenEndpoint: "https://fhir.example.test/oauth2/token",
    });
    mocks.openClinicalOauthVerifier.mockResolvedValue("pkce-verifier");
    mocks.exchangeSmartAuthorizationCode.mockResolvedValue({
      accessToken: "access-token",
      expiresInSeconds: 3_600,
      grantedScopes: ["patient/Patient.rs", "patient/Observation.rs"],
      patientId: "patient-low-entropy",
      refreshToken: "unexpected-refresh-token",
    });
    mocks.readGrantedSmartResourceTypes.mockReturnValue(["Patient", "Observation"]);
    mocks.resolveClinicalProviderDirectoryEntry.mockImplementation(() => provider);
    mocks.sealClinicalConnectionFhirBaseUrl.mockResolvedValue("sealed-fhir-base-url");
    mocks.sealClinicalOauthVerifier.mockResolvedValue("sealed-verifier");
    mocks.sealClinicalConnectionSecret.mockImplementation(async (input: { field: string }) =>
      `sealed-${input.field}`
    );
    mocks.appendClinicalRetrievalWakeTx.mockResolvedValue({
      id: "mailbox_1",
      lane: "system",
      laneSeq: "1",
      userId: MEMBER_ID,
    });
    mocks.signalClinicalRetrievalWake.mockResolvedValue(undefined);
    vi.stubEnv("EPIC_SMART_CLIENT_ID", "epic-client-id");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("persists only the provider base hash in the OAuth session", async () => {
    const harness = createHarness(null);
    mocks.getPrisma.mockReturnValue(harness.prisma);

    await startClinicalRecordConnection({
      claim: CONNECT_CLAIM,
      providerDirectoryEntryId: PROVIDER_ID,
      request: new Request(
        "https://join.example.test/api/clinical-records/connect-intents/start",
        { headers: { origin: "https://join.example.test" }, method: "POST" },
      ),
    });

    const created = harness.oauthSessionCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(created.fhirBaseHash).toBe(
      createHash("sha256").update(provider.fhirBaseUrl).digest("hex"),
    );
    expect(created).not.toHaveProperty("fhirBaseUrl");
  });

  it("uses only the non-production client id for the curated Epic sandbox", async () => {
    provider = {
      ...productionProvider,
      brandName: "Epic Sandbox (test data only)",
      clientIdEnvironmentKey: "EPIC_SMART_NON_PRODUCTION_CLIENT_ID",
      fhirBaseUrl: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
      id: "epic-sandbox",
    };
    vi.stubEnv("EPIC_SMART_CLIENT_ID", "production-client-id");
    vi.stubEnv("EPIC_SMART_NON_PRODUCTION_CLIENT_ID", "sandbox-client-id");
    const harness = createHarness(null);
    mocks.getPrisma.mockReturnValue(harness.prisma);

    await startClinicalRecordConnection({
      claim: CONNECT_CLAIM,
      providerDirectoryEntryId: "epic-sandbox",
      request: new Request(
        "https://join.example.test/api/clinical-records/connect-intents/start",
        { headers: { origin: "https://join.example.test" }, method: "POST" },
      ),
    });

    expect(harness.oauthSessionCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      clientId: "sandbox-client-id",
    });
    expect(mocks.discoverSmartConfiguration).toHaveBeenCalledWith(expect.objectContaining({
      fhirBaseUrl: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
    }));
  });

  it("does not fall back to the production client id for the Epic sandbox", async () => {
    provider = {
      ...productionProvider,
      brandName: "Epic Sandbox (test data only)",
      clientIdEnvironmentKey: "EPIC_SMART_NON_PRODUCTION_CLIENT_ID",
      fhirBaseUrl: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
      id: "epic-sandbox",
    };
    vi.stubEnv("EPIC_SMART_CLIENT_ID", "production-client-id");
    vi.stubEnv("EPIC_SMART_NON_PRODUCTION_CLIENT_ID", "");
    const harness = createHarness(null);
    mocks.getPrisma.mockReturnValue(harness.prisma);

    await expect(startClinicalRecordConnection({
      claim: CONNECT_CLAIM,
      providerDirectoryEntryId: "epic-sandbox",
      request: new Request(
        "https://join.example.test/api/clinical-records/connect-intents/start",
        { headers: { origin: "https://join.example.test" }, method: "POST" },
      ),
    })).rejects.toMatchObject({ code: "CLINICAL_RECORD_PROVIDER_NOT_CONFIGURED" });
    expect(mocks.discoverSmartConfiguration).not.toHaveBeenCalled();
  });

  it("persists only encrypted patient context, not a patient-id derivative", async () => {
    const harness = createHarness(null);
    mocks.getPrisma.mockReturnValue(harness.prisma);

    await finishAuthorization();

    const created = harness.connectionCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(created.patientIdEncrypted).toBe("sealed-patientId");
    expect(created.fhirBaseUrlEncrypted).toBe("sealed-fhir-base-url");
    expect(created.refreshTokenEncrypted).toBeNull();
    expect(created.retrievalGeneration).toBe(1);
    expect(created).not.toHaveProperty("fhirBaseUrl");
    expect(created).not.toHaveProperty("patientIdHash");
    expect(mocks.sealClinicalConnectionSecret.mock.calls.map(([input]) => input.field)).toEqual([
      "patientId",
      "accessToken",
    ]);
    expect(harness.retrievalRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        generation: 1,
        grantedScopesJson: ["patient/Patient.rs", "patient/Observation.rs"],
        retrievalPlanJson: {
          schemaVersion: "murph.clinical-retrieval-plan.v1",
          slices: [
            expect.objectContaining({
              queryScopeId: "patient-demographics",
              resourceType: "Patient",
              sliceId: "whole",
            }),
            expect.objectContaining({
              queryScopeId: "laboratory-observations",
              resourceType: "Observation",
              sliceId: "whole",
            }),
            expect.objectContaining({
              coverage: "bounded-window",
              queryScopeId: "observation-assessments",
              resourceType: "Observation",
            }),
            expect.objectContaining({
              coverage: "bounded-window",
              queryScopeId: "observation-sdoh-assessments",
              resourceType: "Observation",
            }),
            expect.objectContaining({
              coverage: "bounded-window",
              queryScopeId: "observation-social-history",
              resourceType: "Observation",
            }),
            expect.objectContaining({
              coverage: "bounded-window",
              queryScopeId: "vital-sign-observations",
              resourceType: "Observation",
            }),
          ],
        },
        retrievalProtocol: "query-slices-v2",
        status: "queued",
      }),
    });
    const retrievalRun = harness.retrievalRunCreate.mock.calls[0]?.[0]?.data as {
      createdAt: Date;
      retrievalPlanJson: { slices: Array<{ coverage: string; to?: string }> };
    };
    expect(retrievalRun.retrievalPlanJson.slices
      .filter((slice) => slice.coverage === "bounded-window")
      .every((slice) => slice.to === retrievalRun.createdAt.toISOString())).toBe(true);
    expect(harness.connectionCreate).toHaveBeenCalledTimes(1);
    expect(harness.retrievalRunCreate).toHaveBeenCalledTimes(1);
    expect(harness.connectIntentUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.appendClinicalRetrievalWakeTx).toHaveBeenCalledTimes(1);
    expect(mocks.signalClinicalRetrievalWake).toHaveBeenCalledTimes(1);
  });

  it("prepares every connection ciphertext before opening the persistence transaction", async () => {
    const harness = createHarness(null);
    mocks.getPrisma.mockReturnValue(harness.prisma);
    const sealStarted = createDeferred();
    const releaseSeal = createDeferred();
    mocks.sealClinicalConnectionFhirBaseUrl.mockImplementation(async (input) => {
      harness.callOrder.push("seal:fhirBaseUrl:start");
      expect(harness.transactionDepth).toBe(0);
      expect(input).not.toHaveProperty("prisma");
      sealStarted.resolve();
      await releaseSeal.promise;
      harness.callOrder.push("seal:fhirBaseUrl:end");
      return "sealed-fhir-base-url";
    });
    mocks.sealClinicalConnectionSecret.mockImplementation(async (input: {
      connectionId: string;
      field: string;
      tokenVersion: number;
    }) => {
      harness.callOrder.push(`seal:${input.field}`);
      expect(harness.transactionDepth).toBe(0);
      expect(input).not.toHaveProperty("prisma");
      return `sealed-${input.field}`;
    });
    mocks.signalClinicalRetrievalWake.mockImplementation(async () => {
      expect(harness.transactionDepth).toBe(0);
      harness.callOrder.push("signal:wake");
    });

    const authorization = finishAuthorization();
    await sealStarted.promise;

    expect(harness.transactionDepth).toBe(0);
    expect(harness.transactionCalls).toBe(1);
    expect(harness.callOrder).toEqual([
      "transaction:1:start",
      "transaction:1:end",
      "seal:fhirBaseUrl:start",
    ]);

    releaseSeal.resolve();
    await authorization;

    expect(harness.callOrder).toEqual([
      "transaction:1:start",
      "transaction:1:end",
      "seal:fhirBaseUrl:start",
      "seal:fhirBaseUrl:end",
      "seal:patientId",
      "seal:accessToken",
      "transaction:2:start",
      "transaction:2:end",
      "signal:wake",
    ]);
    const fhirSealInput = mocks.sealClinicalConnectionFhirBaseUrl.mock.calls[0]?.[0];
    const secretSealInputs = mocks.sealClinicalConnectionSecret.mock.calls.map(([input]) => input);
    expect(secretSealInputs).toEqual([
      expect.objectContaining({
        connectionId: fhirSealInput?.connectionId,
        field: "patientId",
        tokenVersion: 1,
      }),
      expect.objectContaining({
        connectionId: fhirSealInput?.connectionId,
        field: "accessToken",
        tokenVersion: 1,
      }),
    ]);
    expect(harness.connectionCreate.mock.calls[0]?.[0]?.data.id).toBe(
      fhirSealInput?.connectionId,
    );
  });

  it("rechecks launch consent inside the persistence transaction after ciphertext preparation", async () => {
    const harness = createHarness(null);
    mocks.getPrisma.mockReturnValue(harness.prisma);
    const sealStarted = createDeferred();
    const releaseSeal = createDeferred();
    let launchConsentGranted = true;
    mocks.sealClinicalConnectionFhirBaseUrl.mockImplementation(async () => {
      sealStarted.resolve();
      await releaseSeal.promise;
      return "sealed-fhir-base-url";
    });
    mocks.assertHostedLaunchRequiredConsentGranted.mockImplementation(async ({ prisma }) => {
      if (prisma === harness.tx && !launchConsentGranted) {
        throw Object.assign(new Error("launch consent withdrawn"), {
          code: "HOSTED_CONSENT_REQUIRED",
        });
      }
    });

    const authorization = finishAuthorization();
    await sealStarted.promise;
    launchConsentGranted = false;
    releaseSeal.resolve();

    await expect(authorization).rejects.toMatchObject({ code: "HOSTED_CONSENT_REQUIRED" });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenLastCalledWith({
      memberId: MEMBER_ID,
      prisma: harness.tx,
    });
    expect(harness.connectionCreate).not.toHaveBeenCalled();
    expect(harness.retrievalRunCreate).not.toHaveBeenCalled();
    expect(mocks.appendClinicalRetrievalWakeTx).not.toHaveBeenCalled();
    expect(mocks.signalClinicalRetrievalWake).not.toHaveBeenCalled();
  });

  it("fails closed when provider configuration changes after ciphertext preparation", async () => {
    const harness = createHarness(null);
    mocks.getPrisma.mockReturnValue(harness.prisma);
    const sealStarted = createDeferred();
    const releaseSeal = createDeferred();
    const changedProvider = {
      ...productionProvider,
      fhirBaseUrl: "https://changed-fhir.example.test/FHIR/R4",
    };
    mocks.resolveClinicalProviderDirectoryEntry.mockImplementation(() =>
      harness.transactionDepth > 0 ? changedProvider : productionProvider
    );
    mocks.sealClinicalConnectionFhirBaseUrl.mockImplementation(async () => {
      sealStarted.resolve();
      await releaseSeal.promise;
      return "sealed-fhir-base-url";
    });

    const authorization = finishAuthorization();
    await sealStarted.promise;
    expect(harness.transactionDepth).toBe(0);
    expect(mocks.resolveClinicalProviderDirectoryEntry).toHaveBeenCalledTimes(1);
    releaseSeal.resolve();

    await expect(authorization).rejects.toMatchObject({
      code: "CLINICAL_RECORD_PROVIDER_CONFIGURATION_CHANGED",
    });
    expect(mocks.resolveClinicalProviderDirectoryEntry).toHaveBeenCalledTimes(2);
    expect(harness.connectionCreate).not.toHaveBeenCalled();
    expect(harness.retrievalRunCreate).not.toHaveBeenCalled();
    expect(mocks.appendClinicalRetrievalWakeTx).not.toHaveBeenCalled();
    expect(mocks.signalClinicalRetrievalWake).not.toHaveBeenCalled();
  });

  it("rejects a second retrieval for the same member and provider", async () => {
    const harness = createHarness(existingConnection());
    mocks.getPrisma.mockReturnValue(harness.prisma);

    await expect(finishAuthorization()).rejects.toMatchObject({
      code: "CLINICAL_RECORD_CONNECTION_ALREADY_EXISTS",
    });
    expect(mocks.sealClinicalConnectionFhirBaseUrl).not.toHaveBeenCalled();
    expect(mocks.sealClinicalConnectionSecret).not.toHaveBeenCalled();
    expect(harness.connectionCreate).not.toHaveBeenCalled();
    expect(harness.retrievalRunCreate).not.toHaveBeenCalled();
  });

  it.each(["active", "disconnected", "needs_reauth"] as const)(
    "keeps a %s legacy member-provider row ineligible before provider discovery",
    async (status) => {
      const harness = createHarness(existingConnection(status));
      mocks.getPrisma.mockReturnValue(harness.prisma);

      await expect(startClinicalRecordConnection({
        claim: CONNECT_CLAIM,
        providerDirectoryEntryId: PROVIDER_ID,
        request: new Request(
          "https://join.example.test/api/clinical-records/connect-intents/start",
          { headers: { origin: "https://join.example.test" }, method: "POST" },
        ),
      })).rejects.toMatchObject({
        code: "CLINICAL_RECORD_CONNECTION_ALREADY_EXISTS",
      });
      expect(mocks.discoverSmartConfiguration).not.toHaveBeenCalled();
      expect(mocks.sealClinicalConnectionSecret).not.toHaveBeenCalled();
    },
  );

  it("maps the member-provider uniqueness race to the same bounded conflict", async () => {
    const harness = createHarness(null);
    harness.connectionCreate.mockRejectedValueOnce({ code: "P2002" });
    mocks.getPrisma.mockReturnValue(harness.prisma);

    await expect(finishAuthorization()).rejects.toMatchObject({
      code: "CLINICAL_RECORD_CONNECTION_ALREADY_EXISTS",
    });
    expect(harness.retrievalRunCreate).not.toHaveBeenCalled();
    expect(mocks.appendClinicalRetrievalWakeTx).not.toHaveBeenCalled();
    expect(mocks.signalClinicalRetrievalWake).not.toHaveBeenCalled();
  });

  it("does not persist or signal when the connect intent is superseded during preparation", async () => {
    const harness = createHarness(null);
    mocks.getPrisma.mockReturnValue(harness.prisma);
    const sealStarted = createDeferred();
    const releaseSeal = createDeferred();
    mocks.sealClinicalConnectionFhirBaseUrl.mockImplementation(async () => {
      sealStarted.resolve();
      await releaseSeal.promise;
      return "sealed-fhir-base-url";
    });

    const authorization = finishAuthorization();
    await sealStarted.promise;
    harness.connectIntentUpdateMany.mockResolvedValueOnce({ count: 0 });
    releaseSeal.resolve();

    await expect(authorization).rejects.toMatchObject({
      code: "CLINICAL_RECORD_CONNECT_INTENT_SUPERSEDED",
    });
    expect(harness.connectionCreate).not.toHaveBeenCalled();
    expect(harness.retrievalRunCreate).not.toHaveBeenCalled();
    expect(mocks.appendClinicalRetrievalWakeTx).not.toHaveBeenCalled();
    expect(mocks.signalClinicalRetrievalWake).not.toHaveBeenCalled();
  });

  it("rejects a superseded OAuth session before exchanging its provider code", async () => {
    const harness = createHarness(null, {
      consumedAt: new Date("2026-07-10T12:02:00.000Z"),
    });
    mocks.getPrisma.mockReturnValue(harness.prisma);

    await expect(finishAuthorization()).rejects.toMatchObject({
      code: "CLINICAL_RECORD_OAUTH_STATE_REPLAYED",
    });
    expect(mocks.exchangeSmartAuthorizationCode).not.toHaveBeenCalled();
    expect(harness.connectionCreate).not.toHaveBeenCalled();
  });

  it("rejects OAuth state bound to another member or browser session before token exchange", async () => {
    for (const oauthOverrides of [
      { memberId: "member_clinical_other" },
      { webSessionId: "hws_clinical_other" },
    ]) {
      const harness = createHarness(null, oauthOverrides);
      mocks.getPrisma.mockReturnValue(harness.prisma);

      await expect(finishAuthorization()).rejects.toMatchObject({
        code: "CLINICAL_RECORD_OAUTH_STATE_INVALID",
      });
      expect(harness.connectionCreate).not.toHaveBeenCalled();
    }

    expect(mocks.exchangeSmartAuthorizationCode).not.toHaveBeenCalled();
    expect(mocks.openClinicalOauthVerifier).not.toHaveBeenCalled();
  });

  it("classifies a provider callback error without a code as a connection failure", async () => {
    const harness = createHarness(null);
    mocks.getPrisma.mockReturnValue(harness.prisma);

    await expect(finishClinicalRecordAuthorization({
      code: null,
      providerDenied: false,
      providerError: true,
      request: new Request(
        "https://join.example.test/api/clinical-records/oauth/callback",
      ),
      state: "opaque-state",
    })).rejects.toMatchObject({
      code: "CLINICAL_RECORD_AUTHORIZATION_FAILED",
    });
    expect(mocks.exchangeSmartAuthorizationCode).not.toHaveBeenCalled();
    expect(harness.connectionCreate).not.toHaveBeenCalled();
  });
});

function createHarness(
  existing: ReturnType<typeof existingConnection> | null,
  oauthOverrides: Partial<ReturnType<typeof oauthSession>> = {},
) {
  const connectionCreate = vi.fn();
  const connectionFindUnique = vi.fn(async () => existing ? { ...existing } : null);
  const connectIntentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const oauthSessionCreate = vi.fn();
  const retrievalRunCreate = vi.fn();
  const callOrder: string[] = [];
  const transactionState = { calls: 0, depth: 0 };
  const tx = {
    clinicalRecordConnectIntent: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue({
        claimHash: createHash("sha256").update(CONNECT_CLAIM).digest("hex"),
        completedAt: null,
        createdAt: new Date("2026-07-10T12:00:00.000Z"),
        expiresAt: new Date("2099-07-10T12:10:00.000Z"),
        memberId: MEMBER_ID,
        providerDirectoryEntryId: null,
        startedAt: null,
      }),
      updateMany: connectIntentUpdateMany,
    },
    clinicalRecordConnection: {
      create: connectionCreate,
      findUnique: connectionFindUnique,
    },
    clinicalRecordOauthSession: {
      create: oauthSessionCreate,
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue({ ...oauthSession(), ...oauthOverrides }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    clinicalRecordRetrievalRun: {
      create: retrievalRunCreate,
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
      transactionState.calls += 1;
      const call = transactionState.calls;
      callOrder.push(`transaction:${call}:start`);
      transactionState.depth += 1;
      try {
        return await callback(tx);
      } finally {
        transactionState.depth -= 1;
        callOrder.push(`transaction:${call}:end`);
      }
    },
    clinicalRecordConnectIntent: tx.clinicalRecordConnectIntent,
    clinicalRecordConnection: tx.clinicalRecordConnection,
  };
  return {
    callOrder,
    connectionCreate,
    connectionFindUnique,
    connectIntentUpdateMany,
    get transactionCalls() {
      return transactionState.calls;
    },
    get transactionDepth() {
      return transactionState.depth;
    },
    oauthSessionCreate,
    prisma,
    retrievalRunCreate,
    tx,
  };
}

function oauthSession() {
  return {
    clientId: "epic-client-id",
    codeVerifierEncrypted: "sealed-verifier",
    connectIntentClaimHash: "claim-hash",
    consumedAt: null as Date | null,
    createdAt: new Date("2026-07-10T12:00:00.000Z"),
    expiresAt: new Date("2099-07-10T12:10:00.000Z"),
    fhirBaseHash: createHash("sha256").update(provider.fhirBaseUrl).digest("hex"),
    memberId: MEMBER_ID,
    providerDirectoryEntryId: PROVIDER_ID,
    redirectUri: "https://join.example.test/api/clinical-records/oauth/callback",
    requestedScopesJson: ["patient/Patient.rs", "patient/Observation.rs"],
    stateHash: "state-hash",
    tokenEndpoint: "https://fhir.example.test/oauth2/token",
    webSessionId: "hws_clinical_1",
  };
}

function existingConnection(status: "active" | "disconnected" | "needs_reauth" = "active") {
  return {
    id: "crc_existing",
    status,
  };
}

function finishAuthorization() {
  return finishClinicalRecordAuthorization({
    code: "authorization-code",
    providerDenied: false,
    providerError: false,
    request: new Request(
      "https://join.example.test/api/clinical-records/oauth/callback",
    ),
    state: "opaque-state",
  });
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
