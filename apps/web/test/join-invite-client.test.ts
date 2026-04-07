import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth", () => ({
  HostedPhoneAuth(input: { mode: string; privyAppId: string; privyClientId?: string | null }) {
    return createElement(
      "div",
      {
        "data-hosted-phone-auth": input.mode,
        "data-privy-app-id": input.privyAppId,
        "data-privy-client-id": input.privyClientId ?? "",
      },
      "Hosted phone auth",
    );
  },
}));

import {
  JoinInviteClient,
  resolveInviteStatusAfterPrivyCompletion,
  resolveJoinInviteShareStateFromAccept,
  resolveJoinInviteShareStateFromStatus,
} from "@/src/components/hosted-onboarding/join-invite-client";
import type { HostedSharePageData } from "@/src/lib/hosted-share/service";
import type { HostedInviteStatusPayload, HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

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
      privyAppId: "cm_app_123",
      shareCode: null,
      sharePreview: null,
    }),
  );

  assert.match(markup, /Text signup/);
  assert.match(markup, /Verify the number that messaged Murph to finish joining\./);
  assert.match(markup, /Verify the number that messaged Murph\./);
  assert.doesNotMatch(markup, /Invite for/);
  assert.doesNotMatch(markup, /\+1 415 555 2671/);
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
      privyAppId: "cm_app_123",
      shareCode: null,
      sharePreview: null,
    }),
  );

  assert.ok(markup.includes('href="/settings"'));
  assert.match(markup, /Manage email settings/);
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
      privyAppId: "cm_app_123",
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
