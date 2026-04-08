import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostedInviteStatus: vi.fn(),
  logout: vi.fn(),
  usePrivy: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: mocks.usePrivy,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-invite-phone-auth", () => ({
  HostedInvitePhoneAuth() {
    return createElement(
      "div",
      {
        "data-hosted-invite-phone-auth": "true",
      },
      "Hosted invite phone auth",
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/invite-status-client", () => ({
  fetchHostedInviteStatus: mocks.fetchHostedInviteStatus,
  useHostedInviteStatusRefresh: () => {},
}));

import {
  JoinInviteClient,
  resolveInviteStatusAfterPrivyCompletion,
  resolveJoinInviteShareStateFromAccept,
  resolveJoinInviteShareStateFromStatus,
  shouldAwaitHostedInviteSessionResolution,
} from "@/src/components/hosted-onboarding/join-invite-client";
import type { HostedSharePageData } from "@/src/lib/hosted-share/service";
import type { HostedInviteStatusPayload, HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usePrivy.mockReturnValue({
    authenticated: false,
    logout: mocks.logout,
    ready: true,
  });
});

test("verify-stage invite copy stays neutral and does not expose the masked phone hint", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
      inviteCode: "invite-code",
      shareCode: null,
      sharePreview: null,
    }),
  );

  assert.match(markup, /Text signup/);
  assert.match(markup, /Verify the number that messaged Murph to finish joining\./);
  assert.doesNotMatch(markup, /What happens next/);
  assert.doesNotMatch(markup, /Invite for/);
  assert.doesNotMatch(markup, /\+1 415 555 2671/);
  assert.match(markup, /data-hosted-invite-phone-auth="true"/);
});

test("verify-stage invite waits for Privy readiness before showing phone auth", () => {
  mocks.usePrivy.mockReturnValue({
    authenticated: false,
    logout: mocks.logout,
    ready: false,
  });

  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
      inviteCode: "invite-code",
      shareCode: null,
      sharePreview: null,
    }),
  );

  assert.match(markup, /Checking your signup state/);
  assert.match(markup, /One moment while we pick up your verified phone session\./);
  assert.doesNotMatch(markup, /data-hosted-invite-phone-auth=/);
});

test("verify-stage invite waits for the auth-backed status refresh when Privy is already authenticated", () => {
  mocks.usePrivy.mockReturnValue({
    authenticated: true,
    logout: mocks.logout,
    ready: true,
  });

  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
      inviteCode: "invite-code",
      shareCode: null,
      sharePreview: null,
    }),
  );

  assert.match(markup, /Checking your signup state/);
  assert.doesNotMatch(markup, /data-hosted-invite-phone-auth=/);
});

test("active invite state links to hosted settings with client navigation markup", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: true,
        },
        stage: "active",
      }),
      inviteCode: "invite-code",
      shareCode: null,
      sharePreview: null,
    }),
  );

  assert.ok(markup.includes('href="/settings"'));
  assert.match(markup, /Manage settings/);
});

test("activating invite state explains that payment finished and setup is still running", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: true,
        },
        stage: "activating",
      }),
      inviteCode: "invite-code",
      shareCode: "share-code",
      sharePreview: {
        kinds: ["food"],
        counts: {
          foods: 1,
          protocols: 0,
          recipes: 0,
          total: 1,
        },
        logMealAfterImport: false,
      },
    }),
  );

  assert.match(markup, /We’re setting up your account/);
  assert.match(markup, /Payment received\. We&#x27;re setting up your account\./);
  assert.match(markup, /We&#x27;ll add your shared bundle after setup finishes\./);
});

test("invite share preview renders the generic bundle copy from the tiny summary", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
      inviteCode: "invite-code",
      shareCode: "share-code",
      sharePreview: {
        kinds: ["food", "recipe"],
        counts: {
          foods: 1,
          protocols: 0,
          recipes: 1,
          total: 2,
        },
        logMealAfterImport: true,
      },
    }),
  );

  assert.match(markup, /Add after signup: Shared bundle/);
  assert.match(markup, /1 food · 1 recipe/);
  assert.match(markup, /Murph will also log the shared food after import\./);
});

test("pending share acceptance stays in processing instead of announcing success", () => {
  assert.equal(
    resolveJoinInviteShareStateFromAccept({
      alreadyImported: false,
      imported: false,
      pending: true,
    }),
    "processing",
  );
});

test("share status only resolves to completed after the async import is consumed", () => {
  assert.equal(
    resolveJoinInviteShareStateFromStatus(createShareStatus("processing")),
    "processing",
  );
  assert.equal(
    resolveJoinInviteShareStateFromStatus(createShareStatus("consumed")),
    "completed",
  );
});

test("resolveInviteStatusAfterPrivyCompletion marks the invite session authenticated and matched", () => {
  const nextStatus = resolveInviteStatusAfterPrivyCompletion(
    createStatus({
      stage: "verify",
    }),
    createCompletionPayload("checkout"),
  );

  expect(nextStatus).toMatchObject({
    session: {
      authenticated: true,
      matchesInvite: true,
    },
    stage: "checkout",
  });
});

test("verify-stage auth-settling guard only holds while Privy session state is unresolved", () => {
  assert.equal(
    shouldAwaitHostedInviteSessionResolution({
      authenticated: false,
      ready: false,
      status: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
    }),
    true,
  );
  assert.equal(
    shouldAwaitHostedInviteSessionResolution({
      authenticated: true,
      ready: true,
      status: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
    }),
    true,
  );
  assert.equal(
    shouldAwaitHostedInviteSessionResolution({
      authenticated: false,
      ready: true,
      status: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
    }),
    false,
  );
  assert.equal(
    shouldAwaitHostedInviteSessionResolution({
      authenticated: true,
      ready: true,
      status: createStatus({
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: true,
        },
      }),
    }),
    false,
  );
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
    },
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
    stage: "verify",
    ...overrides,
  };
}

function createShareStatus(stage: HostedSharePageData["stage"]): HostedSharePageData {
  return {
    inviteCode: "invite-code",
    session: {
      active: true,
      authenticated: true,
    },
    share: {
      acceptedByCurrentMember: true,
      consumed: stage === "consumed",
      expiresAt: "2026-03-27T12:00:00.000Z",
      preview: {
        kinds: ["food"],
        counts: {
          foods: 1,
          protocols: 0,
          recipes: 0,
          total: 1,
        },
        logMealAfterImport: false,
      },
    },
    stage,
  };
}

function createCompletionPayload(stage: HostedPrivyCompletionPayload["stage"]): HostedPrivyCompletionPayload {
  return {
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage,
  };
}
