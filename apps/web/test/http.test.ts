import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      const headers = new Headers(init?.headers);
      headers.set("content-type", "application/json");

      return new MockNextResponse(JSON.stringify(body), {
        ...init,
        headers,
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

  it("includes optional sanitized log details for unexpected errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      logDetails: (error) =>
        error instanceof Error && error.message === "boom"
          ? {
              errorCode: "E_DEMO",
              errorMeta: {
                operation: "send-code",
              },
            }
          : null,
    });

    const response = helpers.jsonError(new Error("boom"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
    expect(errorSpy).toHaveBeenCalledWith("route failed", {
      errorCode: "E_DEMO",
      errorMeta: {
        operation: "send-code",
      },
      errorType: "Error",
      internalMessage: "route failed unexpectedly",
    });
  });

  it("does not attach optional log details to warning-level client errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      logDetails: () => ({
        errorCode: "E_DEMO",
      }),
    });

    const response = helpers.jsonError(new SyntaxError("bad json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_JSON",
        message: "Invalid JSON.",
      },
    });
    expect(warnSpy).toHaveBeenCalledWith("route failed", {
      errorType: "SyntaxError",
      internalMessage: "route failed unexpectedly",
    });
  });
});
