import assert from "node:assert/strict";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedSidebarAuthSnapshot: vi.fn(async () => ({
    authenticated: false,
    label: null,
  })),
}));

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

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedSidebarAuthSnapshot: mocks.getHostedSidebarAuthSnapshot,
}));

vi.mock("@/src/components/hosted-onboarding/phone-country-code-provider", () => ({
  PhoneCountryCodeProvider(input: {
    children: ReactNode;
  }) {
    return createElement("div", { "data-phone-country-code": "" }, input.children);
  },
}));

import RootLayout, { metadata } from "../app/layout";

test("RootLayout renders the site footer with legal and social links", async () => {
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
  assert.match(markup, /Murph provides educational health information/);
  assert.match(markup, /Consumer Health Data/);
  assert.match(
    markup,
    /href="\/consumer-health-data-privacy-policy"/u,
  );
  assert.match(markup, /Privacy Policy/);
  assert.match(markup, /\/legal\/privacy/u);
  assert.match(markup, /Terms of Use/);
  assert.match(markup, /\/legal\/terms/u);
  assert.match(markup, /Subprocessors/);
  assert.match(markup, /\/subprocessors/u);
  assert.match(markup, /Security/);
  assert.match(markup, /\/security/u);
  assert.match(markup, /Murph . 2025.2026/);
  assert.doesNotMatch(markup, /rounded-full/u);
  assert.match(markup, /aria-label="Murph on GitHub"/);
  assert.match(markup, /aria-label="Murph on X"/);
  assert.match(markup, /https:\/\/github\.com\/cobuildwithus\/murph/u);
});

test("RootLayout provides default title, description, and preview image metadata", () => {
  assert.ok(metadata.metadataBase instanceof URL);
  assert.equal(metadata.title, "Murph — Discover what actually makes you healthier");
  assert.equal(
    metadata.description,
    "Your personal health assistant. Sync your signals, pick a protocol, see what actually makes you healthier.",
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
