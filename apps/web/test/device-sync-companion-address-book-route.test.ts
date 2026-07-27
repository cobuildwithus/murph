import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  deleteHostedAddressBookProjection: vi.fn(),
  getPrisma: vi.fn(),
  parseHostedAddressBookDeleteRequest: vi.fn(),
  parseHostedAddressBookReplaceRequest: vi.fn(),
  prisma: { label: "address-book-route-prisma" },
  readHostedAddressBookStatus: vi.fn(),
  readJsonObject: vi.fn(),
  replaceHostedAddressBookProjection: vi.fn(),
  requireActivePrivyMemberAuthFromBearerToken: vi.fn(),
  requirePrivyMemberAuthFromBearerToken: vi.fn(),
}));

vi.mock("@/src/lib/hosted-address-book/projection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-address-book/projection")>()),
  deleteHostedAddressBookProjection: mocks.deleteHostedAddressBookProjection,
  parseHostedAddressBookDeleteRequest: mocks.parseHostedAddressBookDeleteRequest,
  parseHostedAddressBookReplaceRequest: mocks.parseHostedAddressBookReplaceRequest,
  readHostedAddressBookStatus: mocks.readHostedAddressBookStatus,
  replaceHostedAddressBookProjection: mocks.replaceHostedAddressBookProjection,
}));

vi.mock("@/src/lib/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/http")>()),
  readJsonObject: mocks.readJsonObject,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActivePrivyMemberAuthFromBearerToken:
    mocks.requireActivePrivyMemberAuthFromBearerToken,
  requirePrivyMemberAuthFromBearerToken:
    mocks.requirePrivyMemberAuthFromBearerToken,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted:
    mocks.assertHostedLaunchRequiredConsentGranted,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type AddressBookRoute =
  typeof import("../app/api/device-sync/companion/address-book/route");

const MEMBER = { id: "member-route-test" };
const STATUS = {
  enabled: false,
  lastReplacedAt: null,
  revision: 2,
  schemaVersion: 1 as const,
  storedContactCount: 0,
  writeCapability: "disabled" as const,
};
const REPLACEMENT = {
  baseRevision: 2,
  contacts: [{ advisoryName: "Alex R.", phoneNumber: "+12125550100" }],
  mutationId: "4f5150c8-a9bc-42d3-b975-a289481a3140",
  schemaVersion: 1 as const,
};
const DELETION = {
  baseRevision: 2,
  mutationId: "747552e5-bd57-4f8b-a402-066ad2dc22c3",
  schemaVersion: 1 as const,
};

let route: AddressBookRoute;

describe("device sync companion address-book route", () => {
  beforeAll(async () => {
    route = await import("../app/api/device-sync/companion/address-book/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.requirePrivyMemberAuthFromBearerToken.mockResolvedValue({ member: MEMBER });
    mocks.requireActivePrivyMemberAuthFromBearerToken.mockResolvedValue({
      member: MEMBER,
    });
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.readHostedAddressBookStatus.mockResolvedValue(STATUS);
    mocks.replaceHostedAddressBookProjection.mockResolvedValue({
      ...STATUS,
      enabled: true,
      revision: 3,
      storedContactCount: 1,
      writeCapability: "enabled",
    });
    mocks.deleteHostedAddressBookProjection.mockResolvedValue(STATUS);
    mocks.parseHostedAddressBookReplaceRequest.mockReturnValue(REPLACEMENT);
    mocks.parseHostedAddressBookDeleteRequest.mockReturnValue(DELETION);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses ordinary member authentication for status reads", async () => {
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/address-book",
    );

    const response = await route.GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(STATUS);
    expect(mocks.requirePrivyMemberAuthFromBearerToken).toHaveBeenCalledWith(
      request,
      mocks.prisma,
    );
    expect(mocks.requireActivePrivyMemberAuthFromBearerToken).not.toHaveBeenCalled();
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.readHostedAddressBookStatus).toHaveBeenCalledWith({
      memberId: MEMBER.id,
      prisma: mocks.prisma,
    });
    expect(route.maxDuration).toBe(60);
  });

  it("requires active access and launch consent for bounded replacements", async () => {
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/address-book",
      { method: "PUT" },
    );
    const rawBody = { request: "replacement" };
    mocks.readJsonObject.mockResolvedValue(rawBody);

    const response = await route.PUT(request);

    expect(response.status).toBe(200);
    expect(mocks.requireActivePrivyMemberAuthFromBearerToken).toHaveBeenCalledWith(
      request,
      mocks.prisma,
    );
    expect(mocks.requirePrivyMemberAuthFromBearerToken).not.toHaveBeenCalled();
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: MEMBER.id,
      prisma: mocks.prisma,
    });
    expect(mocks.readJsonObject).toHaveBeenCalledWith(request, {
      limitBytes: 192 * 1024,
    });
    expect(mocks.parseHostedAddressBookReplaceRequest).toHaveBeenCalledWith(rawBody);
    expect(mocks.replaceHostedAddressBookProjection).toHaveBeenCalledWith({
      memberId: MEMBER.id,
      prisma: mocks.prisma,
      request: REPLACEMENT,
    });
  });

  it("keeps bounded deletion available with ordinary auth and replacement disabled", async () => {
    vi.stubEnv("HOSTED_ADDRESS_BOOK_REPLACEMENT_ENABLED", "0");
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/address-book",
      { method: "DELETE" },
    );
    const rawBody = { request: "deletion" };
    mocks.readJsonObject.mockResolvedValue(rawBody);

    const response = await route.DELETE(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(STATUS);
    expect(mocks.requirePrivyMemberAuthFromBearerToken).toHaveBeenCalledWith(
      request,
      mocks.prisma,
    );
    expect(mocks.requireActivePrivyMemberAuthFromBearerToken).not.toHaveBeenCalled();
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.readJsonObject).toHaveBeenCalledWith(request, {
      limitBytes: 1024,
    });
    expect(mocks.parseHostedAddressBookDeleteRequest).toHaveBeenCalledWith(rawBody);
    expect(mocks.deleteHostedAddressBookProjection).toHaveBeenCalledWith({
      memberId: MEMBER.id,
      prisma: mocks.prisma,
      request: DELETION,
    });
  });
});
