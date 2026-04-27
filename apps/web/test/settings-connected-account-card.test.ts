import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { ConnectedAccountCard } from "@/src/components/settings/connected-account-card";
import { formatMaskedPhoneNumber } from "@/src/components/settings/hosted-settings-utils";

describe("formatMaskedPhoneNumber", () => {
  test("masks E.164 phone numbers to last four digits", () => {
    expect(formatMaskedPhoneNumber("+14046257706")).toBe("•••• 7706");
  });

  test("strips non-digits before extracting last four", () => {
    expect(formatMaskedPhoneNumber("(404) 625-7706")).toBe("•••• 7706");
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
        value: "•••• 7706",
        meta: "Verified",
        action: React.createElement("button", { type: "button" }, "Change phone"),
      }),
    );

    expect(markup).toContain("Phone");
    expect(markup).toContain("•••• 7706");
    expect(markup).toContain("Verified");
    expect(markup).toContain("Change phone");
    expect(markup).toContain("bg-card");
    expect(markup).toContain("border-border");
  });

  test("omits the meta block when meta is not provided", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ConnectedAccountCard, {
        label: "Telegram",
        value: "@willhay",
      }),
    );

    expect(markup).toContain("Telegram");
    expect(markup).toContain("@willhay");
    expect(markup).not.toContain("undefined");
  });
});
