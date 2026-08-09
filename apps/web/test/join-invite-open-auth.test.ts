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
  completeAuth: vi.fn(),
  emailAuthProps: null as Record<string, unknown> | null,
  logout: vi.fn(),
  phoneAuthProps: null as Record<string, unknown> | null,
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
    replace: vi.fn(),
  }),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    logout: mocks.logout,
  }),
  useUser: () => ({ user: null }),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel", () => ({
  HostedAuthPanel(props: Record<string, unknown>) {
    mocks.authPanelProps = props;
    return createElement(
      "div",
      { "data-hosted-auth-panel": "true" },
      "Shared Murph auth",
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-email-auth-button", () => ({
  HostedEmailAuthButton(props: Record<string, unknown>) {
    mocks.emailAuthProps = props;
    return createElement(
      "div",
      { "data-hosted-email-auth": "true" },
      "Email auth",
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-invite-phone-auth", () => ({
  HostedInvitePhoneAuth(props: Record<string, unknown>) {
    mocks.phoneAuthProps = props;
    return createElement(
      "div",
      { "data-hosted-phone-auth": "true" },
      "Phone auth",
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/use-hosted-auth-completion", () => ({
  useHostedAuthCompletion: () => ({
    completeAuth: mocks.completeAuth,
    completingMethod: null,
    errorMessage: null,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authPanelProps = null;
  mocks.emailAuthProps = null;
  mocks.phoneAuthProps = null;
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
  expect(mocks.emailAuthProps).toBeNull();
  expect(mocks.phoneAuthProps).toBeNull();

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

test("targeted phone invites keep their locked phone verification", async () => {
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

  expect(container.querySelector('[data-hosted-phone-auth="true"]')).not.toBeNull();
  expect(mocks.phoneAuthProps).toMatchObject({
    inviteCode: "invite-code",
    phoneAuthTarget: {
      kind: "saved",
      phoneHint: "••• 1212",
    },
    phoneHint: "••• 1212",
  });
  expect(mocks.authPanelProps).toBeNull();

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
