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

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children?: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (open ? createElement("div", { "data-dialog-open": "true" }, children) : null),
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

test("HostedFamilyManager copies a Telegram deep link for Telegram-bound invites", async () => {
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
        setInputValue(window, inputById(container, "family-invite-telegram"), "@dad_username");
      });
      await clickButton(container, window, "Create invite");

      expect(submittedPayload()).toMatchObject({
        addSeatIfNeeded: false,
        targetTelegramUsername: "@dad_username",
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
    }),
    { requireButton: false },
  );

  try {
    assert.match(
      container.textContent ?? "",
      /No open seats\. Inviting with a contact adds a paid seat at \$7\/mo\./,
    );

    await clickButton(container, window, "Invite member");
    assert.match(
      container.textContent ?? "",
      /Add a contact to invite\. It adds a paid seat at \$7\/mo\./,
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
      /Enter a valid phone number to invite\. It adds a paid seat at \$7\/mo\./,
    );
    assert.equal(buttonByText(container, "Create invite").disabled, true);

    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-phone"), "+48600000000");
    });
    const contactBoundSubmit = buttonByText(container, "Create invite & add seat");
    assert.equal(contactBoundSubmit.disabled, false);

    await clickButton(container, window, "Email");
    assert.equal(queryInputById(container, "family-invite-phone"), null);
    assert.ok(inputById(container, "family-invite-email"));
    const inactivePhoneSubmit = buttonByText(container, "Create invite");
    assert.equal(inactivePhoneSubmit.disabled, true);

    await clickButton(container, window, "iMessage");
    await clickButton(container, window, "Create invite & add seat");

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
      },
    ],
    seatPrice: "$7/mo",
    seats: {
      active: 1,
      billed: 2,
      invited: 0,
      max: 6,
      min: 2,
      remaining: 1,
      used: 1,
    },
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

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.includes(label),
  );
  assert.ok(button, `Expected button containing "${label}"`);
  return button;
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
