import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  beginHostedCodexAuthAccessSeedAttempt: vi.fn(),
  disconnectHostedCodexAuthAccessSeed: vi.fn(),
  getPrisma: vi.fn(),
  markHostedCodexAuthAccessSeedDisconnected: vi.fn(),
  markHostedCodexAuthAccessSeedReady: vi.fn(),
  markHostedCodexAuthAttemptError: vi.fn(),
  readHostedCodexAuthCompanionView: vi.fn(),
  requireActivePrivyMemberAuthFromBearerToken: vi.fn(),
  requirePrivyMemberAuthFromBearerToken: vi.fn(),
  signalHostedRuntimeRecheckRuntime: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/codex-auth/store", () => ({
  beginHostedCodexAuthAccessSeedAttempt: mocks.beginHostedCodexAuthAccessSeedAttempt,
  disconnectHostedCodexAuthAccessSeed: mocks.disconnectHostedCodexAuthAccessSeed,
  markHostedCodexAuthAccessSeedDisconnected: mocks.markHostedCodexAuthAccessSeedDisconnected,
  markHostedCodexAuthAccessSeedReady: mocks.markHostedCodexAuthAccessSeedReady,
  markHostedCodexAuthAttemptError: mocks.markHostedCodexAuthAttemptError,
  readHostedCodexAuthCompanionView: mocks.readHostedCodexAuthCompanionView,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActivePrivyMemberAuthFromBearerToken:
    mocks.requireActivePrivyMemberAuthFromBearerToken,
  requirePrivyMemberAuthFromBearerToken: mocks.requirePrivyMemberAuthFromBearerToken,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeRecheckRuntime: mocks.signalHostedRuntimeRecheckRuntime,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type RouteModule = typeof import("../app/api/device-sync/companion/codex-auth-seed/route");

const NOW = new Date("2026-07-21T20:00:00.000Z");
const CONNECTION_VERSION = "hca_abcdefghijklmnop";
const PRISMA = { prisma: true };

let route: RouteModule;

describe("companion Codex auth seed route", () => {
  beforeAll(async () => {
    route = await import("../app/api/device-sync/companion/codex-auth-seed/route");
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("MURPH_COMPANION_CHATGPT_AUTH_ENABLED", "1");
    vi.clearAllMocks();
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.beginHostedCodexAuthAccessSeedAttempt.mockResolvedValue({
      attemptId: CONNECTION_VERSION,
      view: companionView("connecting"),
    });
    mocks.disconnectHostedCodexAuthAccessSeed.mockResolvedValue({
      attemptId: CONNECTION_VERSION,
      view: companionView("disconnecting", null),
    });
    mocks.getPrisma.mockReturnValue(PRISMA);
    mocks.markHostedCodexAuthAccessSeedDisconnected.mockResolvedValue(
      companionView("off", null),
    );
    mocks.markHostedCodexAuthAccessSeedReady.mockResolvedValue(companionView("connected"));
    mocks.markHostedCodexAuthAttemptError.mockResolvedValue(true);
    mocks.readHostedCodexAuthCompanionView.mockResolvedValue(companionView("connected"));
    mocks.requireActivePrivyMemberAuthFromBearerToken.mockResolvedValue({
      member: { id: "member_123" },
    });
    mocks.requirePrivyMemberAuthFromBearerToken.mockResolvedValue({
      member: { id: "member_123" },
    });
    mocks.signalHostedRuntimeRecheckRuntime.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns a credential-free status for an active, consented bearer member", async () => {
    const response = await route.GET(request("GET"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ...companionView("connected"),
      available: true,
    });
    expect(mocks.requireActivePrivyMemberAuthFromBearerToken).toHaveBeenCalledWith(
      expect.any(Request),
      PRISMA,
    );
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: PRISMA,
    });
  });

  it("stores only the exact time-limited access seed, rechecks runtime, and returns no credential", async () => {
    const body = validSeedBody();
    const response = await route.POST(request("POST", JSON.stringify(body)));

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const responseText = await response.text();
    expect(JSON.parse(responseText)).toEqual({
      ...companionView("connected"),
      available: true,
    });
    expect(responseText).not.toContain(body.accessToken);
    expect(responseText).not.toContain(body.chatgptAccountId);
    expect(mocks.beginHostedCodexAuthAccessSeedAttempt).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: PRISMA,
      seed: {
        ...body,
        expiresAt: new Date(body.expiresAt),
      },
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      prisma: PRISMA,
      userId: "member_123",
    });
    expect(mocks.markHostedCodexAuthAccessSeedReady).toHaveBeenCalledWith({
      attemptId: CONNECTION_VERSION,
      memberId: "member_123",
      prisma: PRISMA,
    });
  });

  it("keeps producer upload default-off while GET and DELETE remain available", async () => {
    vi.stubEnv("MURPH_COMPANION_CHATGPT_AUTH_ENABLED", "");

    const postResponse = await route.POST(request("POST", JSON.stringify(validSeedBody())));
    expect(postResponse.status).toBe(404);
    await expect(postResponse.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CODEX_AUTH_ACCESS_SEED_DISABLED",
        message: "ChatGPT connection is not available.",
        retryable: false,
      },
    });
    expect(mocks.requireActivePrivyMemberAuthFromBearerToken).not.toHaveBeenCalled();
    expect(mocks.beginHostedCodexAuthAccessSeedAttempt).not.toHaveBeenCalled();

    await expect(route.GET(request("GET"))).resolves.toMatchObject({ status: 200 });
    await expect(route.DELETE(request("DELETE"))).resolves.toMatchObject({ status: 202 });
    await expect((await route.GET(request("GET"))).json()).resolves.toMatchObject({
      available: false,
    });
  });

  it("rejects forbidden token fields and oversized bodies before persistence", async () => {
    const forbidden = await route.POST(request("POST", JSON.stringify({
      ...validSeedBody(),
      refreshToken: "sensitive-refresh-sentinel",
    })));
    expect(forbidden.status).toBe(400);
    const forbiddenText = await forbidden.text();
    expect(forbiddenText).not.toContain("sensitive-refresh-sentinel");
    expect(mocks.beginHostedCodexAuthAccessSeedAttempt).not.toHaveBeenCalled();

    const oversized = await route.POST(request("POST", JSON.stringify({
      ...validSeedBody(),
      padding: "x".repeat(17 * 1_024),
    })));
    expect(oversized.status).toBe(413);
    expect(mocks.beginHostedCodexAuthAccessSeedAttempt).not.toHaveBeenCalled();
  });

  it("maps malformed credential JSON before response or logs can echo input", async () => {
    const sentinel = "sensitive-malformed-json-sentinel";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await route.POST(request(
      "POST",
      `{"accessToken":"${sentinel}",`,
    ));

    expect(response.status).toBe(400);
    const responseText = await response.text();
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(responseText).not.toContain(sentinel);
    expect(logged).not.toContain(sentinel);
    expect(mocks.beginHostedCodexAuthAccessSeedAttempt).not.toHaveBeenCalled();
  });

  it("clears the fenced seed when runtime signaling fails after POST", async () => {
    mocks.signalHostedRuntimeRecheckRuntime.mockRejectedValueOnce(new Error("runtime offline"));

    const response = await route.POST(request("POST", JSON.stringify(validSeedBody())));

    expect(response.status).toBe(503);
    expect(mocks.markHostedCodexAuthAttemptError).toHaveBeenCalledWith({
      attemptId: CONNECTION_VERSION,
      memberId: "member_123",
      prisma: PRISMA,
    });
    expect(mocks.markHostedCodexAuthAccessSeedReady).not.toHaveBeenCalled();
  });

  it("returns a retryable conflict when another mutation supersedes the POST fence", async () => {
    mocks.markHostedCodexAuthAccessSeedReady.mockResolvedValueOnce(null);

    const response = await route.POST(request("POST", JSON.stringify(validSeedBody())));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CODEX_AUTH_ACCESS_SEED_SUPERSEDED",
        message: "ChatGPT connection changed while it was being saved.",
        retryable: true,
      },
    });
  });

  it("uses identity-only DELETE, clears before signaling, and rotates to off", async () => {
    const order: string[] = [];
    mocks.disconnectHostedCodexAuthAccessSeed.mockImplementationOnce(async () => {
      order.push("clear");
      return {
        attemptId: CONNECTION_VERSION,
        view: companionView("disconnecting", null),
      };
    });
    mocks.signalHostedRuntimeRecheckRuntime.mockImplementationOnce(async () => {
      order.push("signal");
    });
    mocks.markHostedCodexAuthAccessSeedDisconnected.mockImplementationOnce(async () => {
      order.push("ready");
      return companionView("off", null);
    });

    const response = await route.DELETE(request("DELETE"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ...companionView("off", null),
      available: true,
    });
    expect(order).toEqual(["clear", "signal", "ready"]);
    expect(mocks.requirePrivyMemberAuthFromBearerToken).toHaveBeenCalledWith(
      expect.any(Request),
      PRISMA,
    );
    expect(mocks.requireActivePrivyMemberAuthFromBearerToken).not.toHaveBeenCalled();
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
  });

  it("does not expose malformed DELETE input through response or logs", async () => {
    const sentinel = "sensitive-delete-json-sentinel";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await route.DELETE(request(
      "DELETE",
      `{"unexpected":"${sentinel}",`,
    ));

    expect(response.status).toBe(400);
    const responseText = await response.text();
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(responseText).not.toContain(sentinel);
    expect(logged).not.toContain(sentinel);
    expect(mocks.disconnectHostedCodexAuthAccessSeed).not.toHaveBeenCalled();
  });

  it("returns a retryable conflict when another mutation supersedes DELETE", async () => {
    mocks.markHostedCodexAuthAccessSeedDisconnected.mockResolvedValueOnce(null);

    const response = await route.DELETE(request("DELETE"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CODEX_AUTH_DISCONNECT_SUPERSEDED",
        message: "ChatGPT connection changed while it was being removed.",
        retryable: true,
      },
    });
  });

  it("allows inactive members to finish DELETE but surfaces other recheck failures", async () => {
    mocks.signalHostedRuntimeRecheckRuntime.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_RUNTIME_USER_INACTIVE",
      httpStatus: 403,
      message: "Hosted runtime user is not active.",
    }));
    await expect(route.DELETE(request("DELETE"))).resolves.toMatchObject({ status: 202 });
    expect(mocks.markHostedCodexAuthAccessSeedDisconnected).toHaveBeenCalledTimes(1);

    mocks.signalHostedRuntimeRecheckRuntime.mockRejectedValueOnce(new Error("temporal offline"));
    const failed = await route.DELETE(request("DELETE"));
    expect(failed.status).toBe(503);
    expect(mocks.disconnectHostedCodexAuthAccessSeed).toHaveBeenCalledTimes(2);
    expect(mocks.markHostedCodexAuthAccessSeedDisconnected).toHaveBeenCalledTimes(1);
  });
});

function request(method: "DELETE" | "GET" | "POST", body?: string): Request {
  return new Request(
    "https://join.example.test/api/device-sync/companion/codex-auth-seed",
    {
      body,
      headers: {
        authorization: "Bearer synthetic-privy-identity",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      method,
    },
  );
}

function validSeedBody() {
  return {
    accessToken: "synthetic-access-value",
    chatgptAccountId: "account_123",
    expiresAt: "2026-07-21T21:00:00.000Z",
    schemaVersion: 1 as const,
  };
}

function companionView(
  state: "connected" | "connecting" | "disconnecting" | "off",
  expiresAt: string | null = "2026-07-21T21:00:00.000Z",
) {
  return {
    connectionVersion: CONNECTION_VERSION,
    expiresAt,
    schemaVersion: 1,
    state,
  };
}
