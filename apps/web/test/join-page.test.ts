import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

import type { JoinInvitePageModel } from "@/src/components/hosted-onboarding/join-invite-page-model";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";

const mocks = vi.hoisted(() => ({
  getHostedInviteStatus: vi.fn(),
  getHostedPageAuthSnapshot: vi.fn(),
  getHostedPrivySession: vi.fn(),
  buildHostedInvitePageData: vi.fn(),
  getPrisma: vi.fn(),
  joinInvitePageViewProps: null as { model: JoinInvitePageModel } | null,
  joinInviteSuccessClientProps: null as {
    initialStatus: HostedInviteStatusPayload;
    inviteCode: string;
    preview?: boolean;
    sessionId: string | null;
  } | null,
  readHostedConsentStatus: vi.fn(),
  readHostedFamilyBillingRecoveryForOwner: vi.fn(),
  readHostedMemberOwnsSubscription: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  resourceHintOrigins: null as readonly string[] | null,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/src/components/hosted-onboarding/join-invite-page-view", () => ({
  JoinInvitePageView(input: {
    model: JoinInvitePageModel;
  }) {
    mocks.joinInvitePageViewProps = input;
    return createElement(
      "div",
      {
        "data-consent-status": input.model.launchConsent.status,
        "data-invite-code": input.model.inviteCode,
        "data-stage": input.model.status.stage,
      },
      "Join invite page view",
    );
  },
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  buildHostedInvitePageData: mocks.buildHostedInvitePageData,
  getHostedInviteStatus: mocks.getHostedInviteStatus,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/components/hosted-onboarding/join-invite-success-client", () => ({
  JoinInviteSuccessClient(input: {
    initialStatus: HostedInviteStatusPayload;
    inviteCode: string;
    preview?: boolean;
    sessionId: string | null;
  }) {
    mocks.joinInviteSuccessClientProps = input;
    return createElement(
      "div",
      {
        "data-invite-code": input.inviteCode,
        "data-preview": String(input.preview ?? false),
        "data-session-id": input.sessionId ?? "",
        "data-stage": input.initialStatus.stage,
      },
      "Join invite success",
    );
  },
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
  getHostedDashboardPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-session", () => ({
  getHostedPrivySession: mocks.getHostedPrivySession,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberOwnsSubscription: mocks.readHostedMemberOwnsSubscription,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  readHostedFamilyBillingRecoveryForOwner:
    mocks.readHostedFamilyBillingRecoveryForOwner,
}));

vi.mock("@/src/components/hosted-onboarding/phone-country-code-provider", () => ({
  PhoneCountryCodeProvider(input: { children: React.ReactNode }) {
    return createElement(
      "div",
      {
        "data-phone-country-code": "GB",
      },
      input.children,
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-privy-boundary", () => ({
  HostedPrivyBoundary(input: { children: React.ReactNode }) {
    return createElement(
      "div",
      {
        "data-hosted-privy-boundary": "true",
      },
      input.children,
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-privy-resource-hints", () => ({
  HostedPrivyResourceHints(input: { origins: readonly string[] }) {
    mocks.resourceHintOrigins = input.origins;
    return createElement("meta", {
      "data-privy-resource-hints": input.origins.join("|"),
    });
  },
}));

vi.mock("@/src/lib/legal/consent", () => ({
  readHostedConsentStatus: mocks.readHostedConsentStatus,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.joinInvitePageViewProps = null;
  mocks.joinInviteSuccessClientProps = null;
  mocks.resourceHintOrigins = null;
  mocks.getPrisma.mockReturnValue({ prisma: true });
  mocks.readHostedFamilyBillingRecoveryForOwner.mockResolvedValue(null);
  mocks.readHostedMemberOwnsSubscription.mockResolvedValue(false);
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
    session: {
      privyUserId: "test-privy-user",
      identity: {
        phone: {
          number: "+15550100271",
          verifiedAt: 1741194420,
        },
        userId: "test-privy-user",
        wallet: null,
      },
      linkedAccounts: [],
      verifiedPrivyUser: {
        id: "test-privy-user",
      },
    },
  });
  mocks.getHostedPrivySession.mockResolvedValue({
    identity: {
      phone: {
        number: "+15550100271",
        verifiedAt: 1741194420,
      },
      userId: "test-privy-user",
      wallet: null,
    },
    linkedAccounts: [],
    verifiedPrivyUser: {
      id: "test-privy-user",
    },
  });
  mocks.getHostedInviteStatus.mockResolvedValue(createStatus({
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
    stage: "verify",
  }));
  mocks.buildHostedInvitePageData.mockResolvedValue(createStatus({
    stage: "verify",
  }));
  mocks.readHostedConsentStatus.mockResolvedValue(createConsentStatus({
    launchGranted: true,
  }));
});

test("JoinLayout warms hosted Privy for the join route segment", async () => {
  const { default: JoinLayout } = await import("../app/join/layout");

  const markup = renderToStaticMarkup(
    createElement(
      JoinLayout,
      null,
      createElement("main", { "data-join-child": "true" }, "Join child"),
    ),
  );

  expect(mocks.resourceHintOrigins).toEqual(expect.arrayContaining([
    "https://auth.privy.io",
    "https://challenges.cloudflare.com",
  ]));
  assert.match(markup, /data-hosted-privy-boundary="true"/);
  assert.match(markup, /data-privy-resource-hints=/);
  assert.match(markup, /data-join-child="true"/);
});

test("JoinInvitePage builds a server model with the app-session member", async () => {
  const { default: JoinInvitePage } = await import("../app/join/[inviteCode]/page");
  const legacyShareSearchParams = { preview: undefined, share: "share-code" };

  const markup = renderToStaticMarkup(
    await JoinInvitePage({
      params: Promise.resolve({ inviteCode: "invite%20code" }),
      searchParams: Promise.resolve(legacyShareSearchParams),
    }),
  );

  expect(mocks.getHostedInviteStatus).toHaveBeenCalledWith({
    authenticatedMember: {
      billingStatus: "active",
      createdAt: new Date("2025-03-27T08:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    },
    inviteCode: "invite code",
  });
  expect(mocks.readHostedConsentStatus).not.toHaveBeenCalled();
  expect(mocks.joinInvitePageViewProps?.model).toMatchObject({
    awaitingInviteSessionResolution: false,
    expectedPrivyUserId: "test-privy-user",
    inviteCode: "invite code",
    preview: false,
    privySessionMatchesAppSession: true,
    status: {
      stage: "verify",
    },
  });
  assert.doesNotMatch(markup, /data-phone-country-code/);
  assert.doesNotMatch(markup, /data-hosted-privy-boundary/);
  assert.match(markup, /data-invite-code="invite code"/);
  assert.doesNotMatch(markup, /data-share-code/);
});

test.each([
  "incomplete",
  "paused",
] as const)(
  "JoinInvitePage sends a matched %s member with an existing subscription to recovery",
  async (billingStatus) => {
    const { default: JoinInvitePage } = await import("../app/join/[inviteCode]/page");
    mocks.readHostedMemberOwnsSubscription.mockResolvedValueOnce(true);
    mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
      authenticated: true,
      authenticatedMember: {
        billingStatus,
        createdAt: new Date("2026-07-03T08:00:00.000Z"),
        id: `member_${billingStatus}`,
        suspendedAt: null,
        updatedAt: new Date("2026-07-13T08:00:00.000Z"),
      },
      session: {
        privyUserId: "test-privy-user",
        identity: null,
        linkedAccounts: [],
        verifiedPrivyUser: { id: "test-privy-user" },
      },
    });
    mocks.getHostedInviteStatus.mockResolvedValueOnce(createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "active",
    }));

    await expect(JoinInvitePage({
      params: Promise.resolve({ inviteCode: "invite-code" }),
      searchParams: Promise.resolve({ preview: undefined }),
    })).rejects.toThrow("NEXT_REDIRECT:/settings#subscription");

    expect(mocks.redirect).toHaveBeenCalledWith("/settings#subscription");
    expect(mocks.joinInvitePageViewProps).toBeNull();
  },
);

test("JoinInvitePage leaves a suspended paused member in the blocked flow", async () => {
  const { default: JoinInvitePage } = await import("../app/join/[inviteCode]/page");
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "paused",
      createdAt: new Date("2026-07-03T08:00:00.000Z"),
      id: "member_suspended",
      suspendedAt: new Date("2026-07-20T08:00:00.000Z"),
      updatedAt: new Date("2026-07-20T08:00:00.000Z"),
    },
    session: {
      privyUserId: "test-privy-user",
      identity: null,
      linkedAccounts: [],
      verifiedPrivyUser: { id: "test-privy-user" },
    },
  });
  mocks.getHostedInviteStatus.mockResolvedValueOnce(createStatus({
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
    stage: "blocked",
  }));

  const markup = renderToStaticMarkup(await JoinInvitePage({
    params: Promise.resolve({ inviteCode: "invite-code" }),
    searchParams: Promise.resolve({ preview: undefined }),
  }));

  expect(mocks.redirect).not.toHaveBeenCalled();
  expect(mocks.joinInvitePageViewProps?.model.status.stage).toBe("blocked");
  assert.match(markup, /data-stage="blocked"/);
});

test("JoinInvitePage keeps Privy-only sessions out of invite and legal gates", async () => {
  const { default: JoinInvitePage } = await import("../app/join/[inviteCode]/page");
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });
  mocks.getHostedInviteStatus.mockResolvedValueOnce(createStatus({
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
    stage: "verify",
  }));

  const markup = renderToStaticMarkup(
    await JoinInvitePage({
      params: Promise.resolve({ inviteCode: "invite-code" }),
      searchParams: Promise.resolve({ preview: undefined }),
    }),
  );

  expect(mocks.getHostedPrivySession).toHaveBeenCalled();
  expect(mocks.getHostedInviteStatus).toHaveBeenCalledWith({
    authenticatedMember: null,
    inviteCode: "invite-code",
  });
  expect(mocks.readHostedConsentStatus).not.toHaveBeenCalled();
  expect(mocks.joinInvitePageViewProps?.model).toMatchObject({
    launchConsent: {
      gateActive: false,
      status: "not_required",
    },
    status: {
      session: {
        authenticated: false,
        matchesInvite: false,
      },
      stage: "verify",
    },
  });
  assert.match(markup, /data-consent-status="not_required"/);
});

test("JoinInvitePage gates checkout on server-read launch consent", async () => {
  const { default: JoinInvitePage } = await import("../app/join/[inviteCode]/page");
  const consentStatus = createConsentStatus({
    launchGranted: false,
    withGrant: true,
  });
  mocks.getHostedInviteStatus.mockResolvedValue(createStatus({
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
    stage: "checkout",
  }));
  mocks.readHostedConsentStatus.mockResolvedValue(consentStatus);

  const markup = renderToStaticMarkup(
    await JoinInvitePage({
      params: Promise.resolve({ inviteCode: "invite-code" }),
      searchParams: Promise.resolve({ preview: undefined }),
    }),
  );

  expect(mocks.readHostedConsentStatus).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: { prisma: true },
  });
  expect(mocks.joinInvitePageViewProps?.model.launchConsent).toMatchObject({
    gateActive: true,
    status: "required",
  });
  expect(
    mocks.joinInvitePageViewProps?.model.launchConsent.initialStatus?.scopes.map(
      (scope) => scope.grant,
    ),
  ).toEqual([null, null]);
  assert.match(markup, /data-consent-status="required"/);
});

test.each(["available", "checkout", "syncing"] as const)(
  "JoinInvitePage derives %s Family recovery from the authenticated owner group",
  async (familyBillingRecovery) => {
    const { default: JoinInvitePage } = await import("../app/join/[inviteCode]/page");
    mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
      authenticated: true,
      authenticatedMember: {
        billingStatus: "not_started",
        createdAt: new Date("2026-07-03T08:00:00.000Z"),
        id: "member_family_owner",
        suspendedAt: null,
        updatedAt: new Date("2026-07-28T08:00:00.000Z"),
      },
      session: {
        privyUserId: "test-privy-user",
        identity: null,
        linkedAccounts: [],
        verifiedPrivyUser: { id: "test-privy-user" },
      },
    });
    mocks.getHostedInviteStatus.mockResolvedValueOnce(createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }));
    mocks.readHostedConsentStatus.mockResolvedValueOnce(createConsentStatus({
      launchGranted: true,
    }));
    mocks.readHostedFamilyBillingRecoveryForOwner.mockResolvedValueOnce(
      familyBillingRecovery,
    );

    renderToStaticMarkup(
      await JoinInvitePage({
        params: Promise.resolve({ inviteCode: "family-recovery-invite" }),
        searchParams: Promise.resolve({ preview: undefined }),
      }),
    );

    expect(mocks.readHostedFamilyBillingRecoveryForOwner).toHaveBeenCalledWith({
      ownerMemberId: "member_family_owner",
      prisma: { prisma: true },
    });
    expect(mocks.joinInvitePageViewProps?.model.familyBillingRecovery).toBe(
      familyBillingRecovery,
    );
  },
);

test("JoinInvitePage keeps first-time checkout independent of Family recovery reads", async () => {
  const { default: JoinInvitePage } = await import("../app/join/[inviteCode]/page");
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });
  mocks.getHostedInviteStatus.mockResolvedValueOnce(createStatus({
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
    stage: "verify",
  }));

  renderToStaticMarkup(
    await JoinInvitePage({
      params: Promise.resolve({ inviteCode: "first-time-invite" }),
      searchParams: Promise.resolve({ preview: undefined }),
    }),
  );

  expect(mocks.readHostedFamilyBillingRecoveryForOwner).not.toHaveBeenCalled();
  expect(mocks.joinInvitePageViewProps?.model.familyBillingRecovery).toBeNull();
});

test("JoinInvitePage projects linked accounts to a minimal Telegram setup seed", async () => {
  const { default: JoinInvitePage } = await import("../app/join/[inviteCode]/page");
  mocks.getHostedPrivySession.mockResolvedValueOnce({
    identity: {
      phone: null,
      userId: "test-privy-user",
      wallet: null,
    },
    linkedAccounts: [
      {
        address: "hidden@example.test",
        type: "email",
      },
      {
        first_name: "Do",
        id: "telegram-test-user",
        last_name: "Not Serialize",
        photo_url: "https://example.test/avatar.png",
        privateMetadata: "do-not-serialize",
        type: "telegram",
        username: "murph_test",
      },
    ],
    verifiedPrivyUser: {
      id: "test-privy-user",
    },
  });
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      createdAt: new Date("2025-03-27T08:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    },
    linkedAccounts: [],
    session: {
      privyUserId: "test-privy-user",
      identity: null,
      linkedAccounts: [],
      verifiedPrivyUser: {
        id: "test-privy-user",
      },
    },
  });
  mocks.getHostedInviteStatus.mockResolvedValueOnce(createStatus({
    messagingSetupRequired: true,
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
    stage: "checkout",
  }));
  mocks.readHostedConsentStatus.mockResolvedValueOnce(createConsentStatus({
    launchGranted: true,
  }));

  renderToStaticMarkup(
    await JoinInvitePage({
      params: Promise.resolve({ inviteCode: "invite-code" }),
      searchParams: Promise.resolve({ preview: undefined }),
    }),
  );

  expect(mocks.joinInvitePageViewProps?.model.telegramAccountForMessagingSetup).toEqual({
    telegramUserId: "telegram-test-user",
    username: "murph_test",
  });
});

test("JoinInvitePage withholds Telegram seed when the fresh Privy user does not match", async () => {
  const { default: JoinInvitePage } = await import("../app/join/[inviteCode]/page");
  mocks.getHostedPrivySession.mockResolvedValueOnce({
    identity: {
      phone: null,
      userId: "different-privy-user",
      wallet: null,
    },
    linkedAccounts: [
      {
        id: "telegram-test-user",
        type: "telegram",
        username: "murph_test",
      },
    ],
    verifiedPrivyUser: {
      id: "different-privy-user",
    },
  });
  mocks.getHostedInviteStatus.mockResolvedValueOnce(createStatus({
    messagingSetupRequired: true,
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
    stage: "checkout",
  }));
  mocks.readHostedConsentStatus.mockResolvedValueOnce(createConsentStatus({
    launchGranted: true,
  }));

  renderToStaticMarkup(
    await JoinInvitePage({
      params: Promise.resolve({ inviteCode: "invite-code" }),
      searchParams: Promise.resolve({ preview: undefined }),
    }),
  );

  expect(mocks.joinInvitePageViewProps?.model).toMatchObject({
    expectedPrivyUserId: "test-privy-user",
    privySessionMatchesAppSession: false,
    telegramAccountForMessagingSetup: null,
  });
});

test("JoinInvitePage keeps route copy and uses a dedicated Open Graph image", async () => {
  const { generateMetadata } = await import("../app/join/[inviteCode]/page");
  const metadata = await generateMetadata({
    params: Promise.resolve({ inviteCode: "invite-code" }),
  });

  expect(metadata.title).toBe("Murph invite");
  expect(metadata.description).toBe(
    "Finish signup, then add a phone number or connect Telegram so Murph can reach you.",
  );
  expect(metadata.openGraph?.title).toBe("Murph invite");
  expect(metadata.openGraph?.images).toEqual([
    expect.objectContaining({
      url: "/join/invite-code/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
  expect(metadata.twitter?.title).toBe("Murph invite");
  expect(metadata.twitter?.images).toEqual([
    expect.objectContaining({
      url: "/join/invite-code/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
  expect(
    existsSync(new URL("../app/join/[inviteCode]/opengraph-image.tsx", import.meta.url))
  ).toBe(true);
});

test("JoinInviteSuccessPage keeps the invite preview image and setup copy", async () => {
  const { generateMetadata } = await import("../app/join/[inviteCode]/success/page");
  const metadata = await generateMetadata({
    params: Promise.resolve({ inviteCode: "invite-code" }),
  });

  expect(metadata.title).toBe("Finishing setup — Murph");
  expect(metadata.description).toBe(
    "Finish setting up your Murph account after checkout.",
  );
  expect(metadata.openGraph?.images).toEqual([
    expect.objectContaining({
      url: "/join/invite-code/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
  expect(metadata.twitter?.images).toEqual([
    expect.objectContaining({
      url: "/join/invite-code/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
});

test("JoinInviteSuccessPage tolerates malformed percent-encoded success params", async () => {
  const { default: JoinInviteSuccessPage } = await import("../app/join/[inviteCode]/success/page");

  const markup = renderToStaticMarkup(
    await JoinInviteSuccessPage({
      params: Promise.resolve({ inviteCode: "invite%zz" }),
      searchParams: Promise.resolve({ session_id: "checkout%zz" }),
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
    inviteCode: "invite%zz",
  });
  expect(mocks.joinInviteSuccessClientProps).toMatchObject({
    inviteCode: "invite%zz",
    sessionId: "checkout%zz",
  });
  assert.match(markup, /data-invite-code="invite%zz"/);
  assert.match(markup, /data-session-id="checkout%zz"/);
});

test("JoinInviteCancelPage keeps the invite preview image and pause copy", async () => {
  const { generateMetadata } = await import("../app/join/[inviteCode]/cancel/page");
  const metadata = await generateMetadata({
    params: Promise.resolve({ inviteCode: "invite-code" }),
  });

  expect(metadata.title).toBe("Checkout paused — Murph");
  expect(metadata.description).toBe(
    "Return to your Murph invite when you are ready to finish checkout.",
  );
  expect(metadata.openGraph?.images).toEqual([
    expect.objectContaining({
      url: "/join/invite-code/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
  expect(metadata.twitter?.images).toEqual([
    expect.objectContaining({
      url: "/join/invite-code/opengraph-image",
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

function createStatus(
  overrides: Partial<HostedInviteStatusPayload> & {
    capabilities?: Partial<HostedInviteStatusPayload["capabilities"]>;
  },
): HostedInviteStatusPayload {
  return {
    billing: {
      defaultPlanCode: getHostedDefaultBillingPlanCode(),
      plans: listHostedBillingPlanPresentations(),
    },
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
      ...overrides.capabilities,
    },
    invite: {
      code: "invite-code",
      expiresAt: "2026-03-27T12:00:00.000Z",
      phoneAuthTarget: {
        kind: "saved",
        phoneHint: "*** 2671",
      },
      phoneHint: "*** 2671",
      verificationMode: "invite_phone",
    },
    messagingSetupRequired: overrides.messagingSetupRequired ?? false,
    murphPhoneNumber: overrides.murphPhoneNumber ?? null,
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
    stage: "verify",
    telegramStartRequired: false,
    ...overrides,
  };
}

function createConsentStatus(input: {
  launchGranted: boolean;
  withGrant?: boolean;
}): HostedConsentStatus {
  const legalDocument = consentDocument("terms-of-service", "Murph Terms of Service", "/legal/terms");
  const healthDocument = consentDocument(
    "consumer-health-data-notice",
    "Murph Consumer Health Data Notice",
    "/consumer-health-data-privacy-policy",
  );
  const documents = [legalDocument, healthDocument];
  const grant = input.withGrant
    ? {
        documentVersions: {
          "terms-of-service": "2026-07-23",
        },
        grantedAt: "2026-04-30T00:00:00.000Z",
        lastEventId: "event_123",
        revokedAt: null,
        scope: "launch.legal",
        source: "test",
        status: "granted" as const,
        updatedAt: "2026-04-30T00:00:00.000Z",
      }
    : null;

  return {
    documents,
    generatedAt: "2026-04-30T00:00:00.000Z",
    launchGranted: input.launchGranted,
    launchScopes: [
      {
        granted: input.launchGranted,
        missingDocuments: input.launchGranted ? [] : [legalDocument],
        scope: "launch.legal",
      },
      {
        granted: input.launchGranted,
        missingDocuments: input.launchGranted ? [] : [healthDocument],
        scope: "launch.health-data",
      },
    ],
    ok: true,
    schema: "murph.hosted-consent-status.v1",
    scopes: [
      consentScope("launch.legal", "Terms, privacy, and AI disclosure", [legalDocument], input.launchGranted, grant),
      consentScope(
        "launch.health-data",
        "Health data notice and processing authorization",
        [healthDocument],
        input.launchGranted,
        grant,
      ),
    ],
  };
}

function consentDocument(
  id: HostedConsentStatus["documents"][number]["id"],
  title: string,
  href: string,
): HostedConsentStatus["documents"][number] {
  return {
    href,
    id,
    pdfHref: `${href}.pdf`,
    title,
    version: "2026-07-23",
  };
}

function consentScope(
  scope: HostedConsentStatus["scopes"][number]["scope"],
  label: string,
  documents: HostedConsentStatus["documents"],
  granted: boolean,
  grant: HostedConsentStatus["scopes"][number]["grant"],
): HostedConsentStatus["scopes"][number] {
  return {
    current: granted,
    documents,
    grant,
    granted,
    label,
    missingDocuments: granted ? [] : documents,
    revocable: false,
    scope,
  };
}
