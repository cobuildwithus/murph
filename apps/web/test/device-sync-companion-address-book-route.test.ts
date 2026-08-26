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
  HOSTED_HEALTH_DATA_CONSENT_SCOPE: "launch.health-data",
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

const SLOW_GET_STAGE_MS = 5_000;

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
    vi.useRealTimers();
    vi.restoreAllMocks();
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
      { runStage: expect.any(Function) },
    );
    expect(mocks.requireActivePrivyMemberAuthFromBearerToken).not.toHaveBeenCalled();
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.readHostedAddressBookStatus).toHaveBeenCalledWith({
      memberId: MEMBER.id,
      prisma: mocks.prisma,
    });
    expect(route.maxDuration).toBe(60);
  });

  it("reports stalled identity-token verification before the route deadline", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let resolveAuth!: (value: { member: typeof MEMBER }) => void;
    const pendingAuth = new Promise<{ member: typeof MEMBER }>((resolve) => {
      resolveAuth = resolve;
    });
    mocks.requirePrivyMemberAuthFromBearerToken.mockImplementation(
      (_request, _prisma, options) => options.runStage(
        "identity_token_verification",
        () => pendingAuth,
      ),
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

    resolveAuth({ member: MEMBER });
    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
  });

  it("reports a stalled member lookup before the route deadline", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let resolveAuth!: (value: { member: typeof MEMBER }) => void;
    const pendingAuth = new Promise<{ member: typeof MEMBER }>((resolve) => {
      resolveAuth = resolve;
    });
    mocks.requirePrivyMemberAuthFromBearerToken.mockImplementation(
      (_request, _prisma, options) => options.runStage(
        "member_lookup",
        () => pendingAuth,
      ),
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

    resolveAuth({ member: MEMBER });
    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
  });

  it("reports a stalled status read without logging member or request data", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let resolveStatus!: (value: typeof STATUS) => void;
    mocks.readHostedAddressBookStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
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
        stage: "status_read",
      },
    );

    resolveStatus(STATUS);
    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
  });

  it("clears the slow-stage timers after a normal status read", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/address-book",
    );

    await expect(route.GET(request)).resolves.toMatchObject({ status: 200 });
    await vi.advanceTimersByTimeAsync(SLOW_GET_STAGE_MS * 2);

    expect(warn).not.toHaveBeenCalled();
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
