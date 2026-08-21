import assert from "node:assert/strict";

import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: (props: {
    children: ReactNode;
    className?: string;
    href: string;
    prefetch?: boolean;
  }) =>
    createElement(
      "a",
      {
        className: props.className,
        "data-prefetch": String(props.prefetch),
        href: props.href,
      },
      props.children,
    ),
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
  getHostedDashboardPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("NotFound sends anonymous users back to the public landing page", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
  });

  const { default: NotFound } = await import("../app/not-found");

  const markup = renderToStaticMarkup(await NotFound());

  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  assert.match(markup, /data-prefetch="false" href="\/"[^>]*>\s*Back to Murph\s*<\/a>/u);
  assert.match(markup, /Page not found/u);
  assert.match(markup, /href="\/llms\.txt"/u);
  assert.match(markup, /href="\/sitemap\.xml"/u);
});

test("NotFound sends authenticated users back to the hosted home page", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
  });

  const { default: NotFound } = await import("../app/not-found");

  const markup = renderToStaticMarkup(await NotFound());

  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  assert.match(markup, /data-prefetch="false" href="\/home"[^>]*>\s*Back to Murph\s*<\/a>/u);
});
