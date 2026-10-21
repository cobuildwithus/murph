import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  prisma: { label: "address-book-composed-auth-prisma" },
  readHostedAuthSession: vi.fn(),
  readHostedAddressBookStatus: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/src/lib/better-auth/config", () => ({
  requireHostedBetterAuthConfig: () => ({ baseURL: "https://app.example.test", secret: "synthetic-session-secret" }),
}));
vi.mock("@/src/lib/better-auth/session", () => ({ readHostedAuthSession: mocks.readHostedAuthSession }));
vi.mock("@/src/lib/hosted-address-book/projection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-address-book/projection")>()),
  readHostedAddressBookStatus: mocks.readHostedAddressBookStatus,
}));

const SLOW_GET_STAGE_MS = 5_000;
const SESSION = { session: {
  member: { id: "member-composed-address-book-auth", suspendedAt: null },
  sessionId: "synthetic-session", proof: {},
} };
const TOKEN = `murph_auth_v1.${"a".repeat(32)}`;
const STATUS = {
  enabled: false, lastReplacedAt: null, revision: 0, schemaVersion: 1 as const,
  storedContactCount: 0, writeCapability: "disabled" as const,
};
let route: typeof import("../app/api/device-sync/companion/address-book/route");
const request = () => new Request("https://app.example.test/api/device-sync/companion/address-book", {
  headers: { authorization: `Bearer ${TOKEN}` },
});

describe("device sync companion address-book composed auth diagnostics", () => {
  beforeAll(async () => { route = await import("../app/api/device-sync/companion/address-book/route"); });
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.readHostedAuthSession.mockResolvedValue(SESSION);
    mocks.readHostedAddressBookStatus.mockResolvedValue(STATUS);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("attributes pending session and canonical-member verification to the authentication stage", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let resolveSession!: (value: typeof SESSION) => void;
    mocks.readHostedAuthSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve; }));
    const response = route.GET(request());
    await vi.advanceTimersByTimeAsync(SLOW_GET_STAGE_MS);
    expect(warn).toHaveBeenCalledWith("Hosted companion address-book GET stage slow.", {
      elapsedMs: SLOW_GET_STAGE_MS, stage: "identity_token_verification",
    });
    expect(mocks.readHostedAddressBookStatus).not.toHaveBeenCalled();
    expect(mocks.readHostedAuthSession).toHaveBeenCalledWith(expect.objectContaining({
      credential: "a".repeat(32), transport: "native", prisma: mocks.prisma,
    }));
    resolveSession(SESSION);
    await expect(response).resolves.toMatchObject({ status: 200 });
  });

  it("rejects an expired or revoked session before reading private address-book state", async () => {
    mocks.readHostedAuthSession.mockResolvedValue({ session: null });
    const response = await route.GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(mocks.readHostedAddressBookStatus).not.toHaveBeenCalled();
  });
});
