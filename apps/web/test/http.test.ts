import { ContractValidationError } from "@murphai/contracts/validation-error";
import { createCloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";
import { parseInput, RequestInputError, RequestBodyTooLargeError } from "@murphai/hosted-execution/request-input";
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

  it("maps malformed Worker JSON through the real control client to 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("not JSON", { status: 200 }));
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "synthetic-token",
    });
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
    });
    const handler = helpers.withJsonError(async () => {
      return helpers.jsonOk(await client.getRunnerStatus("member-synthetic"));
    });

    const response = await handler();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal error." },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["readJsonObject", "readOptionalJsonObject"] as const)(
    "%s rejects malformed JSON explicitly and preserves stream failures",
    async (reader) => {
      const request = () => new Request("https://example.test/body", { method: "POST", body: "{" });
      await expect(httpModule[reader](request())).rejects.toBeInstanceOf(httpModule.InvalidJsonBodyError);
      const streamFailure = new SyntaxError("stream failure");
      const broken = request();
      Object.defineProperty(broken, "body", { value: new ReadableStream({
        start(controller) { controller.error(streamFailure); },
      }) });
      await expect(httpModule[reader](broken)).rejects.toBe(streamFailure);
    },
  );

  it("retains object-shape rejection and optional whitespace semantics", async () => {
    const request = (body: string) => new Request("https://example.test/body", { method: "POST", body });
    await expect(httpModule.readOptionalJsonObject(request("  \n"))).resolves.toEqual({});
    await expect(httpModule.readJsonObject(request("[]"))).rejects.toBeInstanceOf(httpModule.InvalidJsonObjectBodyError);
    expect(httpModule.parseRequestJson("[1]")).toEqual([1]);
  });

  it("preserves path-rejection identity without hiding parameter access bugs", async () => {
    await expect(httpModule.resolveDecodedRouteParam({ key: "%" }, "key"))
      .rejects.toBeInstanceOf(httpModule.InvalidRouteParamEncodingError);
    const fault = new TypeError("parameter access failed");
    const params = { get key(): string { throw fault; } };
    await expect(httpModule.resolveDecodedRouteParam(params, "key")).rejects.toBe(fault);
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

  it.each(["ios", "android"])("adds validated %s client info to JSON route error logs", async (platform) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const helpers = httpModule.createJsonRouteHelpers({ internalMessage: "route failed unexpectedly", logMessage: "route failed" });
    const handler = helpers.withJsonError<[Request]>(async () => { throw new Error("synthetic failure"); });
    const response = await handler(new Request("https://example.test/api/demo", { headers: {
      "X-Murph-Client-Platform": platform, "X-Murph-Client-Version": "1.1.22-dev", "X-Murph-Client-Build": "109",
      "X-Murph-Client-OS-Version": "18.1.0", "X-Murph-Client-Device-Model": "Example Model",
      "X-Murph-Member-Id": "private-member", authorization: "Bearer private-token",
    } }));
    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith("route failed", expect.objectContaining({
      requestMethod: "GET", clientPlatform: platform, clientVersion: "1.1.22-dev", clientBuild: "109",
      clientOsVersion: "18.1.0", clientDeviceModel: "Example Model",
    }));
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("private-member");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("private-token");
    expect(JSON.stringify(await response.json())).not.toContain("clientPlatform");
  });

  it.each([false, true])("omits client log fields when the core header set is absent or invalid (%s)", async (invalid) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const helpers = httpModule.createJsonRouteHelpers({ internalMessage: "route failed unexpectedly", logMessage: "route failed" });
    const handler = helpers.withJsonError<[Request]>(async () => { throw new Error("synthetic failure"); });
    const headers = new Headers();
    if (invalid) {
      headers.set("X-Murph-Client-Platform", "ios"); headers.set("X-Murph-Client-Version", "1.1.22");
      headers.set("X-Murph-Client-Build", "invalid-build");
    }
    expect((await handler(new Request("https://example.test/api/demo", { headers }))).status).toBe(500);
    const details = errorSpy.mock.calls[0]?.[1];
    for (const field of ["clientPlatform", "clientVersion", "clientBuild", "clientOsVersion", "clientDeviceModel"]) {
      expect(details).not.toHaveProperty(field);
    }
    expect(JSON.stringify(details)).not.toContain("invalid-build");
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

  it.each([
    "durable_thread_container_mismatch",
    "durable_target_missing",
    "requested_target_missing",
    "member_routing_missing",
    "target_not_owned",
    "route_projection_mismatch",
    "route_projection_chat_missing",
    "route_projection_chat_lookup_key_missing",
    "route_projection_chat_lookup_key_mismatch",
    "route_projection_sender_phone_missing_or_invalid",
    "route_projection_sender_lookup_key_mismatch",
    "pending_recipient_invalid",
    "member_identity_missing",
    "member_recipient_invalid",
  ] as const)("keeps Linq reason %s private in the existing HTTP warning", async (reason) => {
    const { hostedOnboardingError } = await import("../src/lib/hosted-onboarding/errors");
    const { withJsonError } = await import("../src/lib/hosted-onboarding/http");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH";
    const message = "Linq egress target does not match the runtime user's Linq route.";
    const handler = withJsonError<[Request]>(async () => {
      throw hostedOnboardingError({
        code, message, httpStatus: 403, retryable: false,
        linqRouteAuthorityMismatchReason: reason,
      });
    });

    const response = await handler(new Request("https://internal.example.test/engagement", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "no-store", "content-type": "application/json",
    });
    await expect(response.text()).resolves.toBe(JSON.stringify({ error: { code, message, retryable: false } }));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("Hosted onboarding route failed.", {
      errorType: "HostedOnboardingError", errorMessage: message, errorCode: code,
      internalMessage: "Hosted onboarding route failed unexpectedly.", requestMethod: "POST",
      errorResponseCode: code, errorResponseStatus: 403, errorResponseRetryable: false,
      linqRouteAuthorityMismatchReason: reason,
    });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("rejects foreign, inherited, coercible and getter Linq diagnostic values", async () => {
    const { hostedOnboardingError, getHostedLinqRouteAuthorityMismatchReasonForLog: reasonForLog } =
      await import("../src/lib/hosted-onboarding/errors");
    const input = {
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      message: "Linq egress target does not match the runtime user's Linq route.",
      httpStatus: 403,
      linqRouteAuthorityMismatchReason: "route_projection_chat_missing" as const,
    };
    const inherited = Object.create(hostedOnboardingError(input));
    Object.defineProperties(inherited, {
      code: { value: input.code }, message: { value: input.message },
    });
    for (const error of [
      null, { ...input }, Object.assign(new Error(input.message), input), inherited,
      hostedOnboardingError({ ...input, code: "OTHER_OWNER" }),
      hostedOnboardingError({ ...input, message: "Linq egress route authority does not match the requested thread." }),
    ]) expect(reasonForLog(error)).toBeUndefined();

    const coerce = vi.fn(() => input.linqRouteAuthorityMismatchReason);
    for (const value of ["foreign-reason", null, 42, { toString: coerce }]) {
      const error = hostedOnboardingError(input);
      Object.defineProperty(error, "linqRouteAuthorityMismatchReason", { value });
      expect(reasonForLog(error)).toBeUndefined();
    }
    expect(coerce).not.toHaveBeenCalled();
    for (const key of ["code", "message", "linqRouteAuthorityMismatchReason"] as const) {
      const error = hostedOnboardingError(input);
      const getter = vi.fn(() => input[key]);
      Object.defineProperty(error, key, { get: getter });
      expect(reasonForLog(error)).toBeUndefined();
      expect(getter).not.toHaveBeenCalled();
    }
  });

  it.each(["foreign-reason", "getter"] as const)("omits a %s Linq reason from HTTP logs without changing the response", async (kind) => {
    const { hostedOnboardingError } = await import("../src/lib/hosted-onboarding/errors");
    const { withJsonError } = await import("../src/lib/hosted-onboarding/http");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH";
    const message = "Linq egress target does not match the runtime user's Linq route.";
    const error = hostedOnboardingError({ code, message, httpStatus: 403, retryable: false });
    const getter = vi.fn(() => "route_projection_chat_missing");
    Object.defineProperty(error, "linqRouteAuthorityMismatchReason", kind === "getter"
      ? { get: getter }
      : { value: "foreign-reason" });
    const handler = withJsonError<[Request]>(async () => { throw error; });

    const response = await handler(new Request("https://internal.example.test/engagement", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.text()).resolves.toBe(JSON.stringify({ error: { code, message, retryable: false } }));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("Hosted onboarding route failed.", {
      errorType: "HostedOnboardingError", errorMessage: message, errorCode: code,
      internalMessage: "Hosted onboarding route failed unexpectedly.", requestMethod: "POST",
      errorResponseCode: code, errorResponseStatus: 403, errorResponseRetryable: false,
    });
    expect(getter).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
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

    const response = helpers.jsonError(new httpModule.InvalidJsonBodyError("bad json"));

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
      errorType: "InvalidJsonBodyError",
      internalMessage: "route failed unexpectedly",
    });
  });

  it("maps an outbound fetch failure to a 500 at error level", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = httpModule.createJsonErrorResponse(new TypeError("fetch failed"), {
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal error." },
    });
    expect(errorSpy).toHaveBeenCalledWith("route failed", expect.objectContaining({
      errorResponseCode: "INTERNAL_ERROR", errorType: "TypeError",
    }));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("keeps domain matchers ahead of the server error fallback", async () => {
    const error = new TypeError("fetch failed");
    const mapping = { status: 409, error: { code: "DOMAIN_CONFLICT", message: "Try the domain recovery." }, log: null };
    const response = httpModule.createJsonErrorResponse(error, {
      internalMessage: "route failed unexpectedly", logMessage: "route failed",
      matchers: [value => value === error ? mapping : null],
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: mapping.error });
  });

  it("maps explicit input rejection to the existing response and warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const logDetails = vi.fn();
    let rejection: unknown;
    try {
      parseInput(null, () => { throw new ContractValidationError("Invalid shape."); });
    } catch (error) {
      rejection = error;
    }
    const response = httpModule.createJsonErrorResponse(rejection, {
      defaultHeaders: { "Cache-Control": "no-store" },
      headers: { "x-test": "present" },
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      logDetails,
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("x-test")).toBe("present");
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_REQUEST", message: "Invalid request." },
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith("route failed", {
      errorType: "RequestInputError",
      errorMessage: "Invalid shape.",
      errorCauseType: "ContractValidationError",
      errorCauseMessage: "Invalid shape.",
      internalMessage: "route failed unexpectedly",
      errorResponseCode: "INVALID_REQUEST",
    });
    expect(errorLog).not.toHaveBeenCalled();
    expect(logDetails).not.toHaveBeenCalled();
  });

  it.each([
    [new ContractValidationError("Invalid shape."), "ContractValidationError"],
    [new TypeError("Invalid shape."), "TypeError"],
    [new RangeError("Invalid shape."), "RangeError"],
    [new URIError("Invalid shape."), "URIError"],
    [new SyntaxError("Invalid shape."), "SyntaxError"],
  ] as const)("treats an untranslated %s as a server failure", async (error, errorType) => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const warnLogDetails = vi.fn();
    const response = httpModule.createJsonErrorResponse(error, {
      defaultHeaders: { "Cache-Control": "no-store" },
      headers: { "x-test": "present" },
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      warnLogDetails,
    });
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("x-test")).toBe("present");
    await expect(response.json()).resolves.toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal error." },
    });
    expect(errorLog).toHaveBeenCalledExactlyOnceWith("route failed", {
      errorType,
      errorMessage: "Invalid shape.",
      internalMessage: "route failed unexpectedly",
      errorResponseCode: "INTERNAL_ERROR",
    });
    expect(warn).not.toHaveBeenCalled();
    expect(warnLogDetails).not.toHaveBeenCalled();
  });

  it("includes optional warning details only for explicit request rejection", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const helpers = httpModule.createJsonRouteHelpers({
      internalMessage: "route failed unexpectedly",
      logMessage: "route failed",
      warnLogDetails: () => ({ errorHint: "request body must be an object" }),
    });
    expect(helpers.jsonError(new RequestInputError("body shape wrong")).status).toBe(400);
    expect(warn).toHaveBeenCalledWith("route failed", expect.objectContaining({
      errorHint: "request body must be an object",
      errorResponseCode: "INVALID_REQUEST",
    }));
  });

  it("summarizes unexpected errors with sanitized shared fields before route-specific extras", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
    expect(errorSpy).toHaveBeenCalledWith("route failed", {
      errorCauseMessage: "Bearer <redacted-secret>",
      errorCauseType: "Error",
      errorCode: "E_STATE_BAD",
      errorMessage:
        "Invalid callback state for <redacted-url> from <redacted-path> while emailing <redacted-email>",
      errorResponseCode: "INTERNAL_ERROR",
      errorStatusCode: 400,
      errorType: "TypeError",
      internalMessage: "route failed unexpectedly",
    });
  });

  it("redacts national-format phone numbers and schemeless URLs while keeping the surrounding wording", () => {
    // These are the shapes external text actually uses. Matching only `+`
    // phones and `https://` URLs left them readable in persisted diagnostics
    // and operational alert emails.
    expect(httpModule.sanitizeJsonLogString("carrier filtered 415-555-2671 for spam"))
      .toBe("carrier filtered <redacted-phone> for spam");
    expect(httpModule.sanitizeJsonLogString("blocked (415) 555-2671 at gateway"))
      .toBe("blocked <redacted-phone> at gateway");
    expect(httpModule.sanitizeJsonLogString("415.555.2671 unreachable"))
      .toBe("<redacted-phone> unreachable");
    expect(httpModule.sanitizeJsonLogString("415 555 2671 unreachable"))
      .toBe("<redacted-phone> unreachable");
    expect(httpModule.sanitizeJsonLogString("see www.example.test/help for details"))
      .toBe("see <redacted-url> for details");
  });

  it("redacts a whole email address whose domain is www-prefixed", () => {
    // Ordering regression: if the schemeless-URL rule runs first it consumes the
    // domain and strands the local part, which is usually the identifying half.
    for (const address of [
      "alice@www.example.test",
      "alice+tag@www.example.test",
      "alice@mail.www.example.test",
    ]) {
      const sanitized = httpModule.sanitizeJsonLogString(`provider rejected ${address}`);
      expect(sanitized).toBe("provider rejected <redacted-email>");
      expect(sanitized).not.toContain("alice");
      expect(sanitized).not.toContain("example.test");
    }
  });

  it("keeps non-contact numerics readable so diagnostics stay useful", () => {
    // Over-redaction would defeat the purpose of keeping provider reasons.
    for (const value of [
      "failed at 2026-08-04 with code 30007",
      "retry after 1.2.3 seconds",
      "carrier filtered the message",
      "spam score 0.87 exceeded threshold",
      "error code 4001 from gateway",
    ]) {
      expect(httpModule.sanitizeJsonLogString(value)).toBe(value);
    }
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
