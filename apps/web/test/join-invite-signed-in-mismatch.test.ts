import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

import { JoinInvitePageView } from "@/src/components/hosted-onboarding/join-invite-page-view";
import type { JoinInvitePageModel } from "@/src/components/hosted-onboarding/join-invite-page-model";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

const mocks = vi.hoisted(() => ({
  stageRendered: false,
  statusRefreshRendered: false,
}));

vi.mock("@/src/components/hosted-onboarding/join-invite-stage-server", () => ({
  isJoinInviteAutoPulseTrialReady() {
    return false;
  },
  JoinInviteStageServer() {
    mocks.stageRendered = true;
    return createElement(
      "div",
      { "data-normal-invite-stage": "true" },
      "Normal invite stage",
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/join-invite-islands", () => ({
  JoinInviteSignOutButtonIsland(input: { idleLabel?: string }) {
    return createElement(
      "button",
      { type: "button" },
      input.idleLabel ?? "Use this invite instead",
    );
  },
  JoinInviteStatusRefreshIsland() {
    mocks.statusRefreshRendered = true;
    return createElement("div", { "data-status-refresh": "true" });
  },
}));

beforeEach(() => {
  mocks.stageRendered = false;
  mocks.statusRefreshRendered = false;
});

test("JoinInvitePageView makes a signed-in account mismatch an exclusive recovery state", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, {
      model: createMismatchModel(),
    }),
  );

  assert.match(markup, /You’re already signed in/);
  assert.match(markup, /different Murph account/);
  assert.match(markup, /href="\/home"/);
  assert.match(markup, />Go to Murph home</);
  assert.match(markup, />Sign out and use invite</);
  assert.doesNotMatch(markup, /Add your phone/);
  assert.doesNotMatch(markup, /data-normal-invite-stage/);
  assert.doesNotMatch(markup, /data-status-refresh/);
  expect(mocks.stageRendered).toBe(false);
  expect(mocks.statusRefreshRendered).toBe(false);
});

test("JoinInvitePageView keeps terminal invite states ahead of account recovery", () => {
  const model = createMismatchModel();
  model.status = {
    ...model.status,
    stage: "expired",
  };

  const markup = renderToStaticMarkup(
    createElement(JoinInvitePageView, { model }),
  );

  assert.doesNotMatch(markup, /You’re already signed in/);
  assert.match(markup, /data-normal-invite-stage/);
  assert.match(markup, /data-status-refresh/);
  expect(mocks.stageRendered).toBe(true);
  expect(mocks.statusRefreshRendered).toBe(true);
});

function createMismatchModel(): JoinInvitePageModel {
  return {
    awaitingInviteSessionResolution: false,
    expectedPrivyUserId: "privy-current-account",
    familyBillingRecovery: null,
    inviteCode: "invite-code",
    launchConsent: {
      gateActive: false,
      initialStatus: null,
      status: "not_required",
    },
    preview: false,
    privySessionMatchesAppSession: true,
    status: createMismatchStatus(),
    telegramAccountForMessagingSetup: null,
  };
}

function createMismatchStatus(): HostedInviteStatusPayload {
  return {
    billing: {
      defaultPlanCode: getHostedDefaultBillingPlanCode(),
      plans: listHostedBillingPlanPresentations(),
    },
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
    },
    invite: {
      code: "invite-code",
      expiresAt: "2026-08-10T12:00:00.000Z",
      phoneAuthTarget: {
        kind: "saved",
        phoneHint: "*** 2671",
      },
      phoneHint: "*** 2671",
      verificationMode: "invite_phone",
    },
    messagingSetupRequired: false,
    murphPhoneNumber: null,
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: false,
    },
    stage: "verify",
    telegramStartRequired: false,
  };
}
