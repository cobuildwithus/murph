import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { HostedLoginMethodSettings } from "@/src/components/settings/hosted-login-method-settings";

test("billing email hints never appear as verified connections and the last usable method has no removal control", () => {
  const markup = renderToStaticMarkup(createElement(HostedLoginMethodSettings, { account: {
    email: { address: "unverified-billing@example.test", verifiedAt: null },
    phone: { number: "+12025550152", verifiedAt: "2026-09-09T12:00:00Z" },
    telegram: { telegramUserId: null }, referralIdentityKey: "synthetic-referral",
  } }));
  expect(markup).not.toContain("unverified-billing@example.test");
  expect(markup).toContain('aria-label="Add Email"');
  expect(markup).toContain('aria-label="Change Phone"');
  expect(markup).not.toContain('aria-label="Remove Phone"');
});
