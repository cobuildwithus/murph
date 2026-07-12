import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getMurphGithubStarCount: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  resolveHostedMurphContactOptions: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("@/src/lib/github-stars", () => ({
  formatStarCount: (count: number) => String(count),
  getMurphGithubStarCount: mocks.getMurphGithubStarCount,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/components/murph/hosted-murph-contact-action", () => ({
  resolveHostedMurphContactOptions: mocks.resolveHostedMurphContactOptions,
}));

import ChangelogPage, { generateMetadata } from "../app/changelog/page";
import {
  buildAbsoluteChangelogUrl,
  buildChangelogCardPath,
  CHANGELOG_PREVIEW_CARD_ITEMS,
  listChangelogEditions,
} from "../src/lib/changelog";

describe("ChangelogPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticated: false,
      authenticatedMember: null,
      session: null,
    });
    mocks.getMurphGithubStarCount.mockResolvedValue(1_000);
    mocks.resolveHostedMurphContactOptions.mockResolvedValue([]);
  });

  it("renders one dated edition with compact older navigation", async () => {
    const markup = renderToStaticMarkup(
      await ChangelogPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("A Murph that sounds more like you");
    expect(markup).not.toContain("Better answers, better instincts");
    expect(markup).toContain('aria-label="Changelog pages"');
    expect(markup).toContain('href="/changelog?edition=2026-07-09"');
    expect(markup).toContain("Older");
    expect(markup).not.toContain(">Newer<");
  });

  it("renders the requested older edition with newer and older links", async () => {
    const markup = renderToStaticMarkup(
      await ChangelogPage({
        searchParams: Promise.resolve({ edition: "2026-07-09" }),
      }),
    );

    expect(markup).toContain("Better answers, better instincts");
    expect(markup).not.toContain("A Murph that sounds more like you");
    expect(markup).toContain('href="/changelog"');
    expect(markup).toContain('href="/changelog?edition=2026-07-08"');
    expect(markup).toContain("Newer");
    expect(markup).toContain("Older");
  });

  it("publishes a canonical URL for each valid archive page", async () => {
    const editions = listChangelogEditions();
    const pageTwoCardUrl = buildAbsoluteChangelogUrl(
      buildChangelogCardPath(
        editions[1]!.items
          .slice(0, CHANGELOG_PREVIEW_CARD_ITEMS)
          .map((item) => item.id),
      ),
    );
    const pageOneCardUrl = buildAbsoluteChangelogUrl(
      buildChangelogCardPath(
        editions[0]!.items
          .slice(0, CHANGELOG_PREVIEW_CARD_ITEMS)
          .map((item) => item.id),
      ),
    );
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ edition: "2026-07-09" }),
    });

    expect(metadata).toEqual(
      expect.objectContaining({
        alternates: { canonical: "/changelog?edition=2026-07-09" },
        openGraph: expect.objectContaining({
          images: [expect.objectContaining({ url: pageTwoCardUrl })],
        }),
        title: "Murph Changelog, page 2",
      }),
    );
    expect(metadata).not.toEqual(
      expect.objectContaining({
        openGraph: expect.objectContaining({
          images: [expect.objectContaining({ url: pageOneCardUrl })],
        }),
      }),
    );
  });

  it("returns not found for malformed or unknown edition cursors", async () => {
    await expect(
      ChangelogPage({
        searchParams: Promise.resolve({ edition: "2026-7-09" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      ChangelogPage({
        searchParams: Promise.resolve({ edition: "2099-01-01" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(2);
  });
});
