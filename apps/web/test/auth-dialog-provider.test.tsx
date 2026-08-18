import { act, createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  authDialogProps: null as {
    description?: string;
    onCompleted?: (payload: {
      activationPending: boolean;
      inviteCode: string;
      joinUrl: string;
      launchConsentGranted?: boolean;
      stage: string;
    }) => Promise<void> | void;
    open?: boolean;
    requireLaunchConsentOnCompletion?: boolean;
    title?: string;
  } | null,
  sessionInvalidationListener: null as null | ((
    source:
      | "same-document"
      | "same-document-clear"
      | "same-document-expired"
      | "cross-document"
      | "cross-document-clear"
  ) => void),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog(props: {
    description?: string;
    onCompleted?: (payload: {
      activationPending: boolean;
      inviteCode: string;
      joinUrl: string;
      launchConsentGranted?: boolean;
      stage: string;
    }) => Promise<void> | void;
    open?: boolean;
    requireLaunchConsentOnCompletion?: boolean;
    title?: string;
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

vi.mock("@/src/lib/browser-vault/session-invalidation", () => ({
  subscribeBrowserVaultSessionInvalidation(listener: (
    source:
      | "same-document"
      | "same-document-clear"
      | "same-document-expired"
      | "cross-document"
      | "cross-document-clear"
  ) => void) {
    mocks.sessionInvalidationListener = listener;
    return () => {
      if (mocks.sessionInvalidationListener === listener) {
        mocks.sessionInvalidationListener = null;
      }
    };
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.authDialogProps = null;
  mocks.sessionInvalidationListener = null;
});

test("AuthProvider reloads a document that receives a cross-tab session transition", async () => {
  const { AuthProvider } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const assign = vi.fn();
  const reload = vi.fn();
  const rendered = await renderClientComponent(
    createElement(AuthProvider, { authenticated: true }),
    { requireButton: false },
  );

  Object.defineProperty(rendered.window, "location", {
    configurable: true,
    value: {
      assign,
      hash: "",
      href: "https://join.example.test/home",
      origin: "https://join.example.test",
      pathname: "/home",
      reload,
      search: "",
    },
  });

  await act(async () => {
    mocks.sessionInvalidationListener?.("same-document");
  });
  expect(reload).not.toHaveBeenCalled();

  await act(async () => {
    mocks.sessionInvalidationListener?.("cross-document-clear");
  });
  expect(reload).not.toHaveBeenCalled();

  await act(async () => {
    mocks.sessionInvalidationListener?.("same-document-expired");
  });
  expect(reload).toHaveBeenCalledTimes(1);

  await act(async () => {
    mocks.sessionInvalidationListener?.("cross-document");
  });
  expect(reload).toHaveBeenCalledTimes(2);
  expect(assign).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("AuthProvider keeps a pending device connect intent ahead of the first-visit redirect", async () => {
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

  await act(async () => {
    await mocks.authDialogProps?.onCompleted?.({
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      stage: "active",
    });
  });

  expect(reload).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("AuthProvider returns an authenticated member to the Connect page", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      { type: "button", onClick: openAuthDialog },
      "Log in or sign up",
    );
  }

  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(OpenAuthButton),
    ),
    {
      location: {
        hash: "",
        href: "https://join.example.test/connect",
        origin: "https://join.example.test",
        pathname: "/connect",
        search: "",
      },
    },
  );

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  await act(async () => {
    await mocks.authDialogProps?.onCompleted?.({
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      stage: "active",
    });
  });

  expect(rendered.reload).toHaveBeenCalledTimes(1);
  expect(rendered.assign).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("AuthProvider resumes a scrubbed Clinical Records connect intent after sign-in", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const { takeClinicalRecordsConnectIntentFromBrowser } = await import(
    "@/src/lib/clinical-records/browser-connect-intent"
  );
  const claim = `cr_${"a".repeat(32)}`;

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      { type: "button", onClick: openAuthDialog },
      "Sign in",
    );
  }

  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(OpenAuthButton),
    ),
    {
      location: {
        hash: `#clinicalRecordsIntent=${claim}`,
        href: `https://join.example.test/records/connect#clinicalRecordsIntent=${claim}`,
        origin: "https://join.example.test",
        pathname: "/records/connect",
        search: "",
      },
    },
  );

  expect(takeClinicalRecordsConnectIntentFromBrowser({
    preserveForAuthReload: true,
  })).toBe(claim);
  const stagedState = rendered.replaceState.mock.lastCall?.[0];
  Object.defineProperty(rendered.window.history, "state", {
    configurable: true,
    value: stagedState,
  });
  rendered.window.location.hash = "";
  rendered.window.location.href = "https://join.example.test/records/connect";

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  await act(async () => {
    await mocks.authDialogProps?.onCompleted?.({
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      stage: "active",
    });
  });

  expect(rendered.reload).toHaveBeenCalledTimes(1);
  expect(rendered.assign).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("AuthProvider does not resume Clinical Records connect without a valid staged intent", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      { type: "button", onClick: openAuthDialog },
      "Sign in",
    );
  }

  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(OpenAuthButton),
    ),
    {
      location: {
        hash: "",
        href: "https://join.example.test/records/connect",
        origin: "https://join.example.test",
        pathname: "/records/connect",
        search: "",
      },
    },
  );
  Object.defineProperty(rendered.window.history, "state", {
    configurable: true,
    value: null,
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

  expect(rendered.assign).toHaveBeenCalledWith("/home");
  expect(rendered.reload).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("AuthProvider resumes the exact generic Clinical Records launcher after sign-in", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      { type: "button", onClick: openAuthDialog },
      "Sign in",
    );
  }

  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(OpenAuthButton),
    ),
    {
      location: {
        hash: "",
        href: "https://join.example.test/records/connect?launch=clinical-records",
        origin: "https://join.example.test",
        pathname: "/records/connect",
        search: "?launch=clinical-records",
      },
    },
  );

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", {
      bubbles: true,
    }));
  });
  const completeButton = Array.from(
    rendered.container.querySelectorAll("button"),
  ).find((button) => button.textContent === "Complete auth");
  expect(completeButton).toBeTruthy();
  await act(async () => {
    completeButton?.dispatchEvent(new rendered.window.Event("click", {
      bubbles: true,
    }));
  });

  expect(rendered.reload).toHaveBeenCalledTimes(1);
  expect(rendered.assign).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("AuthProvider returns an unauthenticated medical-records viewer to that page", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      { type: "button", onClick: openAuthDialog },
      "Sign in",
    );
  }

  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(OpenAuthButton),
    ),
    {
      location: {
        hash: "",
        href: "https://join.example.test/records",
        origin: "https://join.example.test",
        pathname: "/records",
        search: "",
      },
    },
  );

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  await act(async () => {
    await mocks.authDialogProps?.onCompleted?.({
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      stage: "active",
    });
  });

  expect(rendered.reload).toHaveBeenCalledTimes(1);
  expect(rendered.assign).not.toHaveBeenCalled();
  await rendered.cleanup();
});

test("AuthProvider returns an Environment voice user to that page", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      { type: "button", onClick: openAuthDialog },
      "Sign in",
    );
  }

  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(OpenAuthButton),
    ),
    {
      location: {
        hash: "",
        href: "https://join.example.test/environment",
        origin: "https://join.example.test",
        pathname: "/environment",
        search: "",
      },
    },
  );

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  await act(async () => {
    await mocks.authDialogProps?.onCompleted?.({
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      stage: "active",
    });
  });

  expect(rendered.reload).toHaveBeenCalledTimes(1);
  expect(rendered.assign).not.toHaveBeenCalled();
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

test("AuthProvider resumes privacy-only authentication without consent or stage gating", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const assign = vi.fn();
  const reload = vi.fn();

  function OpenAuthButton() {
    const { openDataPrivacyAuthDialog } = useAuth();
    return createElement(
      "button",
      {
        type: "button",
        onClick: openDataPrivacyAuthDialog,
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
      href: "https://join.example.test/settings/data-privacy",
      origin: "https://join.example.test",
      pathname: "/settings/data-privacy",
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
  expect(mocks.authDialogProps).toMatchObject({
    description:
      "Use the email address or phone number already linked to your Murph account.",
    requireLaunchConsentOnCompletion: false,
    title: "Log in to manage your data",
  });

  await act(async () => {
    await mocks.authDialogProps?.onCompleted?.({
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      launchConsentGranted: false,
      stage: "checkout",
    });
  });

  expect(reload).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("AuthProvider preserves a Group payment return through sign-in", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const assign = vi.fn();
  const reload = vi.fn();

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      { type: "button", onClick: openAuthDialog },
      "Sign in",
    );
  }

  const rendered = await renderClientComponent(
    createElement(AuthProvider, {
      authenticated: false,
    }, createElement(OpenAuthButton)),
  );
  const search = "?startGroup=payment_method_saved";
  const href =
    `https://join.example.test/settings${search}#subscription`;
  Object.defineProperty(rendered.window, "location", {
    configurable: true,
    value: {
      assign,
      hash: "#subscription",
      href,
      origin: "https://join.example.test",
      pathname: "/settings",
      reload,
      search,
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

  expect(rendered.window.location.href).toBe(href);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test.each([
  {
    label: "exact recovery handoff",
    resumes: true,
    search: "?usageRecovery=true",
  },
  {
    label: "recovery handoff with extra state",
    resumes: false,
    search: "?usageRecovery=true&context=extra",
  },
  {
    label: "repeated recovery handoff",
    resumes: false,
    search: "?usageRecovery=true&usageRecovery=true",
  },
])("AuthProvider scopes the Settings usage recovery return: $label", async ({ resumes, search }) => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const assign = vi.fn();
  const reload = vi.fn();

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      { type: "button", onClick: openAuthDialog },
      "Sign in",
    );
  }

  const href = `https://join.example.test/settings${search}#subscription`;
  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(OpenAuthButton),
    ),
  );
  Object.defineProperty(rendered.window, "location", {
    configurable: true,
    value: {
      assign,
      hash: "#subscription",
      href,
      origin: "https://join.example.test",
      pathname: "/settings",
      reload,
      search,
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

  if (resumes) {
    expect(rendered.window.location.href).toBe(href);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  } else {
    expect(assign).toHaveBeenCalledWith("/home");
    expect(reload).not.toHaveBeenCalled();
  }

  await rendered.cleanup();
});

test.each([
  {
    label: "exact Family invite",
    resumes: true,
    search:
      "?familyInviteReturn=%2Ffamily%2Faccept%2Fcurrent_username_invite",
  },
  {
    label: "external Family invite",
    resumes: false,
    search:
      "?familyInviteReturn=https%3A%2F%2Fexample.test%2Ffamily%2Faccept%2Finvite_123",
  },
  {
    label: "malformed Family invite",
    resumes: false,
    search: "?familyInviteReturn=%2Ffamily%2Faccept%2Finvite%20123",
  },
  {
    label: "repeated Family invite",
    resumes: false,
    search:
      "?familyInviteReturn=%2Ffamily%2Faccept%2Finvite_123&familyInviteReturn=%2Ffamily%2Faccept%2Finvite_456",
  },
])("AuthProvider scopes Family invite return resume: $label", async ({ resumes, search }) => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const assign = vi.fn();
  const reload = vi.fn();

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      { type: "button", onClick: openAuthDialog },
      "Sign in",
    );
  }

  const href = `https://join.example.test/settings${search}#subscription`;
  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(OpenAuthButton),
    ),
  );
  Object.defineProperty(rendered.window, "location", {
    configurable: true,
    value: {
      assign,
      hash: "#subscription",
      href,
      origin: "https://join.example.test",
      pathname: "/settings",
      reload,
      search,
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

  if (resumes) {
    expect(rendered.window.location.href).toBe(href);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  } else {
    expect(assign).toHaveBeenCalledWith("/home");
    expect(reload).not.toHaveBeenCalled();
  }

  await rendered.cleanup();
});

test("AuthProvider preserves a usage-credit Checkout return through sign-in", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      { type: "button", onClick: openAuthDialog },
      "Sign in",
    );
  }

  const search = "?usageCheckout=success&usagePurchase=hucp_abcdefghijklmnop";
  const href = `https://join.example.test/settings${search}#subscription`;
  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(OpenAuthButton),
    ),
    {
      location: {
        hash: "#subscription",
        href,
        origin: "https://join.example.test",
        pathname: "/settings",
        search,
      },
    },
  );

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  const completeButton = Array.from(rendered.container.querySelectorAll("button")).find(
    (button) => button.textContent === "Complete auth",
  );
  await act(async () => {
    completeButton?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(rendered.window.location.href).toBe(href);
  expect(rendered.reload).toHaveBeenCalledTimes(1);
  expect(rendered.assign).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test.each([
  {
    label: "Edge completion",
    resumes: true,
    search: "?planUpdate=launch_edge_monthly",
  },
  {
    label: "Pulse completion",
    resumes: true,
    search: "?planUpdate=launch_monthly",
  },
  {
    label: "cancellation",
    resumes: true,
    search: "?planUpdate=canceled",
  },
  {
    label: "unsupported Group target",
    resumes: false,
    search: "?planUpdate=launch_group_monthly",
  },
  {
    label: "malformed target",
    resumes: false,
    search: "?planUpdate=edge",
  },
  {
    label: "repeated return",
    resumes: false,
    search: "?planUpdate=launch_edge_monthly&planUpdate=canceled",
  },
])("AuthProvider scopes plan-change return resume: $label", async ({ resumes, search }) => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const assign = vi.fn();
  const reload = vi.fn();

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      { type: "button", onClick: openAuthDialog },
      "Sign in",
    );
  }

  const rendered = await renderClientComponent(
    createElement(AuthProvider, {
      authenticated: false,
    }, createElement(OpenAuthButton)),
  );
  const href = `https://join.example.test/settings${search}#subscription`;
  Object.defineProperty(rendered.window, "location", {
    configurable: true,
    value: {
      assign,
      hash: "#subscription",
      href,
      origin: "https://join.example.test",
      pathname: "/settings",
      reload,
      search,
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

  if (resumes) {
    expect(rendered.window.location.href).toBe(href);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  } else {
    expect(assign).toHaveBeenCalledWith("/home");
    expect(reload).not.toHaveBeenCalled();
  }

  await rendered.cleanup();
});

test("AuthProvider keeps the ordinary home redirect for settings without a signed payment return", async () => {
  const { AuthProvider, useAuth } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const assign = vi.fn();
  const reload = vi.fn();

  function OpenAuthButton() {
    const { openAuthDialog } = useAuth();
    return createElement(
      "button",
      { type: "button", onClick: openAuthDialog },
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
      href: "https://join.example.test/settings?action=start_pulse_now",
      origin: "https://join.example.test",
      pathname: "/settings",
      reload,
      search: "?action=start_pulse_now",
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

  // A partial return is not a return, so the resume branch must stay scoped.
  expect(assign).toHaveBeenCalledWith("/home");
  expect(reload).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("AuthProvider can re-authenticate an already signed-in page and reload the current URL", async () => {
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
      "Sign in again",
    );
  }

  const rendered = await renderClientComponent(
    createElement(AuthProvider, {
      authenticated: true,
    }, createElement(OpenAuthButton)),
  );

  Object.defineProperty(rendered.window, "location", {
    configurable: true,
    value: {
      assign,
      hash: "",
      href: "https://join.example.test/settings",
      origin: "https://join.example.test",
      pathname: "/settings",
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

test("ComputerHandoffAuthRequiredState opens the shared auth dialog on mount", async () => {
  const { AuthProvider } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const { ComputerHandoffAuthRequiredState } = await import(
    "@/src/components/computer-use/computer-handoff-auth-required"
  );

  const rendered = await renderClientComponent(
    createElement(AuthProvider, {
      authenticated: false,
    }, createElement(ComputerHandoffAuthRequiredState)),
    { requireButton: false },
  );

  expect(rendered.container.textContent).toContain("Sign in to open this private page");
  expect(mocks.authDialogProps?.open).toBe(true);

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
      href: "https://join.example.test/search",
      origin: "https://join.example.test",
      pathname: "/search",
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

test("AuthProvider reloads plain home so it can read canonical onboarding state", async () => {
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
      "Sign up",
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
      href: "https://join.example.test/home",
      origin: "https://join.example.test",
      pathname: "/home",
      search: "",
    },
  });

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  await act(async () => {
    await mocks.authDialogProps?.onCompleted?.({
      activationPending: false,
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      stage: "active",
    });
  });

  expect(assign).toHaveBeenCalledWith("https://join.example.test/home");

  await rendered.cleanup();
});
