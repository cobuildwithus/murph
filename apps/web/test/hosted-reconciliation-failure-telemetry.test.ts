import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import type {
  HostedRuntimeReconciliationFactsProcessingStage,
} from "@/src/lib/hosted-orchestration/visible-runtime-reconciliation";

const FAILURE_MESSAGE = "Hosted runtime reconciliation facts failed.";
const FAILURE_SCHEMA = "murph.hosted-runtime.reconciliation-facts.failure.v1";
const FAILURE_CASES = [
  {
    error: hostedOnboardingError({
      code: "SYNTHETIC_HOSTED_FAILURE",
      httpStatus: 500,
      message: "synthetic hosted failure",
    }),
    errorClass: "hosted_onboarding",
    stage: "canonical_access_workspace",
  },
  {
    error: new TypeError("synthetic type failure"),
    errorClass: "type_error",
    stage: "canonical_consent",
  },
  {
    error: new Error("synthetic mailbox failure"),
    errorClass: "error",
    stage: "canonical_mailbox",
  },
  {
    error: Object.freeze({ synthetic: true }),
    errorClass: "non_error",
    stage: "canonical_projection",
  },
  {
    error: new Error("synthetic usage failure"),
    errorClass: "error",
    stage: "canonical_usage",
  },
  {
    error: new Error("synthetic visible-access failure"),
    errorClass: "error",
    stage: "visible_access",
  },
  {
    error: new Error("synthetic notice failure"),
    errorClass: "error",
    stage: "blocked_access_notice",
  },
  {
    error: new Error("synthetic recheck failure"),
    errorClass: "error",
    stage: "canonical_recheck",
  },
] as const;

const mocks = vi.hoisted(() => ({
  readHostedRuntimeReconciliationFactsWithVisibleAccess: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/http", () => ({
  jsonOk: (body: unknown) => Response.json(body),
  withJsonError: (handler: unknown) => handler,
}));

vi.mock("@/src/lib/hosted-orchestration/visible-runtime-reconciliation", () => ({
  readHostedRuntimeReconciliationFactsWithVisibleAccess:
    mocks.readHostedRuntimeReconciliationFactsWithVisibleAccess,
}));

type ReconciliationRoute = typeof import(
  "../app/api/internal/hosted-orchestration/users/[userId]/reconciliation-facts/route"
);

let reconciliationRoute: ReconciliationRoute;

describe("hosted reconciliation failure telemetry", () => {
  beforeAll(async () => {
    reconciliationRoute = await import(
      "../app/api/internal/hosted-orchestration/users/[userId]/reconciliation-facts/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_test");
    mocks.readHostedRuntimeReconciliationFactsWithVisibleAccess
      .mockResolvedValue({
        blocked: null,
        mailboxLag: [],
        workspace: null,
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(FAILURE_CASES)(
    "emits one $errorClass record for $stage and rethrows identically",
    async ({ error, errorClass, stage }) => {
      failReconciliationAt(stage, error);
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      await expect(callRoute()).rejects.toBe(error);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(FAILURE_MESSAGE, {
        errorClass,
        schema: FAILURE_SCHEMA,
        stage,
      });
    },
  );

  it("excludes raw errors and every private or arbitrary field", async () => {
    const privateValue = "private-value-sentinel";
    const failure = Object.assign(
      new Error(privateValue, { cause: new Error(privateValue) }),
      {
        authorization: privateValue,
        contactId: privateValue,
        credential: privateValue,
        healthValue: privateValue,
        mailboxId: privateValue,
        mailboxSequence: privateValue,
        metadata: { scenario: privateValue },
        path: privateValue,
        payload: { value: privateValue },
        prompt: privateValue,
        providerText: privateValue,
        queryText: privateValue,
        requestId: privateValue,
        routeParameter: privateValue,
        transcript: privateValue,
        url: privateValue,
        userId: privateValue,
        workflowId: privateValue,
      },
    );
    failure.stack = privateValue;
    failReconciliationAt("blocked_access_notice", failure);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(callRoute()).rejects.toBe(failure);

    expect(consoleErrorSpy.mock.calls).toEqual([
      [
        FAILURE_MESSAGE,
        {
          errorClass: "error",
          schema: FAILURE_SCHEMA,
          stage: "blocked_access_notice",
        },
      ],
    ]);
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(privateValue);
  });

  it("emits no failure record on success", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await callRoute();

    expect(response.status).toBe(200);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("preserves the original failure when console logging throws", async () => {
    const failure = new Error("synthetic original failure");
    failReconciliationAt("canonical_recheck", failure);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {
        throw new Error("synthetic console failure");
      });

    await expect(callRoute()).rejects.toBe(failure);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});

function failReconciliationAt(
  stage: HostedRuntimeReconciliationFactsProcessingStage,
  error: unknown,
): void {
  mocks.readHostedRuntimeReconciliationFactsWithVisibleAccess
    .mockImplementationOnce(async (
      _input: unknown,
      reportStage?: (
        stage: HostedRuntimeReconciliationFactsProcessingStage,
      ) => void,
    ) => {
      reportStage?.(stage);
      throw error;
    });
}

function callRoute(): Promise<Response> {
  return reconciliationRoute.GET(
    new Request(
      "https://join.example.test/api/internal/hosted-orchestration/users/member_test/reconciliation-facts",
    ),
    { params: Promise.resolve({ userId: "member_test" }) },
  );
}
