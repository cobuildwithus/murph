import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  beginHostedCodexAuthAttempt: vi.fn(),
  getPrisma: vi.fn(),
  markHostedCodexAuthAttemptError: vi.fn(),
  readHostedCodexAuthConnectionView: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/codex-auth/store", () => ({
  beginHostedCodexAuthAttempt: mocks.beginHostedCodexAuthAttempt,
  markHostedCodexAuthAttemptError: mocks.markHostedCodexAuthAttemptError,
  readHostedCodexAuthConnectionView: mocks.readHostedCodexAuthConnectionView,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type ChatGptSettingsRouteModule = typeof import("../app/api/settings/chatgpt/route");

let route: ChatGptSettingsRouteModule;

describe("ChatGPT settings route", () => {
  beforeAll(async () => {
    route = await import("../app/api/settings/chatgpt/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.beginHostedCodexAuthAttempt.mockResolvedValue({
      attemptId: "hca_abcdefghijklmnop",
      mailboxItemId: "mailbox_item_codex_auth",
      view: {
        state: "connecting",
        userCode: null,
        verificationUrl: null,
      },
    });
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.markHostedCodexAuthAttemptError.mockResolvedValue(true);
    mocks.readHostedCodexAuthConnectionView.mockResolvedValue({ state: "connected" });
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue(undefined);
  });

  it("returns the current connection view for the signed-in member", async () => {
    const response = await route.GET(new Request("https://join.example.test/api/settings/chatgpt"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "connected" });
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.readHostedCodexAuthConnectionView).toHaveBeenCalledWith({
      memberId: "member_123",
    });
  });

  it("starts a connect attempt for an active hosted member", async () => {
    const response = await route.POST(jsonRequest("POST", {}));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      state: "connecting",
      userCode: null,
      verificationUrl: null,
    });
    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.beginHostedCodexAuthAttempt).toHaveBeenCalledWith({
      action: "connect",
      memberId: "member_123",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_item_codex_auth",
    });
  });

  it("rejects non-empty mutation bodies before starting an attempt", async () => {
    const response = await route.POST(jsonRequest("POST", {
      unexpected: true,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CODEX_AUTH_INVALID_REQUEST",
        message: "ChatGPT connection request must be empty.",
        retryable: false,
      },
    });
    expect(mocks.beginHostedCodexAuthAttempt).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("starts a disconnect attempt without requiring launch consent", async () => {
    mocks.beginHostedCodexAuthAttempt.mockResolvedValueOnce({
      attemptId: "hca_abcdefghijklmnop",
      mailboxItemId: "mailbox_item_codex_auth_disconnect",
      view: {
        state: "disconnecting",
      },
    });

    const response = await route.DELETE(jsonRequest("DELETE", {}));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      state: "disconnecting",
    });
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.beginHostedCodexAuthAttempt).toHaveBeenCalledWith({
      action: "disconnect",
      memberId: "member_123",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_item_codex_auth_disconnect",
    });
  });

  it("marks a disconnect attempt with a retryable disconnect error when runtime signaling fails", async () => {
    mocks.beginHostedCodexAuthAttempt.mockResolvedValueOnce({
      attemptId: "hca_disconnectattempt",
      mailboxItemId: "mailbox_item_codex_auth_disconnect",
      view: {
        state: "disconnecting",
      },
    });
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(new Error("temporal offline"));

    const response = await route.DELETE(jsonRequest("DELETE", {}));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CODEX_AUTH_RUNTIME_UNAVAILABLE",
        message: "Could not disconnect ChatGPT right now.",
        retryable: true,
      },
    });
    expect(mocks.markHostedCodexAuthAttemptError).toHaveBeenCalledWith({
      attemptId: "hca_disconnectattempt",
      memberId: "member_123",
    });
  });
});

function jsonRequest(method: "DELETE" | "POST", body: Record<string, unknown>): Request {
  return new Request("https://join.example.test/api/settings/chatgpt", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "https://join.example.test",
    },
    method,
  });
}
