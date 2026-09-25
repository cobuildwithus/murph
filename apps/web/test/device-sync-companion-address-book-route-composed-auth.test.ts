import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  lookupHostedMemberIdentityByPrivyUserId: vi.fn(),
  prisma: {
    label: "address-book-composed-auth-prisma",
    hostedAuthRecord: { findUnique: vi.fn() },
    hostedMemberIdentity: { findUnique: vi.fn() },
  },
  projectHostedMemberIdentityState: vi.fn(),
  readHostedAddressBookStatus: vi.fn(),
  verifyHostedPrivyIdentityToken: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  verifyHostedPrivyIdentityToken:
    mocks.verifyHostedPrivyIdentityToken,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  assertHostedPrivyAccountDeletionNotPending: async () => undefined,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  projectHostedMemberIdentityState: mocks.projectHostedMemberIdentityState,
  lookupHostedMemberIdentityByPrivyUserId:
    mocks.lookupHostedMemberIdentityByPrivyUserId,
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
const MEMBER = { core: { id: "member-composed-address-book-auth", suspendedAt: null }, identity: { privyUserId: IDENTITY.userId } };
const SESSION = { id: IDENTITY.userId };
const TOKEN = `header.${Buffer.from(JSON.stringify({ exp: 4_000_000_000 })).toString("base64url")}.signature`;
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
    mocks.prisma.hostedAuthRecord.findUnique.mockResolvedValue(null);
    mocks.prisma.hostedMemberIdentity.findUnique.mockResolvedValue({ memberId: MEMBER.core.id });
    mocks.projectHostedMemberIdentityState.mockResolvedValue({ privyUserId: IDENTITY.userId });
    mocks.verifyHostedPrivyIdentityToken.mockResolvedValue(SESSION);
    mocks.lookupHostedMemberIdentityByPrivyUserId.mockResolvedValue(MEMBER);
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
    mocks.verifyHostedPrivyIdentityToken.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/address-book",
      { headers: { authorization: `Bearer ${TOKEN}` } },
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
    expect(mocks.lookupHostedMemberIdentityByPrivyUserId).not.toHaveBeenCalled();

    resolveSession(SESSION);
    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
  });

  it("maps pending real member resolution to the member-lookup stage", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let resolveMember!: (value: typeof MEMBER) => void;
    mocks.lookupHostedMemberIdentityByPrivyUserId.mockReturnValue(
      new Promise((resolve) => {
        resolveMember = resolve;
      }),
    );
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/address-book",
      { headers: { authorization: `Bearer ${TOKEN}` } },
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
