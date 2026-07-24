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

    expect(markup).toContain("Group chats that read the room");
    expect(markup).toContain(
      "Updated documents, honest reactions, usage you can see",
    );
    expect(markup).toContain("Onboarding that sounds like a person");
    expect(markup).toContain("Pick who Murph is");
    expect(markup).toContain(
      "Standings that explain themselves, payments that finish",
    );
    expect(markup).toContain("Medical records, without the integration jargon");
    expect(markup).toContain("Replies that know what they are answering");
    expect(markup).toContain("Improvements");
    expect(markup).not.toContain("Under the hood");
    expect(markup).not.toContain("Your records and measurements, in one place");
    expect(markup).not.toContain("More control, less waiting");
    expect(markup).not.toContain("Better answers, better instincts");
    expect(markup).not.toContain("Murph referees your group challenge");
    expect(markup).toContain('aria-label="Changelog pages"');
    expect(markup).toContain('href="/changelog?edition=2026-07-17"');
    expect(markup).toContain(
      'href="/changelog?edition=2026-07-19#medical-records-plain-language"',
    );
    expect(markup).toContain("Older");
    expect(markup).not.toContain(">Newer<");
  });

  it("renders explanatory visuals for the major new features", async () => {
    const markup = renderToStaticMarkup(
      await ChangelogPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("Add usage");
    expect(markup).toContain("Independent product testing");
    expect(markup).toContain("Group texts per day");
    expect(markup).toContain("Continue to Garmin");
    expect(markup).toContain("Add to Contacts");
    expect(markup).toContain("Try again");
  });

  it("renders the requested older seven-day window with newer and older links", async () => {
    const markup = renderToStaticMarkup(
      await ChangelogPage({
        searchParams: Promise.resolve({ edition: "2026-07-08" }),
      }),
    );

    expect(markup).toContain("Advice grounded in your own data");
    expect(markup).not.toContain("A lighter way to say yes");
    expect(markup).toContain(
      "Seven days of features and improvements from the full Murph archive.",
    );
    expect(markup).not.toContain("The latest seven days");
    expect(markup).toContain('href="/changelog"');
    expect(markup).toContain('href="/changelog?edition=2026-07-02"');
    expect(markup).toContain("Newer");
    expect(markup).toContain("Older");
  });

  it("uses provider-neutral visible copy for the historical wearable visual", async () => {
    const markup = renderToStaticMarkup(
      await ChangelogPage({
        searchParams: Promise.resolve({ edition: "2026-06-26" }),
      }),
    );

    expect(markup).toContain("Wearable record days");
    expect(markup).not.toContain("WHOOP / Junction days");
  });

  it("publishes a canonical URL for each valid archive page", async () => {
    const editions = listChangelogEditions();
    const pageThreeEditions = editions.slice(14, 21);
    const pageThreeCardUrl = buildAbsoluteChangelogUrl(
      buildChangelogCardPath(
        pageThreeEditions
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
        alternates: { canonical: "/changelog?edition=2026-07-10" },
        openGraph: expect.objectContaining({
          images: [expect.objectContaining({ url: pageThreeCardUrl })],
        }),
        title: "Murph Changelog, page 3",
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
