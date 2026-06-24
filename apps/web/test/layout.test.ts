import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

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

test("footer ownership stays on explicit public surfaces", () => {
  const readAppFile = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const assertOwnsFooter = (path: string) => {
    const source = readAppFile(path);

    assert.match(
      source,
      /import \{ SiteFooter \} from "@\/src\/components\/homepage\/site-footer";/u,
      `${path} should import SiteFooter directly`,
    );
    assert.match(
      source,
      /<SiteFooter \/>/u,
      `${path} should render SiteFooter directly`,
    );
  };

  assertOwnsFooter("app/page.tsx");
  assertOwnsFooter("app/security/page.tsx");
  assertOwnsFooter("app/subprocessors/page.tsx");
  assertOwnsFooter("app/design/page.tsx");
  assertOwnsFooter("app/not-found.tsx");
  assertOwnsFooter("src/components/legal/legal-policy-page.tsx");

  const rootLayoutSource = readAppFile("app/layout.tsx");
  assert.doesNotMatch(rootLayoutSource, /SiteFooter/u);
  assert.equal(
    existsSync(
      new URL("../src/components/homepage/site-footer-slot.tsx", import.meta.url),
    ),
    false,
  );
  assert.equal(
    existsSync(
      new URL(
        "../app/join/[inviteCode]/success/layout.tsx",
        import.meta.url,
      ),
    ),
    false,
  );

  for (const path of [
    "src/components/dashboard/dashboard-shell.tsx",
    "src/components/hosted-onboarding/join-invite-shell.tsx",
  ]) {
    const source = readAppFile(path);
    assert.doesNotMatch(source, /#site-footer/u);
    assert.doesNotMatch(source, /display: none/u);
    assert.doesNotMatch(source, /SiteFooter/u);
  }
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
