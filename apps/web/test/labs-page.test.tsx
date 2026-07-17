import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedDashboardPageAuthSnapshot: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedDashboardPageAuthSnapshot:
    mocks.getHostedDashboardPageAuthSnapshot,
}));

vi.mock("@/app/(dashboard)/labs/labs-page-client", () => ({
  LabsPageClient: () =>
    createElement(
      "main",
      null,
      createElement("h1", null, "Labs"),
      createElement("p", null, "Ordering through Murph is planned for later."),
      createElement("form", { "aria-label": "Search live test catalog" }),
      createElement("form", { "aria-label": "Find collection locations" }),
    ),
}));

import LabsPage, {
  metadata,
} from "../app/(dashboard)/labs/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHostedDashboardPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_fixture",
    },
    session: {
      member: {
        id: "member_fixture",
      },
    },
  });
});

describe("LabsPage", () => {
  it("keeps the hidden catalog out of search indexes", () => {
    expect(metadata.title).toBe("Labs — Murph");
    expect(metadata.robots).toEqual({
      follow: false,
      index: false,
    });
    expect(JSON.stringify(metadata)).not.toMatch(/junction/iu);
  });

  it("redirects an unauthenticated visitor before rendering the catalog", async () => {
    mocks.getHostedDashboardPageAuthSnapshot.mockResolvedValue({
      authenticated: false,
      authenticatedMember: null,
      session: null,
    });

    await expect(LabsPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("renders both read-only discovery surfaces for an authenticated member", async () => {
    const markup = renderToStaticMarkup(await LabsPage());

    assert.match(markup, /Labs/);
    assert.match(markup, /Search live test catalog/);
    assert.match(markup, /Find collection locations/);
    assert.match(markup, /Ordering through Murph is planned for later/);
    assert.doesNotMatch(markup, /junction/iu);
    assert.doesNotMatch(markup, />\s*(?:Buy|Book|Order)\s*</iu);
  });
});
