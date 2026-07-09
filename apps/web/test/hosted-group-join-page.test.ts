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
  GroupJoinAcceptForm(props: { groupName: string }) {
    return createElement(
      "form",
      { "data-group-name": props.groupName },
      "Accept group invite",
    );
  },
  GroupJoinLegalConsentGate(props: {
    initialStatus: {
      launchGranted: boolean;
      scopes: readonly { grant: unknown }[];
    } | null;
  }) {
    return createElement(
      "section",
      {
        "data-initial-launch-granted": String(props.initialStatus?.launchGranted ?? false),
        "data-initial-scope-grants": JSON.stringify(
          props.initialStatus?.scopes.map((scope) => scope.grant) ?? [],
        ),
        "data-legal-consent-gate": "true",
      },
      "Legal consent gate",
    );
  },
  GroupJoinSignInButton() {
    return createElement("button", null, "Sign in to join");
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

test("renders the join form for authenticated viewers with current launch consent", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    authenticatedMember: { id: "member_123" },
  });
  mocks.readHostedConsentStatus.mockResolvedValueOnce(createConsentStatus({
    launchGranted: true,
  }));

  const markup = await renderGroupJoinPage("JOIN123");

  expect(markup).toContain("Accept group invite");
  expect(markup).not.toContain('data-legal-consent-gate="true"');
});

async function renderGroupJoinPage(joinCode: string): Promise<string> {
  const { default: GroupJoinPage } = await import("../app/groups/join/[joinCode]/page");

  return renderToStaticMarkup(
    await GroupJoinPage({
      params: Promise.resolve({ joinCode }),
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
