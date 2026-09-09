import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

type ReadFacts = typeof import(
  "../src/lib/hosted-orchestration/visible-runtime-reconciliation"
).readHostedRuntimeReconciliationFactsWithVisibleAccess;
type ReconciliationRoute = typeof import(
  "../app/api/internal/hosted-orchestration/users/[userId]/reconciliation-facts/route"
);

const MEMBER_ID = "member_timing_fixture";
const TIMING_MESSAGE = "Hosted runtime reconciliation facts timing.";
const TIMING_SCHEMA = "murph.hosted-runtime.reconciliation-facts.timing.v1";
const FACTS: Awaited<ReturnType<ReadFacts>> = {
  blocked: null,
  mailboxLag: [],
  workspace: null,
};

const mocks = vi.hoisted(() => ({
  requireHostedCloudflareCallbackRequest: vi.fn(),
  readFacts: vi.fn<ReadFacts>(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));
vi.mock("@/src/lib/hosted-orchestration/visible-runtime-reconciliation", () => ({
  readHostedRuntimeReconciliationFactsWithVisibleAccess: mocks.readFacts,
}));

let route: ReconciliationRoute;
let elapsedMs = 0;

beforeAll(async () => {
  route = await import(
    "../app/api/internal/hosted-orchestration/users/[userId]/reconciliation-facts/route"
  );
});

beforeEach(() => {
  elapsedMs = 0;
  vi.spyOn(performance, "now").mockImplementation(() => elapsedMs);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.requireHostedCloudflareCallbackRequest.mockReset().mockImplementation(async () => {
    elapsedMs += 20;
    return MEMBER_ID;
  });
  mocks.readFacts.mockReset().mockResolvedValue(FACTS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reconciliation facts route timing", () => {
  it("accounts for authentication and repeated canonical stages without changing the response", async () => {
    mocks.readFacts.mockImplementation(async (_request, reportStage) => {
      reportStage?.("canonical_access_workspace");
      elapsedMs += 30;
      reportStage?.("canonical_consent");
      elapsedMs += 40;
      reportStage?.("canonical_projection");
      elapsedMs += 5;
      reportStage?.("canonical_mailbox");
      elapsedMs += 60;
      reportStage?.("canonical_projection");
      elapsedMs += 7;
      reportStage?.("canonical_mailbox");
      elapsedMs += 80;
      reportStage?.("canonical_projection");
      elapsedMs += 3;
      reportStage?.("canonical_usage");
      elapsedMs += 100;
      reportStage?.("canonical_projection");
      elapsedMs += 2;
      return FACTS;
    });

    const response = await requestFacts();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(FACTS);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 0 },
    );
    expect(console.info).toHaveBeenCalledExactlyOnceWith(TIMING_MESSAGE, {
      durationMs: 347,
      schema: TIMING_SCHEMA,
      stageDurationsMs: {
        authentication: 20,
        request_validation: 0,
        canonical_access_workspace: 30,
        canonical_consent: 40,
        canonical_projection: 17,
        canonical_mailbox: 140,
        canonical_usage: 100,
        response_projection: 0,
      },
    });
  });

  it("records rejected authentication without reading facts or logging request contents", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockImplementation(async () => {
      elapsedMs += 42;
      throw hostedOnboardingError({
        code: "CALLBACK_AUTH_REJECTED",
        httpStatus: 401,
        message: "Synthetic private authentication failure.",
      });
    });

    const response = await requestFacts();

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "CALLBACK_AUTH_REJECTED" },
    });
    expect(mocks.readFacts).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledExactlyOnceWith(TIMING_MESSAGE, {
      durationMs: 42,
      schema: TIMING_SCHEMA,
      stageDurationsMs: { authentication: 42 },
    });
  });

  it("preserves the user-binding rejection before facts are read", async () => {
    const response = await requestFacts("member_other_fixture");

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "HOSTED_ORCHESTRATION_USER_MISMATCH" },
    });
    expect(mocks.readFacts).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledExactlyOnceWith(TIMING_MESSAGE, {
      durationMs: 20,
      schema: TIMING_SCHEMA,
      stageDurationsMs: { authentication: 20, request_validation: 0 },
    });
  });

  it("closes the failing canonical stage and preserves existing failure classification", async () => {
    mocks.readFacts.mockImplementation(async (_request, reportStage) => {
      elapsedMs += 30;
      reportStage?.("canonical_mailbox");
      elapsedMs += 50;
      throw new TypeError("Synthetic private mailbox failure.");
    });

    const response = await requestFacts();

    expect(response.status).toBe(400);
    expect(console.error).toHaveBeenCalledWith(
      "Hosted runtime reconciliation facts failed.",
      {
        errorClass: "type_error",
        schema: "murph.hosted-runtime.reconciliation-facts.failure.v1",
        stage: "canonical_mailbox",
      },
    );
    expect(console.info).toHaveBeenCalledExactlyOnceWith(TIMING_MESSAGE, {
      durationMs: 100,
      schema: TIMING_SCHEMA,
      stageDurationsMs: {
        authentication: 20,
        request_validation: 0,
        canonical_access_workspace: 30,
        canonical_mailbox: 50,
      },
    });
  });

  it.each(["success", "failure"] as const)(
    "does not replace the %s response when timing logging throws",
    async (outcome) => {
      vi.mocked(console.info).mockImplementation(() => {
        throw new Error("Synthetic timing sink failure.");
      });
      if (outcome === "failure") {
        mocks.readFacts.mockRejectedValue(hostedOnboardingError({
          code: "FACTS_UNAVAILABLE",
          httpStatus: 503,
          message: "Synthetic facts unavailable.",
        }));
      }

      const response = await requestFacts();

      expect(response.status).toBe(outcome === "success" ? 200 : 503);
      expect(await response.json()).toEqual(outcome === "success"
        ? FACTS
        : expect.objectContaining({ error: expect.objectContaining({ code: "FACTS_UNAVAILABLE" }) }));
    },
  );
});

async function requestFacts(userId = MEMBER_ID): Promise<Response> {
  return await route.GET(
    new Request(
      `https://join.example.test/api/internal/hosted-orchestration/users/${userId}/reconciliation-facts`,
    ),
    { params: Promise.resolve({ userId }) },
  );
}
