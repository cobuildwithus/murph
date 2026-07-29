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
import { ChangelogArchiveStudy } from "../app/design/changelog-archive-study";
import {
  buildAbsoluteChangelogUrl,
  buildChangelogCardPath,
  buildChangelogPagePath,
  CHANGELOG_EDITIONS_PER_PAGE,
  CHANGELOG_PREVIEW_CARD_ITEMS,
  listChangelogEditions,
  resolveChangelogEditionPage,
  resolveChangelogPage,
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

    expect(markup).toContain("Corrections that carry forward");
    expect(markup).toContain("A first text that goes somewhere");
    expect(markup).toContain("Reminders on your time, not ours");
    expect(markup).toContain("Group memory, clearer recovery");
    expect(markup).toContain("A Murph that knows when to speak");
    expect(markup).toContain("Group chats that read the room");
    expect(markup).toContain(
      "Updated documents, honest reactions, usage you can see",
    );
    expect(markup).not.toContain("Onboarding that sounds like a person");
    expect(markup).not.toContain("Pick who Murph is");
    expect(markup).not.toContain(
      "Standings that explain themselves, payments that finish",
    );
    expect(markup).not.toContain(
      "Medical records, without the integration jargon",
    );
    expect(markup).not.toContain("Replies that know what they are answering");
    expect(markup).toContain("Improvements");
    expect(markup).not.toContain("Under the hood");
    expect(markup).not.toContain("Your records and measurements, in one place");
    expect(markup).not.toContain("More control, less waiting");
    expect(markup).not.toContain("Better answers, better instincts");
    expect(markup).not.toContain("Murph referees your group challenge");
    expect(markup).toContain('aria-label="Changelog pages"');
    expect(markup).toContain('href="/changelog?edition=2026-07-22"');
    expect(markup).toContain(
      'href="/changelog?edition=2026-07-29#post-onboarding-choice-point"',
    );
    expect(markup).toContain("Older");
    expect(markup).not.toContain(">Newer<");
  });

  it("renders the new try-it controls with their exact prompts", async () => {
    const markup = renderToStaticMarkup(
      await ChangelogPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("Ask about X");
    expect(markup).toContain("Turn it up");
    expect(markup).toContain("Explore club challenges");
    expect(markup).toContain('href="/clubs"');
    expect(markup).toMatch(/Ask what(?:&#x27;|')s new/u);
    expect(
      mocks.resolveHostedMurphContactOptions.mock.calls.map(([input]) => input),
    ).toEqual(
      expect.arrayContaining([
        {
          message: {
            body: "What are people on X saying about zone 2 training this week?",
            subject: "Try it: Ask Grok what people are saying on X",
          },
        },
        {
          message: {
            body: "Turn up my Unhinged setting a little.",
            subject: "Try it: Ask Murph to loosen up",
          },
        },
        {
          message: {
            body: "What changed in Murph this week?",
            subject: "Try it: Ask Murph what changed",
          },
        },
      ]),
    );
    expect(mocks.resolveHostedMurphContactOptions).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          subject: "Try it: Club challenges have a home",
        }),
      }),
    );
  });

  it("renders explanatory visuals for the major new features", async () => {
    const markup = renderToStaticMarkup(
      await ChangelogPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("Add usage");
    expect(markup).toContain("Group texts per day");
    expect(markup).toContain("Add to Contacts");
    expect(markup).toContain("Try again");
    expect(markup).toContain("Scheduled reminders");
    expect(markup).toContain("Keep Murph going");
    expect(markup).toContain("Verified line after setup");
    expect(markup).toContain("One-time follow-up");
    expect(markup).toContain("Sponsor this group");
    expect(markup).toContain("Private attachment");
  });

  it("renders the real archive section against synthetic design data", () => {
    const markup = renderToStaticMarkup(<ChangelogArchiveStudy />);

    expect(markup).toContain('data-design-study="changelog-archive"');
    expect(markup).toContain("A week that closes its own loops");
    expect(markup).toContain("Follow-ups arrive where the work started");
    expect(markup).toContain("Recovery explains what to do next");
    expect(markup).toContain("Contact details stay tied to the right line");
    expect(markup).toContain("Corrections stay attached to the conversation");
    expect(markup).toContain("Scheduled follow-up");
    expect(markup).toContain("Stay in the app");
    expect(markup).toContain("Verified line after setup");
    expect(markup).toContain("Private conversation");
    expect(markup).toContain('href="#design-follow-up"');
    expect(markup).toContain("inert");
    expect(markup).not.toContain("Group memory, clearer recovery");
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
    expect(markup).toContain(`href="${buildChangelogPagePath(3)}"`);
    expect(markup).toContain(`href="${buildChangelogPagePath(5)}"`);
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
    const requestedEdition = "2026-07-08";
    const requestedPage = resolveChangelogEditionPage(requestedEdition);
    expect(requestedPage).not.toBeNull();
    const requestedPageEditions = resolveChangelogPage(requestedPage ?? 0)?.editions;
    expect(requestedPageEditions).toBeTruthy();
    const requestedPageCardUrl = buildAbsoluteChangelogUrl(
      buildChangelogCardPath(
        (requestedPageEditions ?? [])
          .flatMap((edition) => edition.items)
          .slice(0, CHANGELOG_PREVIEW_CARD_ITEMS)
          .map((item) => item.id),
      ),
    );
    const pageOneCardUrl = buildAbsoluteChangelogUrl(
      buildChangelogCardPath(
        editions
          .slice(0, CHANGELOG_EDITIONS_PER_PAGE)
          .flatMap((edition) => edition.items)
          .slice(0, CHANGELOG_PREVIEW_CARD_ITEMS)
          .map((item) => item.id),
      ),
    );
    const [pageOneMetadata, metadata] = await Promise.all([
      generateMetadata({ searchParams: Promise.resolve({}) }),
      generateMetadata({
        searchParams: Promise.resolve({ edition: requestedEdition }),
      }),
    ]);

    expect(pageOneMetadata).toEqual(
      expect.objectContaining({
        alternates: { canonical: "/changelog" },
        openGraph: expect.objectContaining({
          images: [expect.objectContaining({ url: pageOneCardUrl })],
        }),
      }),
    );
    expect(metadata).toEqual(
      expect.objectContaining({
        alternates: {
          canonical: buildChangelogPagePath(requestedPage ?? 0),
        },
        openGraph: expect.objectContaining({
          images: [expect.objectContaining({ url: requestedPageCardUrl })],
        }),
        title: `Murph Changelog, page ${requestedPage}`,
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
