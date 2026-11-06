import { act, createElement } from "react";
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
      detail: "Choose phone, Telegram, or email to continue with this invite.",
      inviteCode: "invite-code",
      title: "Log in or sign up.",
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
      detail: "We’ll text you a code.",
      inviteCode: "invite-code",
      phoneAuthTarget: {
        kind: "saved",
        phoneHint: "••• 1212",
      },
      phoneHint: "••• 1212",
      title: "Verify your phone.",
      verificationMode: "invite_phone",
    }),
    { requireButton: false },
  );

  expect(container.textContent).toContain("ending in 1212");
  expect(mocks.authPanelProps).toMatchObject({ inviteCode: "invite-code", methods: ["phone"] });

  await cleanup();
});

test("a verification step keeps the sentence and ticket only while they still apply", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(JoinInvitePhoneVerificationIsland, {
      detail: "We’ll text you a code.",
      inviteCode: "invite-code",
      phoneHint: "••• 1212",
      title: "Verify your phone.",
      verificationMode: "invite_phone",
    }),
    { requireButton: false },
  );
  const onViewChange = mocks.authPanelProps?.onViewChange;
  if (typeof onViewChange !== "function") {
    throw new Error("Expected the verification view callback.");
  }

  expect(container.textContent).toContain("We’ll text you a code.");
  expect(container.textContent).toContain("Meet Murph");

  await act(async () => {
    onViewChange("auth-active");
  });
  expect(container.textContent).toContain("Verify your phone.");
  expect(container.textContent).not.toContain("We’ll text you a code.");
  expect(container.textContent).not.toContain("Meet Murph");
  expect(container.textContent).not.toContain("ending in 1212");

  await act(async () => {
    onViewChange("consent");
  });
  expect(container.textContent).toContain("One quick step.");
  expect(container.textContent).not.toContain("Verify your phone.");
  expect(container.querySelector('[data-hosted-auth-panel="true"]')).not.toBeNull();

  await cleanup();
});

test("each verification mode keeps its own headline", () => {
  const inMode = (verificationMode: string) => ({
    invite: { verificationMode },
    stage: "verify",
  }) as HostedInviteStatusPayload;

  expect(resolveJoinInviteTitle(inMode("invite_phone"))).toBe("Verify your phone.");
  expect(resolveJoinInviteTitle(inMode("invite_email"))).toBe("Verify your email.");
  expect(resolveJoinInviteTitle(inMode("manual_phone"))).toBe("Log in or sign up.");
});

test("open invite copy describes the shared authentication choices", () => {
  const status = {
    invite: {
      verificationMode: "manual_phone",
    },
    stage: "verify",
  } as HostedInviteStatusPayload;

  expect(resolveJoinInviteTitle(status)).toBe("Log in or sign up.");
  expect(resolveJoinInviteSubtitle(status)).toBe(
    "Choose phone, Telegram, or email to continue with this invite.",
  );
});
