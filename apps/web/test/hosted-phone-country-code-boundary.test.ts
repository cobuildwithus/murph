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

vi.mock("@/src/components/hosted-onboarding/phone-country-code-client-provider", () => ({
  PhoneCountryCodeClientProvider(input: {
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

test("PhoneCountryCodeProvider reads the current request hint and provides it to children", async () => {
  mocks.readHostedPhoneCountryCodeHint.mockResolvedValue("GB");

  const { PhoneCountryCodeProvider } = await import(
    "@/src/components/hosted-onboarding/phone-country-code-provider"
  );

  const markup = renderToStaticMarkup(
    await PhoneCountryCodeProvider({
      children: createElement("div", null, "child"),
    }),
  );

  expect(mocks.readHostedPhoneCountryCodeHint).toHaveBeenCalledTimes(1);
  assert.match(markup, /data-phone-country-code="GB"/);
  assert.match(markup, /child/);
});
