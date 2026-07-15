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
  resolveClinicalProviderDirectoryEntry: () => provider,
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
const provider = {
  aliases: [],
  brandName: "Example Health",
  clientIdEnvironmentKey: "EPIC_SMART_CLIENT_ID" as const,
  fhirBaseUrl: "https://fhir.example.test/FHIR/R4",
  id: PROVIDER_ID,
  locations: [],
  requestedBaseScopes: ["openid", "fhirUser", "launch/patient"],
  resourceTypes: ["Patient", "Observation"],
  sourceSystem: "epic-fhir" as const,
};

describe("Clinical Records authorization persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: MEMBER_ID },
      sessionId: "hws_clinical_1",
    });
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
        "patient/Patient.rs",
        "patient/Observation.rs",
      ],
      tokenEndpoint: "https://fhir.example.test/oauth2/token",
    });
    mocks.openClinicalOauthVerifier.mockResolvedValue("pkce-verifier");
    mocks.exchangeSmartAuthorizationCode.mockResolvedValue({
      accessToken: "access-token",
      expiresInSeconds: 3_600,
      grantedScopes: ["patient/Patient.rs", "patient/Observation.rs"],
      patientId: "patient-low-entropy",
      refreshToken: null,
    });
    mocks.readGrantedSmartResourceTypes.mockReturnValue(["Patient", "Observation"]);
    mocks.sealClinicalConnectionFhirBaseUrl.mockResolvedValue("sealed-fhir-base-url");
    mocks.sealClinicalOauthVerifier.mockResolvedValue("sealed-verifier");
    mocks.sealClinicalConnectionSecret.mockImplementation(async (input: { field: string }) =>
      input.field === "refreshToken" ? null : `sealed-${input.field}`
    );
    mocks.appendClinicalRetrievalWakeTx.mockResolvedValue({
      id: "mailbox_1",
      lane: "system",
      laneSeq: "1",
      userId: MEMBER_ID,
    });
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

  it("persists only encrypted patient context, not a patient-id derivative", async () => {
    const harness = createHarness(null);
    mocks.getPrisma.mockReturnValue(harness.prisma);

    await finishAuthorization();

    const created = harness.connectionCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(created.patientIdEncrypted).toBe("sealed-patientId");
    expect(created.fhirBaseUrlEncrypted).toBe("sealed-fhir-base-url");
    expect(created.retrievalGeneration).toBe(1);
    expect(created).not.toHaveProperty("fhirBaseUrl");
    expect(created).not.toHaveProperty("patientIdHash");
    expect(harness.retrievalRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        generation: 1,
        grantedScopesJson: ["patient/Patient.rs", "patient/Observation.rs"],
        status: "queued",
      }),
    });
  });

  it("rejects a second retrieval for the same member and provider", async () => {
    const harness = createHarness(existingConnection());
    mocks.getPrisma.mockReturnValue(harness.prisma);

    await expect(finishAuthorization()).rejects.toMatchObject({
      code: "CLINICAL_RECORD_CONNECTION_ALREADY_EXISTS",
    });
    expect(mocks.sealClinicalConnectionSecret).not.toHaveBeenCalled();
    expect(harness.connectionCreate).not.toHaveBeenCalled();
    expect(harness.retrievalRunCreate).not.toHaveBeenCalled();
  });

  it("rejects an existing member-provider connection before provider discovery", async () => {
    const harness = createHarness(existingConnection());
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
  });

  it("maps the member-provider uniqueness race to the same bounded conflict", async () => {
    const harness = createHarness(null);
    harness.connectionCreate.mockRejectedValueOnce({ code: "P2002" });
    mocks.getPrisma.mockReturnValue(harness.prisma);

    await expect(finishAuthorization()).rejects.toMatchObject({
      code: "CLINICAL_RECORD_CONNECTION_ALREADY_EXISTS",
    });
    expect(harness.retrievalRunCreate).not.toHaveBeenCalled();
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
});

function createHarness(
  existing: ReturnType<typeof existingConnection> | null,
  oauthOverrides: Partial<ReturnType<typeof oauthSession>> = {},
) {
  const connectionCreate = vi.fn();
  const oauthSessionCreate = vi.fn();
  const retrievalRunCreate = vi.fn();
  const harness = {
    connectionCreate,
    oauthSessionCreate,
    retrievalRunCreate,
    prisma: {} as Record<string, unknown>,
  };
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
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    clinicalRecordConnection: {
      create: connectionCreate,
      findUnique: vi.fn(async () => existing ? { ...existing } : null),
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
  harness.prisma = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    clinicalRecordConnection: tx.clinicalRecordConnection,
  };
  return harness;
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

function existingConnection() {
  return {
    id: "crc_existing",
  };
}

function finishAuthorization() {
  return finishClinicalRecordAuthorization({
    code: "authorization-code",
    providerDenied: false,
    request: new Request(
      "https://join.example.test/api/clinical-records/oauth/callback",
    ),
    state: "opaque-state",
  });
}
