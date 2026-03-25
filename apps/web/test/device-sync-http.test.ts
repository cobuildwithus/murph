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
