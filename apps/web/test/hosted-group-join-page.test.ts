import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getPrisma: vi.fn(),
  readHostedConsentStatus: vi.fn(),
  readHostedGroupJoinView: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/components/hosted-groups/group-join-client", () => ({
  GroupJoinAcceptForm(props: {
    expectedMembershipId: string | null;
    groupName: string;
    inviteCode?: string | null;
    postJoinDestination: string;
  }) {
    return createElement(
      "form",
      {
        "data-group-name": props.groupName,
        "data-invite-code": props.inviteCode ?? "",
        "data-membership-id": props.expectedMembershipId ?? "none",
        "data-post-join-destination": props.postJoinDestination,
      },
      "Accept group invite",
    );
  },
  GroupJoinLeaveButton(props: {
    groupName: string;
    joinCode: string;
  }) {
    return createElement(
      "button",
      {
        "data-group-name": props.groupName,
        "data-join-code": props.joinCode,
      },
      "Leave group",
    );
  },
  GroupJoinLegalConsentGate(props: {
    initialStatus: {
      launchGranted: boolean;
      scopes: readonly { grant: unknown }[];
    } | null;
    notNowHref: string;
  }) {
    return createElement(
      "section",
      {
        "data-initial-launch-granted": String(props.initialStatus?.launchGranted ?? false),
        "data-initial-scope-grants": JSON.stringify(
          props.initialStatus?.scopes.map((scope) => scope.grant) ?? [],
        ),
        "data-legal-consent-gate": "true",
        "data-not-now-href": props.notNowHref,
      },
      "Legal consent gate",
    );
  },
  GroupJoinSignInButton(props: { inviteCode?: string | null }) {
    return createElement(
      "button",
      { "data-invite-code": props.inviteCode ?? "" },
      "Continue to join",
    );
  },
}));

vi.mock("@/src/lib/legal/consent", () => ({
  readHostedConsentStatus: mocks.readHostedConsentStatus,
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  readHostedGroupJoinView: mocks.readHostedGroupJoinView,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPrisma.mockReturnValue({ prisma: true });
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
  });
  mocks.readHostedGroupJoinView.mockResolvedValue({
    activeVaultShareProjectionKinds: [],
    activeVaultShareProjectionScopes: [],
    displayName: "Sunday Sleep Crew",
    id: "hgrp_123",
    kind: "family",
    memberCount: 1,
    requestedVaultShareProjections: [],
    status: "active",
    viewerCanLeave: false,
    viewerMembershipId: null,
    viewerMembershipStatus: null,
  });
});

test("renders the group display name on the join page when present", async () => {
  const markup = await renderGroupJoinPage("JOIN123");

  expect(mocks.readHostedGroupJoinView).toHaveBeenCalledWith({
    joinCode: "JOIN123",
    memberId: null,
    prisma: { prisma: true },
  });
  expect(mocks.readHostedConsentStatus).not.toHaveBeenCalled();
  expect(markup).toContain("Join Sunday Sleep Crew");
  expect(markup).toContain(
    "Your chats and vault. Anything you don&#x27;t choose to share stays private.",
  );
  expect(markup).not.toContain("Your chats, health data, and vault. Always.");
  expect(markup).not.toContain("Join this family");
});

test("renders launch legal consent before the join form for authenticated viewers without current consent", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    authenticatedMember: { id: "member_123" },
  });
  mocks.readHostedConsentStatus.mockResolvedValueOnce(createConsentStatus({
    launchGranted: false,
  }));

  const markup = await renderGroupJoinPage("JOIN123");

  expect(mocks.readHostedConsentStatus).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: { prisma: true },
  });
  expect(markup).toContain('data-legal-consent-gate="true"');
  expect(markup).toContain('data-initial-launch-granted="false"');
  expect(markup).toContain('aria-live="polite"');
  expect(markup).toContain('aria-label="Group join action"');
  expect(markup).not.toContain("Accept group invite");
});

test("renders launch legal consent when authenticated consent status cannot be read", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    authenticatedMember: { id: "member_123" },
  });
  mocks.readHostedConsentStatus.mockRejectedValueOnce(new Error("database unavailable"));

  const markup = await renderGroupJoinPage("JOIN123");

  expect(mocks.readHostedConsentStatus).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: { prisma: true },
  });
  expect(markup).toContain('data-legal-consent-gate="true"');
  expect(markup).toContain('data-initial-launch-granted="false"');
  expect(markup).not.toContain("Accept group invite");
});

test("passes only sanitized launch consent status to the legal consent gate", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    authenticatedMember: { id: "member_123" },
  });
  mocks.readHostedConsentStatus.mockResolvedValueOnce(createConsentStatus({
    grantedScopes: ["launch.legal"],
    launchGranted: false,
  }));

  const markup = await renderGroupJoinPage("JOIN123");

  expect(markup).toContain('data-legal-consent-gate="true"');
  expect(markup).toContain("data-initial-scope-grants=\"[null,null]\"");
  expect(markup).not.toContain("event_123");
  expect(markup).not.toContain("Accept group invite");
});

test("forwards a phone-bound invite into the authenticated join form", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    authenticatedMember: { id: "member_123" },
  });
  mocks.readHostedConsentStatus.mockResolvedValueOnce(createConsentStatus({
    launchGranted: true,
  }));

  const markup = await renderGroupJoinPage("JOIN123", {
    invite: "invite_phone_bound",
  });

  expect(markup).toContain('data-invite-code="invite_phone_bound"');
  expect(markup).toContain("Accept group invite");
  expect(markup).not.toContain('data-legal-consent-gate="true"');
  expect(markup).toContain('href="/home"');
  expect(markup).toContain("Not now");
});

test.each([
  ["initial-visit", "/home?initialVisit=true"],
  ["setup", "/join"],
  ["untrusted", "/home"],
] as const)(
  "passes the bounded %s post-auth handoff to the join form",
  async (postJoin, destination) => {
    mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
      authenticated: true,
      authenticatedMember: { id: "member_123" },
    });
    mocks.readHostedConsentStatus.mockResolvedValueOnce(createConsentStatus({
      launchGranted: true,
    }));

    const markup = await renderGroupJoinPage("JOIN123", { postJoin });

    expect(markup).toContain(`data-post-join-destination="${destination.replaceAll("&", "&amp;")}"`);
    // The decline exit must not strip the bounded handoff: the initial-visit
    // destination is one-shot and unrecoverable after this authentication.
    expect(markup).toContain(`href="${destination.replaceAll("&", "&amp;")}"`);
    expect(markup).toContain("Not now");
  },
);

test("keeps the initial-visit destination on the legal consent decline exit", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    authenticatedMember: { id: "member_123" },
  });
  mocks.readHostedConsentStatus.mockResolvedValueOnce(createConsentStatus({
    launchGranted: false,
  }));

  const markup = await renderGroupJoinPage("JOIN123", { postJoin: "initial-visit" });

  expect(markup).toContain('data-legal-consent-gate="true"');
  expect(markup).toContain('data-not-now-href="/home?initialVisit=true"');
});

test("does not send an existing group member through the new-member handoff", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    authenticatedMember: { id: "member_123" },
  });
  mocks.readHostedConsentStatus.mockResolvedValueOnce(createConsentStatus({
    launchGranted: true,
  }));
  mocks.readHostedGroupJoinView.mockResolvedValueOnce({
    activeVaultShareProjectionKinds: [],
    activeVaultShareProjectionScopes: [],
    displayName: "Sunday Sleep Crew",
    id: "hgrp_123",
    kind: "family",
    memberCount: 2,
    requestedVaultShareProjections: [],
    status: "active",
    viewerCanLeave: true,
    viewerMembershipId: "membership_existing",
    viewerMembershipStatus: "active",
  });

  const markup = await renderGroupJoinPage("JOIN123", { postJoin: "initial-visit" });

  expect(markup).toContain('data-post-join-destination="/home"');
  expect(markup).toContain('data-membership-id="membership_existing"');
  expect(markup).toContain('data-join-code="JOIN123"');
  expect(markup).toContain("Leave group");
  expect(markup).toContain('href="/home"');
  expect(markup).toContain("Go home");
});

test("keeps self-service leave available when an existing member lacks launch consent", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    authenticatedMember: { id: "member_123" },
  });
  mocks.readHostedConsentStatus.mockResolvedValueOnce(createConsentStatus({
    launchGranted: false,
  }));
  mocks.readHostedGroupJoinView.mockResolvedValueOnce({
    activeVaultShareProjectionKinds: [],
    activeVaultShareProjectionScopes: [],
    displayName: "Sunday Sleep Crew",
    id: "hgrp_123",
    kind: "family",
    memberCount: 2,
    requestedVaultShareProjections: [],
    status: "active",
    viewerCanLeave: true,
    viewerMembershipId: "membership_existing",
    viewerMembershipStatus: "active",
  });

  const markup = await renderGroupJoinPage("JOIN123");

  expect(markup).toContain('data-legal-consent-gate="true"');
  expect(markup).toContain("Leave group");
  expect(markup).not.toContain("Accept group invite");
  expect(markup).not.toContain("Go home");
});

test("does not offer self-service leave to the group owner", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    authenticatedMember: { id: "member_owner" },
  });
  mocks.readHostedConsentStatus.mockResolvedValueOnce(createConsentStatus({
    launchGranted: true,
  }));
  mocks.readHostedGroupJoinView.mockResolvedValueOnce({
    activeVaultShareProjectionKinds: [],
    activeVaultShareProjectionScopes: [],
    displayName: "Sunday Sleep Crew",
    id: "hgrp_123",
    kind: "family",
    memberCount: 2,
    requestedVaultShareProjections: [],
    status: "active",
    viewerCanLeave: false,
    viewerMembershipId: "membership_owner",
    viewerMembershipStatus: "active",
  });

  const markup = await renderGroupJoinPage("JOIN123");

  expect(markup).toContain("Accept group invite");
  expect(markup).not.toContain("Leave group");
});

// A cold-outreach recipient arrives on /groups/join/<code>?invite=<code>. If the
// page drops that invite, authentication can resolve a different provisional
// identity than the phone member first-contact just created, and the account
// they finish would not be bound to the group they meant to join.
test("forwards an invite code from the join link into the sign-in action", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: false,
    authenticatedMember: null,
  });
  mocks.readHostedGroupJoinView.mockResolvedValueOnce(createSignedOutJoinView());

  const markup = await renderGroupJoinPage("JOIN123", {
    invite: "invite_opaque",
  });

  expect(markup).toContain('data-invite-code="invite_opaque"');
  expect(markup).toContain("Continue to join");
});

test("omits an invite code when the join link carries none", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: false,
    authenticatedMember: null,
  });
  mocks.readHostedGroupJoinView.mockResolvedValueOnce(createSignedOutJoinView());

  const markup = await renderGroupJoinPage("JOIN123");

  expect(markup).toContain('data-invite-code=""');
});

function createSignedOutJoinView(): {
  activeVaultShareProjectionKinds: readonly string[];
  activeVaultShareProjectionScopes: readonly string[];
  displayName: string;
  id: string;
  kind: string;
  memberCount: number;
  requestedVaultShareProjections: readonly string[];
  status: string;
  viewerCanLeave: boolean;
  viewerMembershipId: null;
  viewerMembershipStatus: null;
} {
  return {
    activeVaultShareProjectionKinds: [],
    activeVaultShareProjectionScopes: [],
    displayName: "Sunday Sleep Crew",
    id: "hgrp_123",
    kind: "custom",
    memberCount: 2,
    requestedVaultShareProjections: [],
    status: "active",
    viewerCanLeave: false,
    viewerMembershipId: null,
    viewerMembershipStatus: null,
  };
}

async function renderGroupJoinPage(
  joinCode: string,
  searchParams?: {
    invite?: string | string[] | undefined;
    postJoin?: string | string[] | undefined;
  },
): Promise<string> {
  const { default: GroupJoinPage } = await import("../app/groups/join/[joinCode]/page");

  return renderToStaticMarkup(
    await GroupJoinPage({
      params: Promise.resolve({ joinCode }),
      ...(searchParams ? { searchParams: Promise.resolve(searchParams) } : {}),
    }),
  );
}

function createConsentStatus(input: {
  grantedScopes?: readonly string[];
  launchGranted: boolean;
}) {
  const grantedScopes = new Set(input.grantedScopes ?? (
    input.launchGranted ? ["launch.legal", "launch.health-data"] : []
  ));

  return {
    documents: [],
    generatedAt: "2026-07-08T12:00:00.000Z",
    launchGranted: input.launchGranted,
    launchScopes: [
      {
        granted: grantedScopes.has("launch.legal"),
        missingDocuments: grantedScopes.has("launch.legal") ? [] : [{ id: "terms-of-service" }],
        scope: "launch.legal",
      },
      {
        granted: grantedScopes.has("launch.health-data"),
        missingDocuments: grantedScopes.has("launch.health-data")
          ? []
          : [{ id: "consumer-health-data-notice" }],
        scope: "launch.health-data",
      },
    ],
    ok: true,
    schema: "murph.hosted-consent-status.v1",
    scopes: [
      consentScope({
        documents: [{ id: "terms-of-service" }],
        granted: grantedScopes.has("launch.legal"),
        label: "Terms",
        scope: "launch.legal",
      }),
      consentScope({
        documents: [{ id: "consumer-health-data-notice" }],
        granted: grantedScopes.has("launch.health-data"),
        label: "Health data",
        scope: "launch.health-data",
      }),
    ],
  };
}

function consentScope(input: {
  documents: readonly { id: string }[];
  granted: boolean;
  label: string;
  scope: string;
}) {
  return {
    current: input.granted,
    documents: input.documents,
    grant: input.granted ? {
      documentVersions: {},
      grantedAt: "2026-07-08T12:00:00.000Z",
      lastEventId: "event_123",
      revokedAt: null,
      scope: input.scope,
      source: "test",
      status: "granted",
      updatedAt: "2026-07-08T12:00:00.000Z",
    } : null,
    granted: input.granted,
    label: input.label,
    missingDocuments: input.granted ? [] : input.documents,
    revocable: false,
    scope: input.scope,
  };
}
