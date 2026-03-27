import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth", () => ({
  HostedPhoneAuth(input: { mode: string; privyAppId: string }) {
    return createElement(
      "div",
      {
        "data-hosted-phone-auth": input.mode,
        "data-privy-app-id": input.privyAppId,
      },
      "Hosted phone auth",
    );
  },
}));

import { JoinInviteClient } from "@/src/components/hosted-onboarding/join-invite-client";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

beforeEach(() => {
  vi.clearAllMocks();
});

test("JoinInviteClient keeps the fallback copy when phone auth is ready but the public app id is missing", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
      inviteCode: "invite-code",
      privyAppId: null,
      shareCode: null,
      sharePreview: null,
    }),
  );

  assert.match(markup, /Phone signup is not configured for this environment yet\./);
  assert.doesNotMatch(markup, /data-hosted-phone-auth=/);
});

function createStatus(
  overrides: Partial<HostedInviteStatusPayload> & {
    capabilities?: Partial<HostedInviteStatusPayload["capabilities"]>;
  },
): HostedInviteStatusPayload {
  return {
    capabilities: {
      billingReady: true,
      phoneAuthReady: false,
      ...overrides.capabilities,
    },
    invite: {
      code: "invite-code",
      expiresAt: "2026-03-27T12:00:00.000Z",
      phoneHint: "+1 415 555 2671",
      status: "opened",
    },
    member: {
      billingStatus: "pending",
      hasWallet: false,
      phoneHint: "+1 415 555 2671",
      phoneVerified: false,
      status: "pending",
      walletAddress: null,
      walletChainType: null,
    },
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
    stage: "register",
    ...overrides,
  };
}
