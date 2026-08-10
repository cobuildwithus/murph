import { act, createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

type AuthCompletion = {
  joinUrl: string;
  stage: "active" | "activating" | "blocked" | "checkout";
};

const mocks = vi.hoisted(() => ({
  authDialogProps: null as {
    onCompleted?: (payload: AuthCompletion) => Promise<void> | void;
    open?: boolean;
  } | null,
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog(props: {
    onCompleted?: (payload: AuthCompletion) => Promise<void> | void;
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
                joinUrl: "/join/invite-code",
                stage: "active",
              }),
          },
          "Complete Family auth",
        )
      : null;
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  mocks.authDialogProps = null;
});

test("Family setup reloads the handoff after an accessible sign-in", async () => {
  const { FamilySetupAuthRequired } = await import(
    "@/src/components/family/family-setup-auth-required"
  );
  const rendered = await renderClientComponent(
    createElement(FamilySetupAuthRequired),
    {
      location: {
        hash: "",
        href: "https://join.example.test/family/setup",
        origin: "https://join.example.test",
        pathname: "/family/setup",
        search: "",
      },
    },
  );
  const completeButton = Array.from(
    rendered.container.querySelectorAll("button"),
  ).find((button) => button.textContent === "Complete Family auth");

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
