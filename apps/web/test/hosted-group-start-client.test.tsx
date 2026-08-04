import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { HostedOnboardingApiError } from "@/src/components/hosted-onboarding/client-api";
import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/components/hosted-onboarding/client-api")
  >();

  return {
    ...actual,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog() {
    return null;
  },
}));

const RECOVERY_LOCATION = {
  hash: "#recover=tok_group_start_example",
  href: "https://join.example.test/groups/start#recover=tok_group_start_example",
  origin: "https://join.example.test",
  pathname: "/groups/start",
  search: "",
};

let cleanupRender: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  vi.clearAllMocks();
});

test("explains the cross-account conflict without offering a retry", async () => {
  mocks.requestHostedOnboardingJson.mockRejectedValue(
    new HostedOnboardingApiError({
      code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CONFLICT",
      message: "That Messages address is already linked to another Murph setup.",
      retryable: false,
    }),
  );

  const { container, cleanup } = await renderStartClient();
  cleanupRender = cleanup;

  expect(container.textContent).toContain("That address is already set up");
  expect(container.textContent).toContain("a different Murph account");
  // The binding conflict is terminal for this link, so retrying it forever is
  // not offered, and the generic failure copy must not stand in for it.
  expect(container.querySelector("button")).toBeNull();
  expect(container.textContent).not.toContain("Try again");
  expect(container.textContent).not.toContain("That recovery link did not work");
});

test("keeps the retry action for a recovery failure that can succeed later", async () => {
  mocks.requestHostedOnboardingJson.mockRejectedValue(
    new HostedOnboardingApiError({
      code: null,
      message: "Something went wrong. Try again.",
      retryable: true,
    }),
  );

  const { container, cleanup } = await renderStartClient();
  cleanupRender = cleanup;

  expect(container.textContent).toContain("That recovery link did not work");
  expect(container.querySelector("button")?.textContent).toContain("Try again");
});

async function renderStartClient() {
  const { HostedGroupStartClient } = await import(
    "@/src/components/hosted-groups/group-start-client"
  );

  return renderClientComponent(
    createElement(HostedGroupStartClient, {
      activeAccess: false,
      authenticated: true,
    }),
    {
      location: RECOVERY_LOCATION,
      requireButton: false,
    },
  );
}
