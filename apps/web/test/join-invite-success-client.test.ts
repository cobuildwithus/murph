import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock("@/src/components/hosted-onboarding/invite-status-client", () => ({
  useHostedInviteStatusRefresh: () => {},
}));

import { JoinInviteSuccessShell } from "@/src/components/hosted-onboarding/join-invite-success-shell";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

test("verify-stage success page keeps the copy neutral while sign-in settles", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteSuccessShell, {
      initialStatus: createStatus("verify"),
      inviteCode: "invite-code",
      shareCode: null,
    }),
  );

  assert.match(markup, /Finishing sign-in/);
  assert.match(markup, /We’re finishing sign-in and checking your hosted activation status now\./);
  assert.doesNotMatch(markup, /Payment received/);
  assert.match(markup, /Back to invite/);
});

test("blocked success page does not pretend setup is still running", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteSuccessShell, {
      initialStatus: createStatus("blocked"),
      inviteCode: "invite-code",
      shareCode: null,
    }),
  );

  assert.match(markup, /Unable to continue/);
  assert.match(markup, /We couldn’t finish activation automatically\./);
  assert.doesNotMatch(markup, /Payment received/);
  assert.doesNotMatch(markup, /We&#x27;ll keep checking automatically/);
});

function createStatus(stage: HostedInviteStatusPayload["stage"]): HostedInviteStatusPayload {
  return {
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
    },
    invite: {
      code: "invite-code",
      expiresAt: "2026-03-27T12:00:00.000Z",
      phoneHint: "+1 415 555 2671",
    },
    session: {
      authenticated: stage !== "verify",
      expiresAt: null,
      matchesInvite: stage !== "verify",
    },
    stage,
  };
}
