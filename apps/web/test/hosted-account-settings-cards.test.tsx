import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { HostedAccountSettingsCards } from "@/src/components/settings/hosted-account-settings-cards";
import type { HostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";

import { renderClientComponent } from "./render-client-component";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("next/dynamic", () => ({
  default: () => function MockHostedSettingsIdentityLinkDialog(
    props: {
      initialMode?: string;
      intent?: string;
      onOpenChange?: (open: boolean) => void;
    },
  ) {
    return React.createElement("div", {
      "data-link-intent": props.intent ?? "manage",
      "data-link-mode": props.initialMode ?? "",
    },
    `identity link ${props.initialMode ?? ""}`,
    React.createElement("button", {
      "data-close-link-dialog": "true",
      onClick: () => props.onOpenChange?.(false),
      type: "button",
    }, "Close"));
  },
}));

vi.mock("@/src/components/settings/hosted-signup-referral-link-button", () => ({
  HostedSignupReferralLinkButton: () => React.createElement(
    "button",
    { type: "button" },
    "Copy link",
  ),
}));

describe("HostedAccountSettingsCards", () => {
  test("keeps a reusable referral link visible without a messaging connection", () => {
    const markup = renderToStaticMarkup(
      React.createElement(HostedAccountSettingsCards, {
        account: makeAccountSnapshot({ phoneNumber: null }),
      }),
    );

    expect(markup).toContain("Referral link");
    expect(markup).toContain("Your reusable link for inviting friends");
    expect(markup).toContain("Copy link");
  });

  test("shows the SMS Murph link only after the member has linked a phone", () => {
    const withoutPhone = renderToStaticMarkup(
      React.createElement(HostedAccountSettingsCards, {
        account: makeAccountSnapshot({ phoneNumber: null }),
        murphPhoneNumber: "+15550100001",
      }),
    );
    const withPhone = renderToStaticMarkup(
      React.createElement(HostedAccountSettingsCards, {
        account: makeAccountSnapshot({ phoneNumber: "+14045550123" }),
        murphPhoneNumber: "+15550100001",
      }),
    );

    expect(withoutPhone).not.toContain("Text Murph");
    expect(withoutPhone).not.toContain("sms:+15550100001");
    expect(withPhone).toContain("Text Murph");
    expect(withPhone).toContain("sms:+15550100001");
  });

  test("shows a private Murph email action after the member has one", () => {
    const markup = renderToStaticMarkup(
      React.createElement(HostedAccountSettingsCards, {
        account: {
          ...makeAccountSnapshot({ phoneNumber: null }),
          email: {
            address: "member@example.com",
            murphEmailAddress: "murph+u2-private-alias@mail.example.test",
            verifiedAt: "2026-05-02T00:00:00.000Z",
          },
          privySignInStates: {
            ...protectedPrivySignInStates(),
            email: { removable: false, status: "matched" },
          },
        },
      }),
    );

    expect(markup).toContain("member@example.com");
    expect(markup).toContain("Email Murph");
    expect(markup).toContain("mailto:murph+u2-private-alias@mail.example.test");
    expect(markup).not.toContain("Email Murph at murph+u2-private-alias@mail.example.test");
    expect(markup).not.toContain("Email murph+u2-private-alias@mail.example.test");
    expect(markup).not.toContain("mail@mail.withmurph.ai");
  });

  test("shows a matched Telegram username instead of the raw Telegram id", () => {
    const markup = renderToStaticMarkup(
      React.createElement(HostedAccountSettingsCards, {
        account: {
          ...makeAccountSnapshot({ phoneNumber: null }),
          privySignInStates: {
            ...protectedPrivySignInStates(),
            telegram: { removable: false, status: "matched" },
          },
          telegram: {
            telegramUserId: "456",
            username: "sample_user",
          },
        },
      }),
    );

    expect(markup).toContain("@sample_user");
    expect(markup).toContain("Message Murph");
    expect(markup).toContain("https://t.me/withmurph_bot");
    expect(markup).not.toContain("Telegram user 456");
  });

  test("hides the Telegram Murph message action until Telegram is connected", () => {
    const markup = renderToStaticMarkup(
      React.createElement(HostedAccountSettingsCards, {
        account: makeAccountSnapshot({ phoneNumber: null }),
      }),
    );

    expect(markup).not.toContain("Message Murph");
    expect(markup).not.toContain("https://t.me/withmurph_bot");
  });

  test("hides the raw Telegram id when no username hint is available", () => {
    const markup = renderToStaticMarkup(
      React.createElement(HostedAccountSettingsCards, {
        account: {
          ...makeAccountSnapshot({ phoneNumber: null }),
          privySignInStates: {
            ...protectedPrivySignInStates(),
            telegram: { removable: false, status: "matched" },
          },
          telegram: {
            telegramUserId: "456",
            username: null,
          },
        },
      }),
    );

    expect(markup).toContain("Connected");
    expect(markup).not.toContain("Telegram user 456");
  });

  test("offers removal only for provider-approved secondary sign-ins", () => {
    const account: HostedAccountSettingsSnapshot = {
      ...makeAccountSnapshot({ phoneNumber: "+14045550123" }),
      email: {
        address: "member@example.com",
        verifiedAt: "2026-05-02T00:00:00.000Z",
      },
      privySignInStates: removablePrivySignInStates(),
      telegram: {
        telegramUserId: "456",
        username: "sample_user",
      },
    };
    const removableMarkup = renderToStaticMarkup(
      React.createElement(HostedAccountSettingsCards, { account }),
    );
    const protectedMarkup = renderToStaticMarkup(
      React.createElement(HostedAccountSettingsCards, {
        account: {
          ...account,
          privySignInStates: protectedPrivySignInStates(),
        },
      }),
    );

    expect(removableMarkup).toContain('aria-label="Remove phone"');
    expect(removableMarkup).toContain('aria-label="Remove email"');
    expect(removableMarkup).toContain('aria-label="Remove Telegram"');
    expect(protectedMarkup).not.toContain('aria-label="Remove phone"');
    expect(protectedMarkup).not.toContain('aria-label="Remove email"');
    expect(protectedMarkup).not.toContain('aria-label="Remove Telegram"');
  });

  test("routes Telegram Change through replacement instead of linking a second account", async () => {
    const rendered = await renderClientComponent(
      React.createElement(HostedAccountSettingsCards, {
        account: {
          ...makeAccountSnapshot({ phoneNumber: null }),
          privySignInStates: {
            ...protectedPrivySignInStates(),
            telegram: { removable: true, status: "matched" },
          },
          telegram: {
            telegramUserId: "456",
            username: "sample_user",
          },
        },
      }),
    );

    try {
      const telegramRow = Array.from(rendered.container.querySelectorAll("div")).find(
        (candidate) =>
          candidate.children[1]?.querySelector("span")?.textContent === "Telegram",
      );
      const changeButton = Array.from(telegramRow?.querySelectorAll("button") ?? []).find(
        (candidate) => candidate.textContent === "Change",
      );

      await React.act(async () => {
        changeButton?.click();
      });

      expect(
        rendered.container.querySelector("[data-link-mode]")?.getAttribute("data-link-mode"),
      ).toBe("telegram");
      expect(
        rendered.container.querySelector("[data-link-intent]")?.getAttribute("data-link-intent"),
      ).toBe("replace");
    } finally {
      await rendered.cleanup();
    }
  });

  test("offers durable cleanup after the provider identity disappears", async () => {
    const rendered = await renderClientComponent(
      React.createElement(HostedAccountSettingsCards, {
        account: {
          ...makeAccountSnapshot({ phoneNumber: "+14045550123" }),
          privySignInStates: {
            ...protectedPrivySignInStates(),
            phone: { removable: true, status: "matched" },
            telegram: { removable: false, status: "absent" },
          },
          telegram: {
            telegramUserId: "456",
            username: null,
          },
        },
      }),
    );

    try {
      expect(rendered.container.textContent).toContain("Finish disconnecting");
      expect(rendered.container.textContent).not.toContain("Message Murph");

      const finishButton = Array.from(rendered.container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === "Finish disconnecting",
      );

      await React.act(async () => {
        finishButton?.click();
      });

      expect(
        rendered.container.querySelector("[data-link-mode]")?.getAttribute("data-link-mode"),
      ).toBe("telegram");
      expect(
        rendered.container.querySelector("[data-link-intent]")?.getAttribute("data-link-intent"),
      ).toBe("finish");
    } finally {
      await rendered.cleanup();
    }
  });

  test("refreshes instead of offering destructive actions when identities disagree", async () => {
    refresh.mockClear();
    const rendered = await renderClientComponent(
      React.createElement(HostedAccountSettingsCards, {
        account: {
          ...makeAccountSnapshot({ phoneNumber: null }),
          privySignInStates: {
            ...protectedPrivySignInStates(),
            telegram: { removable: false, status: "mismatched" },
          },
          telegram: {
            telegramUserId: "456",
            username: null,
          },
        },
      }),
    );

    try {
      const refreshButton = Array.from(rendered.container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === "Refresh",
      );
      expect(refreshButton).toBeTruthy();
      expect(rendered.container.textContent).not.toContain("Remove");

      await React.act(async () => {
        refreshButton?.click();
      });

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(rendered.container.querySelector("[data-link-mode]")).toBeNull();
    } finally {
      await rendered.cleanup();
    }
  });

  test("routes a completed provider phone change through the existing phone recovery flow", async () => {
    refresh.mockClear();
    const rendered = await renderClientComponent(
      React.createElement(HostedAccountSettingsCards, {
        account: {
          ...makeAccountSnapshot({ phoneNumber: "+14045550123" }),
          privySignInStates: {
            ...protectedPrivySignInStates(),
            phone: { removable: false, status: "mismatched" },
          },
        },
      }),
    );

    try {
      const phoneRow = Array.from(rendered.container.querySelectorAll("div")).find(
        (candidate) =>
          candidate.children[1]?.querySelector("span")?.textContent === "Phone",
      );
      const changeButton = Array.from(phoneRow?.querySelectorAll("button") ?? []).find(
        (candidate) => candidate.textContent === "Change",
      );

      expect(changeButton).toBeTruthy();
      await React.act(async () => {
        changeButton?.click();
      });

      expect(refresh).not.toHaveBeenCalled();
      expect(
        rendered.container.querySelector("[data-link-mode]")?.getAttribute("data-link-mode"),
      ).toBe("phone");
      expect(
        rendered.container.querySelector("[data-link-intent]")?.getAttribute("data-link-intent"),
      ).toBe("manage");
    } finally {
      await rendered.cleanup();
    }
  });

  test("keeps phone changes fail closed when the provider state is unknown", async () => {
    refresh.mockClear();
    const rendered = await renderClientComponent(
      React.createElement(HostedAccountSettingsCards, {
        account: {
          ...makeAccountSnapshot({ phoneNumber: "+14045550123" }),
          privySignInStates: null,
        },
      }),
    );

    try {
      const refreshButton = Array.from(rendered.container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === "Refresh",
      );

      expect(refreshButton).toBeTruthy();
      await React.act(async () => {
        refreshButton?.click();
      });

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(rendered.container.querySelector("[data-link-mode]")).toBeNull();
    } finally {
      await rendered.cleanup();
    }
  });

  test("opens the email link dialog when the add-email deep link is present on first mount", async () => {
    const rendered = await renderClientComponent(
      React.createElement(HostedAccountSettingsCards, {
        account: makeAccountSnapshot({ phoneNumber: null }),
        openEmailLink: true,
      }),
      {
        location: {
          href: "https://app.example.test/settings?addEmail=true",
        },
        requireButton: false,
      },
    );

    expect(rendered.container.querySelector("[data-link-mode]")?.getAttribute("data-link-mode"))
      .toBe("email");

    await rendered.cleanup();
  });

  test("opens the email link dialog when the add-email deep link appears after mount", async () => {
    const account = makeAccountSnapshot({ phoneNumber: null });
    const rendered = await renderClientComponent(
      React.createElement(HostedAccountSettingsCards, {
        account,
        openEmailLink: false,
      }),
      {
        location: {
          href: "https://app.example.test/settings?addEmail=true",
        },
        requireButton: false,
      },
    );

    expect(rendered.container.querySelector("[data-link-mode]")).toBeNull();

    await rendered.rerender(
      React.createElement(HostedAccountSettingsCards, {
        account,
        openEmailLink: true,
      }),
    );

    expect(rendered.container.querySelector("[data-link-mode]")?.getAttribute("data-link-mode"))
      .toBe("email");

    const closeButton = rendered.container.querySelector("[data-close-link-dialog]");
    expect(closeButton).toBeInstanceOf(rendered.window.HTMLButtonElement);
    await React.act(async () => {
      (closeButton as HTMLButtonElement | null)?.click();
    });

    expect(rendered.container.querySelector("[data-link-mode]")).toBeNull();

    await rendered.rerender(
      React.createElement(HostedAccountSettingsCards, {
        account,
        openEmailLink: true,
      }),
    );

    expect(rendered.container.querySelector("[data-link-mode]")).toBeNull();

    await rendered.cleanup();
  });
});

function makeAccountSnapshot(input: {
  phoneNumber: string | null;
}): HostedAccountSettingsSnapshot {
  return {
    email: {
      address: null,
      verifiedAt: null,
    },
    phone: {
      number: input.phoneNumber,
      verifiedAt: input.phoneNumber ? "2026-05-02T00:00:00.000Z" : null,
    },
    privySignInStates: {
      ...protectedPrivySignInStates(),
      phone: {
        removable: false,
        status: input.phoneNumber ? "matched" : "absent",
      },
    },
    referralIdentityKey: "member_settings_test",
    telegram: {
      telegramUserId: null,
    },
  };
}

function protectedPrivySignInStates(): NonNullable<
  HostedAccountSettingsSnapshot["privySignInStates"]
> {
  return {
    email: { removable: false, status: "absent" },
    phone: { removable: false, status: "absent" },
    telegram: { removable: false, status: "absent" },
  };
}

function removablePrivySignInStates(): NonNullable<
  HostedAccountSettingsSnapshot["privySignInStates"]
> {
  return {
    email: { removable: true, status: "matched" },
    phone: { removable: true, status: "matched" },
    telegram: { removable: true, status: "matched" },
  };
}
