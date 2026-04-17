import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";

import { createJsonPostRequest } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  requireActivePrivyMemberAuth: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActivePrivyMemberAuth: mocks.requireActivePrivyMemberAuth,
}));

type BrowserVaultSessionRouteModule = typeof import("../app/api/browser-vault/session/route");

let browserVaultSessionRoute: BrowserVaultSessionRouteModule;

describe("browser vault session route", () => {
  beforeAll(async () => {
    browserVaultSessionRoute = await import("../app/api/browser-vault/session/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActivePrivyMemberAuth.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
  });

  it("forwards the authenticated member and browser public key to the hosted control client", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    const createBrowserVaultSession = vi.fn().mockResolvedValue({
      rootKeyEnvelope: null,
      snapshotEnvelope: null,
    });

    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      createBrowserVaultSession,
    });

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireActivePrivyMemberAuth).toHaveBeenCalledTimes(1);
    expect(createBrowserVaultSession).toHaveBeenCalledWith(
      "member_123",
      browser.publicKeyJwk,
    );
    await expect(response.json()).resolves.toEqual({
      rootKeyEnvelope: null,
      snapshotEnvelope: null,
    });
  });

  it("returns a 503 when hosted execution control is not configured", async () => {
    const browser = await generateHostedUserRecipientKeyPair();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);

    const response = await browserVaultSessionRoute.POST(
      createJsonPostRequest("https://join.example.test/api/browser-vault/session", {
        browserPublicKeyJwk: browser.publicKeyJwk,
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
        message: "Hosted execution control plane is not configured.",
        retryable: false,
      },
    });
  });
});
