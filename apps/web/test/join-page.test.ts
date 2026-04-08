import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildHostedInvitePageData: vi.fn(),
  buildHostedSharePageData: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildHostedInvitePageData.mockResolvedValue({
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
    },
    invite: null,
    member: null,
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
    stage: "register",
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
    authenticatedMember: null,
    inviteCode: "invite-code",
  });
  expect(mocks.buildHostedSharePageData).toHaveBeenCalledWith({
    authenticatedMember: null,
    inviteCode: "invite-code",
    shareCode: "share-code",
  });
  assert.match(markup, /data-invite-code="invite-code"/);
  assert.match(markup, /data-share-code="share-code"/);
});
