import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { HostedAccountSettingsCards } from "@/src/components/settings/hosted-account-settings-cards";
import type { HostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";

describe("HostedAccountSettingsCards", () => {
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
        },
      }),
    );

    expect(markup).toContain("member@example.com");
    expect(markup).toContain("Email Murph");
    expect(markup).toContain("mailto:murph+u2-private-alias@mail.example.test");
    expect(markup).not.toContain("Email Murph at murph+u2-private-alias@mail.example.test");
    expect(markup).not.toContain("Email murph+u2-private-alias@mail.example.test");
    expect(markup).not.toContain("murph@mail.withmurph.ai");
  });

  test("shows a matched Telegram username instead of the raw Telegram id", () => {
    const markup = renderToStaticMarkup(
      React.createElement(HostedAccountSettingsCards, {
        account: {
          ...makeAccountSnapshot({ phoneNumber: null }),
          telegram: {
            telegramUserId: "456",
            username: "sample_user",
          },
        },
      }),
    );

    expect(markup).toContain("@sample_user");
    expect(markup).not.toContain("Telegram user 456");
  });

  test("hides the raw Telegram id when no username hint is available", () => {
    const markup = renderToStaticMarkup(
      React.createElement(HostedAccountSettingsCards, {
        account: {
          ...makeAccountSnapshot({ phoneNumber: null }),
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
    telegram: {
      telegramUserId: null,
    },
  };
}
