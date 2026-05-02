import { HostedBillingStatus, type HostedMember } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedAppSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  getHostedAppSession: mocks.getHostedAppSession,
}));

describe("hosted page auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getHostedAppSession.mockResolvedValue(null);
  });

  it("returns an anonymous snapshot when no hosted app session exists", async () => {
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).resolves.toEqual({
      authenticated: false,
      authenticatedMember: null,
      session: null,
    });
  });

  it("returns the member-backed snapshot when the hosted app session verifies", async () => {
    const member = createHostedMember();
    const session = {
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member,
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    };
    mocks.getHostedAppSession.mockResolvedValue(session);
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).resolves.toEqual({
      authenticated: true,
      authenticatedMember: member,
      session,
    });
  });

  it("rethrows unexpected app-session failures", async () => {
    const error = new Error("session store unavailable");
    mocks.getHostedAppSession.mockRejectedValue(error);
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).rejects.toBe(error);
  });
});

describe("hosted sidebar auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getHostedAppSession.mockResolvedValue(null);
  });

  it("returns anonymous sidebar auth without an app session", async () => {
    const { getHostedSidebarAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedSidebarAuthSnapshot()).resolves.toEqual({
      authenticated: false,
      label: null,
    });
  });

  it("returns a minimal browser-safe sidebar label for a verified app session", async () => {
    mocks.getHostedAppSession.mockResolvedValue({
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member: createHostedMember(),
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    });
    const { getHostedSidebarAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedSidebarAuthSnapshot()).resolves.toEqual({
      authenticated: true,
      label: "Account",
    });
  });
});

function createHostedMember(overrides: Partial<HostedMember> = {}): HostedMember {
  return {
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2025-03-27T08:00:00.000Z"),
    id: "member_123",
    pendingActivationTimeZone: null,
    suspendedAt: null,
    updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    ...overrides,
  };
}
