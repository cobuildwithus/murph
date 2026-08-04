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

vi.mock("@/app/(dashboard)/environment/print/environment-print-page-client", () => ({
  EnvironmentPrintPageClient: ({ generatedOn }: { generatedOn: string }) =>
    createElement("main", null, `Private Environment report · ${generatedOn}`),
}));

import EnvironmentPrintPage, {
  metadata,
} from "../app/(dashboard)/environment/print/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHostedDashboardPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: { id: "member_fixture" },
    session: { member: { id: "member_fixture" } },
  });
});

describe("EnvironmentPrintPage", () => {
  it("keeps the private report out of search indexes", () => {
    expect(metadata.title).toBe("Environment report — Murph");
    expect(metadata.robots).toEqual({ follow: false, index: false });
  });

  it("redirects an unauthenticated visitor before the private report mounts", async () => {
    mocks.getHostedDashboardPageAuthSnapshot.mockResolvedValue({
      authenticated: false,
      authenticatedMember: null,
      session: null,
    });

    await expect(EnvironmentPrintPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("renders the private report client for an authenticated member", async () => {
    const markup = renderToStaticMarkup(await EnvironmentPrintPage());

    assert.match(markup, /Private Environment report/);
    expect(mocks.getHostedDashboardPageAuthSnapshot).toHaveBeenCalledOnce();
  });
});
