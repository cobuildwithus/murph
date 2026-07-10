import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { createBearerRequest } from "./route-test-helpers";

const ACTIVE_SESSION = {
  id: "dsa_messages",
  userId: "member-1",
  label: "Murph Messages mini app",
  createdAt: "2026-07-10T12:00:00.000Z",
  updatedAt: "2026-07-10T12:00:00.000Z",
  expiresAt: "2026-07-11T12:00:00.000Z",
  lastSeenAt: "2026-07-10T12:00:00.000Z",
  revokedAt: null,
  revokeReason: null,
  replacedBySessionId: null,
};
const MESSAGES_TOKEN = `hbds_imessage_${"a".repeat(43)}`;

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  authenticateAgentSessionByTokenHash: vi.fn(),
  createAgentSession: vi.fn(),
  getPrisma: vi.fn(() => ({ marker: "prisma" })),
  requireActivePrivyMemberAuthFromBearerToken: vi.fn(),
  revokeAgentSession: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActivePrivyMemberAuthFromBearerToken:
    mocks.requireActivePrivyMemberAuthFromBearerToken,
}));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: mocks.assertActiveHostedMemberAccessAllowed,
}));
vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));
vi.mock("@/src/lib/device-sync/prisma-store/agent-sessions", () => ({
  PrismaHostedAgentSessionStore: class {
    authenticateAgentSessionByTokenHash = mocks.authenticateAgentSessionByTokenHash;
    createAgentSession = mocks.createAgentSession;
    revokeAgentSession = mocks.revokeAgentSession;
  },
}));

type EnrollmentRoute = typeof import("../app/api/device-sync/companion/imessage-mini-app/enrollment/route");
type ProofActionRoute = typeof import("../app/api/device-sync/companion/imessage-mini-app/proof-action/route");

let enrollmentRoute: EnrollmentRoute;
let proofActionRoute: ProofActionRoute;

function jsonRequest(url: string, token: string, method: "POST" | "DELETE", body?: unknown) {
  return createBearerRequest(url, token, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    method,
  });
}

describe("iMessage mini-app routes", () => {
  beforeAll(async () => {
    enrollmentRoute = await import("../app/api/device-sync/companion/imessage-mini-app/enrollment/route");
    proofActionRoute = await import("../app/api/device-sync/companion/imessage-mini-app/proof-action/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActivePrivyMemberAuthFromBearerToken.mockResolvedValue({
      member: { id: "member-1" },
    });
    mocks.createAgentSession.mockImplementation(async (input) => ({
      ...ACTIVE_SESSION,
      expiresAt: input.expiresAt,
    }));
    mocks.authenticateAgentSessionByTokenHash.mockResolvedValue({
      status: "active",
      session: ACTIVE_SESSION,
    });
    mocks.revokeAgentSession.mockResolvedValue({
      ...ACTIVE_SESSION,
      revokedAt: "2026-07-10T12:10:00.000Z",
      revokeReason: "imessage_app_request",
    });
  });

  it("exchanges a verified Privy member session for a scoped derived credential", async () => {
    const request = jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/enrollment",
      "privy-identity-proof",
      "POST",
      { schemaVersion: 1 },
    );

    const response = await enrollmentRoute.POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requireActivePrivyMemberAuthFromBearerToken).toHaveBeenCalledWith(
      request,
      { marker: "prisma" },
    );
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: "member-1",
      prisma: { marker: "prisma" },
    });
    expect(body).toMatchObject({
      schemaVersion: 1,
      credential: {
        token: expect.stringMatching(/^hbds_imessage_/u),
      },
    });
    expect(JSON.stringify(body)).not.toContain("privy-identity-proof");
  });

  it("re-checks account access and consent before accepting a proof choice", async () => {
    const request = jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/proof-action",
      MESSAGES_TOKEN,
      "POST",
      {
        schemaVersion: 1,
        cardId: "privy-proof-v1",
        choice: "morning",
        idempotencyKey: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
      },
    );

    const response = await proofActionRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: "member-1",
      prisma: { marker: "prisma" },
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: "member-1",
      prisma: { marker: "prisma" },
    });
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      authenticated: true,
      cardId: "privy-proof-v1",
      choice: "morning",
    });
  });

  it("fails closed when the credential owner no longer has active account access", async () => {
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "An active Murph plan is required.",
    }));

    const response = await proofActionRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/proof-action",
      MESSAGES_TOKEN,
      "POST",
      {
        schemaVersion: 1,
        cardId: "privy-proof-v1",
        choice: "morning",
        idempotencyKey: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
      },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_ACCESS_REQUIRED" },
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
  });

  it("fails closed when launch consent is no longer current", async () => {
    mocks.assertHostedLaunchRequiredConsentGranted.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Accept the current Murph legal consent before continuing.",
    }));

    const response = await proofActionRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/proof-action",
      MESSAGES_TOKEN,
      "POST",
      {
        schemaVersion: 1,
        cardId: "privy-proof-v1",
        choice: "evening",
        idempotencyKey: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
      },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_CONSENT_REQUIRED" },
    });
  });

  it("rejects a device-agent token before account gates or action parsing", async () => {
    const response = await proofActionRoute.POST(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/proof-action",
      "hbds_agent_active",
      "POST",
      { schemaVersion: 1 },
    ));

    expect(response.status).toBe(401);
    expect(mocks.authenticateAgentSessionByTokenHash).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
  });

  it("revokes the derived credential without requiring the member to remain active", async () => {
    const response = await enrollmentRoute.DELETE(jsonRequest(
      "https://example.test/api/device-sync/companion/imessage-mini-app/enrollment",
      MESSAGES_TOKEN,
      "DELETE",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ schemaVersion: 1, revoked: true });
    expect(mocks.revokeAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      reason: "imessage_app_request",
      sessionId: "dsa_messages",
    }));
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
  });
});
