import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { vi } from "vitest";

vi.mock("next/font/google", () => ({
  Outfit() {
    return {
      className: "font-outfit",
    };
  },
  Geist() {
    return {
      variable: "font-geist",
    };
  },
}));

vi.mock("@/src/lib/hosted-onboarding/landing", () => ({
  resolveHostedPrivyClientId: () => "client_123",
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  requireHostedPrivyPhoneAuthConfig: () => ({
    appId: "cm_app_123",
    verificationKey: "privy-verification-key",
  }),
}));

vi.mock("../app/providers", () => ({
  Providers(input: { children: React.ReactNode; privyAppId: string; privyClientId?: string | null }) {
    return createElement(
      "div",
      {
        "data-providers": "true",
        "data-privy-app-id": input.privyAppId,
        "data-privy-client-id": input.privyClientId ?? "",
      },
      input.children,
    );
  },
}));

import RootLayout from "../app/layout";

test("RootLayout renders the Apache footer with a GitHub link", () => {
  const markup = renderToStaticMarkup(
    RootLayout({
      children: "hosted-shell",
    }),
  );

  assert.match(markup, /hosted-shell/);
  assert.match(markup, /data-providers="true"/);
  assert.match(markup, /data-privy-app-id="cm_app_123"/);
  assert.match(markup, /data-privy-client-id="client_123"/);
  assert.match(markup, /Murph is open source and licensed under Apache 2\.0\./);
  assert.match(markup, /View the code on GitHub/);
  assert.match(markup, /https:\/\/github\.com\/cobuildwithus\/murph/u);
});
