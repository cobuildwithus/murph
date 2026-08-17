import assert from "node:assert/strict";

import {
  act,
  createElement,
  type ChangeEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
  usageTopUpDialogProps: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
  }),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  HostedOnboardingApiError: class HostedOnboardingApiError extends Error {
    readonly code: string | null;

    constructor(input: { code?: string | null; message: string }) {
      super(input.message);
      this.code = input.code ?? null;
    }
  },
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("@/src/components/settings/hosted-usage-top-up-dialog", () => ({
  HostedUsageTopUpDialog: (props: {
    activePurchase?: unknown;
    checkoutUrl?: string;
    deferTerminalRefreshUntilClose?: boolean;
    offers: readonly unknown[];
    purchaseReturn?: unknown;
    quietSuccessfulReturn?: boolean;
    scope?: string;
    targetLabel?: string;
  }) => {
    mocks.usageTopUpDialogProps(props);
    return props.offers.length > 0 || props.activePurchase || props.purchaseReturn
      ? createElement("button", { type: "button" }, "Add usage")
      : null;
  },
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children?: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (open
    ? createElement(
        "div",
        { "data-dialog-open": "true" },
        children,
        createElement("button", {
          "aria-label": "Dismiss dialog",
          onClick: () => onOpenChange?.(false),
          type: "button",
        }),
      )
    : null),
  DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", { className, "data-dialog-content": "true" }, children),
  DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
    createElement("h2", props),
}));

vi.mock("@/src/components/ui/input", () => ({
  Input: ({ onChange, ...props }: InputHTMLAttributes<HTMLInputElement>) =>
    createElement("input", {
      ...props,
      onChange,
      onInput: onChange,
    }),
}));

vi.mock("@/src/components/ui/phone-number-input", () => ({
  PhoneNumberInput: ({
    id,
    value,
    onPhoneNumberChange,
  }: {
    id: string;
    value: string;
    onPhoneNumberChange: (value: string) => void;
  }) =>
    createElement("input", {
      id,
      value,
      onChange: (event: ChangeEvent<HTMLInputElement>) =>
        onPhoneNumberChange(event.currentTarget.value),
      onInput: (event: ChangeEvent<HTMLInputElement>) =>
        onPhoneNumberChange(event.currentTarget.value),
    }),
}));

vi.mock("@/src/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    invite: {
      acceptUrl: "https://app.murph.test/family/accept/NEWCODE",
      id: "inv_new",
      planCode: "pulse",
      targetLabel: "Mom",
      targetPhoneHint: "+48 6** *** ***",
      telegramInviteUrl: "https://t.me/withmurph_bot?start=family_NEWCODE",
    },
  });
});

test("HostedFamilyManager keeps the created invite visible for manual sharing", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  vi.useFakeTimers();

  try {
    const { HostedFamilyManager } = await import(
      "@/src/components/settings/hosted-family-settings-actions"
    );
    const { cleanup, container, window } = await renderClientComponent(
      createElement(HostedFamilyManager, baseFamilyManagerProps()),
      { requireButton: false },
    );
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    try {
      await clickButton(container, window, "Invite member");
      assert.match(
        container.textContent ?? "",
        /You'll get a link to send them yourself\. Murph won't message them\./,
      );

      await act(async () => {
        setInputValue(window, inputById(container, "family-invite-phone"), "+48600000000");
      });
      await clickButton(container, window, "Create invite");

      assert.match(container.textContent ?? "", /Invite created/);
      assert.match(container.textContent ?? "", /Copy the link and send it to them yourself\./);
      assert.match(container.textContent ?? "", /Only they can use this invite\./);
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            targetPhoneNumber: "+48600000000",
          }),
          url: "/api/settings/billing/family/invite",
        }),
      );
      expect(mocks.refresh).toHaveBeenCalledTimes(1);

      await clickButton(container, window, "Copy invite link");
      expect(writeText).toHaveBeenCalledWith("https://app.murph.test/family/accept/NEWCODE");
      assert.match(container.textContent ?? "", /Copied invite link/);

      await act(async () => {
        vi.runOnlyPendingTimers();
      });
    } finally {
      await cleanup();
    }
  } finally {
    vi.useRealTimers();
  }
});

test("HostedFamilyManager submits a normalized Telegram username", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  vi.useFakeTimers();

  try {
    const { HostedFamilyManager } = await import(
      "@/src/components/settings/hosted-family-settings-actions"
    );
    const { cleanup, container, window } = await renderClientComponent(
      createElement(HostedFamilyManager, baseFamilyManagerProps()),
      { requireButton: false },
    );
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    try {
      await clickButton(container, window, "Invite member");
      await clickButton(container, window, "Telegram");
      await act(async () => {
        setInputValue(window, inputById(container, "family-invite-telegram"), "@Dad_Username");
      });
      await clickButton(container, window, "Create invite");

      expect(submittedPayload()).toMatchObject({
        addSeatIfNeeded: false,
        targetTelegramUsername: "dad_username",
      });
      expect(submittedPayload()).not.toHaveProperty("targetPhoneNumber");
      expect(submittedPayload()).not.toHaveProperty("targetEmail");

      await clickButton(container, window, "Copy invite link");
      expect(writeText).toHaveBeenCalledWith(
        "https://t.me/withmurph_bot?start=family_NEWCODE",
      );

      await act(async () => {
        vi.runOnlyPendingTimers();
      });
    } finally {
      await cleanup();
    }
  } finally {
    vi.useRealTimers();
  }
});

test("HostedFamilyManager rejects an invalid email before submitting", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, baseFamilyManagerProps()),
    { requireButton: false },
  );

  try {
    await clickButton(container, window, "Invite member");
    await clickButton(container, window, "Email");
    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-email"), "not-an-email");
    });
    await clickButton(container, window, "Create invite");

    assert.match(container.textContent ?? "", /Enter a valid email address\./);
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager rejects an invalid Telegram username before submitting", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, baseFamilyManagerProps()),
    { requireButton: false },
  );

  try {
    await clickButton(container, window, "Invite member");
    await clickButton(container, window, "Telegram");
    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-telegram"), "@dad");
    });
    await clickButton(container, window, "Create invite");

    assert.match(container.textContent ?? "", /Enter a valid Telegram username\./);
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager copies a Telegram deep link for pending Telegram invites", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...baseFamilyManagerProps(),
      invites: [
        {
          acceptUrl: "https://app.murph.test/family/accept/TELEGRAM",
          channel: "family",
          expiresAtIso: "2026-07-30T00:00:00.000Z",
          id: "inv_telegram",
          planCode: "pulse",
          targetEmail: null,
          targetLabel: "Dad",
          targetPhoneHint: null,
          targetTelegramUsername: "dad_username",
          telegramInviteUrl: "https://t.me/withmurph_bot?start=family_TELEGRAM",
        },
      ],
    }),
    { requireButton: false },
  );
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  try {
    await clickButton(container, window, "Copy link");

    expect(writeText).toHaveBeenCalledWith(
      "https://t.me/withmurph_bot?start=family_TELEGRAM",
    );
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager hides paid seat quantity controls", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container } = await renderClientComponent(
    createElement(HostedFamilyManager, baseFamilyManagerProps()),
    { requireButton: false },
  );

  try {
    assert.match(container.textContent ?? "", /1 family member/);
    assert.doesNotMatch(container.textContent ?? "", /paid seats assigned/);
    assert.equal(container.querySelector('button[aria-label^="Add "]'), null);
    assert.equal(container.querySelector('button[aria-label^="Remove an empty"]'), null);
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager presents rows as mobile cards without forcing horizontal overflow", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...baseFamilyManagerProps(),
      invites: [
        {
          acceptUrl: "https://app.murph.test/family/accept/PENDING",
          channel: "family",
          expiresAtIso: "2026-07-30T00:00:00.000Z",
          id: "inv_pending",
          planCode: "edge",
          targetEmail: `${"a".repeat(60)}@example.test`,
          targetLabel:
            "A deliberately long synthetic family member label for responsive containment proof",
          targetPhoneHint: null,
          targetTelegramUsername: null,
          telegramInviteUrl: null,
        },
      ],
    }),
    { requireButton: false },
  );

  try {
    const table = container.querySelector("table");
    assert.ok(table);
    assert.doesNotMatch(table.className, /min-w-/u);
    assert.match(table.className, /md:table-fixed/u);
    assert.doesNotMatch(table.parentElement?.className ?? "", /overflow-x-auto/u);

    const body = table.querySelector("tbody");
    assert.match(body?.className ?? "", /\bgrid\b/u);
    assert.match(body?.className ?? "", /md:table-row-group/u);

    const rows = body?.querySelectorAll("tr") ?? [];
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.match(row.className, /\bgrid\b/u);
      assert.match(row.className, /rounded-xl/u);
      assert.match(row.className, /md:table-row/u);
    }
    assert.match(body?.textContent ?? "", /Plan/u);
    assert.match(body?.textContent ?? "", /Status/u);
    const inviteMetadata = Array.from(body?.querySelectorAll("span") ?? []).find((element) =>
      element.textContent?.includes("@example.test"),
    );
    assert.match(inviteMetadata?.className ?? "", /break-all/u);
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager adds the selected Edge seat while creating an invite", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, baseFamilyManagerProps()),
    { requireButton: false },
  );

  try {
    await clickButton(container, window, "Invite member");
    await clickButton(container, window, "Edge · $19/mo");
    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-phone"), "+48600000000");
    });
    await clickButton(container, window, "Create invite & add Edge · $19/mo");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          addSeatIfNeeded: true,
          planCode: "edge",
          targetPhoneNumber: "+48600000000",
        }),
        url: "/api/settings/billing/family/invite",
      }),
    );
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager requires an open seat in the selected tier at maximum capacity", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...baseFamilyManagerProps(),
      plans: {
        edge: { active: 0, billed: 1, invited: 0, remaining: 1, used: 0 },
        max: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
        pulse: { active: 1, billed: 5, invited: 4, remaining: 0, used: 5 },
      },
      seats: {
        active: 1,
        billed: 6,
        invited: 4,
        max: 6,
        min: 2,
        remaining: 1,
        used: 5,
      },
    }),
    { requireButton: false },
  );

  try {
    await clickButton(container, window, "Invite member");
    assert.match(
      container.textContent ?? "",
      /No open Pulse seats\. Choose a tier with an open seat or free one first\./,
    );
    assert.equal(buttonByText(container, "Create invite").disabled, true);

    await clickButton(container, window, "Edge · $19/mo");
    assert.doesNotMatch(container.textContent ?? "", /No open Edge seats\./);
    assert.equal(buttonByText(container, "Create invite").disabled, false);
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager confirms a member move to Edge", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...baseFamilyManagerProps(),
      members: [
        ...baseFamilyManagerProps().members,
        {
          isOwner: false,
          joinedAtIso: "2026-07-02T00:00:00.000Z",
          label: "Mom",
          memberId: "member_mom",
          pendingPlanCode: null,
          planCode: "pulse" as const,
        },
      ],
      plans: {
        edge: { active: 0, billed: 1, invited: 0, remaining: 1, used: 0 },
        max: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
        pulse: { active: 2, billed: 2, invited: 0, remaining: 0, used: 2 },
      },
      seats: {
        active: 2,
        billed: 3,
        invited: 0,
        max: 6,
        min: 2,
        remaining: 1,
        used: 2,
      },
    }),
    { requireButton: false },
  );
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ syncing: false });

  try {
    assert.ok(container.querySelector('button[aria-label="Manage Mom\'s plan"]'));
    await clickLastButton(container, window, "Manage");
    assert.match(container.textContent ?? "", /Manage Mom/);
    assert.match(
      container.textContent ?? "",
      /Upgrade Mom from Pulse to Edge at \$19\/mo\. The prorated difference will appear on your next invoice\./,
    );
    await clickButton(container, window, "Upgrade to Edge");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "PATCH",
      payload: { planCode: "edge" },
      url: "/api/settings/billing/family/members/member_mom",
    });
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager keeps member removal inside the manage dialog", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const props = baseFamilyManagerProps();
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...props,
      members: [
        ...props.members,
        {
          isOwner: false,
          joinedAtIso: "2026-07-02T00:00:00.000Z",
          label: "Mom",
          memberId: "member_mom",
          pendingPlanCode: null,
          planCode: "pulse" as const,
        },
      ],
    }),
    { requireButton: false },
  );
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({});

  try {
    assert.equal(buttonByTextOrNull(container, "Remove"), null);

    await clickLastButton(container, window, "Manage");
    assert.ok(buttonByText(container, "Remove from Family"));

    await clickButton(container, window, "Remove from Family");
    assert.match(container.textContent ?? "", /Remove Mom\?/);
    await clickButton(container, window, "Remove member");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "DELETE",
      url: "/api/settings/billing/family/members/member_mom",
    });
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager retries the persisted target while keeping removal locked", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const props = baseFamilyManagerProps();
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...props,
      members: [
        ...props.members,
        {
          isOwner: false,
          joinedAtIso: "2026-07-02T00:00:00.000Z",
          label: "Mom",
          memberId: "member_mom",
          pendingPlanCode: "edge" as const,
          planCode: "pulse" as const,
        },
      ],
    }),
    { requireButton: false },
  );
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ syncing: true });

  try {
    assert.match(container.textContent ?? "", /Updating to Edge/);
    const retry = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry updating Mom\'s plan to Edge"]',
    );
    assert.ok(retry);
    assert.equal(retry.disabled, false);
    assert.equal(buttonByTextOrNull(container, "Remove from Family"), null);

    await clickButton(container, window, "Retry update");
    assert.match(container.textContent ?? "", /Upgrade Mom from Pulse to Edge/);
    assert.equal(buttonByTextOrNull(container, "Remove from Family"), null);
    await clickButton(container, window, "Upgrade to Edge");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "PATCH",
      payload: { planCode: "edge" },
      url: "/api/settings/billing/family/members/member_mom",
    });
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager locks row actions and ignores dialog dismissal while acting", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const props = baseFamilyManagerProps();
  let resolveRequest: ((value: { syncing: boolean }) => void) | undefined;
  const request = new Promise<{ syncing: boolean }>((resolve) => {
    resolveRequest = resolve;
  });
  mocks.requestHostedOnboardingJson.mockReturnValueOnce(request);
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...props,
      members: [
        ...props.members,
        {
          isOwner: false,
          joinedAtIso: "2026-07-02T00:00:00.000Z",
          label: "Mom",
          memberId: "member_mom",
          pendingPlanCode: null,
          planCode: "pulse" as const,
        },
      ],
    }),
    { requireButton: false },
  );

  try {
    await clickLastButton(container, window, "Manage");
    await clickButton(container, window, "Upgrade to Edge");

    assert.equal(
      container.querySelector<HTMLButtonElement>('button[aria-label="Manage your plan"]')
        ?.disabled,
      true,
    );
    assert.equal(
      container.querySelector<HTMLButtonElement>('button[aria-label="Manage Mom\'s plan"]')
        ?.disabled,
      true,
    );
    assert.equal(buttonByText(container, "Remove from Family").disabled, true);
    assert.match(container.textContent ?? "", /Working\.\.\./);

    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss dialog"]',
    );
    assert.ok(dismiss);
    await act(async () => {
      dismiss.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    assert.match(container.textContent ?? "", /Working\.\.\./);

    await act(async () => {
      resolveRequest?.({ syncing: false });
      await request;
    });
    assert.doesNotMatch(container.textContent ?? "", /Working\.\.\./);
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager reports an owner-specific tier error without exposing capacity", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, baseFamilyManagerProps()),
    { requireButton: false },
  );
  mocks.requestHostedOnboardingJson.mockRejectedValueOnce(undefined);

  try {
    await clickButton(container, window, "Manage");
    assert.match(
      container.textContent ?? "",
      /Upgrade your plan from Pulse to Edge at \$19\/mo/,
    );
    await clickButton(container, window, "Upgrade to Edge");
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "PATCH",
      payload: { planCode: "edge" },
      url: "/api/settings/billing/family/members/member_owner",
    });
    assert.match(container.textContent ?? "", /Could not change your tier right now\./);
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager offers one-click downgrade copy for an Edge member", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const props = baseFamilyManagerProps();
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...props,
      members: props.members.map((member) => ({ ...member, planCode: "edge" as const })),
      plans: {
        edge: { active: 1, billed: 1, invited: 0, remaining: 0, used: 1 },
        max: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
        pulse: { active: 0, billed: 1, invited: 0, remaining: 1, used: 0 },
      },
    }),
    { requireButton: false },
  );
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ syncing: false });

  try {
    await clickButton(container, window, "Manage");
    await clickButton(container, window, "Pulse · $7/mo");
    assert.match(
      container.textContent ?? "",
      /Downgrade your plan from Edge to Pulse at \$7\/mo\. Any prorated credit will apply to your next invoice\./,
    );
    await clickButton(container, window, "Downgrade to Pulse");
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "PATCH",
      payload: { planCode: "pulse" },
      url: "/api/settings/billing/family/members/member_owner",
    });
  } finally {
    await cleanup();
  }
});

test.each([
  { sourceName: "Pulse", sourcePlanCode: "pulse" as const },
  { sourceName: "Edge", sourcePlanCode: "edge" as const },
])("HostedFamilyManager can move $sourceName access to Max", async ({
  sourceName,
  sourcePlanCode,
}) => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const props = baseFamilyManagerProps();
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...props,
      members: props.members.map((member) => ({
        ...member,
        planCode: sourcePlanCode,
      })),
    }),
    { requireButton: false },
  );
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ syncing: false });

  try {
    await clickButton(container, window, "Manage");
    await clickButton(container, window, "Max · $49/mo");
    assert.match(
      container.textContent ?? "",
      new RegExp(
        `Upgrade your plan from ${sourceName} to Max at \\$49/mo\\. The prorated difference will appear on your next invoice\\.`,
      ),
    );
    await clickButton(container, window, "Upgrade to Max");
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "PATCH",
      payload: { planCode: "max" },
      url: "/api/settings/billing/family/members/member_owner",
    });
  } finally {
    await cleanup();
  }
});

test.each([
  {
    expectedCopy:
      /Downgrade your plan from Max to Edge at \$19\/mo\. Any prorated credit will apply to your next invoice\./,
    targetName: "Edge",
    targetPlanCode: "edge" as const,
  },
  {
    expectedCopy:
      /Downgrade your plan from Max to Pulse at \$7\/mo\. Any prorated credit will apply to your next invoice\./,
    targetName: "Pulse",
    targetPlanCode: "pulse" as const,
  },
])("HostedFamilyManager can move Max access to $targetName", async ({
  expectedCopy,
  targetName,
  targetPlanCode,
}) => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const props = baseFamilyManagerProps();
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...props,
      members: props.members.map((member) => ({
        ...member,
        planCode: "max" as const,
      })),
    }),
    { requireButton: false },
  );
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ syncing: false });

  try {
    await clickButton(container, window, "Manage");
    if (targetPlanCode === "pulse") {
      await clickButton(container, window, "Pulse · $7/mo");
    }
    assert.match(container.textContent ?? "", expectedCopy);
    await clickButton(container, window, `Downgrade to ${targetName}`);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "PATCH",
      payload: { planCode: targetPlanCode },
      url: "/api/settings/billing/family/members/member_owner",
    });
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager disables paid-seat submit for an invalid email", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...baseFamilyManagerProps(),
      seats: {
        active: 1,
        billed: 2,
        invited: 1,
        max: 6,
        min: 2,
        remaining: 0,
        used: 2,
      },
      plans: {
        edge: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
        max: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
        pulse: { active: 1, billed: 2, invited: 1, remaining: 0, used: 2 },
      },
    }),
    { requireButton: false },
  );

  try {
    await clickButton(container, window, "Invite member");
    await clickButton(container, window, "Email");
    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-email"), "not-an-email");
    });

    assert.match(
      container.textContent ?? "",
      /Enter a valid email to invite\. It adds a paid Pulse seat at \$7\/mo\./,
    );
    assert.equal(buttonByText(container, "Create invite").disabled, true);
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager requires a stable target before adding a paid seat", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...baseFamilyManagerProps(),
      seats: {
        active: 1,
        billed: 2,
        invited: 1,
        max: 6,
        min: 2,
        remaining: 0,
        used: 2,
      },
      plans: {
        edge: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
        max: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
        pulse: { active: 1, billed: 2, invited: 1, remaining: 0, used: 2 },
      },
    }),
    { requireButton: false },
  );

  try {
    assert.match(container.textContent ?? "", /1 family member/);
    assert.doesNotMatch(container.textContent ?? "", /paid seats assigned/);

    await clickButton(container, window, "Invite member");
    assert.match(
      container.textContent ?? "",
      /Add a contact to invite\. It adds a paid Pulse seat at \$7\/mo\./,
    );

    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-label"), "Mom");
    });
    const labelOnlySubmit = buttonByText(container, "Create invite");
    assert.equal(labelOnlySubmit.disabled, true);
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();

    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-phone"), "12");
    });
    assert.match(
      container.textContent ?? "",
      /Enter a valid phone number to invite\. It adds a paid Pulse seat at \$7\/mo\./,
    );
    assert.equal(buttonByText(container, "Create invite").disabled, true);

    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-phone"), "+48600000000");
    });
    const contactBoundSubmit = buttonByText(
      container,
      "Create invite & add Pulse · $7/mo",
    );
    assert.equal(contactBoundSubmit.disabled, false);

    await clickButton(container, window, "Email");
    assert.equal(queryInputById(container, "family-invite-phone"), null);
    assert.ok(inputById(container, "family-invite-email"));
    const inactivePhoneSubmit = buttonByText(container, "Create invite");
    assert.equal(inactivePhoneSubmit.disabled, true);

    await clickButton(container, window, "iMessage");
    await clickButton(container, window, "Create invite & add Pulse · $7/mo");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          addSeatIfNeeded: true,
          targetLabel: "Mom",
          targetPhoneNumber: "+48600000000",
        }),
      }),
    );
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager keeps Telegram invites from authorizing an automatic paid seat", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...baseFamilyManagerProps(),
      seats: {
        active: 1,
        billed: 2,
        invited: 1,
        max: 6,
        min: 2,
        remaining: 0,
        used: 2,
      },
      plans: {
        edge: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
        max: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
        pulse: { active: 1, billed: 2, invited: 1, remaining: 0, used: 2 },
      },
    }),
    { requireButton: false },
  );

  try {
    await clickButton(container, window, "Invite member");
    await clickButton(container, window, "Telegram");
    await act(async () => {
      setInputValue(
        window,
        inputById(container, "family-invite-telegram"),
        "@relative",
      );
    });

    assert.match(
      container.textContent ?? "",
      /Use iMessage or Email to add a paid Pulse seat, or change Family capacity first\./,
    );
    assert.equal(buttonByText(container, "Create invite").disabled, true);
    assert.doesNotMatch(container.textContent ?? "", /Create invite & add Pulse/);
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager defaults to the phone channel with name first", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, baseFamilyManagerProps()),
    { requireButton: false },
  );

  try {
    await clickButton(container, window, "Invite member");

    assert.equal(inputById(container, "family-invite-label").placeholder, "Mom");
    assert.ok(inputById(container, "family-invite-phone"));
    assert.equal(queryInputById(container, "family-invite-email"), null);
    assert.equal(queryInputById(container, "family-invite-telegram"), null);
    assertInviteNameFirst(container);
    assert.match(container.textContent ?? "", /No contact\? Anyone with the link can join\./);
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager submits only the active email contact", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, baseFamilyManagerProps()),
    { requireButton: false },
  );

  try {
    await clickButton(container, window, "Invite member");
    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-phone"), "+48600000000");
    });

    await clickButton(container, window, "Email");
    assert.equal(queryInputById(container, "family-invite-phone"), null);
    assert.ok(inputById(container, "family-invite-email"));
    assert.equal(queryInputById(container, "family-invite-telegram"), null);

    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-email"), "mom@example.com");
    });
    await clickButton(container, window, "Create invite");

    expect(submittedPayload()).toMatchObject({
      addSeatIfNeeded: false,
      targetEmail: "mom@example.com",
    });
    expect(submittedPayload()).not.toHaveProperty("targetPhoneNumber");
    expect(submittedPayload()).not.toHaveProperty("targetTelegramUsername");
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager hides the no-contact hint when the active contact has a value", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, baseFamilyManagerProps()),
    { requireButton: false },
  );

  try {
    await clickButton(container, window, "Invite member");
    assert.match(container.textContent ?? "", /No contact\? Anyone with the link can join\./);

    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-phone"), "+48600000000");
    });

    assert.doesNotMatch(
      container.textContent ?? "",
      /No contact\? Anyone with the link can join\./,
    );
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager surfaces the top-up dialog inside each member's manage modal", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const props = baseFamilyManagerProps();
  const activePurchase = {
    offerCode: "usage_10_usd",
    purchaseId: "hucp_abcdefghijklmnop",
    retryAllowed: false,
    status: "checkout_open" as const,
    url: "https://checkout.stripe.test/session",
  };
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...props,
      members: [
        props.members[0],
        {
          isOwner: false,
          joinedAtIso: "2026-07-10T00:00:00.000Z",
          label: "Family member",
          memberId: "member_family",
          pendingPlanCode: null,
          planCode: "edge" as const,
        },
      ],
      usageTopUpActiveMemberId: "member_family",
      usageTopUpActivePurchase: activePurchase,
      usageTopUpOffers: [
        { amountLabel: "$5", offerCode: "usage_5_usd" },
        { amountLabel: "$10", offerCode: "usage_10_usd" },
        { amountLabel: "$25", offerCode: "usage_25_usd" },
      ],
    }),
    { requireButton: false },
  );

  try {
    // The top-up entry only lives inside a member's manage modal now, so
    // nothing renders it inline in the roster.
    assert.equal(buttonByTextOrNull(container, "Add usage"), null);

    // The frozen member's manage modal surfaces the payment-recovery action.
    await clickLastButton(container, window, "Manage");
    expect([...container.querySelectorAll("button")].filter(
      (button) => button.textContent === "Add usage",
    )).toHaveLength(1);
    expect(mocks.usageTopUpDialogProps).toHaveBeenCalledWith(
      expect.objectContaining({
        activePurchase,
        checkoutUrl:
          "/api/settings/billing/family/members/member_family/usage-credit/checkout",
        deferTerminalRefreshUntilClose: true,
        offers: [],
        scope: "family",
        targetLabel: "Family member",
      }),
    );
    const memberManageProps = mocks.usageTopUpDialogProps.mock.calls
      .map(([callProps]) => callProps)
      .find((callProps) => callProps.targetLabel === "Family member");
    assert.ok(memberManageProps);
    assert.equal("quietSuccessfulReturn" in memberManageProps, false);

    // The owner's manage modal gates offers away and shows no payment action.
    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss dialog"]',
    );
    assert.ok(dismiss);
    await act(async () => {
      dismiss.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    await clickButton(container, window, "Manage");
    assert.equal(buttonByTextOrNull(container, "Add usage"), null);
    expect(mocks.usageTopUpDialogProps).toHaveBeenCalledWith(
      expect.objectContaining({
        activePurchase: null,
        checkoutUrl:
          "/api/settings/billing/family/members/member_owner/usage-credit/checkout",
        deferTerminalRefreshUntilClose: false,
        offers: [],
        scope: "family",
        targetLabel: "you",
      }),
    );
    const ownerManageProps = mocks.usageTopUpDialogProps.mock.calls
      .map(([callProps]) => callProps)
      .find((callProps) => callProps.targetLabel === "you");
    assert.ok(ownerManageProps);
    assert.equal("quietSuccessfulReturn" in ownerManageProps, false);
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager renders a server-withheld former-member checkout as status-only", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const activePurchase = {
    offerCode: "usage_10_usd",
    purchaseId: "hucp_abcdefghijklmnop",
    retryAllowed: false,
    status: "checkout_open" as const,
  };
  const { cleanup, container } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...baseFamilyManagerProps(),
      usageTopUpActiveMemberId: "member_former",
      usageTopUpActivePurchase: activePurchase,
    }),
    { requireButton: false },
  );

  try {
    assert.match(
      container.textContent ?? "",
      /former family member\. It cannot be paid here/,
    );
    expect(mocks.usageTopUpDialogProps).toHaveBeenCalledWith(
      expect.objectContaining({
        activePurchase,
        checkoutUrl:
          "/api/settings/billing/family/members/member_former/usage-credit/checkout",
        deferTerminalRefreshUntilClose: true,
        offers: [],
        scope: "family",
        targetLabel: "a former family member",
      }),
    );
    const formerMountProps = mocks.usageTopUpDialogProps.mock.calls
      .map(([callProps]) => callProps)
      .find((callProps) => callProps.targetLabel === "a former family member");
    assert.ok(formerMountProps);
    assert.equal("contactOptions" in formerMountProps, false);
    assert.equal("quietSuccessfulReturn" in formerMountProps, false);
  } finally {
    await cleanup();
  }
});

test("HostedFamilyManager owns an active member's exact return without opening Manage", async () => {
  const { HostedFamilyManager } = await import(
    "@/src/components/settings/hosted-family-settings-actions"
  );
  const props = baseFamilyManagerProps();
  const activePurchase = {
    offerCode: "usage_10_usd",
    purchaseId: "hucp_active_return00",
    retryAllowed: false,
    status: "fulfilled" as const,
  };
  const purchaseReturn = {
    kind: "success" as const,
    purchaseId: activePurchase.purchaseId,
  };
  const { cleanup, container } = await renderClientComponent(
    createElement(HostedFamilyManager, {
      ...props,
      members: [
        ...props.members,
        {
          isOwner: false,
          joinedAtIso: "2026-07-10T00:00:00.000Z",
          label: "Family member",
          memberId: "member_family",
          pendingPlanCode: null,
          planCode: "edge" as const,
        },
      ],
      usageTopUpActiveMemberId: "member_family",
      usageTopUpActivePurchase: activePurchase,
      usageTopUpPurchaseReturn: purchaseReturn,
      usageTopUpReturnMemberId: "member_family",
    }),
    { requireButton: false },
  );

  try {
    const returnOwnerCalls = mocks.usageTopUpDialogProps.mock.calls
      .map(([callProps]) => callProps)
      .filter(
        (callProps) =>
          callProps.targetLabel === "Family member" &&
          callProps.purchaseReturn === purchaseReturn,
      );
    expect(returnOwnerCalls).toHaveLength(1);
    const returnOwner = returnOwnerCalls[0];
    assert.ok(returnOwner);
    expect(returnOwner).toMatchObject({
      activePurchase,
      checkoutUrl:
        "/api/settings/billing/family/members/member_family/usage-credit/checkout",
      deferTerminalRefreshUntilClose: true,
      offers: [],
      purchaseReturn,
      scope: "family",
      targetLabel: "Family member",
    });
    assert.equal("quietSuccessfulReturn" in returnOwner, false);
    assert.equal(container.querySelector('[data-dialog-open="true"]'), null);
  } finally {
    await cleanup();
  }
});


function baseFamilyManagerProps() {
  return {
    billingActive: true,
    invites: [],
    members: [
      {
        isOwner: true,
        joinedAtIso: "2026-07-01T00:00:00.000Z",
        label: null,
        memberId: "member_owner",
        pendingPlanCode: null,
        planCode: "pulse" as const,
      },
    ],
    plans: {
      edge: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
      max: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
      pulse: { active: 1, billed: 2, invited: 0, remaining: 1, used: 1 },
    },
    payerMemberId: "member_owner",
    seats: {
      active: 1,
      billed: 2,
      invited: 0,
      max: 6,
      min: 2,
      remaining: 1,
      used: 1,
    },
    tiers: [
      {
        name: "Pulse",
        planCode: "pulse" as const,
        priceLabel: "$7/mo",
        recurringAmountUsdCents: 700,
      },
      {
        name: "Edge",
        planCode: "edge" as const,
        priceLabel: "$19/mo",
        recurringAmountUsdCents: 1_900,
      },
      {
        name: "Max",
        planCode: "max" as const,
        priceLabel: "$49/mo",
        recurringAmountUsdCents: 4_900,
      },
    ],
  };
}

async function clickButton(
  container: HTMLElement,
  window: Window & typeof globalThis,
  label: string,
) {
  const button = buttonByText(container, label);
  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

async function clickLastButton(
  container: HTMLElement,
  window: Window & typeof globalThis,
  label: string,
) {
  const buttons = [...container.querySelectorAll("button")].filter(
    (candidate) => candidate.textContent?.includes(label),
  );
  const button = buttons.at(-1);
  assert.ok(button, `Expected button containing "${label}"`);
  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = buttonByTextOrNull(container, label);
  assert.ok(button, `Expected button containing "${label}"`);
  return button;
}

function buttonByTextOrNull(container: HTMLElement, label: string): HTMLButtonElement | null {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.includes(label),
  ) ?? null;
}

function inputById(container: HTMLElement, id: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  assert.ok(input, `Expected input #${id}`);
  return input;
}

function queryInputById(container: HTMLElement, id: string): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(`#${id}`);
}

function setInputValue(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
  value: string,
) {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function submittedPayload(): Record<string, unknown> {
  const lastCall = mocks.requestHostedOnboardingJson.mock.lastCall;
  assert.ok(lastCall, "Expected invite request");
  const payload = lastCall[0]?.payload;
  assert.equal(typeof payload, "object");
  assert.ok(payload);
  return payload as Record<string, unknown>;
}

function assertInviteNameFirst(container: HTMLElement) {
  const inputs = [...container.querySelectorAll<HTMLInputElement>("input")];
  assert.ok(inputs.length > 0, "Expected invite inputs");
  assert.equal(inputs[0]?.id, "family-invite-label");

  const text = container.textContent ?? "";
  const nameIndex = text.indexOf("Name");
  const phoneIndex = text.indexOf("Phone number");

  assert.ok(nameIndex >= 0, "Expected name field");
  assert.ok(phoneIndex > nameIndex, "Expected phone after name");
}
