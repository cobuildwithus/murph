import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

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
  resolveJoinInviteShareStateFromAccept,
  resolveJoinInviteShareStateFromStatus,
} from "@/src/components/hosted-onboarding/join-invite-client";
import type { HostedSharePageData } from "@/src/lib/hosted-share/service";
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
      phoneHint: "+1 415 555 2671",
      status: "registered",
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
        counts: {
          foods: 1,
          protocols: 0,
          recipes: 0,
        },
        foodTitles: ["Smoothie"],
        logMealAfterImport: false,
        protocolTitles: [],
        recipeTitles: [],
        title: "Smoothie pack",
      },
    },
    stage,
  };
}
