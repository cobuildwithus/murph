import { createElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { JoinInvitePhoneVerificationIsland } from "@/src/components/hosted-onboarding/join-invite-islands";
import {
  resolveJoinInviteSubtitle,
  resolveJoinInviteTitle,
} from "@/src/components/hosted-onboarding/join-invite-state";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  authPanelProps: null as Record<string, unknown> | null,
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
    replace: vi.fn(),
  }),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-first-party-auth-panel", () => ({
  HostedFirstPartyAuthPanel(props: Record<string, unknown>) {
    mocks.authPanelProps = props;
    return createElement(
      "div",
      { "data-hosted-auth-panel": "true" },
      "Shared Murph auth",
    );
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authPanelProps = null;
});

test("open invites reuse the shared auth panel with every supported method", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(JoinInvitePhoneVerificationIsland, {
      inviteCode: "invite-code",
      verificationMode: "manual_phone",
    }),
    { requireButton: false },
  );

  expect(container.querySelector('[data-hosted-auth-panel="true"]')).not.toBeNull();
  expect(mocks.authPanelProps).toMatchObject({
    inviteCode: "invite-code",
    methods: ["phone", "email", "telegram"],
    onCompleted: expect.any(Function),
    onSignOut: expect.any(Function),
    requireLaunchConsentOnCompletion: true,
    size: "compact",
  });

  const onCompleted = mocks.authPanelProps?.onCompleted;
  if (typeof onCompleted !== "function") {
    throw new Error("Expected shared auth completion callback.");
  }
  await onCompleted();
  expect(mocks.refresh).toHaveBeenCalledTimes(1);

  const onSignOut = mocks.authPanelProps?.onSignOut;
  if (typeof onSignOut !== "function") {
    throw new Error("Expected shared auth sign-out callback.");
  }
  await onSignOut();
  expect(mocks.refresh).toHaveBeenCalledTimes(2);

  await cleanup();
});

test("targeted phone invites retain their hint and server-bound first-party verification", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(JoinInvitePhoneVerificationIsland, {
      inviteCode: "invite-code",
      phoneAuthTarget: {
        kind: "saved",
        phoneHint: "••• 1212",
      },
      phoneHint: "••• 1212",
      verificationMode: "invite_phone",
    }),
    { requireButton: false },
  );

  expect(container.textContent).toContain("ending in 1212");
  expect(mocks.authPanelProps).toMatchObject({ inviteCode: "invite-code", methods: ["phone"] });

  await cleanup();
});

test("open invite copy describes the shared authentication choices", () => {
  const status = {
    invite: {
      verificationMode: "manual_phone",
    },
    stage: "verify",
  } as HostedInviteStatusPayload;

  expect(resolveJoinInviteTitle(status)).toBe("Log in or sign up");
  expect(resolveJoinInviteSubtitle(status)).toBe(
    "Choose phone, Telegram, or email to continue with this invite.",
  );
});
