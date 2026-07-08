import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  readHostedGroupJoinView: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/components/hosted-groups/group-join-client", () => ({
  GroupJoinAcceptForm(props: { groupName: string }) {
    return createElement(
      "form",
      { "data-group-name": props.groupName },
      "Accept group invite",
    );
  },
  GroupJoinSignInButton() {
    return createElement("button", null, "Sign in to join");
  },
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  readHostedGroupJoinView: mocks.readHostedGroupJoinView,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
  });
  mocks.readHostedGroupJoinView.mockResolvedValue({
    activeVaultShareProjectionKinds: [],
    displayName: "Sunday Sleep Crew",
    id: "hgrp_123",
    kind: "family",
    memberCount: 1,
    requestedVaultShareProjections: [],
    status: "active",
    viewerMembershipStatus: null,
  });
});

test("renders the group display name on the join page when present", async () => {
  const markup = await renderGroupJoinPage("JOIN123");

  expect(mocks.readHostedGroupJoinView).toHaveBeenCalledWith({
    joinCode: "JOIN123",
    memberId: null,
  });
  expect(markup).toContain("Join Sunday Sleep Crew");
  expect(markup).not.toContain("Join this family");
});

async function renderGroupJoinPage(joinCode: string): Promise<string> {
  const { default: GroupJoinPage } = await import("../app/groups/join/[joinCode]/page");

  return renderToStaticMarkup(
    await GroupJoinPage({
      params: Promise.resolve({ joinCode }),
    }),
  );
}
