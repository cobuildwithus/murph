import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getHostedSidebarAuthSnapshot: vi.fn(),
  issueHostedInvite: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  issueHostedInvite: mocks.issueHostedInvite,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
  getHostedSidebarAuthSnapshot: mocks.getHostedSidebarAuthSnapshot,
}));

vi.mock("@/src/components/dashboard/sidebar", () => ({
  Sidebar() {
    return createElement("div", {
      "data-dashboard-sidebar": "true",
    });
  },
}));

import DashboardLayout from "../app/(dashboard)/layout";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });
  mocks.getHostedSidebarAuthSnapshot.mockResolvedValue({
    authenticated: false,
    label: null,
  });
  mocks.issueHostedInvite.mockResolvedValue({
    inviteCode: "recovery invite",
  });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

test("the dashboard layout is the single shell owner for biomarker pages", async () => {
  assert.equal(
    existsSync(new URL("../app/(dashboard)/biomarkers/layout.tsx", import.meta.url)),
    false,
  );

  const markup = renderToStaticMarkup(
    await DashboardLayout({
      children: createElement(
        "div",
        { "data-biomarker-page": "true" },
        "biomarker",
      ),
    }),
  );

  assert.doesNotMatch(markup, /site-footer/);
  assert.doesNotMatch(markup, /data-hosted-privy-boundary="true"/);
  assert.match(markup, /data-dashboard-sidebar="true"/);
  assert.match(markup, /data-biomarker-page="true"/);
  assert.match(markup, /data-slot="sidebar-wrapper"/);
  assert.match(markup, /data-slot="sidebar-inset"/);
  assert.match(markup, /<main class="flex-1 px-4 py-8 md:px-14 md:py-10">/);
});

test.each(["not_started", "incomplete"])(
  "redirects %s members back to their hosted join flow",
  async (billingStatus) => {
    mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce(
      createAuthenticatedPageAuth(billingStatus),
    );

    await expect(
      DashboardLayout({
        children: createElement("div", null, "dashboard"),
      }),
    ).rejects.toThrow("redirect:/join/recovery%20invite");

    expect(mocks.issueHostedInvite).toHaveBeenCalledWith({
      channel: "web",
      memberId: "member_123",
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/join/recovery%20invite");
    expect(mocks.getHostedSidebarAuthSnapshot).not.toHaveBeenCalled();
  },
);

test("keeps active members on the dashboard", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce(
    createAuthenticatedPageAuth("active"),
  );
  mocks.getHostedSidebarAuthSnapshot.mockResolvedValueOnce({
    authenticated: true,
    label: null,
  });

  const markup = renderToStaticMarkup(
    await DashboardLayout({
      children: createElement("div", { "data-active-dashboard": "true" }, "dashboard"),
    }),
  );

  assert.match(markup, /data-active-dashboard="true"/);
  expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
  expect(mocks.redirect).not.toHaveBeenCalled();
});

test.each([
  ["past_due", null],
  ["not_started", new Date("2026-06-24T00:00:00.000Z")],
])(
  "does not send blocked %s members into checkout recovery",
  async (billingStatus, suspendedAt) => {
    mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce(
      createAuthenticatedPageAuth(billingStatus, suspendedAt),
    );

    const markup = renderToStaticMarkup(
      await DashboardLayout({
        children: createElement("div", { "data-blocked-dashboard": "true" }, "dashboard"),
      }),
    );

    assert.match(markup, /data-blocked-dashboard="true"/);
    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  },
);

function createAuthenticatedPageAuth(
  billingStatus: string,
  suspendedAt: Date | null = null,
) {
  const member = {
    billingStatus,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    id: "member_123",
    suspendedAt,
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  };

  return {
    authenticated: true,
    authenticatedMember: member,
    session: {
      expiresAt: new Date("2026-07-01T00:00:00.000Z"),
      member,
      privyUserId: "privy_123",
      sessionId: "session_123",
    },
  };
}
