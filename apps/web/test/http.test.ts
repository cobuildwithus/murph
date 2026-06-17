import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

  afterEach(() => {
    vi.restoreAllMocks();
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
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expect(warnSpy).toHaveBeenCalledWith("route failed", {
      errorResponseCode: "KNOWN",
      errorResponseStatus: 409,
      errorType: "string",
      errorValue: "known",
      internalMessage: "route failed unexpectedly",
    });
  });

  it("reuses the same domain mapping when wrapping handlers", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expect(warnSpy).toHaveBeenCalledWith("route failed", {
      errorMessage: "known",
      errorResponseCode: "KNOWN",
      errorResponseStatus: 422,
      errorType: "Error",
      internalMessage: "route failed unexpectedly",
    });
  });

  it("logs wrapped route context for mapped failures without logging bodies or headers", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      matchers: [
        (error) => error === "known"
          ? {
              error: {
                code: "KNOWN",
                message: "Known failure.",
              },
              status: 400,
            }
          : null,
      ],
    });
    const handler = helpers.withJsonError(async (request: Request) => {
      void request;
      return Promise.reject("known");
    });

    const response = await handler(new Request("https://join.example.test/api/demo", {
      body: JSON.stringify({
        token: "secret-value",
      }),
      headers: {
        authorization: "Bearer secret-value",
      },
      method: "POST",
    }));

    expect(response.status).toBe(400);
    expect(warnSpy).toHaveBeenCalledWith("route failed", {
      errorResponseCode: "KNOWN",
      errorResponseStatus: 400,
      errorType: "string",
      errorValue: "known",
      internalMessage: "route failed unexpectedly",
      requestMethod: "POST",
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secret-value");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("/api/demo");
  });

  it("can suppress logs for explicitly quiet mapped errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      matchers: [
        (error) => error === "quiet"
          ? {
              error: {
                code: "QUIET",
                message: "Quiet failure.",
              },
              log: null,
              status: 404,
            }
          : null,
      ],
    });

    const response = helpers.jsonError("quiet");

    expect(response.status).toBe(404);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("can opt matched domain errors into safe classified logs", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const domainError = new Error(
      "Domain failed from /tmp/demo-app with apiKey=fake-token",
    );
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      matchers: [
        (error) => error === domainError
          ? {
              error: {
                code: "DOMAIN_BACKEND_DOWN",
                message: "Domain backend is unavailable.",
                retryable: true,
              },
              log: {
                details: {
                  errorClass: "backend_setup",
                  errorDomain: "demo",
                },
              },
              status: 503,
            }
          : null,
      ],
    });

    const response = helpers.jsonError(domainError);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "DOMAIN_BACKEND_DOWN",
        message: "Domain backend is unavailable.",
        retryable: true,
      },
    });
    expect(errorSpy).toHaveBeenCalledWith("route failed", {
      errorClass: "backend_setup",
      errorDomain: "demo",
      errorMessage: "Domain failed from <redacted-path> with apiKey=<redacted-secret>",
      errorResponseCode: "DOMAIN_BACKEND_DOWN",
      errorResponseRetryable: true,
      errorResponseStatus: 503,
      errorType: "Error",
      internalMessage: "route failed unexpectedly",
    });
  });

  it("logs sanitized safe mapped response details for domain errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      matchers: [
        (error) => error === "known"
          ? httpModule.mapDomainJsonError({
              code: "BILLING_DOWN",
              details: {
                code: "resource_missing",
                inviteCode: "invite-code",
                operationName: "subscription.update.plan-items",
                requestId: "req_unlogged",
                requestIdPresent: true,
                stripeParam: "items[0][price]",
                statusCode: 400,
                type: "StripeInvalidRequestError from https://billing.example.test/raw",
              },
              httpStatus: 502,
              message: "Billing is unavailable.",
              retryable: true,
            })
          : null,
      ],
    });

    const response = helpers.jsonError("known");

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "BILLING_DOWN",
        details: {
          code: "resource_missing",
          inviteCode: "invite-code",
          operationName: "subscription.update.plan-items",
          requestId: "req_unlogged",
          requestIdPresent: true,
          stripeParam: "items[0][price]",
          statusCode: 400,
          type: "StripeInvalidRequestError from https://billing.example.test/raw",
        },
        message: "Billing is unavailable.",
        retryable: true,
      },
    });
    expect(errorSpy).toHaveBeenCalledWith("route failed", {
      errorResponseCode: "BILLING_DOWN",
      errorResponseDetails: {
        code: "resource_missing",
        operationName: "subscription.update.plan-items",
        requestIdPresent: true,
        stripeParam: "items[0][price]",
        statusCode: 400,
        type: "StripeInvalidRequestError from <redacted-url>",
      },
      errorResponseRetryable: true,
      errorResponseStatus: 502,
      errorType: "string",
      errorValue: "known",
      internalMessage: "route failed unexpectedly",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("invite-code");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("req_unlogged");
  });

  it("lets explicit mapped log details replace generic response detail logging", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      matchers: [
        (error) => error === "known"
          ? {
              ...httpModule.mapDomainJsonError({
                code: "BILLING_DOWN",
                details: {
                  code: "resource_missing",
                  operationName: "subscription.update.plan-items",
                  stripeParam: "items[0][price]",
                },
                httpStatus: 502,
                message: "Billing is unavailable.",
                retryable: true,
              }),
              log: {
                details: {
                  errorDetails: {
                    operationName: "subscription.update.plan-items",
                  },
                },
              },
            }
          : null,
      ],
    });

    const response = helpers.jsonError("known");

    expect(response.status).toBe(502);
    expect(errorSpy).toHaveBeenCalledWith("route failed", {
      errorDetails: {
        operationName: "subscription.update.plan-items",
      },
      errorResponseCode: "BILLING_DOWN",
      errorResponseRetryable: true,
      errorResponseStatus: 502,
      errorType: "string",
      errorValue: "known",
      internalMessage: "route failed unexpectedly",
    });
    expect(errorSpy.mock.calls[0]?.[1]).not.toHaveProperty("errorResponseDetails");
  });

  it("lets explicit errorResponseDetails replace generic response detail logging", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      matchers: [
        (error) => error === "known"
          ? {
              ...httpModule.mapDomainJsonError({
                code: "BILLING_DOWN",
                details: {
                  code: "resource_missing",
                  operationName: "subscription.update.plan-items",
                },
                httpStatus: 502,
                message: "Billing is unavailable.",
                retryable: true,
              }),
              log: {
                details: {
                  errorResponseDetails: {
                    operationName: "subscription.update.plan-items",
                  },
                },
              },
            }
          : null,
      ],
    });

    const response = helpers.jsonError("known");

    expect(response.status).toBe(502);
    expect(errorSpy).toHaveBeenCalledWith("route failed", {
      errorResponseCode: "BILLING_DOWN",
      errorResponseRetryable: true,
      errorResponseStatus: 502,
      errorResponseDetails: {
        operationName: "subscription.update.plan-items",
      },
      errorType: "string",
      errorValue: "known",
      internalMessage: "route failed unexpectedly",
    });
    expect(errorSpy.mock.calls[0]?.[1]).not.toHaveProperty("errorDetails");
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
      errorMessage: "boom",
      errorMeta: {
        operation: "send-code",
      },
      errorResponseCode: "INTERNAL_ERROR",
      errorType: "Error",
      internalMessage: "route failed unexpectedly",
    });
  });

  it("includes the shared sanitized summary for warning-level client errors without reusing error-only details", async () => {
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
      errorMessage: "bad json",
      errorResponseCode: "INVALID_JSON",
      errorType: "SyntaxError",
      internalMessage: "route failed unexpectedly",
    });
  });

  it("can opt into warning-level log details without changing the response", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      warnLogDetails: (error) =>
        error instanceof TypeError
          ? {
              errorHint: "request body must be an object",
            }
          : null,
    });

    const response = helpers.jsonError(new TypeError("body shape wrong"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request.",
      },
    });
    expect(warnSpy).toHaveBeenCalledWith("route failed", {
      errorHint: "request body must be an object",
      errorMessage: "body shape wrong",
      errorResponseCode: "INVALID_REQUEST",
      errorType: "TypeError",
      internalMessage: "route failed unexpectedly",
    });
  });

  it("summarizes unexpected errors with sanitized shared fields before route-specific extras", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
    });
    const error = new TypeError(
      "Invalid callback state for https://example.test/callback?token=secret from /Users/test/app while emailing operator@example.test",
    );

    Reflect.set(error, "code", "E_STATE_BAD");
    Reflect.set(error, "statusCode", 400);
    error.cause = new Error("Bearer sk_test_123");

    const response = helpers.jsonError(error);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request.",
      },
    });
    expect(warnSpy).toHaveBeenCalledWith("route failed", {
      errorCauseMessage: "Bearer <redacted-secret>",
      errorCauseType: "Error",
      errorCode: "E_STATE_BAD",
      errorMessage:
        "Invalid callback state for <redacted-url> from <redacted-path> while emailing <redacted-email>",
      errorResponseCode: "INVALID_REQUEST",
      errorStatusCode: 400,
      errorType: "TypeError",
      internalMessage: "route failed unexpectedly",
    });
  });

  it("redacts complete authorization and cookie header values from log strings", () => {
    expect(httpModule.sanitizeJsonLogString("Authorization: Bearer auth-fixture-token, status=401"))
      .toBe("Authorization: <redacted-secret>");
    expect(httpModule.sanitizeJsonLogString("Proxy-Authorization: Custom credential=auth-fixture-token, status=407"))
      .toBe("Proxy-Authorization: <redacted-secret>");
    expect(httpModule.sanitizeJsonLogString("Cookie: sid=cookie-fixture-value; theme=dark, request failed"))
      .toBe("Cookie: <redacted-secret>");
    expect(httpModule.sanitizeJsonLogString("Set-Cookie: sid=cookie-fixture-value; Path=/; HttpOnly, response failed"))
      .toBe("Set-Cookie: <redacted-secret>");
    expect(httpModule.sanitizeJsonLogString("authorization=Bearer auth-fixture-token"))
      .toBe("authorization=<redacted-secret>");
    expect(httpModule.sanitizeJsonLogString("cookie=sid=cookie-fixture-value; theme=dark"))
      .toBe("cookie=<redacted-secret>");
    expect(httpModule.sanitizeJsonLogString("set-cookie=sid=cookie-fixture-value; Path=/; HttpOnly"))
      .toBe("set-cookie=<redacted-secret>");
    expect(httpModule.sanitizeJsonLogString(
      "Authorization: Digest username=\"user\", response=\"auth-fixture-token\", status=401",
    )).toBe("Authorization: <redacted-secret>");
    expect(httpModule.sanitizeJsonLogString(
      "Set-Cookie: sid=cookie-fixture-value; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/, refresh=other-cookie-value",
    )).toBe("Set-Cookie: <redacted-secret>");
    expect(httpModule.sanitizeJsonLogString("Set-Cookie: [\"sid=cookie-fixture-value; Path=/; HttpOnly\"], response failed"))
      .toBe("Set-Cookie: <redacted-secret>, response failed");
    expect(httpModule.sanitizeJsonLogString("headers={\"set-cookie\":[\"sid=cookie-fixture-value; Path=/; HttpOnly\"]} response failed"))
      .toBe("headers={\"set-cookie\":<redacted-secret>} response failed");
    expect(httpModule.sanitizeJsonLogString("Cookie: sid=\"cookie-fixture-value\", request failed"))
      .toBe("Cookie: <redacted-secret>");
    expect(httpModule.sanitizeJsonLogString("{\"authorization\":\"Bearer auth-fixture-token\",\"status\":401}"))
      .toBe("{\"authorization\":<redacted-secret>,\"status\":401}");
  });
});
