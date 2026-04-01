import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
    }
  }

  return {
    NextResponse: MockNextResponse,
  };
});

type HttpModule = typeof import("../src/lib/http");

let httpModule: HttpModule;

describe("json route helper factory", () => {
  beforeAll(async () => {
    httpModule = await import("../src/lib/http");
  });

  it("merges default headers into jsonOk responses", async () => {
    const helpers = httpModule.createJsonRouteHelpers({
      defaultHeaders: {
        "Cache-Control": "no-store",
      },
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
    });

    const response = helpers.jsonOk(
      { ok: true },
      202,
      { "x-test": "present" },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("x-test")).toBe("present");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("uses domain matchers and default headers for jsonError responses", async () => {
    const helpers = httpModule.createJsonRouteHelpers({
      defaultHeaders: {
        "Cache-Control": "no-store",
      },
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      matchers: [
        (error) => error === "known"
          ? {
              error: {
                code: "KNOWN",
                message: "Known failure.",
              },
              status: 409,
            }
          : null,
      ],
    });

    const response = helpers.jsonError("known", { "x-test": "present" });

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("x-test")).toBe("present");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "KNOWN",
        message: "Known failure.",
      },
    });
  });

  it("reuses the same domain mapping when wrapping handlers", async () => {
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      matchers: [
        (error) => error instanceof Error && error.message === "known"
          ? {
              error: {
                code: "KNOWN",
                message: "Known failure.",
              },
              status: 422,
            }
          : null,
      ],
    });

    const handler = helpers.withJsonError(async () => {
      throw new Error("known");
    });

    const response = await handler();

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "KNOWN",
        message: "Known failure.",
      },
    });
  });
});
