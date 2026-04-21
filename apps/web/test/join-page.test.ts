import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildHostedInvitePageData: vi.fn(),
  buildHostedSharePageData: vi.fn(),
  getHostedPageAuthSnapshot: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/join-invite-client", () => ({
  JoinInviteClient(input: {
    initialStatus: unknown;
    inviteCode: string;
    shareCode: string | null;
    sharePreview: unknown;
  }) {
    return createElement(
      "div",
      {
        "data-invite-code": input.inviteCode,
        "data-share-code": input.shareCode ?? "",
      },
      "Join invite client",
    );
  },
}));

vi.mock("@/src/lib/hosted-share/service", () => ({
  buildHostedSharePageData: mocks.buildHostedSharePageData,
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
  mocks.buildHostedSharePageData.mockResolvedValue({
    share: {
      preview: {
        kinds: ["protocol"],
        counts: {
          foods: 0,
          protocols: 1,
          recipes: 0,
          total: 1,
        },
        logMealAfterImport: false,
      },
    },
  });
});

test("JoinInvitePage passes invite status and share data into the client tree", async () => {
  const { default: JoinInvitePage } = await import("../app/join/[inviteCode]/page");

  const markup = renderToStaticMarkup(
    await JoinInvitePage({
      params: Promise.resolve({ inviteCode: "invite-code" }),
      searchParams: Promise.resolve({ share: "share-code" }),
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
  expect(mocks.buildHostedSharePageData).toHaveBeenCalledWith({
    authenticatedMember: {
      billingStatus: "active",
      createdAt: new Date("2025-03-27T08:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    },
    inviteCode: "invite-code",
    shareCode: "share-code",
  });
  assert.match(markup, /data-phone-country-code="GB"/);
  assert.match(markup, /data-invite-code="invite-code"/);
  assert.match(markup, /data-share-code="share-code"/);
});

test("JoinInvitePage keeps its route copy while inheriting the app-level Open Graph image", async () => {
  const { metadata } = await import("../app/join/[inviteCode]/page");

  expect(metadata.title).toBe("Murph hosted invite");
  expect(metadata.openGraph?.title).toBe("Murph hosted invite");
  expect(metadata.twitter?.title).toBe("Murph hosted invite");
  expect(
    existsSync(new URL("../app/join/[inviteCode]/opengraph-image.tsx", import.meta.url))
  ).toBe(false);
});
