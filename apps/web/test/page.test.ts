import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  scheduleHomepageBrowserVaultPreparation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-vercel-ip-country": "US" }),
}));
vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));
vi.mock("@/src/lib/browser-vault/homepage-preparation", () => ({
  scheduleHomepageBrowserVaultPreparation:
    mocks.scheduleHomepageBrowserVaultPreparation,
}));
vi.mock("@/src/lib/github-stars", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/github-stars")>(),
  getMurphGithubStarCount: async () => null,
}));
vi.mock("@/src/lib/hero-contact-info", () => ({
  fetchHeroContactInfo: async () => ({
    phone: null,
    phoneConfigured: false,
    telegram: null,
  }),
}));

import HomePage from "../app/page";

beforeEach(() => {
  vi.clearAllMocks();
});

test("an anonymous homepage visit does not prepare a private browser vault", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({ authenticated: false });
  await HomePage();
  expect(mocks.scheduleHomepageBrowserVaultPreparation).not.toHaveBeenCalled();
});

test("a signed-in homepage visit prepares only its authenticated member's vault", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: { id: "member_homepage" },
  });
  await HomePage();
  expect(mocks.scheduleHomepageBrowserVaultPreparation.mock.calls).toEqual([
    [{ memberId: "member_homepage" }],
  ]);
});
