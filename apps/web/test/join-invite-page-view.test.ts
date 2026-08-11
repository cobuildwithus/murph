import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

import { JoinInvitePageView } from "@/src/components/hosted-onboarding/join-invite-page-view";
import type { JoinInvitePageModel } from "@/src/components/hosted-onboarding/join-invite-page-model";
import { buildJoinInviteStatusRefreshSnapshot } from "@/src/components/hosted-onboarding/join-invite-state";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";

const mocks = vi.hoisted(() => ({
  starterUsageProps: null as Record<string, unknown> | null,
  messagingSetupProps: null as Record<string, unknown> | null,
  phoneVerificationProps: null as Record<string, unknown> | null,
  statusRefreshProps: null as Record<string, unknown> | null,
}));

vi.mock("@/src/components/hosted-onboarding/join-invite-starter-usage-island", () => ({
  JoinInviteStarterUsageIsland(input: Record<string, unknown>) {
    mocks.starterUsageProps = input;
    return createElement("div", { "data-starter-usage-island": "true" });
  },
}));

vi.mock("@/src/components/hosted-onboarding/join-invite-islands", () => ({
  JoinInviteCheckoutPlanButtonIsland(input: { idleLabel: string; planCode: string | null }) {
    return createElement(
      "button",
      {
        "data-checkout-plan": input.planCode ?? "",
        type: "button",
      },
      input.idleLabel,
    );
  },
  JoinInviteLegalConsentIsland(input: { initialStatus: HostedConsentStatus | null }) {
    return createElement(
      "div",
      {
        "data-initial-launch-granted": String(input.initialStatus?.launchGranted ?? false),
        "data-legal-consent-island": "true",
      },
      "Legal consent island",
    );
  },
  JoinInviteMessagingSetupIsland(input: Record<string, unknown>) {
    mocks.messagingSetupProps = input;
    return createElement("div", { "data-messaging-setup-island": "true" });
  },
  JoinInvitePhoneVerificationIsland(input: Record<string, unknown>) {
    mocks.phoneVerificationProps = input;
    return createElement("div", { "data-phone-verification-island": "true" });
  },
  JoinInviteRefreshButtonIsland() {
    return createElement("button", { type: "button" }, "Try again");
  },
  JoinInviteSignOutButtonIsland() {
    return createElement("button", { type: "button" }, "Use this invite instead");
  },
  JoinInviteStatusRefreshIsland(input: Record<string, unknown>) {
    mocks.statusRefreshProps = input;
    return null;
  },
}));

beforeEach(() => {
  mocks.starterUsageProps = null;
  mocks.messagingSetupProps = null;
  mocks.phoneVerificationProps = null;
  mocks.statusRefreshProps = null;
});

test("JoinInvitePageView renders verify copy without exposing the masked phone hint", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        status: createStatus({
          capabilities: {
            billingReady: true,
            phoneAuthReady: true,
          },
        }),
      }),
    }),
  );

  assert.match(markup, /Chat with Murph/);
  assert.match(markup, /Verify your phone/);
  assert.doesNotMatch(markup, /Use the number that received this join link\./);
  assert.match(markup, /data-phone-verification-island="true"/);
  assert.doesNotMatch(markup, /\*\*\* 2671/);
  assert.doesNotMatch(markup, /Telegram/);
  expect(mocks.phoneVerificationProps).toMatchObject({
    inviteCode: "invite-code",
    phoneHint: "*** 2671",
    verificationMode: "invite_phone",
  });
});

test("JoinInvitePageView renders shared auth options for manual invite verification", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        status: createStatus({
          invite: {
            code: "invite-code",
            expiresAt: "2026-03-27T12:00:00.000Z",
            phoneAuthTarget: {
              kind: "manual",
            },
            phoneHint: null,
            verificationMode: "manual_phone",
          },
        }),
      }),
    }),
  );

  assert.match(markup, /Log in or sign up/);
  assert.match(markup, /Choose phone, Telegram, or email to continue with this invite\./);
  assert.match(markup, /data-phone-verification-island="true"/);
  assert.doesNotMatch(markup, /Add the phone number Murph should use for your private conversations\./);
});

test("JoinInvitePageView renders invite email verification without phone setup copy", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        status: createStatus({
          invite: {
            code: "invite-code",
            emailAuthTarget: {
              emailAddress: "buddy@example.com",
              kind: "saved",
            },
            expiresAt: "2026-03-27T12:00:00.000Z",
            phoneAuthTarget: {
              kind: "manual",
            },
            phoneHint: null,
            verificationMode: "invite_email",
          },
          messagingSetupRequired: false,
        }),
      }),
    }),
  );

  assert.match(markup, /Verify your email/);
  assert.match(markup, /Use the iMessage email address that received this join link\./);
  assert.match(markup, /data-phone-verification-island="true"/);
  assert.doesNotMatch(markup, /Add your phone/);
  assert.doesNotMatch(markup, /Add your phone or Telegram/);
  expect(mocks.phoneVerificationProps).toMatchObject({
    emailAuthTarget: {
      emailAddress: "buddy@example.com",
      kind: "saved",
    },
    inviteCode: "invite-code",
    phoneAuthTarget: {
      kind: "manual",
    },
    phoneHint: null,
    verificationMode: "invite_email",
  });
});

test("JoinInvitePageView keeps the desktop invite rail sticky", () => {
  const model = createModel({
    launchConsent: {
      gateActive: false,
      initialStatus: createConsentStatus({ launchGranted: true }),
      status: "granted",
    },
    status: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }),
  });
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model,
    }),
  );

  assert.match(markup, /md:sticky/);
  assert.match(markup, /md:top-0/);
  assert.match(markup, /md:h-svh/);
  assert.match(markup, /data-starter-usage-island="true"/);
  expect(mocks.statusRefreshProps).toMatchObject({
    current: buildJoinInviteStatusRefreshSnapshot(model.status),
    inviteCode: "invite-code",
    legalGateActive: false,
    disabled: false,
  });
});

test("JoinInvitePageView starts non-expiring Starter usage instead of rendering pricing", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        launchConsent: {
          gateActive: false,
          initialStatus: createConsentStatus({ launchGranted: true }),
          status: "granted",
        },
        status: createStatus({
          session: {
            authenticated: true,
            expiresAt: null,
            matchesInvite: true,
          },
          stage: "checkout",
        }),
      }),
    }),
  );

  assert.match(markup, /data-starter-usage-island="true"/);
    assert.doesNotMatch(markup, /data-checkout-plan=/);
  assert.doesNotMatch(markup, /Start 14-day trial/);
  assert.doesNotMatch(markup, /Card required\. Then \$8\/month unless canceled\./);
  assert.doesNotMatch(markup, /Get Pulse/);
  assert.doesNotMatch(markup, /Get Edge/);
  expect(mocks.starterUsageProps).toMatchObject({
    inviteCode: "invite-code",
  });
});

test("JoinInvitePageView offers direct checkout and Family retry after terminal Family cleanup", () => {
  const model = createModel({
    familyBillingRecovery: "available",
    launchConsent: {
      gateActive: false,
      initialStatus: createConsentStatus({ launchGranted: true }),
      status: "granted",
    },
    status: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }),
  });
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, { model }),
  );

  assert.match(markup, /Choose how to continue/);
  assert.match(markup, /Restart Family or choose an individual plan\./);
  assert.match(markup, /Restart Family/);
  assert.match(markup, /Get Pulse/);
  assert.match(markup, /Get Edge/);
  assert.match(markup, /2 to 6 people, one bill/);
  assert.doesNotMatch(markup, /data-starter-usage-island="true"/);
  expect(mocks.statusRefreshProps).toMatchObject({
    current: buildJoinInviteStatusRefreshSnapshot(
      model.status,
      model.familyBillingRecovery,
    ),
    inviteCode: "invite-code",
    legalGateActive: false,
  });
});

test("JoinInvitePageView keeps a reusable Family checkout actionable after cancellation", () => {
  const model = createModel({
    familyBillingRecovery: "checkout",
    launchConsent: {
      gateActive: false,
      initialStatus: createConsentStatus({ launchGranted: true }),
      status: "granted",
    },
    status: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }),
  });
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, { model }),
  );

  assert.match(markup, /Continue Family checkout/);
  assert.match(markup, /Your existing Stripe checkout is ready to resume\./);
  assert.match(markup, /Your Family checkout is still open/);
  assert.match(markup, /same secure checkout/);
  assert.doesNotMatch(markup, /Restart Family/);
  assert.doesNotMatch(markup, /Get Pulse/);
  assert.doesNotMatch(markup, /Get Edge/);
  assert.doesNotMatch(markup, /data-starter-usage-island="true"/);
  expect(mocks.statusRefreshProps).toMatchObject({
    current: buildJoinInviteStatusRefreshSnapshot(
      model.status,
      model.familyBillingRecovery,
    ),
    inviteCode: "invite-code",
    legalGateActive: false,
  });
});

test("JoinInvitePageView persists Family syncing and withholds individual checkout", () => {
  const model = createModel({
    familyBillingRecovery: "syncing",
    launchConsent: {
      gateActive: false,
      initialStatus: createConsentStatus({ launchGranted: true }),
      status: "granted",
    },
    status: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }),
  });
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, { model }),
  );

  assert.match(markup, /Family billing is in progress/);
  assert.match(markup, /Your Family plan is syncing/);
  assert.match(markup, /This page checks automatically/);
  assert.doesNotMatch(markup, /Restart Family/);
  assert.doesNotMatch(markup, /Get Pulse/);
  assert.doesNotMatch(markup, /Get Edge/);
  assert.doesNotMatch(markup, /data-starter-usage-island="true"/);
  expect(mocks.statusRefreshProps).toMatchObject({
    current: buildJoinInviteStatusRefreshSnapshot(
      model.status,
      model.familyBillingRecovery,
    ),
    inviteCode: "invite-code",
    legalGateActive: false,
  });
});

test("JoinInvitePageView offers Stripe management for inactive Family billing", () => {
  const model = createModel({
    familyBillingRecovery: "manage",
    launchConsent: {
      gateActive: false,
      initialStatus: createConsentStatus({ launchGranted: true }),
      status: "granted",
    },
    status: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }),
  });
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, { model }),
  );

  assert.match(markup, /Resolve Family billing/);
  assert.match(markup, /Open Family billing/);
  assert.match(markup, /Stripe/);
  assert.doesNotMatch(markup, /Restart Family/);
  assert.doesNotMatch(markup, /Get Pulse/);
  assert.doesNotMatch(markup, /Get Edge/);
  assert.doesNotMatch(markup, /data-starter-usage-island="true"/);
});

test("JoinInvitePageView keeps messaging setup before Starter activation when messaging is required", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        status: createStatus({
          messagingSetupRequired: true,
          session: {
            authenticated: true,
            expiresAt: null,
            matchesInvite: true,
          },
          stage: "checkout",
        }),
      }),
    }),
  );

  assert.doesNotMatch(markup, /data-starter-usage-island="true"/);
  assert.match(markup, /data-messaging-setup-island="true"/);
  expect(mocks.starterUsageProps).toBeNull();
  expect(mocks.messagingSetupProps).toMatchObject({
    authenticated: true,
    expectedPrivyUserId: "privy-user-a",
    privySessionMatchesAppSession: true,
  });
});

test("JoinInvitePageView keeps messaging setup before Starter activation when billing is unavailable", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        status: createStatus({
          capabilities: {
            billingReady: false,
            phoneAuthReady: true,
          },
          messagingSetupRequired: true,
          session: {
            authenticated: true,
            expiresAt: null,
            matchesInvite: true,
          },
          stage: "checkout",
        }),
      }),
    }),
  );

  assert.doesNotMatch(markup, /data-starter-usage-island="true"/);
  assert.match(markup, /data-messaging-setup-island="true"/);
  expect(mocks.starterUsageProps).toBeNull();
  expect(mocks.messagingSetupProps).toMatchObject({
    authenticated: true,
    expectedPrivyUserId: "privy-user-a",
    privySessionMatchesAppSession: true,
  });
});

test("JoinInvitePageView hides pricing behind the server launch-consent gate", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        launchConsent: {
          gateActive: true,
          initialStatus: createConsentStatus({ launchGranted: false }),
          status: "required",
        },
        status: createStatus({
          session: {
            authenticated: true,
            expiresAt: null,
            matchesInvite: true,
          },
          stage: "checkout",
        }),
      }),
    }),
  );

  assert.match(markup, /One quick step/);
  assert.match(markup, /Legal consent island/);
  assert.doesNotMatch(markup, /data-checkout-plan=/);
  assert.doesNotMatch(markup, /Get Pulse/);
  assert.doesNotMatch(markup, /Get Edge/);
  expect(mocks.statusRefreshProps).toMatchObject({
    legalGateActive: true,
  });
});

test("JoinInvitePageView renders messaging setup before checkout pricing", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        status: createStatus({
          messagingSetupRequired: true,
          session: {
            authenticated: true,
            expiresAt: null,
            matchesInvite: true,
          },
          stage: "checkout",
        }),
        telegramAccountForMessagingSetup: {
          telegramUserId: "telegram-test-user",
          username: "murph_test",
        },
      }),
    }),
  );

  assert.match(markup, /data-messaging-setup-island="true"/);
  assert.doesNotMatch(markup, /Get Pulse/);
  expect(mocks.messagingSetupProps).toMatchObject({
    authenticated: true,
    expectedPrivyUserId: "privy-user-a",
    initialTelegramAccount: {
      telegramUserId: "telegram-test-user",
      username: "murph_test",
    },
    privySessionMatchesAppSession: true,
  });
});

test("JoinInvitePageView renders support mailto action for blocked accounts", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        status: createStatus({
          stage: "blocked",
        }),
      }),
    }),
  );

  assert.match(markup, /Needs support/);
  assert.match(markup, /Email support/);
  assert.match(markup, /mailto:support@withmurph\.ai/);
  assert.match(markup, /subject=Murph\+account\+support/);
  assert.match(markup, /Context%3A\+Invite\+or\+hosted\+account\+is\+blocked/);
});

test("JoinInvitePageView renders active and activating account states", () => {
  const activeMarkup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        launchConsent: {
          gateActive: false,
          initialStatus: createConsentStatus({ launchGranted: true }),
          status: "granted",
        },
        status: createStatus({
          murphPhoneNumber: "+15550100999",
          session: {
            authenticated: true,
            expiresAt: null,
            matchesInvite: true,
          },
          stage: "active",
        }),
      }),
    }),
  );
  const activatingMarkup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        launchConsent: {
          gateActive: false,
          initialStatus: createConsentStatus({ launchGranted: true }),
          status: "granted",
        },
        status: createStatus({
          session: {
            authenticated: true,
            expiresAt: null,
            matchesInvite: true,
          },
          stage: "activating",
        }),
      }),
    }),
  );

  assert.match(activeMarkup, /Welcome to Murph/);
  assert.match(activeMarkup, /Murph is ready whenever you are\./);
  assert.doesNotMatch(activeMarkup, /Murph will text you shortly/);
  assert.match(activeMarkup, /Text Murph/);
  assert.match(activeMarkup, /Add Murph to Contacts/);
  assert.match(activatingMarkup, /Finishing your setup/);
  assert.match(activatingMarkup, /Setting up your account and assistant/);
});

function createModel(
  overrides: Partial<JoinInvitePageModel> & {
    status?: HostedInviteStatusPayload;
  } = {},
): JoinInvitePageModel {
  const status = overrides.status ?? createStatus({});

  return {
    awaitingInviteSessionResolution: false,
    expectedPrivyUserId: "privy-user-a",
    familyBillingRecovery: null,
    inviteCode: "invite-code",
    launchConsent: {
      gateActive: false,
      initialStatus: null,
      status: "not_required",
    },
    preview: false,
    privySessionMatchesAppSession: true,
    status,
    telegramAccountForMessagingSetup: null,
    ...overrides,
  };
}

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
}): HostedConsentStatus {
  const document = {
    href: "/legal/terms",
    id: "terms-of-service" as const,
    pdfHref: "/legal/terms.pdf",
    title: "Murph Terms of Service",
    version: "2026-04-29",
  };

  return {
    documents: [document],
    generatedAt: "2026-04-30T00:00:00.000Z",
    launchGranted: input.launchGranted,
    launchScopes: [
      {
        granted: input.launchGranted,
        missingDocuments: input.launchGranted ? [] : [document],
        scope: "launch.legal",
      },
      {
        granted: true,
        missingDocuments: [],
        scope: "launch.health-data",
      },
    ],
    ok: true,
    schema: "murph.hosted-consent-status.v1",
    scopes: [
      {
        current: input.launchGranted,
        documents: [document],
        grant: null,
        granted: input.launchGranted,
        label: "Terms, privacy, and AI disclosure",
        missingDocuments: input.launchGranted ? [] : [document],
        revocable: false,
        scope: "launch.legal",
      },
    ],
  };
}
