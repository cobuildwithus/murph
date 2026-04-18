import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedPhoneCountryCodeHint: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/phone-country-hint-server", () => ({
  readHostedPhoneCountryCodeHint: mocks.readHostedPhoneCountryCodeHint,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-phone-country-code-provider", () => ({
  HostedPhoneCountryCodeProvider(input: {
    children: React.ReactNode;
    countryCode: string | null;
  }) {
    return createElement(
      "div",
      {
        "data-phone-country-code": input.countryCode ?? "",
      },
      input.children,
    );
  },
}));

test("HostedPhoneCountryCodeBoundary reads the current request hint and provides it to children", async () => {
  mocks.readHostedPhoneCountryCodeHint.mockResolvedValue("GB");

  const { HostedPhoneCountryCodeBoundary } = await import(
    "@/src/components/hosted-onboarding/hosted-phone-country-code-boundary"
  );

  const markup = renderToStaticMarkup(
    await HostedPhoneCountryCodeBoundary({
      children: createElement("div", null, "child"),
    }),
  );

  expect(mocks.readHostedPhoneCountryCodeHint).toHaveBeenCalledTimes(1);
  assert.match(markup, /data-phone-country-code="GB"/);
  assert.match(markup, /child/);
});
