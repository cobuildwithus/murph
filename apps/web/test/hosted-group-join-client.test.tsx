import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import type { HostedVaultShareFixedProjectionKind } from "@murphai/hosted-execution/vault-share";
import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  authDialogProps: null as {
    description: string;
    onCompleted?: (payload: {
      initialVisitEligible?: boolean;
      stage: "active" | "activating" | "blocked" | "checkout";
    }) => Promise<void> | void;
    onOpenChange: (open: boolean) => void;
    open: boolean;
    title: string;
  } | null,
  navigateHostedAuthRedirect: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    refresh: mocks.routerRefresh,
  }),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog(props: {
    description: string;
    onCompleted?: (payload: {
      initialVisitEligible?: boolean;
      stage: "active" | "activating" | "blocked" | "checkout";
    }) => Promise<void> | void;
    onOpenChange: (open: boolean) => void;
    open: boolean;
    title: string;
  }) {
    mocks.authDialogProps = props;
    return props.open
      ? createElement("div", {
          "data-auth-description": props.description,
          "data-auth-title": props.title,
        })
      : null;
  },
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  navigateHostedAuthRedirect: mocks.navigateHostedAuthRedirect,
}));

vi.mock("@/src/components/legal/hosted-legal-consent-card", () => ({
  HostedLegalConsentCard() {
    return createElement("div", { "data-consent-card": "true" }, "Consent card");
  },
}));

let cleanupRender: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  mocks.authDialogProps = null;
  vi.clearAllMocks();
});

test("renders a not-now escape link with the group join legal consent gate", async () => {
  const { GroupJoinLegalConsentGate } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );

  const markup = renderToStaticMarkup(
    createElement(GroupJoinLegalConsentGate, { initialStatus: null }),
  );

  expect(markup).toContain('data-consent-card="true"');
  expect(markup).toContain('href="/home"');
  expect(markup).toContain("Not now");
});

test("renders optional sharing cards with visible keyboard focus treatment", async () => {
  const { GroupJoinAcceptForm } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );

  const markup = renderToStaticMarkup(
    createElement(GroupJoinAcceptForm, {
      activeVaultShareProjectionScopes: [],
      alreadyActiveMember: false,
      expectedMembershipId: null,
      groupName: "Sunday Sleep Crew",
      joinCode: "JOIN123",
      permissions: [{
        description:
          "Shares which health sources are connected. No health values.",
        label: "Health source connection status",
        projectionScope: { projectionKind: "device-sync-status.v0" },
        projectionScopeKey: "device-sync-status.v0",
      }],
      postJoinDestination: "/home",
    }),
  );

  expect(markup).toContain("Health source connection status");
  expect(markup).toContain(
    "Shares which health sources are connected. No health values.",
  );
  expect(markup).toContain("has-[:focus-visible]:ring-2");
  expect(markup).toContain('type="checkbox"');
});

test("groups the four macro nutrients into one Daily macros card, calories separate", async () => {
  const { groupJoinPermissionsForDisplay } = await import(
    "@/src/components/hosted-groups/group-join-permission-groups"
  );
  const nutrientPermission = (
    projectionKind: HostedVaultShareFixedProjectionKind,
    label: string,
  ) => ({
    description: `Shares your last 7 days of daily ${label} totals from meals in Murph, including meals imported from connected apps.`,
    label: `Daily ${label}`,
    projectionScope: { projectionKind },
    projectionScopeKey: projectionKind,
  });

  const groups = groupJoinPermissionsForDisplay([
    {
      description: "Shares your last 7 days of steps.",
      label: "Steps",
      projectionScope: { projectionKind: "steps-days.v0" },
      projectionScopeKey: "steps-days.v0",
    },
    nutrientPermission("protein-days.v0", "protein"),
    nutrientPermission("carbs-days.v0", "carbohydrate"),
    nutrientPermission("fat-days.v0", "fat"),
    nutrientPermission("fiber-days.v0", "fiber"),
    {
      description:
        "Shares your last 7 days of daily calorie totals from meals in Murph, including meals imported from connected apps.",
      label: "Daily calories",
      projectionScope: { projectionKind: "calories-days.v0" },
      projectionScopeKey: "calories-days.v0",
    },
  ]);

  expect(groups).toEqual([
    {
      description: "Shares your last 7 days of steps.",
      key: "steps-days.v0",
      label: "Steps",
      scopeKeys: ["steps-days.v0"],
    },
    {
      description:
        "Shares your last 7 days of daily protein, carbs, fat, and fiber totals from meals in Murph, including meals imported from connected apps.",
      key: "group:daily-macros",
      label: "Daily macros",
      scopeKeys: [
        "protein-days.v0",
        "carbs-days.v0",
        "fat-days.v0",
        "fiber-days.v0",
      ],
    },
    {
      description:
        "Shares your last 7 days of daily calorie totals from meals in Murph, including meals imported from connected apps.",
      key: "calories-days.v0",
      label: "Daily calories",
      scopeKeys: ["calories-days.v0"],
    },
  ]);
});

test("renders one Daily macros card that toggles every macro scope together", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ ok: true });
  const { GroupJoinAcceptForm } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );
  const macroPermission = (
    projectionKind: HostedVaultShareFixedProjectionKind,
    label: string,
  ) => ({
    description: `Shares your last 7 days of daily ${label} totals from meals in Murph, including meals imported from connected apps.`,
    label: `Daily ${label}`,
    projectionScope: { projectionKind },
    projectionScopeKey: projectionKind,
  });
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(GroupJoinAcceptForm, {
      activeVaultShareProjectionScopes: [],
      alreadyActiveMember: false,
      expectedMembershipId: null,
      groupName: "Sunday Sleep Crew",
      joinCode: "JOIN123",
      permissions: [
        macroPermission("protein-days.v0", "protein"),
        macroPermission("carbs-days.v0", "carbohydrate"),
        macroPermission("fat-days.v0", "fat"),
        macroPermission("fiber-days.v0", "fiber"),
        {
          description:
            "Shares your last 7 days of daily calorie totals from meals in Murph, including meals imported from connected apps.",
          label: "Daily calories",
          projectionScope: { projectionKind: "calories-days.v0" as const },
          projectionScopeKey: "calories-days.v0",
        },
      ],
      postJoinDestination: "/home",
    }),
  );
  cleanupRender = cleanup;

  const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
  expect(checkboxes).toHaveLength(2);
  expect(container.textContent).toContain("Daily macros");
  expect(container.textContent).toContain("Daily calories");
  expect(container.textContent).not.toContain("Daily protein");

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  // All four macro scopes plus calories start selected (preselected requested scopes),
  // proving one grouped card carries four separate underlying grants.
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: {
      expectedMembershipId: null,
      selectedVaultShareProjectionScopes: [
        { projectionKind: "protein-days.v0" },
        { projectionKind: "carbs-days.v0" },
        { projectionKind: "fat-days.v0" },
        { projectionKind: "fiber-days.v0" },
        { projectionKind: "calories-days.v0" },
      ],
    },
    url: "/api/groups/join/JOIN123/accept",
  });
});

test("automatically opens the intent-first auth prompt on a valid group join page", async () => {
  const { GroupJoinSignInButton } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );
  const { cleanup, container } = await renderClientComponent(
    createElement(GroupJoinSignInButton),
    {
      location: {
        hash: "",
        href: "https://join.example.test/groups/join/JOIN123",
        pathname: "/groups/join/JOIN123",
        search: "",
      },
    },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(mocks.authDialogProps?.open).toBe(true);
  });

  expect(container.textContent).toContain("Continue to join");
  expect(container.querySelector(
    '[data-auth-title="Continue to join this Murph group"]',
  )).toBeTruthy();
  expect(container.textContent).not.toContain("Sign in to join");

  await act(async () => {
    mocks.authDialogProps?.onOpenChange(false);
  });

  expect(mocks.authDialogProps?.open).toBe(false);
  expect(container.textContent).toContain("Continue to join");

  const continueButton = container.querySelector("button");
  expect(continueButton).toBeTruthy();

  await act(async () => {
    continueButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  expect(mocks.authDialogProps?.open).toBe(true);
});

test("returns an authenticated new member to the same group intent", async () => {
  const { GroupJoinSignInButton } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );
  const { cleanup } = await renderClientComponent(
    createElement(GroupJoinSignInButton),
    {
      location: {
        hash: "#sharing",
        href: "https://join.example.test/groups/join/JOIN123?source=text#sharing",
        pathname: "/groups/join/JOIN123",
        search: "?source=text",
      },
    },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(mocks.authDialogProps?.open).toBe(true);
  });

  await act(async () => {
    await mocks.authDialogProps?.onCompleted?.({
      initialVisitEligible: true,
      stage: "active",
    });
  });

  expect(mocks.navigateHostedAuthRedirect).toHaveBeenCalledWith(
    "/groups/join/JOIN123?source=text&postJoin=initial-visit#sharing",
  );
});

test("opens the post-auth destination only after membership succeeds", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ ok: true });
  const { GroupJoinAcceptForm } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(GroupJoinAcceptForm, {
      activeVaultShareProjectionScopes: [],
      alreadyActiveMember: false,
      expectedMembershipId: null,
      groupName: "Sunday Sleep Crew",
      joinCode: "JOIN123",
      permissions: [],
      postJoinDestination: "/home?initialVisit=true",
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: {
      expectedMembershipId: null,
      selectedVaultShareProjectionScopes: [],
    },
    url: "/api/groups/join/JOIN123/accept",
  });
  expect(mocks.routerPush).not.toHaveBeenCalled();
  expect(container.textContent).toContain("You're in Sunday Sleep Crew.");

  const openMurphButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Open Murph",
  );
  expect(openMurphButton).toBeTruthy();

  await act(async () => {
    openMurphButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.routerPush).toHaveBeenCalledWith("/home?initialVisit=true");
});

test("binds an existing-member sharing update to the rendered membership id", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ ok: true });
  const { GroupJoinAcceptForm } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );
  const { button, cleanup, window } = await renderClientComponent(
    createElement(GroupJoinAcceptForm, {
      activeVaultShareProjectionScopes: [],
      alreadyActiveMember: true,
      expectedMembershipId: "membership_existing",
      groupName: "Sunday Sleep Crew",
      joinCode: "JOIN123",
      permissions: [],
      postJoinDestination: "/home",
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: {
      expectedMembershipId: "membership_existing",
      selectedVaultShareProjectionScopes: [],
    },
    url: "/api/groups/join/JOIN123/accept",
  });
});

test("confirms the provider boundary before leaving and returns home", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ ok: true, status: "left" });
  const { GroupJoinLeaveButton } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );
  const { button, cleanup, window } = await renderClientComponent(
    createElement(GroupJoinLeaveButton, {
      groupName: "Sunday Sleep Crew",
      joinCode: "JOIN123",
    }),
  );
  cleanupRender = cleanup;
  const confirmLeave = vi.fn(() => true);
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: confirmLeave,
  });

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(confirmLeave).toHaveBeenCalledWith(expect.stringMatching(
    /ends your Murph membership.*queues its shared copies for cleanup.*won't remove you from the iMessage chat.*provider history.*backups.*outside Murph/u,
  ));
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    url: "/api/groups/join/JOIN123/leave",
  });
  expect(mocks.routerPush).toHaveBeenCalledWith("/home");
});

test("does not leave when the confirmation is cancelled", async () => {
  const { GroupJoinLeaveButton } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );
  const { button, cleanup, window } = await renderClientComponent(
    createElement(GroupJoinLeaveButton, {
      groupName: "Sunday Sleep Crew",
      joinCode: "JOIN123",
    }),
  );
  cleanupRender = cleanup;
  const confirmLeave = vi.fn(() => false);
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: confirmLeave,
  });

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(confirmLeave).toHaveBeenCalledOnce();
  expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  expect(mocks.routerPush).not.toHaveBeenCalled();
});
