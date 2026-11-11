import { act, createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { HostedOnboardingApiError } from "@/src/components/hosted-onboarding/client-api";
import { renderClientComponent } from "./render-client-component";

type AuthCompletion = {
  joinUrl: string;
  stage: "active" | "blocked" | "checkout";
};

const mocks = vi.hoisted(() => ({
  authPanelProps: null as {
    onCompleted?: (payload: AuthCompletion) => Promise<void> | void;
    requireLaunchConsentOnCompletion?: boolean;
  } | null,
  navigateHostedAuthRedirect: vi.fn(),
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

vi.mock("@/src/components/hosted-onboarding/hosted-first-party-auth-panel", () => ({
  HostedFirstPartyAuthPanel(props: NonNullable<typeof mocks.authPanelProps>) {
    mocks.authPanelProps = props;
    return null;
  },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  navigateHostedAuthRedirect: mocks.navigateHostedAuthRedirect,
  reloadCurrentHostedAuthDocument: vi.fn(),
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
  mocks.authPanelProps = null;
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

test("finishes an on-page sign-in through the group's own recovery", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({ ok: true, status: "linked" });

  const { container, cleanup, replaceState } = await renderStartClient({
    authenticated: false,
  });
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(mocks.authPanelProps).not.toBeNull();
  });
  expect(container.textContent).toContain("Set up Murph for this group.");
  expect(mocks.authPanelProps?.requireLaunchConsentOnCompletion).toBe(true);
  expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();

  await act(async () => {
    await mocks.authPanelProps?.onCompleted?.({
      joinUrl: "/join/invite-code",
      stage: "active",
    });
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    payload: { token: "tok_group_start_example" },
    url: "/api/groups/start/recover",
  });
  expect(replaceState).toHaveBeenCalledTimes(1);
  expect(mocks.navigateHostedAuthRedirect).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Go back to the group.");
  expect(container.querySelector('a[href="sms:"]')?.textContent).toContain("Open Messages");
});

test("retains active sign-in after recovery fails and an explicit retry succeeds", async () => {
  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("Temporary recovery failure"))
    .mockResolvedValueOnce({ ok: true, status: "linked" });
  const { container, cleanup } = await renderStartClient({ authenticated: false });
  cleanupRender = cleanup;

  await vi.waitFor(() => expect(mocks.authPanelProps).not.toBeNull());
  await act(async () => {
    await mocks.authPanelProps?.onCompleted?.({
      joinUrl: "/join/invite-code",
      stage: "active",
    });
  });
  expect(container.textContent).toContain("That recovery link did not work");
  const retry = container.querySelector("button");
  expect(retry?.textContent).toContain("Try again");
  await act(async () => {
    retry?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Go back to the group.");
  expect(container.querySelector('a[href="sms:"]')?.textContent).toContain("Open Messages");
  expect(container.textContent).not.toContain("Finish setting up Murph");
  expect(mocks.navigateHostedAuthRedirect).not.toHaveBeenCalled();
});

test("sends an unfinished account to setup after an on-page sign-in", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({ ok: true, status: "linked" });

  const { cleanup } = await renderStartClient({ authenticated: false });
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(mocks.authPanelProps).not.toBeNull();
  });
  await act(async () => {
    await mocks.authPanelProps?.onCompleted?.({
      joinUrl: "/join/invite-code",
      stage: "checkout",
    });
  });

  expect(mocks.navigateHostedAuthRedirect).toHaveBeenCalledWith("/join/invite-code");
});

async function renderStartClient({ authenticated = true }: { authenticated?: boolean } = {}) {
  const { HostedGroupStartClient } = await import(
    "@/src/components/hosted-groups/group-start-client"
  );

  return renderClientComponent(
    createElement(HostedGroupStartClient, {
      activeAccess: false,
      authenticated,
    }),
    {
      location: RECOVERY_LOCATION,
      requireButton: false,
    },
  );
}
