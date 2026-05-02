import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  hostedWebSession: {
    create: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

describe("hosted app session production cookie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    mocks.getPrisma.mockReturnValue({
      hostedWebSession: mocks.hostedWebSession,
    });
    mocks.hostedWebSession.create.mockResolvedValue({});
  });

  it("uses the __Host cookie name and Secure flag in production", async () => {
    const {
      HOSTED_APP_SESSION_COOKIE_NAME,
      buildHostedAppSessionClearCookie,
      issueHostedAppSession,
    } = await import("@/src/lib/hosted-onboarding/app-session");

    const result = await issueHostedAppSession({
      memberId: "member_123",
      now: new Date("2026-05-02T00:00:00.000Z"),
      privyUserId: "did:privy:user_123",
    });

    expect(HOSTED_APP_SESSION_COOKIE_NAME).toBe("__Host-murph-session");
    expect(result.cookie).toContain("__Host-murph-session=murph_session_");
    expect(result.cookie).toContain("Path=/");
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("SameSite=Lax");
    expect(result.cookie).toContain("Secure");
    expect(buildHostedAppSessionClearCookie()).toBe(
      "__Host-murph-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
  });
});
