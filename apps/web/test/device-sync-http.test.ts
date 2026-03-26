import { beforeAll, describe, expect, it, vi } from "vitest";

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
    deviceSyncError: vi.fn(
      (options: ConstructorParameters<typeof MockDeviceSyncError>[0]) =>
        new MockDeviceSyncError(options),
    ),
    isDeviceSyncError: vi.fn((error: unknown) => error instanceof MockDeviceSyncError),
  };
});

vi.mock("@healthybob/device-syncd", () => mocks);
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

type HttpModule = typeof import("../src/lib/device-sync/http");

let httpModule: HttpModule;

describe("device sync callback redirect helpers", () => {
  beforeAll(async () => {
    httpModule = await import("../src/lib/device-sync/http");
  });

  it("maps device-sync domain errors through the shared JSON error helper", async () => {
    const response = httpModule.jsonError(
      mocks.deviceSyncError({
        code: "ACCOUNT_REQUIRES_REAUTH",
        details: { provider: "oura" },
        httpStatus: 409,
        message: "Reconnect the account to continue syncing.",
        retryable: true,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ACCOUNT_REQUIRES_REAUTH",
        details: { provider: "oura" },
        message: "Reconnect the account to continue syncing.",
        retryable: true,
      },
    });
  });

  it("maps shared malformed request errors to the existing 400 JSON shapes", async () => {
    const invalidJsonResponse = httpModule.jsonError(
      new SyntaxError("Unexpected token ] in JSON at position 3"),
    );
    const invalidRequestResponse = httpModule.jsonError(
      new RangeError("Expected a shorter callback state value."),
    );

    expect(invalidJsonResponse.status).toBe(400);
    await expect(invalidJsonResponse.json()).resolves.toEqual({
      error: {
        code: "INVALID_JSON",
        message: "Unexpected token ] in JSON at position 3",
      },
    });

    expect(invalidRequestResponse.status).toBe(400);
    await expect(invalidRequestResponse.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Expected a shorter callback state value.",
      },
    });
  });

  it("keeps raw callback error text out of redirect query params", () => {
    const response = httpModule.errorToCallbackRedirect({
      returnTo: "https://app.healthybob.test/settings/devices?tab=wearables",
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
    expect(destination.origin).toBe("https://app.healthybob.test");
    expect(destination.pathname).toBe("/settings/devices");
    expect(destination.searchParams.get("tab")).toBe("wearables");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("error");
    expect(destination.searchParams.get("deviceSyncProvider")).toBe("demo");
    expect(destination.searchParams.get("deviceSyncError")).toBe("OAUTH_CALLBACK_REJECTED");
    expect(destination.searchParams.get("deviceSyncErrorMessage")).toBeNull();
  });
});
