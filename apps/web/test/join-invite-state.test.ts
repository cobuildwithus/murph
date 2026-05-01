import assert from "node:assert/strict";

import { expect, test } from "vitest";

import {
  buildJoinInviteStatusRefreshSnapshot,
  resolveJoinInviteStatusFromRefresh,
  shouldAwaitHostedInviteSessionResolution,
  shouldRefreshJoinInviteStatusFromPayload,
} from "@/src/components/hosted-onboarding/join-invite-state";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

test("verified invite refreshes do not regress back to stale verify payloads", () => {
  const refreshedStatus = resolveJoinInviteStatusFromRefresh({
    nextStatus: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
    }),
    status: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }),
  });

  expect(refreshedStatus).toMatchObject({
    session: {
      authenticated: true,
      matchesInvite: true,
    },
    stage: "checkout",
  });
});

test("signed-out verify refreshes are not masked as stale", () => {
  const refreshedStatus = resolveJoinInviteStatusFromRefresh({
    nextStatus: createStatus({
      session: {
        authenticated: false,
        expiresAt: null,
        matchesInvite: false,
      },
    }),
    status: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }),
  });

  expect(refreshedStatus).toMatchObject({
    session: {
      authenticated: false,
      matchesInvite: false,
    },
    stage: "verify",
  });
});

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

test("verify-stage auth-settling guard only holds until the first hosted refresh completes", () => {
  assert.equal(
    shouldAwaitHostedInviteSessionResolution({
      hasCompletedInitialRefresh: false,
      status: createStatus({
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: false,
        },
      }),
    }),
    true,
  );
  assert.equal(
    shouldAwaitHostedInviteSessionResolution({
      hasCompletedInitialRefresh: true,
      status: createStatus({}),
    }),
    false,
  );
  assert.equal(
    shouldAwaitHostedInviteSessionResolution({
      hasCompletedInitialRefresh: false,
      status: createStatus({
        session: {
          authenticated: false,
          expiresAt: null,
          matchesInvite: false,
        },
      }),
    }),
    false,
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
    ...statusOverrides,
  };
}
