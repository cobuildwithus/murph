import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  executeJunctionLabsTool: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  requireHostedCloudflareCallbackJsonRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest:
    mocks.requireHostedCloudflareCallbackJsonRequest,
}));
vi.mock("@/src/lib/labs/junction", () => ({
  executeJunctionLabsTool: mocks.executeJunctionLabsTool,
}));

type InternalRoute = typeof import(
  "../app/api/internal/hosted-execution/labs/tool/route"
);
type DashboardRoute = typeof import("../app/api/labs/route");

let internalRoute: InternalRoute;
let dashboardRoute: DashboardRoute;

const EMPTY_SEARCH_RESPONSE = {
  action: "search",
  checkedAt: "2026-07-16T15:30:00.000Z",
  items: [],
  orderableThroughMurph: false,
  orderingStatus: "discovery_only",
  provider: { page: 1, pages: 0, total: 0 },
  source: "junction",
} as const;

beforeAll(async () => {
  [internalRoute, dashboardRoute] = await Promise.all([
    import("../app/api/internal/hosted-execution/labs/tool/route"),
    import("../app/api/labs/route"),
  ]);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
  mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
    member: { id: "member_fixture" },
  });
  mocks.requireHostedCloudflareCallbackJsonRequest.mockImplementation(
    async (request: Request) => ({
      payload: await request.json(),
      userId: "member_fixture",
    }),
  );
  mocks.executeJunctionLabsTool.mockResolvedValue(EMPTY_SEARCH_RESPONSE);
});

describe("hosted labs internal callback route", () => {
  it("authenticates, strictly parses, and executes without forwarding member identity", async () => {
    const request = jsonRequest(
      "https://join.example.test/api/internal/hosted-execution/labs/tool",
      { action: "search", limit: 5, query: "lipids" },
    );

    const response = await internalRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 2_048 },
    );
    expect(mocks.executeJunctionLabsTool).toHaveBeenCalledWith(
      { action: "search", limit: 5, query: "lipids" },
      { signal: request.signal },
    );
    expect(JSON.stringify(mocks.executeJunctionLabsTool.mock.calls[0]))
      .not.toContain("member_fixture");
    await expect(response.json()).resolves.toEqual(EMPTY_SEARCH_RESPONSE);
  });

  it("rejects failed callback authentication before provider execution", async () => {
    mocks.requireHostedCloudflareCallbackJsonRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
        httpStatus: 401,
        message: "Hosted callback authentication failed.",
      }),
    );

    const response = await internalRoute.POST(jsonRequest(
      "https://join.example.test/api/internal/hosted-execution/labs/tool",
      { action: "search", query: "lipids" },
    ));

    expect(response.status).toBe(401);
    expect(mocks.executeJunctionLabsTool).not.toHaveBeenCalled();
  });

  it("passes the small callback body cap and maps an oversize rejection to 413", async () => {
    mocks.requireHostedCloudflareCallbackJsonRequest.mockRejectedValueOnce(
      new RangeError("Request body exceeded 2048 bytes."),
    );
    const request = jsonRequest(
      "https://join.example.test/api/internal/hosted-execution/labs/tool",
      { action: "search", query: "lipids" },
    );

    const response = await internalRoute.POST(request);

    expect(response.status).toBe(413);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 2_048 },
    );
    expect(mocks.executeJunctionLabsTool).not.toHaveBeenCalled();
  });

  it("rejects unknown request fields after callback authentication", async () => {
    const response = await internalRoute.POST(jsonRequest(
      "https://join.example.test/api/internal/hosted-execution/labs/tool",
      { action: "search", query: "lipids", userId: "foreign_fixture" },
    ));

    expect(response.status).toBe(400);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledOnce();
    expect(mocks.executeJunctionLabsTool).not.toHaveBeenCalled();
  });
});

describe("authenticated dashboard labs route", () => {
  it("requires same-origin active session authority before live search", async () => {
    const request = jsonRequest(
      "https://join.example.test/api/labs",
      { action: "search", kind: "biomarker", query: "vitamin d" },
    );

    const response = await dashboardRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(request);
    expect(mocks.executeJunctionLabsTool).toHaveBeenCalledWith(
      { action: "search", kind: "biomarker", query: "vitamin d" },
      { signal: request.signal },
    );
  });

  it("fails closed on a rejected origin before session or provider work", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "ORIGIN_NOT_ALLOWED",
        httpStatus: 403,
        message: "Request origin is not allowed.",
      });
    });

    const response = await dashboardRoute.POST(jsonRequest(
      "https://join.example.test/api/labs",
      { action: "search", query: "lipids" },
    ));

    expect(response.status).toBe(403);
    expect(mocks.requireActiveHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.executeJunctionLabsTool).not.toHaveBeenCalled();
  });

  it("rejects a missing or inactive session before provider work", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
        message: "Sign in to continue.",
      }),
    );

    const response = await dashboardRoute.POST(jsonRequest(
      "https://join.example.test/api/labs",
      { action: "search", query: "lipids" },
    ));

    expect(response.status).toBe(401);
    expect(mocks.executeJunctionLabsTool).not.toHaveBeenCalled();
  });

  it("strictly rejects unknown fields", async () => {
    const response = await dashboardRoute.POST(jsonRequest(
      "https://join.example.test/api/labs",
      { action: "locations", memberId: "foreign_fixture", zipCode: "10001" },
    ));

    expect(response.status).toBe(400);
    expect(mocks.executeJunctionLabsTool).not.toHaveBeenCalled();
  });

  it("rejects request bodies over the small route cap", async () => {
    const response = await dashboardRoute.POST(jsonRequest(
      "https://join.example.test/api/labs",
      { action: "search", query: "x".repeat(3_000) },
    ));

    expect(response.status).toBe(413);
    expect(mocks.executeJunctionLabsTool).not.toHaveBeenCalled();
  });
});

function jsonRequest(url: string, payload: unknown): Request {
  return new Request(url, {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
      origin: "https://join.example.test",
    },
    method: "POST",
  });
}
