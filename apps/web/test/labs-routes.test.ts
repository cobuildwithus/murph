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
  executeJunctionLabsTool: vi.fn(),
  requireHostedCloudflareCallbackJsonRequest: vi.fn(),
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

let internalRoute: InternalRoute;

const EMPTY_SEARCH_RESPONSE = {
  action: "search",
  checkedAt: "2026-07-16T15:30:00.000Z",
  items: [],
  orderableThroughMurph: false,
  orderingStatus: "discovery_only",
} as const;

beforeAll(async () => {
  internalRoute = await import("../app/api/internal/hosted-execution/labs/tool/route");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
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
