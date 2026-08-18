import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedPhoneCallStatus: vi.fn(),
  requireHostedCloudflareCallbackJsonRequest: vi.fn(),
  stopHostedPhoneCall: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest:
    mocks.requireHostedCloudflareCallbackJsonRequest,
}));
vi.mock("@/src/lib/phone-calls/status", () => ({
  readHostedPhoneCallStatus: mocks.readHostedPhoneCallStatus,
}));
vi.mock("@/src/lib/phone-calls/control", () => ({
  stopHostedPhoneCall: mocks.stopHostedPhoneCall,
}));

type StatusRoute = typeof import(
  "../app/api/internal/phone-calls/status/route"
);
type StopRoute = typeof import(
  "../app/api/internal/phone-calls/stop/route"
);

let statusRoute: StatusRoute;
let stopRoute: StopRoute;

describe("hosted phone-call control routes", () => {
  beforeAll(async () => {
    [statusRoute, stopRoute] = await Promise.all([
      import("../app/api/internal/phone-calls/status/route"),
      import("../app/api/internal/phone-calls/stop/route"),
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackJsonRequest.mockImplementation(
      async (request: Request) => ({
        payload: await request.json(),
        userId: "member_signed_callback",
      }),
    );
  });

  it("binds a status read to the signed callback member instead of request data", async () => {
    const responseBody = {
      calls: [{
        analyzedAt: null,
        createdAt: "2026-08-14T12:00:00.000Z",
        endedAt: null,
        phoneCallId: "hpc_status_route",
        result: null,
        status: "calling",
        stopRequestedAt: null,
        updatedAt: "2026-08-14T12:01:00.000Z",
      }],
    };
    mocks.readHostedPhoneCallStatus.mockResolvedValueOnce(responseBody);
    const request = new Request(
      "https://join.example.test/api/internal/phone-calls/status",
      {
        body: JSON.stringify({ phoneCallId: "hpc_status_route" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await statusRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 4 * 1024 },
    );
    expect(mocks.readHostedPhoneCallStatus).toHaveBeenCalledWith({
      memberId: "member_signed_callback",
      phoneCallId: "hpc_status_route",
      signal: request.signal,
    });
    await expect(response.json()).resolves.toEqual(responseBody);
  });

  it("binds an exact stop to the signed callback member and request signal", async () => {
    const responseBody = {
      phoneCallId: "hpc_stop_route",
      state: "stopped",
      status: "ended",
    };
    mocks.stopHostedPhoneCall.mockResolvedValueOnce(responseBody);
    const request = new Request(
      "https://join.example.test/api/internal/phone-calls/stop",
      {
        body: JSON.stringify({ phoneCallId: "hpc_stop_route" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await stopRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 4 * 1024 },
    );
    expect(mocks.stopHostedPhoneCall).toHaveBeenCalledWith({
      memberId: "member_signed_callback",
      phoneCallId: "hpc_stop_route",
      signal: request.signal,
    });
    await expect(response.json()).resolves.toEqual(responseBody);
  });

  it("rejects malformed status requests before reading member data", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await statusRoute.POST(new Request(
        "https://join.example.test/api/internal/phone-calls/status",
        {
          body: JSON.stringify({ phoneCallId: "" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ));

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(mocks.readHostedPhoneCallStatus).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("rejects malformed stop requests before invoking provider control", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await stopRoute.POST(new Request(
        "https://join.example.test/api/internal/phone-calls/stop",
        {
          body: JSON.stringify({ phoneCallId: "", unexpected: true }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ));

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(mocks.stopHostedPhoneCall).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
