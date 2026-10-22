import assert from "node:assert/strict";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

import type { HostedPublicLayoutAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

const mocks = vi.hoisted(() => ({
  getHostedPublicLayoutAuthSnapshot: vi.fn(
    async (): Promise<HostedPublicLayoutAuthSnapshot> => ({
      sidebarAuth: {
        authenticated: false,
        label: null,
      },
      status: "ready",
    }),
  ),
}));

vi.mock("next/font/local", () => ({
  default(input: { variable?: string }) {
    return {
      variable: input.variable ?? "font-local",
    };
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPublicLayoutAuthSnapshot: mocks.getHostedPublicLayoutAuthSnapshot,
}));

vi.mock("@/src/components/hosted-onboarding/phone-country-code-provider", () => ({
  PhoneCountryCodeProvider(input: {
    children: ReactNode;
  }) {
    return createElement("div", { "data-phone-country-code": "" }, input.children);
  },
}));

import RootLayout from "../app/layout";

test("RootLayout renders global providers without route-owned footer chrome", async () => {
  const markup = renderToStaticMarkup(
    await RootLayout({
      children: "hosted-shell",
    }),
  );

  assert.match(markup, /hosted-shell/);
  assert.match(markup, /data-phone-country-code=""/);
  assert.doesNotMatch(markup, /data-providers="true"/);
  assert.doesNotMatch(markup, /data-privy-app-id=/);
  assert.doesNotMatch(markup, /data-privy-client-id=/);
  assert.match(markup, /<html lang="en" class="[^"]*--font-serif[^"]*"/u);
  assert.match(markup, /<html lang="en" class="[^"]*--font-sans[^"]*"/u);
  assert.match(markup, /<html lang="en" class="[^"]*--font-mono[^"]*"/u);
  assert.doesNotMatch(markup, /id="site-footer"/u);
  assert.doesNotMatch(markup, /Murph provides educational health information/u);
});
