import assert from "node:assert/strict";

import { act, createElement, type ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  navigateHostedAuthRedirect: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog: (props: {
    description: string;
    onCompleted: () => void;
    title: string;
  }) => createElement(
    "div",
    null,
    createElement("p", null, props.title),
    createElement("p", null, props.description),
    createElement("button", { onClick: props.onCompleted, type: "button" }, "Complete sign in"),
  ),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  navigateHostedAuthRedirect: mocks.navigateHostedAuthRedirect,
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: ({ children, ...props }: {
    children?: ReactNode;
    onClick?: () => void;
    type?: "button";
  }) => createElement("button", props, children),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("returns signed-in group-funding visitors to the exact private URL", async () => {
  const { GroupFundingSignInButton } = await import(
    "@/src/components/hosted-groups/group-funding-sign-in-button"
  );
  const rendered = await renderClientComponent(
    createElement(GroupFundingSignInButton),
    {
      location: {
        hash: "#manage",
        href: "https://www.withmurph.ai/groups/fund/private_locator?source=message#manage",
        origin: "https://www.withmurph.ai",
        pathname: "/groups/fund/private_locator",
        search: "?source=message",
      },
    },
  );

  try {
    const completeButton = [...rendered.container.querySelectorAll("button")]
      .find((button) => button.textContent === "Complete sign in");
    assert.ok(completeButton);
    await act(async () => {
      completeButton.click();
    });

    assert.deepEqual(mocks.navigateHostedAuthRedirect.mock.calls, [[
      "/groups/fund/private_locator?source=message#manage",
    ]]);
  } finally {
    await rendered.cleanup();
  }
});
