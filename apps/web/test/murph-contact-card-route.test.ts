import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  fetchMurphHostedLinqContactCardVcfPhoto: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  requireActivePrivyMemberAuth: vi.fn(),
  resolveMurphHostedLinqContactCardBackupPhoneNumber: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActivePrivyMemberAuth: mocks.requireActivePrivyMemberAuth,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-contact-card", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-contact-card")
  >();
  return {
    ...actual,
    fetchMurphHostedLinqContactCardVcfPhoto:
      mocks.fetchMurphHostedLinqContactCardVcfPhoto,
    resolveMurphHostedLinqContactCardBackupPhoneNumber:
      mocks.resolveMurphHostedLinqContactCardBackupPhoneNumber,
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type MurphContactCardRouteModule =
  typeof import("../app/api/murph-contact-card/route");

let route: MurphContactCardRouteModule;

function buildRequest(query: string = ""): Request {
  return new Request(`https://app.example.com/api/murph-contact-card${query}`);
}

describe("murph contact card route", () => {
  beforeAll(async () => {
    route = await import("../app/api/murph-contact-card/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getPrisma.mockReturnValue({});
    mocks.requireActivePrivyMemberAuth.mockResolvedValue({
      member: { id: "member_1" },
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqRecipientPhone: "+14045550100",
    });
    mocks.resolveMurphHostedLinqContactCardBackupPhoneNumber.mockResolvedValue(
      "+14045550111",
    );
    mocks.fetchMurphHostedLinqContactCardVcfPhoto.mockResolvedValue({
      base64: "cGhvdG8=",
      type: "PNG",
    });
  });

  it("returns a downloadable vCard with mobile, backup, and the default avatar photo", async () => {
    const response = await route.GET(buildRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/vcard");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="Murph.vcf"',
    );

    const body = await response.text();
    expect(body).toContain("FN:Murph");
    expect(body).toContain("TEL;TYPE=CELL:+14045550100");
    expect(body).toContain("item1.TEL:+14045550111");
    expect(body).toContain("item1.X-ABLabel:backup");
    expect(body).toContain("PHOTO;ENCODING=b;TYPE=PNG:cGhvdG8=");

    expect(mocks.fetchMurphHostedLinqContactCardVcfPhoto).toHaveBeenCalledWith({
      imageUrl: "https://www.withmurph.ai/murph-headshots/murph-headshot-02-sm.png",
    });
    expect(
      mocks.resolveMurphHostedLinqContactCardBackupPhoneNumber,
    ).toHaveBeenCalledWith({
      excludePhoneNumber: "+14045550100",
      prisma: {},
    });
  });

  it("embeds the chosen logo avatar", async () => {
    await route.GET(buildRequest("?avatar=logo-light"));

    expect(mocks.fetchMurphHostedLinqContactCardVcfPhoto).toHaveBeenCalledWith({
      imageUrl: "https://www.withmurph.ai/brand-logos/murph-logo-avatar-light.png",
    });
  });

  it("ignores the request origin when resolving the photo asset", async () => {
    await route.GET(
      new Request("https://evil.example.net/api/murph-contact-card?avatar=hooded"),
    );

    expect(mocks.fetchMurphHostedLinqContactCardVcfPhoto).toHaveBeenCalledWith({
      imageUrl: "https://www.withmurph.ai/murph-headshots/murph-headshot-01-sm.png",
    });
  });

  it("omits the photo for the no-photo option", async () => {
    const response = await route.GET(buildRequest("?avatar=none"));

    const body = await response.text();
    expect(body).not.toContain("PHOTO");
    expect(mocks.fetchMurphHostedLinqContactCardVcfPhoto).not.toHaveBeenCalled();
  });

  it("falls back to the default avatar for unknown ids", async () => {
    await route.GET(buildRequest("?avatar=does-not-exist"));

    expect(mocks.fetchMurphHostedLinqContactCardVcfPhoto).toHaveBeenCalledWith({
      imageUrl: "https://www.withmurph.ai/murph-headshots/murph-headshot-02-sm.png",
    });
  });

  it("returns 409 when the member has no conversation line", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);

    const response = await route.GET(buildRequest());
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error.code).toBe("MURPH_TEXT_LINE_NOT_READY");
  });

  it("propagates auth failures without building a card", async () => {
    mocks.requireActivePrivyMemberAuth.mockRejectedValue(
      hostedOnboardingError({
        code: "APP_SESSION_REQUIRED",
        message: "Sign in to continue.",
        httpStatus: 401,
      }),
    );

    const response = await route.GET(buildRequest());
    expect(response.status).toBe(401);
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
  });
});
