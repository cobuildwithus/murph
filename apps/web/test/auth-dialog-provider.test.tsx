import { act, createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  authDialogProps: null as {
    onCompleted?: (payload: {
      activationPending: boolean;
      inviteCode: string;
      joinUrl: string;
      stage: string;
    }) => Promise<void> | void;
    open?: boolean;
  } | null,
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog(props: {
    onCompleted?: (payload: {
      activationPending: boolean;
      inviteCode: string;
      joinUrl: string;
      stage: string;
    }) => Promise<void> | void;
    open?: boolean;
  }) {
    mocks.authDialogProps = props;
    return props.open
      ? createElement(
          "button",
          {
            type: "button",
            onClick: () =>
              void props.onCompleted?.({
                activationPending: false,
                inviteCode: "invite-code",
                joinUrl: "/join/invite-code",
                stage: "active",
              }),
          },
          "Complete auth",
        )
      : null;
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("AuthProvider resumes a pending device connect intent after sign-in completion", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const assign = vi.fn();
  const reload = vi.fn();
  const claim = "dc_12345678901234567890123456789012";

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      {
        type: "button",
        onClick: openAuthDialog,
      },
      "Sign in",
    );
  }

  const rendered = await renderClientComponent(
    createElement(AuthProvider, {
      authenticated: false,
    }, createElement(OpenAuthButton)),
  );

  Object.defineProperty(rendered.window, "location", {
    configurable: true,
    value: {
      assign,
      hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
      href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
      origin: "https://join.example.test",
      pathname: "/connect",
      reload,
      search: "",
    },
  });

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  const completeButton = Array.from(rendered.container.querySelectorAll("button")).find(
    (button) => button.textContent === "Complete auth",
  );
  expect(completeButton).toBeTruthy();

  await act(async () => {
    completeButton?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(reload).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("AuthProvider resumes a private computer handoff after sign-in completion", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const assign = vi.fn();
  const reload = vi.fn();

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      {
        type: "button",
        onClick: openAuthDialog,
      },
      "Sign in",
    );
  }

  const rendered = await renderClientComponent(
    createElement(AuthProvider, {
      authenticated: false,
    }, createElement(OpenAuthButton)),
  );

  Object.defineProperty(rendered.window, "location", {
    configurable: true,
    value: {
      assign,
      hash: "",
      href: "https://join.example.test/computer/handoff/handoff-token",
      origin: "https://join.example.test",
      pathname: "/computer/handoff/handoff-token",
      reload,
      search: "",
    },
  });

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  const completeButton = Array.from(rendered.container.querySelectorAll("button")).find(
    (button) => button.textContent === "Complete auth",
  );
  expect(completeButton).toBeTruthy();

  await act(async () => {
    completeButton?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(reload).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("AuthProvider keeps the default home redirect for ordinary sign-in completion", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const assign = vi.fn();

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      {
        type: "button",
        onClick: openAuthDialog,
      },
      "Sign in",
    );
  }

  const rendered = await renderClientComponent(
    createElement(AuthProvider, {
      authenticated: false,
    }, createElement(OpenAuthButton)),
  );

  Object.defineProperty(rendered.window, "location", {
    configurable: true,
    value: {
      assign,
      hash: "",
      href: "https://join.example.test/connect",
      origin: "https://join.example.test",
      pathname: "/connect",
      search: "",
    },
  });

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  const completeButton = Array.from(rendered.container.querySelectorAll("button")).find(
    (button) => button.textContent === "Complete auth",
  );

  await act(async () => {
    completeButton?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(assign).toHaveBeenCalledWith("/home");

  await rendered.cleanup();
});
