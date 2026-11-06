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
import { JOIN_FAMILY_FEATURES } from "@/src/lib/hosted-onboarding/plan-features";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";

const mocks = vi.hoisted(() => ({
  legalConsentProps: null as Record<string, unknown> | null,
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
  JoinInviteLegalConsentIsland(input: {
    initialStatus: HostedConsentStatus | null;
    inviteCode: string;
  }) {
    mocks.legalConsentProps = input;
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
  JoinInvitePhoneVerificationIsland(input: Record<string, unknown> & {
    detail: string;
    title: string;
  }) {
    mocks.phoneVerificationProps = input;
    return createElement(
      "div",
      { "data-phone-verification-island": "true" },
      input.title,
      input.detail,
    );
  },
  JoinInviteRefreshButtonIsland() {
    return createElement("button", { type: "button" }, "Try again");
  },
  JoinInviteSignOutButtonIsland(input: { idleLabel?: string }) {
    return createElement(
      "button",
      { "data-sign-out": "true", type: "button" },
      input.idleLabel ?? "Use this invite instead",
    );
  },
  JoinInviteStatusRefreshIsland(input: Record<string, unknown>) {
    mocks.statusRefreshProps = input;
    return null;
  },
}));

beforeEach(() => {
  mocks.legalConsentProps = null;
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
          },
        }),
      }),
    }),
  );

  assert.doesNotMatch(markup, /Chat with Murph/);
  assert.match(markup, /Verify your phone\./);
  assert.match(markup, /We’ll text you a code\./);
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

test("JoinInvitePageView puts a stage on the night frame and keeps its status refresh", () => {
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

  assert.match(markup, /data-slot="link-page-surface"/);
  assert.match(markup, /html,body\{background:#1C1915\}/);
  assert.doesNotMatch(markup, /md:sticky/);
  assert.doesNotMatch(markup, /Private by default/);
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

  assert.match(markup, /Choose how to continue\./);
  assert.match(markup, /Restart Family or choose an individual plan\./);
  assert.match(markup, />Restart Family</);
  assert.match(markup, /value="Family"/);
  assert.match(markup, /value="Pulse"/);
  assert.match(markup, /value="Edge"/);
  for (const feature of JOIN_FAMILY_FEATURES) {
    assert.match(markup, new RegExp(feature.replaceAll("'", "&#x27;")));
  }
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

  assert.match(markup, /Continue Family checkout\./);
  assert.match(markup, />Continue Family checkout</);
  assert.match(markup, /Individual plans stay unavailable while this Family checkout is open\./);
  assert.doesNotMatch(markup, /Stripe/);
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

  assert.match(markup, /Family billing is in progress\./);
  assert.match(markup, /This page checks automatically/);
  assert.match(markup, /data-slot="link-page-dots"/);
  assert.doesNotMatch(markup, /Stripe/);
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

  assert.match(markup, /Resolve Family billing\./);
  assert.match(markup, />Open Family billing</);
  assert.match(markup, /Update payment details, review invoices, or cancel the plan\./);
  assert.doesNotMatch(markup, /Stripe/);
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
  expect(mocks.messagingSetupProps).toEqual({});
});

test("JoinInvitePageView keeps messaging setup before Starter activation when billing is unavailable", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        status: createStatus({
          capabilities: {
            billingReady: false,
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
  expect(mocks.messagingSetupProps).toEqual({});
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
  expect(mocks.legalConsentProps).toMatchObject({
    inviteCode: "invite-code",
  });
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
      }),
    }),
  );

  assert.match(markup, /data-messaging-setup-island="true"/);
  assert.doesNotMatch(markup, /Get Pulse/);
  expect(mocks.messagingSetupProps).toEqual({});
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

  assert.doesNotMatch(markup, /Needs support/);
  assert.match(markup, /This account can’t continue\./);
  assert.match(markup, /Contact support and we’ll help you get back in\./);
  assert.match(markup, />Contact support</);
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

  assert.match(activeMarkup, /Welcome to Murph\./);
  assert.match(activeMarkup, /Text Murph below to start\./);
  assert.doesNotMatch(activeMarkup, /Murph will text you shortly/);
  assert.doesNotMatch(activeMarkup, /What Murph can help with/);
  assert.match(activeMarkup, /href="sms:\+15550100999"/);
  assert.match(activeMarkup, /Hey Murph/);
  assert.match(activeMarkup, /Add Murph to Contacts/);
  assert.match(activatingMarkup, /Finishing your setup\./);
  assert.match(activatingMarkup, /Setup finishes in about ten seconds\./);
  assert.match(activatingMarkup, /data-slot="link-page-dots"/);
  assert.doesNotMatch(activatingMarkup, /Hey Murph/);
});

test("JoinInvitePageView sends a Telegram member to message first", () => {
  vi.stubEnv("TELEGRAM_BOT_USERNAME", "synthetic_murph_bot");
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
          stage: "active",
          telegramStartRequired: true,
        }),
      }),
    }),
  );

  vi.unstubAllEnvs();

  assert.match(markup, /Message Murph on Telegram to start\./);
  assert.match(markup, />Message Murph on Telegram</);
  assert.match(markup, /href="https:\/\/t\.me\/synthetic_murph_bot"/);
  assert.doesNotMatch(markup, /Add Murph to Contacts/);
});

test("JoinInvitePageView withholds the first message when there is no way to send it", () => {
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
          stage: "active",
        }),
      }),
    }),
  );

  assert.match(markup, /You’re all set\./);
  assert.doesNotMatch(markup, /Hey Murph/);
  assert.doesNotMatch(markup, /Text Murph/);
});

test("JoinInvitePageView shows a dead invite like every other dead link", () => {
  const invalid = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({ status: createStatus({ invite: null, stage: "invalid" }) }),
    }),
  );
  const expired = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({ status: createStatus({ stage: "expired" }) }),
    }),
  );

  assert.match(invalid, /This link isn’t working\./);
  assert.match(expired, /This link expired\./);
  for (const markup of [invalid, expired]) {
    assert.match(markup, /Ask Murph for a new one\./);
    assert.match(markup, /href="sms:"/);
    assert.doesNotMatch(markup, /Link no longer works/);
    assert.doesNotMatch(markup, /data-sign-out/);
  }
});

test("JoinInvitePageView keeps sign-out on a dead link for another account", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        status: createStatus({
          session: {
            authenticated: true,
            expiresAt: null,
            matchesInvite: false,
          },
          stage: "expired",
        }),
      }),
    }),
  );

  assert.match(markup, /This link expired\./);
  assert.match(markup, /data-sign-out="true"/);
  assert.match(markup, />Sign out</);
});

test("JoinInvitePageView recovers when legal consent fails to load", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        launchConsent: {
          errorMessage: "Could not load Murph legal consent right now.",
          gateActive: true,
          initialStatus: null,
          status: "error",
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

  assert.match(markup, /Unable to load Murph legal consent\./);
  assert.match(markup, /Could not load Murph legal consent right now\./);
  assert.match(markup, />Try again</);
  assert.doesNotMatch(markup, /Legal consent island/);
  assert.doesNotMatch(markup, /value="Pulse"/);
});

test("JoinInvitePageView prices the plan rows from the billing data", () => {
  const plans = listHostedBillingPlanPresentations().map((plan) => ({
    ...plan,
    recurringAmountUsdCents: plan.code === "launch_monthly" ? 900 : 2_500,
  }));
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createModel({
        status: createStatus({
          billing: {
            defaultPlanCode: getHostedDefaultBillingPlanCode(),
            plans,
          },
          session: {
            authenticated: false,
            expiresAt: null,
            matchesInvite: false,
          },
          stage: "checkout",
        }),
      }),
    }),
  );

  assert.match(markup, /Choose your Murph plan\./);
  assert.match(markup, /Your data stays yours, and it’s never sold\./);
  assert.match(markup, />\$9</);
  assert.match(markup, />\$25</);
  assert.match(markup, /data-checkout-plan="launch_monthly"/);
  assert.match(markup, />Get Pulse</);
  assert.doesNotMatch(markup, /personal health assistant/);
});

function createModel(
  overrides: Partial<JoinInvitePageModel> & {
    status?: HostedInviteStatusPayload;
  } = {},
): JoinInvitePageModel {
  const status = overrides.status ?? createStatus({});

  return {
    awaitingInviteSessionResolution: false,
    familyBillingRecovery: null,
    inviteCode: "invite-code",
    launchConsent: {
      gateActive: false,
      initialStatus: null,
      status: "not_required",
    },
    preview: false,
    status,
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
