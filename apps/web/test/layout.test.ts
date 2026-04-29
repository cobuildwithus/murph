import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { vi } from "vitest";

vi.mock("next/font/google", () => ({
  Fraunces(input: { variable?: string }) {
    return {
      variable: input.variable ?? "font-fraunces",
    };
  },
  DM_Sans(input: { variable?: string }) {
    return {
      variable: input.variable ?? "font-sans",
    };
  },
  DM_Mono(input: { variable?: string }) {
    return {
      variable: input.variable ?? "font-mono",
    };
  },
}));

vi.mock("@/src/lib/hosted-onboarding/landing", () => ({
  requireHostedPrivyClientAppId: () => "cm_app_123",
  resolveHostedPrivyClientId: () => "client_123",
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

import RootLayout, { metadata } from "../app/layout";

test("RootLayout renders the Apache footer with support and GitHub links", () => {
  const markup = renderToStaticMarkup(
    RootLayout({
      children: "hosted-shell",
    }),
  );

  assert.match(markup, /hosted-shell/);
  assert.match(markup, /data-phone-country-code=""/);
  assert.match(markup, /data-providers="true"/);
  assert.match(markup, /data-privy-app-id="cm_app_123"/);
  assert.match(markup, /data-privy-client-id="client_123"/);
  assert.match(markup, /<html lang="en" class="[^"]*--font-serif[^"]*"/u);
  assert.match(markup, /<html lang="en" class="[^"]*--font-sans[^"]*"/u);
  assert.match(markup, /<html lang="en" class="[^"]*--font-mono[^"]*"/u);
  assert.match(markup, /Murph is open source and licensed under Apache 2\.0\./);
  assert.match(markup, /Privacy Policy/);
  assert.match(markup, /\/legal\/privacy\.pdf/u);
  assert.match(markup, /Terms/);
  assert.match(markup, /\/legal\/terms\.pdf/u);
  assert.match(markup, /Subprocessors/);
  assert.match(markup, /\/subprocessors/u);
  assert.match(markup, /Contact support/);
  assert.match(markup, /mailto:support@withmurph\.ai/u);
  assert.match(markup, /text-\[11px\].*uppercase.*text-stone-600/u);
  assert.doesNotMatch(markup, /rounded-full/u);
  assert.match(markup, /View the code on GitHub/);
  assert.match(markup, /https:\/\/github\.com\/cobuildwithus\/murph/u);
});

test("RootLayout provides default title, description, and preview image metadata", () => {
  assert.ok(metadata.metadataBase instanceof URL);
  assert.equal(metadata.title, "Murph — Discover what actually makes you healthier");
  assert.equal(
    metadata.description,
    "Your personal health assistant. Connect your data, pick a protocol, see what actually makes you healthier.",
  );
  assert.deepEqual(metadata.openGraph?.images, [
    {
      alt: "Murph — Wearable data, made useful.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
  assert.deepEqual(metadata.twitter?.images, [
    {
      alt: "Murph — Wearable data, made useful.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
});
