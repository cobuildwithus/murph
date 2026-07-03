import assert from "node:assert/strict";

import {
  act,
  createElement,
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
      assert.match(container.textContent ?? "", /Murph won't message them/);

      await act(async () => {
        setInputValue(window, inputById(container, "family-invite-phone"), "+48600000000");
      });
      await clickButton(container, window, "Create invite");

      assert.match(container.textContent ?? "", /Invite created/);
      assert.match(container.textContent ?? "", /Murph won't send this for you/);
      assert.match(container.textContent ?? "", /copy the link and text it to them yourself/i);
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
      /Invites with a phone, email, or Telegram add a paid seat/,
    );

    await clickButton(container, window, "Invite member");
    assert.match(container.textContent ?? "", /Add a phone, email, or Telegram username/);

    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-label"), "Mom");
    });
    const labelOnlySubmit = buttonByText(container, "Create invite");
    assert.equal(labelOnlySubmit.disabled, true);
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();

    await act(async () => {
      setInputValue(window, inputById(container, "family-invite-phone"), "+48600000000");
    });
    const contactBoundSubmit = buttonByText(container, "Create invite & add seat");
    assert.equal(contactBoundSubmit.disabled, false);

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
