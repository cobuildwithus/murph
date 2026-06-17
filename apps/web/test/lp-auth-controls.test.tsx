import {
  act,
  createElement,
  createContext,
  useContext,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { afterEach, expect, test, vi } from "vitest";

import { LandingAuthActions } from "@/app/auth-controls";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  hostedAuthPanelIslandModuleLoad: vi.fn(),
  hostedAuthPanelIslandRender: vi.fn(),
  navigateHostedAuthRedirect: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel-island", () => {
  mocks.hostedAuthPanelIslandModuleLoad();

  return {
    HostedAuthPanelIsland(props: {
      onCompleted?: (payload: {
        activationPending: boolean;
        initialVisitEligible?: boolean;
        inviteCode: string;
        joinUrl: string;
        stage: "active" | "blocked" | "checkout";
      }) => Promise<void> | void;
      requireLaunchConsentOnCompletion?: boolean;
      showPassiveLegalNotice?: boolean;
    }) {
      mocks.hostedAuthPanelIslandRender(props);

      return createElement(
        "div",
        {
          "data-hosted-auth-launch-consent":
            props.requireLaunchConsentOnCompletion ? "required" : "not-required",
          "data-hosted-auth-passive-legal-notice":
            props.showPassiveLegalNotice ? "shown" : "hidden",
        },
        "Hosted auth panel",
        createElement(
          "button",
          {
            type: "button",
            onClick: () =>
              void props.onCompleted?.({
                activationPending: false,
                initialVisitEligible: true,
                inviteCode: "invite-code",
                joinUrl: "/join/invite-code",
                stage: "active",
              }),
          },
          "Complete active auth",
        ),
        createElement(
          "button",
          {
            type: "button",
            onClick: () =>
              void props.onCompleted?.({
                activationPending: false,
                initialVisitEligible: false,
                inviteCode: "invite-code",
                joinUrl: "/join/invite-code",
                stage: "active",
              }),
          },
          "Complete existing active auth",
        ),
        createElement(
          "button",
          {
            type: "button",
            onClick: () =>
              void props.onCompleted?.({
                activationPending: false,
                inviteCode: "invite-code",
                joinUrl: "/join/invite-code",
                stage: "checkout",
              }),
          },
          "Complete checkout auth",
        ),
      );
    },
  };
});

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  navigateHostedAuthRedirect: mocks.navigateHostedAuthRedirect,
}));

async function flushHostedAuthPanelIsland() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const DialogOpenContext = createContext(false);

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog(props: { children: ReactNode; open?: boolean }) {
    return createElement(
      DialogOpenContext.Provider,
      { value: Boolean(props.open) },
      props.children,
    );
  },
  DialogContent(props: { children: ReactNode }) {
    const open = useContext(DialogOpenContext);
    return open
      ? createElement("div", { "data-dialog-content": "shown" }, props.children)
      : null;
  },
  DialogDescription(props: HTMLAttributes<HTMLParagraphElement>) {
    return createElement("p", props);
  },
  DialogHeader(props: HTMLAttributes<HTMLDivElement>) {
    return createElement("div", props);
  },
  DialogTitle(props: HTMLAttributes<HTMLHeadingElement>) {
    return createElement("h2", props);
  },
}));

let cleanupRender: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  vi.clearAllMocks();
});

test("LandingAuthActions preloads the auth panel on CTA intent and reuses the cached island on click", async () => {
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "hero",
      authLabel: "See what works for your body",
    }),
  );
  cleanupRender = cleanup;

  expect(mocks.hostedAuthPanelIslandModuleLoad).toHaveBeenCalledTimes(0);

  await act(async () => {
    button.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  });
  await flushHostedAuthPanelIsland();

  expect(mocks.hostedAuthPanelIslandModuleLoad).toHaveBeenCalledTimes(1);
  expect(mocks.hostedAuthPanelIslandRender).not.toHaveBeenCalled();
  expect(container.querySelector("[data-dialog-content='shown']")).toBeNull();

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushHostedAuthPanelIsland();

  expect(mocks.hostedAuthPanelIslandModuleLoad).toHaveBeenCalledTimes(1);
  expect(mocks.hostedAuthPanelIslandRender).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[data-dialog-content='shown']")).toBeTruthy();
});

test("LandingAuthActions opens the unified homepage auth flow", async () => {
  const { button, cleanup, window } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "hero",
      authLabel: "See what works for your body",
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await flushHostedAuthPanelIsland();

  const authPanel = window.document.querySelector(
    '[data-hosted-auth-launch-consent="required"]',
  );
  expect(authPanel).toBeTruthy();
  expect(authPanel?.getAttribute("data-hosted-auth-passive-legal-notice")).toBe(
    "hidden",
  );
  expect(window.document.body.textContent).toContain("Log in or sign up");
});

test("LandingAuthActions sends completed homepage signups through the initial-visit home dialog", async () => {
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "hero",
      authLabel: "See what works for your body",
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushHostedAuthPanelIsland();

  const completeButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Complete active auth",
  );

  await act(async () => {
    completeButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.navigateHostedAuthRedirect).toHaveBeenCalledWith(
    "/home?initialVisit=true",
  );
});

test("LandingAuthActions sends completed existing homepage logins to home without the initial-visit dialog", async () => {
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "hero",
      authLabel: "See what works for your body",
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushHostedAuthPanelIsland();

  const completeButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Complete existing active auth",
  );

  await act(async () => {
    completeButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.navigateHostedAuthRedirect).toHaveBeenCalledWith("/home");
});

test("LandingAuthActions sends existing split login completions to home without the initial-visit dialog", async () => {
  const { cleanup, container, window } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "footer",
      authLabel: "Signup",
      splitUnauthenticated: true,
    }),
  );
  cleanupRender = cleanup;

  const loginButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Log in",
  );

  await act(async () => {
    loginButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushHostedAuthPanelIsland();

  const completeButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Complete existing active auth",
  );

  await act(async () => {
    completeButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.navigateHostedAuthRedirect).toHaveBeenCalledWith("/home");
});

test("LandingAuthActions sends new split login completions through the initial-visit home dialog", async () => {
  const { cleanup, container, window } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "footer",
      authLabel: "Signup",
      splitUnauthenticated: true,
    }),
  );
  cleanupRender = cleanup;

  const loginButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Log in",
  );

  await act(async () => {
    loginButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushHostedAuthPanelIsland();

  const completeButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Complete active auth",
  );

  await act(async () => {
    completeButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.navigateHostedAuthRedirect).toHaveBeenCalledWith(
    "/home?initialVisit=true",
  );
});

test("LandingAuthActions sends split signup completions through the initial-visit home dialog", async () => {
  const { cleanup, container, window } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "footer",
      authLabel: "Signup",
      splitUnauthenticated: true,
    }),
  );
  cleanupRender = cleanup;

  const signupButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Signup",
  );

  await act(async () => {
    signupButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushHostedAuthPanelIsland();

  const completeButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Complete active auth",
  );

  await act(async () => {
    completeButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.navigateHostedAuthRedirect).toHaveBeenCalledWith(
    "/home?initialVisit=true",
  );
});

test("LandingAuthActions keeps checkout completions on the join handoff", async () => {
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "hero",
      authLabel: "See what works for your body",
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushHostedAuthPanelIsland();

  const completeButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Complete checkout auth",
  );

  await act(async () => {
    completeButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.navigateHostedAuthRedirect).toHaveBeenCalledWith("/join/invite-code");
});

test("LandingAuthActions keeps the hero CTA as one auth button", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "hero",
      authLabel: "See what works for your body",
    }),
  );
  cleanupRender = cleanup;

  const buttons = Array.from(
    container.querySelectorAll("button"),
  ) as HTMLButtonElement[];
  expect(buttons).toHaveLength(1);
  expect(buttons[0]?.textContent).toContain("See what works for your body");
});

test("LandingAuthActions splits the nav CTA when requested", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "nav",
      authLabel: "Log in or sign up",
      splitUnauthenticated: true,
    }),
  );
  cleanupRender = cleanup;

  const buttons = Array.from(
    container.querySelectorAll("button"),
  ) as HTMLButtonElement[];
  expect(buttons).toHaveLength(2);
  expect(buttons[0]?.textContent).toBe("Log in");
  expect(buttons[1]?.textContent).toBe("Signup");
});

test("LandingAuthActions split CTAs open the same unified auth modal", async () => {
  const { cleanup, container, window } = await renderClientComponent(
    createElement(LandingAuthActions, {
      authenticated: false,
      context: "footer",
      authLabel: "Signup",
      signupLabel: "Signup",
      splitUnauthenticated: true,
    }),
  );
  cleanupRender = cleanup;

  const buttons = Array.from(
    container.querySelectorAll("button"),
  ) as HTMLButtonElement[];
  expect(buttons).toHaveLength(2);
  expect(buttons[0]?.textContent).toBe("Log in");
  expect(buttons[1]?.textContent).toBe("Signup");

  await act(async () => {
    buttons[0]?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushHostedAuthPanelIsland();

  expect(container.textContent).toContain("Log in or sign up");
  expect(
    container.querySelector(
      '[data-hosted-auth-launch-consent="required"][data-hosted-auth-passive-legal-notice="hidden"]',
    ),
  ).toBeTruthy();

  await act(async () => {
    buttons[1]?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushHostedAuthPanelIsland();

  expect(container.textContent).toContain("Log in or sign up");
  expect(
    container.querySelector(
      '[data-hosted-auth-launch-consent="required"][data-hosted-auth-passive-legal-notice="hidden"]',
    ),
  ).toBeTruthy();
});

test("LandingAuthActions shows only an Open settings link for authenticated users", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(
      "div",
      null,
      createElement("button", { type: "button" }, "sentinel"),
      createElement(LandingAuthActions, {
        authenticated: true,
        context: "footer",
        authLabel: "Start your first experiment",
      }),
    ),
  );
  cleanupRender = cleanup;

  const links = Array.from(container.querySelectorAll("a"));
  expect(links).toHaveLength(1);
  expect(links[0]?.getAttribute("href")).toBe("/home");
  expect(links[0]?.textContent).toContain("Start your first experiment");
  expect(container.textContent).not.toContain("Log in or sign up");
});
