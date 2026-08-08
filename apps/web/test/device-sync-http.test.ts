import { Prisma } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockDeviceSyncError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    readonly httpStatus: number;
    readonly accountStatus: "reauthorization_required" | "disconnected" | null;
    readonly details: Record<string, unknown> | undefined;

    constructor(options: {
      code: string;
      message: string;
      retryable?: boolean;
      httpStatus?: number;
      accountStatus?: "reauthorization_required" | "disconnected" | null;
      details?: Record<string, unknown>;
    }) {
      super(options.message);
      this.name = "DeviceSyncError";
      this.code = options.code;
      this.retryable = options.retryable ?? false;
      this.httpStatus = options.httpStatus ?? 500;
      this.accountStatus = options.accountStatus ?? null;
      this.details = options.details;
    }
  }

  return {
    DeviceSyncError: MockDeviceSyncError,
    buildPublicDeviceSyncErrorPayload: vi.fn((error: InstanceType<typeof MockDeviceSyncError>) => ({
      error: {
        code: error.code,
        details:
          typeof error.details?.status === "number" ? { status: error.details.status } : undefined,
        message: error.message,
        retryable: error.retryable,
      },
    })),
    deviceSyncError: vi.fn(
      (options: ConstructorParameters<typeof MockDeviceSyncError>[0]) =>
        new MockDeviceSyncError(options),
    ),
    isDeviceSyncError: vi.fn((error: unknown) => error instanceof MockDeviceSyncError),
    normalizeString: vi.fn((value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)),
  };
});

vi.mock("@murphai/device-syncd/errors", () => mocks);
vi.mock("next/server", () => {
  class MockNextResponse extends Response {
    static redirect(url: string, init?: number | ResponseInit) {
      const responseInit =
        typeof init === "number"
          ? { status: init }
          : {
              ...init,
            };

      const headers = new Headers(responseInit?.headers);
      headers.set("location", url);
      return new MockNextResponse(null, {
        ...responseInit,
        status: responseInit?.status ?? 302,
        headers,
      });
    }

    static json(body: unknown, init?: ResponseInit) {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());

      return new MockNextResponse(JSON.stringify(body), {
        ...init,
        headers: {
          "content-type": "application/json",
          ...headers,
        },
      });
    }
  }

  return {
    NextResponse: MockNextResponse,
  };
});

type HttpModule = typeof import("../src/lib/device-sync/http");

let httpModule: HttpModule;

// Mirrors the production @prisma/adapter-pg raw-query lock-timeout shape, as
// encoded by the hosted member billing store fixtures.
function createAdapterPgLockTimeout(
  codeField: "code" | "originalCode",
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Raw query failed. Code: `55P03`.",
    {
      clientVersion: "7.8.0",
      code: "P2010",
      meta: {
        driverAdapterError: {
          cause: {
            [codeField]: "55P03",
            kind: "postgres",
            message: "canceling statement due to lock timeout",
            severity: "ERROR",
          },
          name: "DriverAdapterError",
        },
      },
    },
  );
}

describe("device sync callback redirect helpers", () => {
  beforeAll(async () => {
    httpModule = await import("../src/lib/device-sync/http");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps device-sync domain errors through the shared JSON error helper", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sensitiveBodySnippet =
      "account_id=acct_fake_sensitive_123 access_token=tok_fake_sensitive_456 scope=offline";
    const response = httpModule.jsonError(
      mocks.deviceSyncError({
        code: "ACCOUNT_REQUIRES_REAUTH",
        details: {
          status: 401,
          bodySnippet: sensitiveBodySnippet,
          provider: "oura",
        },
        httpStatus: 409,
        message: "Reconnect the account to continue syncing.",
        retryable: true,
      }),
    );

    expect(response.status).toBe(409);
    const body = await response.text();

    expect(body).not.toContain("acct_fake_sensitive_123");
    expect(body).not.toContain("tok_fake_sensitive_456");
    expect(body).not.toContain("bodySnippet");
    expect(JSON.parse(body)).toEqual({
      error: {
        code: "ACCOUNT_REQUIRES_REAUTH",
        details: { status: 401 },
        message: "Reconnect the account to continue syncing.",
        retryable: true,
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(warnSpy).toHaveBeenCalledWith("Hosted device-sync route failed.", {
      errorCode: "ACCOUNT_REQUIRES_REAUTH",
      errorMessage: "Reconnect the account to continue syncing.",
      errorResponseCode: "ACCOUNT_REQUIRES_REAUTH",
      errorResponseDetails: {
        status: 401,
      },
      errorResponseRetryable: true,
      errorResponseStatus: 409,
      errorType: "MockDeviceSyncError",
      internalMessage: "Hosted device-sync route failed unexpectedly.",
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("acct_fake_sensitive_123");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("tok_fake_sensitive_456");
  });

  it("keeps retryable 5xx device-sync domain errors at warning log level", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = httpModule.jsonError(
      mocks.deviceSyncError({
        code: "WEBHOOK_TRACE_IN_PROGRESS",
        httpStatus: 503,
        message: "Webhook delivery is already being processed. Retry later.",
        retryable: true,
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WEBHOOK_TRACE_IN_PROGRESS",
        message: "Webhook delivery is already being processed. Retry later.",
        retryable: true,
      },
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("Hosted device-sync route failed.", {
      errorCode: "WEBHOOK_TRACE_IN_PROGRESS",
      errorMessage: "Webhook delivery is already being processed. Retry later.",
      errorResponseCode: "WEBHOOK_TRACE_IN_PROGRESS",
      errorResponseRetryable: true,
      errorResponseStatus: 503,
      errorType: "MockDeviceSyncError",
      internalMessage: "Hosted device-sync route failed unexpectedly.",
    });
  });

  it("maps expired Prisma transaction faults to a retryable 503", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const expiredTransactionError = Object.assign(
      new Error("A query cannot be executed on an expired transaction."),
      {
        code: "P2028",
        name: "PrismaClientKnownRequestError",
      },
    );

    const response = httpModule.jsonError(expiredTransactionError);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "STORE_CONTENTION",
        message: "The device-sync store timed out under contention. Retry later.",
        retryable: true,
      },
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it.each(["originalCode", "code"] as const)(
    "maps adapter-pg P2010 lock timeouts from the nested cause %s to the retryable 503",
    async (codeField) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const lockTimeoutError = createAdapterPgLockTimeout(codeField);

      const response = httpModule.jsonError(lockTimeoutError);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "STORE_CONTENTION",
          message: "The device-sync store timed out under contention. Retry later.",
          retryable: true,
        },
      });
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );

  it("keeps unrelated Prisma errors on the internal 500 path", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const uniqueViolation = Object.assign(
      new Error("Unique constraint failed."),
      {
        code: "P2002",
        name: "PrismaClientKnownRequestError",
      },
    );

    const response = httpModule.jsonError(uniqueViolation);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("maps shared malformed request errors to the existing 400 JSON shapes", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalidJsonError = new SyntaxError(
      "Unexpected token ] in JSON at position 3 access_token=tok_fake_sensitive_123",
    );
    const invalidRequestError = new RangeError(
      "Expected a shorter callback state value. request_body={\"apiKey\":\"secret-value\"}",
    );
    const invalidJsonResponse = httpModule.jsonError(invalidJsonError);
    const invalidRequestResponse = httpModule.jsonError(invalidRequestError);

    expect(invalidJsonResponse.status).toBe(400);
    await expect(invalidJsonResponse.json()).resolves.toEqual({
      error: {
        code: "INVALID_JSON",
        message: "Invalid JSON.",
      },
    });

    expect(invalidRequestResponse.status).toBe(400);
    await expect(invalidRequestResponse.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request.",
      },
    });

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenNthCalledWith(1, "Hosted device-sync route failed.", {
      errorMessage: "Unexpected token ] in JSON at position 3 access_token=<redacted-secret>",
      errorResponseCode: "INVALID_JSON",
      errorType: "SyntaxError",
      internalMessage: "Hosted device-sync route failed unexpectedly.",
    });
    expect(warnSpy).toHaveBeenNthCalledWith(2, "Hosted device-sync route failed.", {
      errorMessage:
        "Expected a shorter callback state value. request_body={\"apiKey\":\"<redacted-secret>\"}",
      errorResponseCode: "INVALID_REQUEST",
      errorType: "RangeError",
      internalMessage: "Hosted device-sync route failed unexpectedly.",
    });
    expect(warnSpy.mock.calls[0]?.[1]).not.toBe(invalidJsonError);
    expect(warnSpy.mock.calls[1]?.[1]).not.toBe(invalidRequestError);
  });

  it("redacts raw thrown values from internal error logs", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const internalError = {
      name: "WebhookFailure",
      requestBody: {
        accessToken: "tok_fake_sensitive_456",
      },
      tokenBundle: {
        refreshToken: "refresh_fake_sensitive_789",
      },
    };

    const response = httpModule.jsonError(internalError);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith("Hosted device-sync route failed.", {
      errorResponseCode: "INTERNAL_ERROR",
      errorType: "object",
      internalMessage: "Hosted device-sync route failed unexpectedly.",
    });
    expect(errorSpy.mock.calls[0]?.[1]).not.toBe(internalError);
  });

  it("logs built-in error buckets instead of caller-controlled error names", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const internalError = new Error("request_body={\"token\":\"secret-value\"}");

    internalError.name = "access_token=tok_fake_sensitive_999";

    const response = httpModule.jsonError(internalError);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith("Hosted device-sync route failed.", {
      errorMessage: "request_body={\"token\":\"<redacted-secret>\"}",
      errorResponseCode: "INTERNAL_ERROR",
      errorType: "Error",
      internalMessage: "Hosted device-sync route failed unexpectedly.",
    });
    expect(errorSpy.mock.calls[0]?.[1]).not.toBe(internalError);
  });

  it("passes through successful wrapped responses", async () => {
    const handler = httpModule.withJsonError(async (value: string) =>
      new Response(`ok:${value}`, {
        status: 201,
      }),
    );

    const response = await handler("demo");

    expect(response.status).toBe(201);
    await expect(response.text()).resolves.toBe("ok:demo");
  });

  it("marks device-sync json success responses as no-store", async () => {
    const response = httpModule.jsonOk({ ok: true });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("resolves and decodes route params through the shared helper", async () => {
    await expect(
      httpModule.resolveDecodedRouteParam(
        Promise.resolve({
          provider: "oura%2Flegacy",
        }),
        "provider",
      ),
    ).resolves.toBe("oura/legacy");
  });

  it("maps malformed route param encodings to a stable type error", async () => {
    await expect(
      httpModule.resolveDecodedRouteParam(
        Promise.resolve({
          provider: "%E0%A4%A",
        }),
        "provider",
      ),
    ).rejects.toThrow("Route parameter provider contained an invalid encoding.");
  });

  it("wraps thrown handler errors with the hosted device-sync JSON mapper", async () => {
    const sensitiveBodySnippet =
      "account_id=acct_fake_sensitive_789 access_token=tok_fake_sensitive_987 scope=recovery";
    const handler = httpModule.withJsonError(async () => {
      throw mocks.deviceSyncError({
        code: "ACCOUNT_REQUIRES_REAUTH",
        details: {
          status: 401,
          bodySnippet: sensitiveBodySnippet,
          provider: "oura",
        },
        httpStatus: 409,
        message: "Reconnect the account to continue syncing.",
        retryable: true,
      });
    });

    const response = await handler();

    expect(response.status).toBe(409);
    const body = await response.text();

    expect(body).not.toContain("acct_fake_sensitive_789");
    expect(body).not.toContain("tok_fake_sensitive_987");
    expect(body).not.toContain("bodySnippet");
    expect(JSON.parse(body)).toEqual({
      error: {
        code: "ACCOUNT_REQUIRES_REAUTH",
        details: { status: 401 },
        message: "Reconnect the account to continue syncing.",
        retryable: true,
      },
    });
  });

  it("renders callback html from plain-text title and body", async () => {
    const response = httpModule.callbackHtml(
      `Connected <demo>`,
      `Connection details: <ok>&"'`,
      201,
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");

    const html = await response.text();

    expect(html).toContain("<title>Connected &lt;demo&gt;</title>");
    expect(html).toContain("<h1>Connected &lt;demo&gt;</h1>");
    expect(html).toContain("<p>Connection details: &lt;ok&gt;&amp;&quot;&#39;</p>");
    expect(html).not.toContain("Connection details: <ok>&\"'");
    expect(html).not.toContain("Connection details: &amp;lt;ok&amp;gt;");
  });

  it("adds connected callback params while preserving existing query state", () => {
    const response = httpModule.providerCallbackRedirect({
      returnTo:
        "https://app.example.test/settings/devices?tab=wearables&deviceSyncStatus=error&deviceSyncProvider=legacy&deviceSyncError=stale&deviceSyncErrorMessage=leak",
      provider: "demo",
    });

    expect(response).not.toBeNull();

    const location = response?.headers.get("location");

    expect(location).toBeTruthy();
    expect(response?.headers.get("Cache-Control")).toBe("no-store");

    const destination = new URL(location!);
    expect(destination.origin).toBe("https://app.example.test");
    expect(destination.pathname).toBe("/settings/devices");
    expect(destination.searchParams.get("tab")).toBe("wearables");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("connected");
    expect(destination.searchParams.get("deviceSyncProvider")).toBe("demo");
    expect(destination.searchParams.get("deviceSyncConnectionId")).toBeNull();
    expect(destination.searchParams.get("deviceSyncError")).toBeNull();
    expect(destination.searchParams.get("deviceSyncErrorMessage")).toBeNull();
  });

  it("keeps raw callback error text out of redirect query params", () => {
    const response = httpModule.errorToCallbackRedirect({
      returnTo:
        "https://app.example.test/settings/devices?tab=wearables&deviceSyncStatus=connected&deviceSyncProvider=demo&deviceSyncConnectionId=conn_123&deviceSyncErrorMessage=leak",
      provider: "demo",
      error: mocks.deviceSyncError({
        code: "OAUTH_CALLBACK_REJECTED",
        message: "The user canceled the OAuth flow.",
        retryable: false,
        httpStatus: 400,
      }),
    });

    expect(response).not.toBeNull();

    const location = response?.headers.get("location");

    expect(location).toBeTruthy();
    expect(response?.headers.get("Cache-Control")).toBe("no-store");

    const destination = new URL(location!);
    expect(destination.origin).toBe("https://app.example.test");
    expect(destination.pathname).toBe("/settings/devices");
    expect(destination.searchParams.get("tab")).toBe("wearables");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("error");
    expect(destination.searchParams.get("deviceSyncProvider")).toBe("demo");
    expect(destination.searchParams.get("deviceSyncConnectionId")).toBeNull();
    expect(destination.searchParams.get("deviceSyncError")).toBe("OAUTH_CALLBACK_REJECTED");
    expect(destination.searchParams.get("deviceSyncErrorMessage")).toBeNull();
  });

  it("scrubs stale callback error text already present in returnTo", () => {
    const response = httpModule.errorToCallbackRedirect({
      returnTo:
        "https://app.example.test/settings/devices?tab=wearables&deviceSyncErrorMessage=leak",
      provider: "demo",
      error: mocks.deviceSyncError({
        code: "OAUTH_CALLBACK_REJECTED",
        message: "The user canceled the OAuth flow.",
        retryable: false,
        httpStatus: 400,
      }),
    });

    expect(response).not.toBeNull();

    const location = response?.headers.get("location");

    expect(location).toBeTruthy();

    const destination = new URL(location!);
    expect(destination.searchParams.get("tab")).toBe("wearables");
    expect(destination.searchParams.get("deviceSyncError")).toBe("OAUTH_CALLBACK_REJECTED");
    expect(destination.searchParams.get("deviceSyncErrorMessage")).toBeNull();
  });

  it("rejects malformed or non-http callback redirect destinations", () => {
    expect(
      httpModule.providerCallbackRedirect({
        returnTo: "javascript:alert(1)",
        provider: "demo",
      }),
    ).toBeNull();

    expect(
      httpModule.errorToCallbackRedirect({
        returnTo: "https://app.example.test:bad/settings",
        provider: "demo",
        error: mocks.deviceSyncError({
          code: "OAUTH_CALLBACK_REJECTED",
          message: "The user canceled the OAuth flow.",
          retryable: false,
          httpStatus: 400,
        }),
      }),
    ).toBeNull();
  });
});
