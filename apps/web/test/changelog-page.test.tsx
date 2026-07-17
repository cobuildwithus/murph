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

  it("renders the latest seven days with compact older navigation", async () => {
    const markup = renderToStaticMarkup(
      await ChangelogPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("More follow-through, less friction");
    expect(markup).toContain("A lighter way to say yes");
    expect(markup).toContain("Your plan, groups, and next appointment");
    expect(markup).toContain("More control, less waiting");
    expect(markup).toContain("Health help with more context");
    expect(markup).toContain("A cleaner fit on every phone");
    expect(markup).toContain("A Murph that sounds more like you");
    expect(markup).not.toContain("Better answers, better instincts");
    expect(markup).not.toContain("Murph referees your group challenge");
    expect(markup).toContain('aria-label="Changelog pages"');
    expect(markup).toContain('href="/changelog?edition=2026-07-09"');
    expect(markup).toContain(
      'href="/changelog?edition=2026-07-12#eye-health-playbook"',
    );
    expect(markup).toContain("Older");
    expect(markup).not.toContain(">Newer<");
  });

  it("renders explanatory visuals for the major new features", async () => {
    const markup = renderToStaticMarkup(
      await ChangelogPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("Thinking settings");
    expect(markup).toContain("Approve and resume");
    expect(markup).toContain("Browser login recovery");
    expect(markup).toContain("A few to start with");
    expect(markup).toContain("Pick Murph&#x27;s voice");
    expect(markup).toContain("Classic Murph");
    expect(markup).toContain("Warm and friendly");
    expect(markup).toContain("Small-screen pass");
  });

  it("renders the requested older seven-day window with newer and older links", async () => {
    const markup = renderToStaticMarkup(
      await ChangelogPage({
        searchParams: Promise.resolve({ edition: "2026-07-08" }),
      }),
    );

    expect(markup).toContain("Murph referees your group challenge");
    expect(markup).not.toContain("A lighter way to say yes");
    expect(markup).toContain(
      "Seven days of features and improvements from the full Murph archive.",
    );
    expect(markup).not.toContain("The latest seven days");
    expect(markup).toContain('href="/changelog"');
    expect(markup).toContain('href="/changelog?edition=2026-07-01"');
    expect(markup).toContain("Newer");
    expect(markup).toContain("Older");
  });

  it("keeps internal provider branding out of every rendered archive page", async () => {
    const editions = listChangelogEditions();
    const pageStarts = editions.filter((_, index) => index % 7 === 0);

    for (const [index, edition] of pageStarts.entries()) {
      const markup = renderToStaticMarkup(
        await ChangelogPage({
          searchParams: Promise.resolve(index === 0 ? {} : { edition: edition.id }),
        }),
      );
      expect(markup).not.toMatch(/junction/iu);
    }
  });

  it("publishes a canonical URL for each valid archive page", async () => {
    const editions = listChangelogEditions();
    const pageTwoEditions = editions.slice(7, 14);
    const pageTwoCardUrl = buildAbsoluteChangelogUrl(
      buildChangelogCardPath(
        pageTwoEditions
          .flatMap((edition) => edition.items)
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
      searchParams: Promise.resolve({ edition: "2026-07-08" }),
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
