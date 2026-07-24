import assert from "node:assert/strict";

import { expect, test } from "vitest";

import {
  buildJoinInviteStatusRefreshSnapshot,
  hasResolvedHostedInviteVerification,
  resolveJoinInviteSubtitle,
  shouldRefreshJoinInviteStatusFromPayload,
} from "@/src/components/hosted-onboarding/join-invite-state";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

test("server refresh snapshots ignore stale verify payloads and refresh changed same-stage render data", () => {
  const currentStatus = createStatus({
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
    stage: "checkout",
  });
  const current = buildJoinInviteStatusRefreshSnapshot(currentStatus);

  assert.equal(
    shouldRefreshJoinInviteStatusFromPayload({
      current,
      nextStatus: createStatus({
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: true,
        },
      }),
    }),
    false,
  );
  assert.equal(
    shouldRefreshJoinInviteStatusFromPayload({
      current,
      nextStatus: currentStatus,
    }),
    false,
  );
  assert.equal(
    shouldRefreshJoinInviteStatusFromPayload({
      current,
      nextStatus: createStatus({
        capabilities: {
          billingReady: false,
        },
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: true,
        },
        stage: "checkout",
      }),
    }),
    true,
  );
});

test("verify-stage session resolution only waits for authenticated unresolved verify state", () => {
  expect(hasResolvedHostedInviteVerification(createStatus({
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: false,
    },
  }))).toBe(false);
  expect(hasResolvedHostedInviteVerification(createStatus({}))).toBe(true);
  expect(hasResolvedHostedInviteVerification(createStatus({
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
    stage: "checkout",
  }))).toBe(true);
});

test("an activated Telegram member is told to message Murph instead of being called done", () => {
  assert.equal(
    resolveJoinInviteSubtitle(createStatus({
      stage: "active",
      telegramStartRequired: true,
    })),
    "Message Murph on Telegram to start.",
  );

  assert.equal(
    resolveJoinInviteSubtitle(createStatus({ stage: "active" })),
    "You’re all set.",
  );
});

test("status refresh notices when the Telegram start requirement clears", () => {
  const current = buildJoinInviteStatusRefreshSnapshot(createStatus({
    session: { authenticated: true, expiresAt: null, matchesInvite: true },
    stage: "active",
    telegramStartRequired: true,
  }));

  assert.equal(
    shouldRefreshJoinInviteStatusFromPayload({
      current,
      nextStatus: createStatus({
        session: { authenticated: true, expiresAt: null, matchesInvite: true },
        stage: "active",
        telegramStartRequired: false,
      }),
    }),
    true,
  );
});

function createStatus(
  overrides: Omit<Partial<HostedInviteStatusPayload>, "capabilities"> & {
    capabilities?: Partial<HostedInviteStatusPayload["capabilities"]>;
  },
): HostedInviteStatusPayload {
  const { capabilities, ...statusOverrides } = overrides;

  return {
    billing: {
      defaultPlanCode: getHostedDefaultBillingPlanCode(),
      plans: listHostedBillingPlanPresentations(),
    },
    capabilities: {
      billingReady: capabilities?.billingReady ?? true,
      phoneAuthReady: capabilities?.phoneAuthReady ?? true,
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
    ...statusOverrides,
  };
}
