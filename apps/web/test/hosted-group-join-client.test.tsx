import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import type { HostedVaultShareFixedProjectionKind } from "@murphai/hosted-execution/vault-share";
import { HostedOnboardingApiError } from "@/src/components/hosted-onboarding/client-api";
import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  authDialogProps: null as {
    autoSendPastedPhoneNumber?: boolean;
    description: string;
    inviteCode?: string | null;
    methods?: readonly ("phone" | "telegram" | "email")[];
    onCompleted?: (payload: {
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
  routerReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    refresh: mocks.routerRefresh,
    replace: mocks.routerReplace,
  }),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog(props: {
    autoSendPastedPhoneNumber?: boolean;
    description: string;
    inviteCode?: string | null;
    methods?: readonly ("phone" | "telegram" | "email")[];
    onCompleted?: (payload: {
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

vi.mock("@/src/components/hosted-onboarding/client-api", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/components/hosted-onboarding/client-api")
  >();

  return {
    ...actual,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  navigateHostedAuthRedirect: mocks.navigateHostedAuthRedirect,
}));

vi.mock("@/src/components/hosted-onboarding/join-invite-islands", () => ({
  JoinInviteSignOutButtonIsland(props: { idleLabel?: string }) {
    return createElement(
      "button",
      {
        "data-invite-account-recovery": "true",
        type: "button",
      },
      props.idleLabel ?? "Use this invite instead",
    );
  },
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
    createElement(GroupJoinLegalConsentGate, {
      initialStatus: null,
      notNowHref: "/home",
    }),
  );

  expect(markup).toContain('data-consent-card="true"');
  expect(markup).toContain('href="/home"');
  expect(markup).toContain("Not now");
});

test("keeps the home destination on the consent gate not-now link", async () => {
  const { GroupJoinLegalConsentGate } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );

  const markup = renderToStaticMarkup(
    createElement(GroupJoinLegalConsentGate, {
      initialStatus: null,
      notNowHref: "/home",
    }),
  );

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
      postJoinContactOption: null,
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

test("keeps a comprehensive default checklist bounded and keyboard-scrollable", async () => {
  const { GroupJoinAcceptForm } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );
  const permissions = Array.from({ length: 13 }, (_, index) => ({
    description: `Shares choice ${index + 1}.`,
    label: `Choice ${index + 1}`,
    projectionScope: { projectionKind: "steps-days.v0" as const },
    projectionScopeKey: `steps-days.v0:${index + 1}`,
  }));

  const markup = renderToStaticMarkup(
    createElement(GroupJoinAcceptForm, {
      activeVaultShareProjectionScopes: [],
      alreadyActiveMember: false,
      expectedMembershipId: null,
      groupName: "Sunday Sleep Crew",
      joinCode: "JOIN123",
      permissions,
      postJoinContactOption: null,
      postJoinDestination: "/home",
    }),
  );

  expect(markup).toContain("13 of 13 choices selected");
  expect(markup).toContain('aria-label="Sharing choices"');
  expect(markup).toContain('role="region"');
  expect(markup).toContain("max-h-[26rem]");
  expect(markup).toContain('tabindex="0"');
  expect(markup).toContain("shrink-0 overflow-hidden");
  expect(markup).toContain("Join group");
});

test("discloses and submits source-aware sleep metadata on the link-only join page", async () => {
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
      permissions: [
        {
          description:
            "Shares 7 days of each source’s name, deep sleep minutes, and recorded time.",
          label: "Deep sleep",
          legacyProjectionScope: { projectionKind: "deep-sleep-days.v0" as const },
          projectionScope: { projectionKind: "deep-sleep-sources-days.v1" as const },
          projectionScopeKey: "deep-sleep-sources-days.v1",
        },
        {
          description:
            "Shares 7 days of each source’s name, REM sleep minutes, and recorded time.",
          label: "REM sleep",
          legacyProjectionScope: { projectionKind: "rem-sleep-days.v0" as const },
          projectionScope: { projectionKind: "rem-sleep-sources-days.v1" as const },
          projectionScopeKey: "rem-sleep-sources-days.v1",
        },
      ],
      postJoinContactOption: null,
      postJoinDestination: "/home",
    }),
  );
  cleanupRender = cleanup;

  expect(Array.from(container.querySelectorAll("label")).map((label) =>
    label.querySelector(".flex.flex-col > span:first-child")?.textContent
  )).toEqual(["Deep sleep", "REM sleep"]);

  expect(container.textContent).toContain(
    "Shares 7 days of each source’s name, deep sleep minutes, and recorded time.",
  );
  expect(container.textContent).toContain(
    "Shares 7 days of each source’s name, REM sleep minutes, and recorded time.",
  );
  expect(Array.from(container.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  )).every((checkbox) => checkbox.checked)).toBe(true);

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: {
      expectedMembershipId: null,
      selectedVaultShareProjectionScopes: [
        { projectionKind: "deep-sleep-sources-days.v1" },
        { projectionKind: "rem-sleep-sources-days.v1" },
      ],
    },
    url: "/api/groups/join/JOIN123/accept",
  });
});

test.each([
  ["preserves", "preserve", [{ projectionKind: "deep-sleep-days.v0" }]],
  ["explicitly upgrades", "upgrade", [{ projectionKind: "deep-sleep-sources-days.v1" }]],
  ["fully revokes", "off", []],
] as const)(
  "%s a visible legacy Deep sleep grant from the single permission row",
  async (_label, action, expectedScopes) => {
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ ok: true });
    const { GroupJoinAcceptForm } = await import(
      "@/src/components/hosted-groups/group-join-client"
    );
    const { cleanup, container, window } = await renderClientComponent(
      createElement(GroupJoinAcceptForm, {
        activeVaultShareProjectionScopes: [
          { projectionKind: "deep-sleep-days.v0" as const },
        ],
        alreadyActiveMember: true,
        expectedMembershipId: "membership_existing",
        groupName: "Sunday Sleep Crew",
        joinCode: "JOIN123",
        permissions: [{
          description:
            "Shares 7 days of each source’s name, deep sleep minutes, and recorded time.",
          label: "Deep sleep",
          legacyProjectionScope: { projectionKind: "deep-sleep-days.v0" as const },
          projectionScope: { projectionKind: "deep-sleep-sources-days.v1" as const },
          projectionScopeKey: "deep-sleep-sources-days.v1",
        }],
        postJoinContactOption: null,
        postJoinDestination: "/home",
      }),
    );
    cleanupRender = cleanup;

    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error("Expected the Deep sleep checkbox.");
    expect(checkbox.checked).toBe(true);
    expect(container.textContent).toContain(
      "Currently shares one daily value only. Source names and recorded times are not shared.",
    );

    if (action === "upgrade") {
      const upgradeButton = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === "Include source details",
      );
      if (!upgradeButton) throw new Error("Expected the legacy upgrade action.");
      await act(async () => {
        upgradeButton.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
      expect(container.textContent).not.toContain("Currently shares one daily value only.");
      expect(checkbox.checked).toBe(true);
    } else if (action === "off") {
      await act(async () => {
        checkbox.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
      expect(checkbox.checked).toBe(false);
    }

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Save changes",
    );
    if (!saveButton) throw new Error("Expected the sharing save action.");
    await act(async () => {
      saveButton.dispatchEvent(new window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        expectedMembershipId: "membership_existing",
        selectedVaultShareProjectionScopes: expectedScopes,
      },
      url: "/api/groups/join/JOIN123/accept",
    });
  },
);

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

  const permissions = [
    {
      description: "Shares your last 7 days of steps.",
      label: "Steps",
      projectionScope: { projectionKind: "steps-days.v0" as const },
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
      projectionScope: { projectionKind: "calories-days.v0" as const },
      projectionScopeKey: "calories-days.v0",
    },
  ];
  const groups = groupJoinPermissionsForDisplay(
    permissions,
    new Set(permissions.map((permission) => permission.projectionScopeKey)),
  );

  expect(groups).toEqual([
    {
      description: "Shares your last 7 days of steps.",
      key: "steps-days.v0",
      label: "Steps",
      legacyScopeKeys: [],
      scopeKeys: ["steps-days.v0"],
    },
    {
      description:
        "Shares your last 7 days of daily protein, carbs, fat, and fiber totals from meals in Murph, including meals imported from connected apps.",
      key: "group:daily-macros",
      label: "Daily macros",
      legacyScopeKeys: [],
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
      legacyScopeKeys: [],
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
      inviteCode: "invite_phone_bound",
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
      postJoinContactOption: null,
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
      inviteCode: "invite_phone_bound",
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

test("keeps macros as individual cards when the initial macro selection is mixed", async () => {
  const { groupJoinPermissionsForDisplay } = await import(
    "@/src/components/hosted-groups/group-join-permission-groups"
  );
  const macro = (projectionKind: HostedVaultShareFixedProjectionKind, label: string) => ({
    description: `Shares your last 7 days of daily ${label} totals from meals in Murph, including meals imported from connected apps.`,
    label: `Daily ${label}`,
    projectionScope: { projectionKind },
    projectionScopeKey: projectionKind,
  });
  const permissions = [
    macro("protein-days.v0", "protein"),
    macro("carbs-days.v0", "carbs"),
    macro("fat-days.v0", "fat"),
    macro("fiber-days.v0", "fiber"),
  ];

  // Only protein is currently active: an unchecked grouped card would hide it, so the
  // helper must fall back to individual cards.
  const groups = groupJoinPermissionsForDisplay(
    permissions,
    new Set(["protein-days.v0"]),
  );

  expect(groups.map((group) => group.label)).toEqual([
    "Daily protein",
    "Daily carbs",
    "Daily fat",
    "Daily fiber",
  ]);
  expect(groups.every((group) => group.scopeKeys.length === 1)).toBe(true);
});

test("shows revocable individual macro cards for an existing mixed macro grant", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ ok: true });
  const { GroupJoinAcceptForm } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );
  const macro = (projectionKind: HostedVaultShareFixedProjectionKind, label: string) => ({
    description: `Shares your last 7 days of daily ${label} totals from meals in Murph, including meals imported from connected apps.`,
    label: `Daily ${label}`,
    projectionScope: { projectionKind },
    projectionScopeKey: projectionKind,
  });
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(GroupJoinAcceptForm, {
      activeVaultShareProjectionScopes: [{ projectionKind: "protein-days.v0" }],
      alreadyActiveMember: true,
      expectedMembershipId: "membership_existing",
      groupName: "Sunday Sleep Crew",
      joinCode: "JOIN123",
      permissions: [
        macro("protein-days.v0", "protein"),
        macro("carbs-days.v0", "carbohydrate"),
        macro("fat-days.v0", "fat"),
        macro("fiber-days.v0", "fiber"),
      ],
      postJoinContactOption: null,
      postJoinDestination: "/home",
    }),
  );
  cleanupRender = cleanup;

  // A mixed grant must not collapse into one grouped card; each macro is its own row.
  const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
  expect(checkboxes).toHaveLength(4);
  expect(container.textContent).toContain("Daily protein");
  expect(container.textContent).not.toContain("Daily macros");

  // Saving without touching anything preserves exactly the active protein grant and
  // never silently broadens sharing to the other macros.
  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: {
      expectedMembershipId: "membership_existing",
      selectedVaultShareProjectionScopes: [{ projectionKind: "protein-days.v0" }],
    },
    url: "/api/groups/join/JOIN123/accept",
  });
});

test("automatically opens the intent-first auth prompt on a valid group join page", async () => {
  const { GroupJoinSignInButton } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );
  const { cleanup, container } = await renderClientComponent(
    createElement(GroupJoinSignInButton, {
      inviteCode: "invite_opaque",
    }),
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
  expect(mocks.authDialogProps?.inviteCode).toBe("invite_opaque");
  expect(mocks.authDialogProps?.methods).toEqual(["phone"]);
  expect(mocks.authDialogProps?.autoSendPastedPhoneNumber).toBeUndefined();
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

  expect(mocks.authDialogProps?.methods).toBeUndefined();

  await act(async () => {
    await mocks.authDialogProps?.onCompleted?.({
      stage: "active",
    });
  });

  expect(mocks.navigateHostedAuthRedirect).toHaveBeenCalledWith(
    "/groups/join/JOIN123?source=text#sharing",
  );
});

test("offers same-link account recovery for a mismatched phone-bound invite", async () => {
  mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
    new HostedOnboardingApiError({
      code: "AUTH_INVITE_MISMATCH",
      message: "That invite belongs to a different hosted member.",
    }),
  );
  const { GroupJoinAcceptForm } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );
  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(GroupJoinAcceptForm, {
      activeVaultShareProjectionScopes: [],
      alreadyActiveMember: false,
      expectedMembershipId: null,
      groupName: "Sunday Sleep Crew",
      inviteCode: "invite_phone_bound",
      joinCode: "JOIN123",
      permissions: [],
      postJoinContactOption: null,
      postJoinDestination: "/home",
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Use the invited phone number");
  });
  expect(container.textContent).toContain(
    "Sign out, then verify the phone number that received this invite.",
  );
  expect(container.querySelector(
    '[data-invite-account-recovery="true"]',
  )).toBeTruthy();
  expect(container.textContent).toContain("Sign out and continue");
  expect(container.textContent).not.toContain("Join group");
  expect(container.textContent).not.toContain(
    "That invite belongs to a different hosted member.",
  );
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: {
      expectedMembershipId: null,
      inviteCode: "invite_phone_bound",
      selectedVaultShareProjectionScopes: [],
    },
    url: "/api/groups/join/JOIN123/accept",
  });
});

test("returns to the dashboard through a real link once membership succeeds", async () => {
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
      postJoinContactOption: null,
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
      expectedMembershipId: null,
      selectedVaultShareProjectionScopes: [],
    },
    url: "/api/groups/join/JOIN123/accept",
  });
  expect(container.textContent).toContain("You're in Sunday Sleep Crew.");

  // The hand-off must be a real anchor: an onClick-only button leaves the click
  // unacknowledged for the whole transition, which reads as a dead control.
  const returnLink = Array.from(container.querySelectorAll("a")).find(
    (candidate) => candidate.textContent?.includes("Back to Murph"),
  );
  expect(returnLink).toBeTruthy();
  expect(returnLink?.getAttribute("href")).toBe("/home");
  expect(mocks.routerPush).not.toHaveBeenCalled();
  expect(mocks.routerReplace).not.toHaveBeenCalled();
});

test("continues an incomplete account into canonical setup after membership succeeds", async () => {
  let finishRequest: (() => void) | null = null;
  const request = new Promise<{ ok: true }>((resolve) => {
    finishRequest = () => resolve({ ok: true });
  });
  mocks.requestHostedOnboardingJson.mockReturnValueOnce(request);
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
      postJoinContactOption: null,
      postJoinDestination: "/join",
    }),
  );
  cleanupRender = cleanup;

  const setupEscape = container.querySelector('a[href="/join"]');
  expect(setupEscape?.textContent).toContain("Finish setting up Murph");
  expect(container.textContent).not.toContain("Go home");

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
  expect(mocks.routerReplace).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("You're in Sunday Sleep Crew.");

  await act(async () => {
    if (!finishRequest) throw new Error("expected pending group join request");
    finishRequest();
    await request;
  });

  expect(mocks.routerReplace).toHaveBeenCalledTimes(1);
  expect(mocks.routerReplace).toHaveBeenCalledWith("/join");
  expect(container.textContent).toContain("You're in Sunday Sleep Crew.");
  expect(container.textContent).toContain("Finish setting up Murph");
  expect(container.querySelectorAll('a[href="/join"]')).toHaveLength(1);
});

test("hands a messaging member back to the channel Murph reaches them on", async () => {
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
      postJoinContactOption: {
        href: "https://t.me/withmurph_bot",
        kind: "telegram",
        label: "Telegram",
        rel: "noopener noreferrer",
        target: "_blank",
      },
      postJoinDestination: "/home",
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  const returnLink = Array.from(container.querySelectorAll("a")).find(
    (candidate) => candidate.textContent?.includes("Back to Murph"),
  );
  expect(returnLink?.getAttribute("href")).toBe("https://t.me/withmurph_bot");
  expect(returnLink?.getAttribute("target")).toBe("_blank");
  expect(returnLink?.getAttribute("aria-label")).toBe(
    "Back to Murph in Telegram (opens in a new tab)",
  );
  expect(container.querySelector('a[href="/home"]')).toBeNull();
});

test("uses the canonical home destination when no completed-member contact return is projected", async () => {
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
      postJoinContactOption: null,
      postJoinDestination: "/home",
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  const returnLink = Array.from(container.querySelectorAll("a")).find(
    (candidate) => candidate.textContent?.includes("Back to Murph"),
  );
  expect(returnLink?.getAttribute("href")).toBe("/home");
  expect(container.querySelector('a[href^="sms:"]')).toBeNull();
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
      postJoinContactOption: null,
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
