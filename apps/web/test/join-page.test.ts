import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildHostedInvitePageData: vi.fn(),
  getHostedPageAuthSnapshot: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/join-invite-client", () => ({
  JoinInviteClient(input: {
    initialStatus: unknown;
    inviteCode: string;
  }) {
    return createElement(
      "div",
      {
        "data-invite-code": input.inviteCode,
      },
      "Join invite client",
    );
  },
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  buildHostedInvitePageData: mocks.buildHostedInvitePageData,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-phone-country-code-boundary", () => ({
  HostedPhoneCountryCodeBoundary(input: { children: React.ReactNode }) {
    return createElement(
      "div",
      {
        "data-phone-country-code": "GB",
      },
      input.children,
    );
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      createdAt: new Date("2025-03-27T08:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    },
    linkedAccounts: [],
    memberLookup: null,
    session: {
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      linkedAccounts: [],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    },
  });
  mocks.buildHostedInvitePageData.mockResolvedValue({
    billing: {
      defaultPlanCode: "launch_monthly",
      plans: [],
    },
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
    },
    invite: null,
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
    stage: "verify",
  });
});

test("JoinInvitePage passes invite status into the client tree without legacy share state", async () => {
  const { default: JoinInvitePage } = await import("../app/join/[inviteCode]/page");
  const legacyShareSearchParams = { preview: undefined, share: "share-code" };

  const markup = renderToStaticMarkup(
    await JoinInvitePage({
      params: Promise.resolve({ inviteCode: "invite-code" }),
      searchParams: Promise.resolve(legacyShareSearchParams),
    }),
  );

  expect(mocks.buildHostedInvitePageData).toHaveBeenCalledWith({
    authenticatedMember: {
      billingStatus: "active",
      createdAt: new Date("2025-03-27T08:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    },
    inviteCode: "invite-code",
  });
  assert.match(markup, /data-phone-country-code="GB"/);
  assert.match(markup, /data-invite-code="invite-code"/);
  assert.doesNotMatch(markup, /data-share-code/);
});

test("JoinInvitePage keeps the desktop invite rail sticky", async () => {
  const { default: JoinInvitePage } = await import("../app/join/[inviteCode]/page");

  const markup = renderToStaticMarkup(
    await JoinInvitePage({
      params: Promise.resolve({ inviteCode: "invite-code" }),
      searchParams: Promise.resolve({ preview: undefined }),
    }),
  );

  assert.match(markup, /md:sticky/);
  assert.match(markup, /md:top-0/);
  assert.match(markup, /md:h-svh/);
});

test("JoinInvitePage keeps route copy and inherits the shared Open Graph image", async () => {
  const { metadata } = await import("../app/join/[inviteCode]/page");

  expect(metadata.title).toBe("Murph hosted invite");
  expect(metadata.description).toBe(
    "Finish signup, then add a phone number or connect Telegram so Murph can reach you.",
  );
  expect(metadata.openGraph?.title).toBe("Murph hosted invite");
  expect(metadata.openGraph?.images).toEqual([
    expect.objectContaining({
      url: "/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
  expect(metadata.twitter?.title).toBe("Murph hosted invite");
  expect(metadata.twitter?.images).toEqual([
    expect.objectContaining({
      url: "/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
  expect(
    existsSync(new URL("../app/join/[inviteCode]/opengraph-image.tsx", import.meta.url))
  ).toBe(false);
});

test("JoinInviteSuccessPage keeps the shared preview image and setup copy", async () => {
  const { metadata } = await import("../app/join/[inviteCode]/success/page");

  expect(metadata.title).toBe("Finishing setup — Murph");
  expect(metadata.description).toBe(
    "Finish activating your Murph hosted account after checkout.",
  );
  expect(metadata.openGraph?.images).toEqual([
    expect.objectContaining({
      url: "/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
  expect(metadata.twitter?.images).toEqual([
    expect.objectContaining({
      url: "/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
});

test("JoinInviteCancelPage keeps the shared preview image and pause copy", async () => {
  const { metadata } = await import("../app/join/[inviteCode]/cancel/page");

  expect(metadata.title).toBe("Checkout paused — Murph");
  expect(metadata.description).toBe(
    "Return to your Murph invite when you are ready to finish checkout.",
  );
  expect(metadata.openGraph?.images).toEqual([
    expect.objectContaining({
      url: "/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
  expect(metadata.twitter?.images).toEqual([
    expect.objectContaining({
      url: "/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
});

test("JoinInviteCancelPage returns to the invite without legacy share state", async () => {
  const { default: JoinInviteCancelPage } = await import("../app/join/[inviteCode]/cancel/page");
  const input = {
    params: Promise.resolve({ inviteCode: "invite-code" }),
  };

  const markup = renderToStaticMarkup(await JoinInviteCancelPage(input));

  assert.match(markup, /href="\/join\/invite-code"/);
  assert.doesNotMatch(markup, /\?share=/);
});
