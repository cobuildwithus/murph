import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  lookupHostedMemberForPrivyPrincipal: vi.fn(),
  prisma: { label: "address-book-composed-auth-prisma" },
  readHostedAddressBookStatus: vi.fn(),
  resolveHostedPrivySessionFromBearerToken: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-session", () => ({
  resolveHostedPrivySessionFromBearerToken:
    mocks.resolveHostedPrivySessionFromBearerToken,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  lookupHostedMemberForPrivyPrincipal:
    mocks.lookupHostedMemberForPrivyPrincipal,
}));

vi.mock("@/src/lib/hosted-address-book/projection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-address-book/projection")>()),
  readHostedAddressBookStatus: mocks.readHostedAddressBookStatus,
}));

type AddressBookRoute =
  typeof import("../app/api/device-sync/companion/address-book/route");

const SLOW_GET_STAGE_MS = 5_000;
const IDENTITY = {
  phone: null,
  telegram: null,
  userId: "did:privy:composed-address-book-auth",
  wallet: null,
};
const MEMBER = { id: "member-composed-address-book-auth" };
const SESSION = {
  identity: IDENTITY,
  linkedAccounts: [],
  verifiedPrivyUser: { id: IDENTITY.userId },
};
const STATUS = {
  enabled: false,
  lastReplacedAt: null,
  revision: 0,
  schemaVersion: 1 as const,
  storedContactCount: 0,
  writeCapability: "disabled" as const,
};

let route: AddressBookRoute;

describe("device sync companion address-book composed auth diagnostics", () => {
  beforeAll(async () => {
    route = await import("../app/api/device-sync/companion/address-book/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.resolveHostedPrivySessionFromBearerToken.mockResolvedValue(SESSION);
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(MEMBER);
    mocks.readHostedAddressBookStatus.mockResolvedValue(STATUS);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("maps pending real identity verification to the identity stage", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let resolveSession!: (value: typeof SESSION) => void;
    mocks.resolveHostedPrivySessionFromBearerToken.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/address-book",
    );

    const responsePromise = route.GET(request);
    await vi.advanceTimersByTimeAsync(SLOW_GET_STAGE_MS);

    expect(warn).toHaveBeenCalledWith(
      "Hosted companion address-book GET stage slow.",
      {
        elapsedMs: SLOW_GET_STAGE_MS,
        stage: "identity_token_verification",
      },
    );
    expect(mocks.lookupHostedMemberForPrivyPrincipal).not.toHaveBeenCalled();

    resolveSession(SESSION);
    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
  });

  it("maps pending real member resolution to the member-lookup stage", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let resolveMember!: (value: typeof MEMBER) => void;
    mocks.lookupHostedMemberForPrivyPrincipal.mockReturnValue(
      new Promise((resolve) => {
        resolveMember = resolve;
      }),
    );
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/address-book",
    );

    const responsePromise = route.GET(request);
    await vi.advanceTimersByTimeAsync(SLOW_GET_STAGE_MS);

    expect(warn).toHaveBeenCalledWith(
      "Hosted companion address-book GET stage slow.",
      {
        elapsedMs: SLOW_GET_STAGE_MS,
        stage: "member_lookup",
      },
    );
    expect(mocks.readHostedAddressBookStatus).not.toHaveBeenCalled();

    resolveMember(MEMBER);
    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
  });
});
