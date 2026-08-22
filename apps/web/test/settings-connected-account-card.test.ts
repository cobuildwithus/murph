import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  ConnectedAccountCard,
  SettingsContactLink,
  SettingsStatusLine,
} from "@/src/components/settings/connected-account-card";
import { formatMaskedPhoneNumber } from "@/src/components/settings/hosted-settings-utils";

describe("formatMaskedPhoneNumber", () => {
  test("masks E.164 phone numbers to last four digits", () => {
    expect(formatMaskedPhoneNumber("+15550100002")).toBe("•••• 0002");
  });

  test("strips non-digits before extracting last four", () => {
    expect(formatMaskedPhoneNumber("(555) 010-0002")).toBe("•••• 0002");
  });

  test("pads with bullets when fewer than four digits are available", () => {
    expect(formatMaskedPhoneNumber("12")).toBe("•••• ••12");
  });

  test("returns the original input when no digits are present", () => {
    expect(formatMaskedPhoneNumber("not a phone")).toBe("not a phone");
  });
});

describe("ConnectedAccountCard", () => {
  test("renders the label, value, optional meta, and action slot", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ConnectedAccountCard, {
        label: "Phone",
        value: "•••• 0002",
        meta: "Verified",
        action: React.createElement("button", { type: "button" }, "Change"),
      }),
    );

    expect(markup).toContain("Phone");
    expect(markup).toContain("•••• 0002");
    expect(markup).toContain("Verified");
    expect(markup).toContain("Change");
    expect(markup).toContain("bg-[rgba(255,252,246,0.9)]");
    expect(markup).toContain("border-[rgba(196,168,130,0.25)]");
    expect(markup).toContain("sm:justify-end");
  });

  test("omits the meta block when meta is not provided", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ConnectedAccountCard, {
        label: "Telegram",
        value: "@member_example",
      }),
    );

    expect(markup).toContain("Telegram");
    expect(markup).toContain("@member_example");
    expect(markup).not.toContain("undefined");
  });

  test("muted empty-state variant uses the shared card surface and muted value text", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ConnectedAccountCard, {
        label: "Email",
        value: "Not connected",
        variant: "empty",
        action: React.createElement("button", { type: "button" }, "Link email"),
      }),
    );

    expect(markup).toContain("Not connected");
    expect(markup).toContain("Link email");
    expect(markup).toContain("text-muted-foreground");
    expect(markup).toContain("text-lg");
    expect(markup).toContain("bg-[rgba(255,252,246,0.9)]");
    expect(markup).toContain("sm:justify-end");
  });

  test("renders a quiet contact link", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        SettingsContactLink,
        {
          href: "mailto:mail@mail.withmurph.ai",
          label: "Email Murph",
        },
        "Email mail@mail.withmurph.ai",
      ),
    );

    expect(markup).toContain("mailto:mail@mail.withmurph.ai");
    expect(markup).toContain("Email mail@mail.withmurph.ai");
    expect(markup).toContain("text-xs");
    expect(markup).toContain("hover:underline");
  });
});

describe("SettingsStatusLine", () => {
  test("reserves vertical space and renders message with destructive tone", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SettingsStatusLine, {
        message: "Could not refresh phone state.",
        tone: "destructive",
      }),
    );

    expect(markup).toContain("Could not refresh phone state.");
    expect(markup).toContain("min-h-[1.25rem]");
    expect(markup).toContain("text-destructive");
    expect(markup).toMatch(/role="alert"/);
  });

  test("reserves vertical space when message is null so layout does not shift", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SettingsStatusLine, {
        message: null,
        tone: "neutral",
      }),
    );

    expect(markup).toContain("min-h-[1.25rem]");
    expect(markup).toContain("text-muted-foreground");
  });

  test("can render visible feedback without owning a live region", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SettingsStatusLine, {
        announce: false,
        message: "Inference mode saved.",
        tone: "neutral",
      }),
    );

    expect(markup).toContain("Inference mode saved.");
    expect(markup).not.toContain("aria-live");
    expect(markup).not.toContain("role=");
  });
});
