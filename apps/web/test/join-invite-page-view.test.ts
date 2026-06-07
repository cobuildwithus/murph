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
  messagingSetupProps: null as Record<string, unknown> | null,
  phoneVerificationProps: null as Record<string, unknown> | null,
  statusRefreshProps: null as Record<string, unknown> | null,
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
  assert.match(markup, /Use the number that received this join link\./);
  assert.match(markup, /data-phone-verification-island="true"/);
  assert.doesNotMatch(markup, /\*\*\* 2671/);
  assert.doesNotMatch(markup, /Telegram/);
  expect(mocks.phoneVerificationProps).toMatchObject({
    inviteCode: "invite-code",
    phoneHint: "*** 2671",
    verificationMode: "invite_phone",
  });
});

test("JoinInvitePageView keeps manual phone fallback copy out of Telegram setup", () => {
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

  assert.match(markup, /Add your phone/);
  assert.match(markup, /Add the phone number Murph should use for experiment check-ins\./);
  assert.match(markup, /data-phone-verification-island="true"/);
  assert.doesNotMatch(markup, /Telegram/);
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
  assert.match(markup, /Get Pulse/);
  expect(mocks.statusRefreshProps).toMatchObject({
    current: buildJoinInviteStatusRefreshSnapshot(model.status),
    inviteCode: "invite-code",
    legalGateActive: false,
    disabled: false,
  });
});

test("JoinInvitePageView renders Pulse Trial billing disclosure", () => {
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

  assert.match(markup, /Pulse Trial/);
  assert.match(markup, /Card required\. Then \$8\/month unless canceled\./);
  assert.doesNotMatch(markup, /hosted AI usage/);
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
    initialTelegramAccount: {
      telegramUserId: "telegram-test-user",
      username: "murph_test",
    },
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
  assert.match(activeMarkup, /Text Murph/);
  assert.match(activeMarkup, /Add Murph to Contacts/);
  assert.match(activatingMarkup, /Finishing your setup/);
  assert.match(activatingMarkup, /Setting up your vault and assistant/);
});

function createModel(
  overrides: Partial<JoinInvitePageModel> & {
    status?: HostedInviteStatusPayload;
  } = {},
): JoinInvitePageModel {
  const status = overrides.status ?? createStatus({});

  return {
    awaitingInviteSessionResolution: false,
    inviteCode: "invite-code",
    launchConsent: {
      gateActive: false,
      initialStatus: null,
      status: "not_required",
    },
    preview: false,
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
