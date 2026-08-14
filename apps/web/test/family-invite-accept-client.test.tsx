import {
  act,
  createElement,
  type ButtonHTMLAttributes,
} from "react";
import { afterEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  authDialogProps: null as {
    autoSendPastedPhoneNumber?: boolean;
    description: string;
    onOpenChange: (open: boolean) => void;
    open: boolean;
    requireLaunchConsentOnCompletion?: boolean;
    title: string;
  } | null,
  navigateHostedAuthRedirect: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.routerPush,
  }),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog(props: {
    autoSendPastedPhoneNumber?: boolean;
    description: string;
    onCompleted: () => void;
    onOpenChange: (open: boolean) => void;
    open: boolean;
    requireLaunchConsentOnCompletion?: boolean;
    title: string;
  }) {
    mocks.authDialogProps = props;
    return createElement("div", {
      "data-auth-dialog-open": String(props.open),
    });
  },
}));

vi.mock("@/src/components/hosted-onboarding/client-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/components/hosted-onboarding/client-api")
  >("@/src/components/hosted-onboarding/client-api");
  return {
    ...actual,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  navigateHostedAuthRedirect: mocks.navigateHostedAuthRedirect,
}));

vi.mock("@/src/components/settings/hosted-settings-sync-helpers", () => ({
  toErrorMessage: () => "error",
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: ({
    children,
    className,
    size,
    variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: string;
    variant?: string;
  }) => createElement(
    "button",
    {
      ...props,
      className,
      "data-size": size,
      "data-variant": variant,
    },
    children,
  ),
}));

let cleanupRender: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  mocks.authDialogProps = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("renders the Messages alternative as a compact ghost button and opens sign-in", async () => {
  const { FamilyInviteSignInButton } = await import(
    "@/src/components/family/family-invite-accept-client"
  );
  const { button, cleanup, window } = await renderClientComponent(
    createElement(FamilyInviteSignInButton, {
      bindingLabel: "phone number",
      variant: "link",
    }),
  );
  cleanupRender = cleanup;

  expect(button.textContent).toBe("Prefer not to text?");
  expect(button.getAttribute("data-variant")).toBe("ghost");
  expect(button.getAttribute("data-size")).toBe("sm");
  expect(button.className.split(/\s+/u)).toContain("w-fit");
  expect(mocks.authDialogProps).toMatchObject({
    description: "Use the same phone number this invite was sent to.",
    open: false,
    requireLaunchConsentOnCompletion: true,
    title: "Sign in to join Murph Family",
  });
  expect(mocks.authDialogProps?.autoSendPastedPhoneNumber).toBeUndefined();

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.authDialogProps?.open).toBe(true);
});

test("links an active Family draft conflict to Settings and preserves the invite", async () => {
  const { HostedOnboardingApiError } = await import(
    "@/src/components/hosted-onboarding/client-api"
  );
  mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
    new HostedOnboardingApiError({
      code: "HOSTED_FAMILY_DRAFT_CHECKOUT_ACTIVE",
      message: "Resolve the unfinished Family checkout first.",
    }),
  );
  const { FamilyInviteWebAcceptButton } = await import(
    "@/src/components/family/family-invite-accept-client"
  );
  const inviteCode = "invite_return_target";
  const rendered = await renderClientComponent(
    createElement(FamilyInviteWebAcceptButton, { inviteCode }),
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(rendered.container.textContent).toContain("Open Family settings");
  const recoveryButton = [...rendered.window.document.querySelectorAll("button")]
    .find((button) => button.textContent === "Open Family settings");
  expect(recoveryButton).toBeTruthy();
  await act(async () => {
    recoveryButton?.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  expect(mocks.routerPush).toHaveBeenCalledWith(
    "/settings?familyInviteReturn=%2Ffamily%2Faccept%2Finvite_return_target#subscription",
  );
});
