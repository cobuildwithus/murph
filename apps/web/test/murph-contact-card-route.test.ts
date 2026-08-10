import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  issueMurphContactCardHandoffClaim,
  MURPH_CONTACT_CARD_NATIVE_COMPANION_SESSION_ID,
} from "@/src/lib/hosted-onboarding/contact-card-handoff";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { isRecord } from "@/src/lib/primitives";

const INITIATING_MEMBER_ID = "member_123456789";
const INITIATING_SESSION_ID = "hws_initiating";
const INITIATING_PHONE_NUMBER = "+14045550100";
const OTHER_MEMBER_ID = "member_987654321";
const OTHER_PHONE_NUMBER = "+14045550999";
const IOS_WEBVIEW_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IOS_SAFARI_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

interface TestMurphContactCardHandoffPayload {
  avatarId: string;
  exp: number;
  iat: number;
  memberId: string;
  sessionId: string;
}

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedCompanionMemberAccessAllowed: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  fetchMurphHostedLinqContactCardVcfPhoto: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  resolveMurphHostedLinqContactCardBackupPhoneNumber: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
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

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed:
    mocks.assertActiveHostedMemberAccessAllowed,
  assertHostedCompanionMemberAccessAllowed:
    mocks.assertHostedCompanionMemberAccessAllowed,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type MurphContactCardRouteModule =
  typeof import("../app/api/murph-contact-card/route");

let route: MurphContactCardRouteModule;

function buildRequest(
  query: string = "",
  options: { cookie?: string; userAgent?: string } = {},
): Request {
  const headers = new Headers();
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  if (options.userAgent) {
    headers.set("user-agent", options.userAgent);
  }

  return new Request(
    `https://app.example.com/api/murph-contact-card${query}`,
    { headers },
  );
}

function buildIssuanceRequest(avatar: string): Request {
  return new Request("https://app.example.com/api/murph-contact-card", {
    body: JSON.stringify({ avatar }),
    headers: {
      "content-type": "application/json",
      cookie: "murph-session=webview-only",
      origin: "https://app.example.com",
      "user-agent": IOS_WEBVIEW_USER_AGENT,
    },
    method: "POST",
  });
}

async function readHandoffClaim(response: Response): Promise<string> {
  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.claim !== "string") {
    throw new Error("Expected a contact-card handoff claim.");
  }
  return payload.claim;
}

function readHandoffPayload(claim: string): TestMurphContactCardHandoffPayload {
  const payloadEncoded = claim.split(".")[2];
  if (!payloadEncoded) {
    throw new Error("Expected a contact-card handoff payload.");
  }

  const payload: unknown = JSON.parse(
    Buffer.from(payloadEncoded, "base64url").toString("utf8"),
  );
  if (
    !isRecord(payload)
    || typeof payload.avatarId !== "string"
    || typeof payload.exp !== "number"
    || typeof payload.iat !== "number"
    || typeof payload.memberId !== "string"
    || typeof payload.sessionId !== "string"
  ) {
    throw new Error("Expected a contact-card handoff payload object.");
  }

  return {
    avatarId: payload.avatarId,
    exp: payload.exp,
    iat: payload.iat,
    memberId: payload.memberId,
    sessionId: payload.sessionId,
  };
}

describe("murph contact card route", () => {
  beforeAll(async () => {
    route = await import("../app/api/murph-contact-card/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getPrisma.mockReturnValue({});
    mocks.assertActiveHostedMemberAccessAllowed.mockResolvedValue(undefined);
    mocks.assertHostedCompanionMemberAccessAllowed.mockResolvedValue(undefined);
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: INITIATING_MEMBER_ID },
      sessionId: INITIATING_SESSION_ID,
    });
    mocks.readHostedMemberRoutingState.mockImplementation(
      async ({ memberId }: { memberId: string }) => ({
        linqRecipientPhone: memberId === OTHER_MEMBER_ID
          ? OTHER_PHONE_NUMBER
          : INITIATING_PHONE_NUMBER,
      }),
    );
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
    expect(body).toContain(`TEL;TYPE=CELL:${INITIATING_PHONE_NUMBER}`);
    expect(body).toContain("item1.TEL:+14045550111");
    expect(body).toContain("item1.X-ABLabel:backup");
    expect(body).toContain("PHOTO;ENCODING=b;TYPE=PNG:cGhvdG8=");

    expect(mocks.fetchMurphHostedLinqContactCardVcfPhoto).toHaveBeenCalledWith({
      imageUrl: "https://www.withmurph.ai/murph-headshots/murph-headshot-02-sm.png",
    });
    expect(
      mocks.resolveMurphHostedLinqContactCardBackupPhoneNumber,
    ).toHaveBeenCalledWith({
      excludePhoneNumber: INITIATING_PHONE_NUMBER,
      prisma: {},
    });
  });

  it("issues in the webview context and redeems in a cookie-empty Safari context", async () => {
    const webviewRequest = buildIssuanceRequest("gremlin");
    expect(webviewRequest.headers.get("cookie")).toBe(
      "murph-session=webview-only",
    );

    const issuanceResponse = await route.POST(webviewRequest);
    expect(issuanceResponse.status).toBe(200);
    const claim = await readHandoffClaim(issuanceResponse);
    const claimPayload = readHandoffPayload(claim);
    expect(claimPayload).toMatchObject({
      avatarId: "gremlin",
      memberId: INITIATING_MEMBER_ID,
      sessionId: INITIATING_SESSION_ID,
    });
    expect(claimPayload.exp - claimPayload.iat).toBe(5 * 60);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
      webviewRequest,
    );
    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(
      webviewRequest,
    );

    mocks.requireActiveHostedAppSessionFromRequest.mockClear();
    const safariRequest = buildRequest(
      `?handoff=${encodeURIComponent(claim)}`,
      { userAgent: IOS_SAFARI_USER_AGENT },
    );
    expect(safariRequest.headers.get("cookie")).toBeNull();

    const safariResponse = await route.GET(safariRequest);
    expect(safariResponse.status).toBe(200);
    expect(mocks.requireActiveHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: INITIATING_MEMBER_ID,
    });
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: INITIATING_MEMBER_ID,
      prisma: {},
    });
    expect(await safariResponse.text()).toContain(
      `TEL;TYPE=CELL:${INITIATING_PHONE_NUMBER}`,
    );
    expect(mocks.fetchMurphHostedLinqContactCardVcfPhoto).toHaveBeenCalledWith({
      imageUrl: "https://www.withmurph.ai/murph-headshots/murph-headshot-03-sm.png",
    });
  });

  it("keeps the handoff member and avatar when Safari has another member's cookie", async () => {
    const claim = issueMurphContactCardHandoffClaim({
      avatarId: "gremlin",
      memberId: INITIATING_MEMBER_ID,
      sessionId: INITIATING_SESSION_ID,
    });
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: OTHER_MEMBER_ID },
      sessionId: "hws_other",
    });

    const response = await route.GET(buildRequest(
      `?handoff=${encodeURIComponent(claim)}&avatar=hooded`,
      { cookie: "murph-session=other-safari-session" },
    ));

    expect(response.status).toBe(200);
    expect(mocks.requireActiveHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: INITIATING_MEMBER_ID,
      prisma: {},
    });
    const body = await response.text();
    expect(body).toContain(`TEL;TYPE=CELL:${INITIATING_PHONE_NUMBER}`);
    expect(body).not.toContain(OTHER_PHONE_NUMBER);
    expect(mocks.fetchMurphHostedLinqContactCardVcfPhoto).toHaveBeenCalledWith({
      imageUrl: "https://www.withmurph.ai/murph-headshots/murph-headshot-03-sm.png",
    });
  });

  it("redeems a signed native companion handoff through companion access", async () => {
    const claim = issueMurphContactCardHandoffClaim({
      avatarId: "gremlin",
      memberId: INITIATING_MEMBER_ID,
      sessionId: MURPH_CONTACT_CARD_NATIVE_COMPANION_SESSION_ID,
    });

    const response = await route.GET(buildRequest(
      `?handoff=${encodeURIComponent(claim)}`,
    ));

    expect(response.status).toBe(200);
    expect(mocks.assertHostedCompanionMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: INITIATING_MEMBER_ID,
    });
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
    expect(mocks.requireActiveHostedAppSessionFromRequest).not.toHaveBeenCalled();
  });

  it("rejects a missing handoff claim without falling back to a Safari session", async () => {
    const response = await route.GET(buildRequest(
      "?handoff=",
      { cookie: "murph-session=other-safari-session" },
    ));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe(
      "MURPH_CONTACT_CARD_HANDOFF_INVALID",
    );
    expect(mocks.requireActiveHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      "Hosted Murph contact-card request.",
      {
        app: null,
        authOutcome: "rejected",
        authority: "handoff",
        errorCode: "MURPH_CONTACT_CARD_HANDOFF_INVALID",
        webview: false,
      },
    );
  });

  it("rejects expired handoff claims", async () => {
    const claim = issueMurphContactCardHandoffClaim({
      avatarId: "gremlin",
      memberId: INITIATING_MEMBER_ID,
      now: new Date("2020-01-01T00:00:00.000Z"),
      sessionId: INITIATING_SESSION_ID,
    });

    const response = await route.GET(buildRequest(
      `?handoff=${encodeURIComponent(claim)}`,
    ));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe(
      "MURPH_CONTACT_CARD_HANDOFF_INVALID",
    );
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
  });

  it("rejects tampered handoff claims", async () => {
    const claim = issueMurphContactCardHandoffClaim({
      avatarId: "gremlin",
      memberId: INITIATING_MEMBER_ID,
      sessionId: INITIATING_SESSION_ID,
    });
    const claimParts = claim.split(".");
    const payload = readHandoffPayload(claim);
    payload.avatarId = "hooded";
    payload.memberId = OTHER_MEMBER_ID;
    claimParts[2] = Buffer.from(JSON.stringify(payload), "utf8")
      .toString("base64url");
    const tamperedClaim = claimParts.join(".");

    const response = await route.GET(buildRequest(
      `?handoff=${encodeURIComponent(tamperedClaim)}`,
    ));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe(
      "MURPH_CONTACT_CARD_HANDOFF_INVALID",
    );
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
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

  it("logs an authorized iOS webview contact-card request", async () => {
    await route.GET(
      buildRequest(
        "?avatar=hooded",
        {
          userAgent: IOS_WEBVIEW_USER_AGENT,
        },
      ),
    );

    expect(console.info).toHaveBeenCalledWith(
      "Hosted Murph contact-card request.",
      {
        app: null,
        authOutcome: "authorized",
        authority: "session",
        avatarId: "hooded",
        memberIdSuffix: "456789",
        webview: true,
      },
    );
  });

  it("logs an authorized Safari handoff request as outside a webview", async () => {
    const claim = issueMurphContactCardHandoffClaim({
      avatarId: "hooded",
      memberId: INITIATING_MEMBER_ID,
      sessionId: INITIATING_SESSION_ID,
    });
    await route.GET(
      buildRequest(
        `?handoff=${encodeURIComponent(claim)}`,
        {
          userAgent: IOS_SAFARI_USER_AGENT,
        },
      ),
    );

    expect(console.info).toHaveBeenCalledWith(
      "Hosted Murph contact-card request.",
      {
        app: null,
        authOutcome: "authorized",
        authority: "handoff",
        avatarId: "hooded",
        memberIdSuffix: "456789",
        webview: false,
      },
    );
  });

  it("uses the pending line while the member's line commit is in flight", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqRecipientPhone: null,
      pendingLinqRecipientPhone: "+14045550122",
    });

    const response = await route.GET(buildRequest());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("TEL;TYPE=CELL:+14045550122");
    expect(
      mocks.resolveMurphHostedLinqContactCardBackupPhoneNumber,
    ).toHaveBeenCalledWith({
      excludePhoneNumber: "+14045550122",
      prisma: {},
    });
  });

  it("returns 409 when the member has no conversation line", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);

    const response = await route.GET(buildRequest());
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error.code).toBe("MURPH_TEXT_LINE_NOT_READY");
  });

  it("logs and propagates unauthenticated Safari requests before card lookup", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockRejectedValue(
      hostedOnboardingError({
        code: "APP_SESSION_REQUIRED",
        message: "Sign in to continue.",
        httpStatus: 401,
      }),
    );

    const response = await route.GET(buildRequest(
      "?avatar=hooded",
      { userAgent: IOS_SAFARI_USER_AGENT },
    ));

    expect(response.status).toBe(401);
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      "Hosted Murph contact-card request.",
      {
        app: null,
        authOutcome: "rejected",
        authority: "session",
        avatarId: "hooded",
        errorCode: "APP_SESSION_REQUIRED",
        webview: false,
      },
    );
  });
});
