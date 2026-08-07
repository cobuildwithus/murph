import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  createClinicalRecordConnectIntent: vi.fn(),
  fetchClinicalRetrievalPage: vi.fn(),
  readClinicalRetrievalRun: vi.fn(),
  recordClinicalRetrievalOutcome: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  requireHostedRuntimeActiveAccess: vi.fn(),
}));

vi.mock("@/src/lib/clinical-records/retrieval", () => ({
  fetchClinicalRetrievalPage: mocks.fetchClinicalRetrievalPage,
  readClinicalRetrievalRun: mocks.readClinicalRetrievalRun,
  recordClinicalRetrievalOutcome: mocks.recordClinicalRetrievalOutcome,
}));

vi.mock("@/src/lib/clinical-records/connect-intents", () => ({
  createClinicalRecordConnectIntent: mocks.createClinicalRecordConnectIntent,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  requireHostedRuntimeActiveAccess: mocks.requireHostedRuntimeActiveAccess,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

type ReadRunRoute = typeof import("../app/api/internal/clinical-records/runtime/read-run/route");
type ConnectLinkRoute = typeof import("../app/api/internal/clinical-records/connect-link/route");
type FetchPageRoute = typeof import("../app/api/internal/clinical-records/runtime/fetch-page/route");
type RecordOutcomeRoute = typeof import("../app/api/internal/clinical-records/runtime/record-outcome/route");

let readRunRoute: ReadRunRoute;
let connectLinkRoute: ConnectLinkRoute;
let fetchPageRoute: FetchPageRoute;
let recordOutcomeRoute: RecordOutcomeRoute;

describe("Clinical Records internal runtime routes", () => {
  beforeAll(async () => {
    [connectLinkRoute, readRunRoute, fetchPageRoute, recordOutcomeRoute] = await Promise.all([
      import("../app/api/internal/clinical-records/connect-link/route"),
      import("../app/api/internal/clinical-records/runtime/read-run/route"),
      import("../app/api/internal/clinical-records/runtime/fetch-page/route"),
      import("../app/api/internal/clinical-records/runtime/record-outcome/route"),
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_clinical_1");
    mocks.requireHostedRuntimeActiveAccess.mockResolvedValue(undefined);
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.createClinicalRecordConnectIntent.mockResolvedValue({
      claim: `cr_${"a".repeat(32)}`,
      connectUrl:
        `https://join.example.test/records/connect#clinicalRecordsIntent=cr_${"a".repeat(32)}`,
      expiresAt: "2026-07-10T12:15:00.000Z",
    });
    mocks.readClinicalRetrievalRun.mockResolvedValue({
      errorCode: "family-unavailable",
      retryable: false,
      status: "unavailable",
    });
    mocks.fetchClinicalRetrievalPage.mockResolvedValue({
      errorCode: "family-unavailable",
      retryable: false,
      status: "unavailable",
    });
    mocks.recordClinicalRetrievalOutcome.mockResolvedValue(undefined);
  });

  it("rejects all four operations before signed auth when the runtime write fence is absent", async () => {
    const responses = await Promise.all([
      connectLinkRoute.POST(jsonRequest("/api/internal/clinical-records/connect-link", {})),
      readRunRoute.POST(jsonRequest("/api/internal/clinical-records/runtime/read-run", {
        generation: 1,
        runId: "run_1",
      })),
      fetchPageRoute.POST(jsonRequest("/api/internal/clinical-records/runtime/fetch-page", {
        cursor: null,
        generation: 1,
        requestId: "request_1",
        resourceType: "Patient",
        runId: "run_1",
      })),
      recordOutcomeRoute.POST(jsonRequest("/api/internal/clinical-records/runtime/record-outcome", {
        counts: emptyOutcomeCounts(),
        generation: 1,
        runId: "run_1",
        status: "failed",
      })),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "CLINICAL_RECORD_RUNTIME_WRITE_FENCE_REQUIRED",
          message: "Clinical Records runtime access requires the active runtime write fence.",
          retryable: false,
        },
      });
    }
    expect(mocks.requireHostedCloudflareCallbackRequest).not.toHaveBeenCalled();
    expect(mocks.createClinicalRecordConnectIntent).not.toHaveBeenCalled();
    expect(mocks.readClinicalRetrievalRun).not.toHaveBeenCalled();
    expect(mocks.fetchClinicalRetrievalPage).not.toHaveBeenCalled();
    expect(mocks.recordClinicalRetrievalOutcome).not.toHaveBeenCalled();
  });

  it("accepts canonical forwarded fences and preserves strict runtime response shapes", async () => {
    const headers = runtimeWriteFenceHeaders();
    const requestKey = `scheduled_${"a".repeat(64)}`;
    const connectResponse = await connectLinkRoute.POST(jsonRequest(
      "/api/internal/clinical-records/connect-link",
      { requestKey },
      headers,
    ));
    const readResponse = await readRunRoute.POST(jsonRequest(
      "/api/internal/clinical-records/runtime/read-run",
      { generation: 1, runId: "run_1" },
      headers,
    ));
    const fetchResponse = await fetchPageRoute.POST(jsonRequest(
      "/api/internal/clinical-records/runtime/fetch-page",
      {
        cursor: null,
        generation: 1,
        requestId: "request_1",
        resourceType: "Patient",
        runId: "run_1",
      },
      headers,
    ));
    const outcomeResponse = await recordOutcomeRoute.POST(jsonRequest(
      "/api/internal/clinical-records/runtime/record-outcome",
      {
        counts: emptyOutcomeCounts(),
        errorCode: "provider-unavailable",
        generation: 1,
        runId: "run_1",
        status: "failed",
      },
      headers,
    ));

    await expect(connectResponse.json()).resolves.toEqual({
      connectUrl: "https://join.example.test/records/connect?launch=clinical-records",
      expiresAt: null,
      ok: true,
    });
    await expect(readResponse.json()).resolves.toEqual({
      errorCode: "family-unavailable",
      retryable: false,
      status: "unavailable",
    });
    await expect(fetchResponse.json()).resolves.toEqual({
      errorCode: "family-unavailable",
      retryable: false,
      status: "unavailable",
    });
    await expect(outcomeResponse.json()).resolves.toEqual({ ok: true });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledTimes(4);
    expect(mocks.requireHostedRuntimeActiveAccess).toHaveBeenCalledTimes(4);
    expect(mocks.createClinicalRecordConnectIntent).not.toHaveBeenCalled();
  });

  it("creates a short-lived claim immediately for current-message authority", async () => {
    const response = await connectLinkRoute.POST(jsonRequest(
      "/api/internal/clinical-records/connect-link",
      {},
      runtimeWriteFenceHeaders(),
    ));

    expect(response.status).toBe(200);
    expect(mocks.createClinicalRecordConnectIntent).toHaveBeenCalledWith({
      memberId: "member_clinical_1",
      request: expect.any(Request),
    });
  });

  it("accepts complete query-aware page and outcome identities and rejects partial identity", async () => {
    const headers = runtimeWriteFenceHeaders();
    const page = {
      cursor: null,
      generation: 1,
      queryFingerprint: "a".repeat(64),
      queryScopeId: "laboratory-observations",
      requestId: "request_1",
      resourceType: "Observation",
      retrievalProtocol: "query-slices-v2",
      runId: "run_1",
      sliceId: "whole",
    };
    const outcome = {
      counts: emptyOutcomeCounts(),
      generation: 1,
      retrievalProtocol: "query-slices-v2",
      retrievalSlices: [{
        queryScopeId: "laboratory-observations",
        sliceId: "whole",
      }],
      runId: "run_1",
      status: "completed",
    };

    const [pageResponse, outcomeResponse, invalidOutcomeResponse] = await Promise.all([
      fetchPageRoute.POST(jsonRequest(
        "/api/internal/clinical-records/runtime/fetch-page",
        page,
        headers,
      )),
      recordOutcomeRoute.POST(jsonRequest(
        "/api/internal/clinical-records/runtime/record-outcome",
        outcome,
        headers,
      )),
      recordOutcomeRoute.POST(jsonRequest(
        "/api/internal/clinical-records/runtime/record-outcome",
        { ...outcome, retrievalSlices: undefined },
        headers,
      )),
    ]);

    expect(pageResponse.status).toBe(200);
    expect(outcomeResponse.status).toBe(200);
    expect(invalidOutcomeResponse.status).toBe(400);
    expect(mocks.fetchClinicalRetrievalPage).toHaveBeenCalledWith({
      memberId: "member_clinical_1",
      request: page,
    });
    expect(mocks.recordClinicalRetrievalOutcome).toHaveBeenCalledWith({
      memberId: "member_clinical_1",
      request: outcome,
    });
  });

  it("rejects inactive members before any Clinical Records read, egress, or outcome mutation", async () => {
    mocks.requireHostedRuntimeActiveAccess.mockRejectedValue(hostedOnboardingError({
      code: "CLINICAL_RECORD_RUNTIME_MEMBER_INACTIVE",
      httpStatus: 403,
      message: "Clinical Records runtime access is inactive.",
    }));
    const headers = runtimeWriteFenceHeaders();
    const responses = await Promise.all([
      connectLinkRoute.POST(jsonRequest(
        "/api/internal/clinical-records/connect-link",
        {},
        headers,
      )),
      readRunRoute.POST(jsonRequest("/api/internal/clinical-records/runtime/read-run", {
        generation: 1,
        runId: "run_1",
      }, headers)),
      fetchPageRoute.POST(jsonRequest("/api/internal/clinical-records/runtime/fetch-page", {
        cursor: null,
        generation: 1,
        requestId: "request_1",
        resourceType: "Patient",
        runId: "run_1",
      }, headers)),
      recordOutcomeRoute.POST(jsonRequest("/api/internal/clinical-records/runtime/record-outcome", {
        counts: emptyOutcomeCounts(),
        generation: 1,
        runId: "run_1",
        status: "failed",
      }, headers)),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "CLINICAL_RECORD_RUNTIME_MEMBER_INACTIVE",
          message: "Clinical Records runtime access is inactive.",
          retryable: false,
        },
      });
    }
    expect(mocks.readClinicalRetrievalRun).not.toHaveBeenCalled();
    expect(mocks.createClinicalRecordConnectIntent).not.toHaveBeenCalled();
    expect(mocks.fetchClinicalRetrievalPage).not.toHaveBeenCalled();
    expect(mocks.recordClinicalRetrievalOutcome).not.toHaveBeenCalled();
  });

  it("rejects provider or member selectors before creating a connect intent", async () => {
    const response = await connectLinkRoute.POST(jsonRequest(
      "/api/internal/clinical-records/connect-link",
      { providerDirectoryEntryId: "provider_1" },
      runtimeWriteFenceHeaders(),
    ));

    expect(response.status).toBe(400);
    expect(mocks.createClinicalRecordConnectIntent).not.toHaveBeenCalled();
  });

  it("rejects non-canonical generations in otherwise present fences", async () => {
    const response = await readRunRoute.POST(jsonRequest(
      "/api/internal/clinical-records/runtime/read-run",
      { generation: 1, runId: "run_1" },
      {
        ...runtimeWriteFenceHeaders(),
        "x-hosted-runtime-workspace-version": "04",
      },
    ));

    expect(response.status).toBe(401);
    expect(mocks.requireHostedCloudflareCallbackRequest).not.toHaveBeenCalled();
  });
});

function jsonRequest(path: string, body: Record<string, unknown>, headers: HeadersInit = {}): Request {
  return new Request(`https://join.example.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });
}

function runtimeWriteFenceHeaders(): Record<string, string> {
  return {
    "x-hosted-runtime-attempt-id": "attempt_clinical_1",
    "x-hosted-runtime-lease-generation": "9",
    "x-hosted-runtime-workspace-version": "4",
  };
}

function emptyOutcomeCounts(): Record<string, number> {
  return {
    createdCount: 0,
    executableDecisionCount: 0,
    fetchedPageCount: 0,
    fetchedResourceFamilyCount: 0,
    rawFileCount: 0,
    retractedCount: 0,
    reviewDecisionCount: 0,
    skippedExistingCount: 0,
    supersededCount: 0,
  };
}
