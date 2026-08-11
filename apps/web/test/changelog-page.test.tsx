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

const RETIRED_USAGE_TERM = ["cost", "weighted"].join("-");

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

    expect(markup).toContain(
      "Starter access, patterns, reminders, cards, voices, and web search",
    );
    expect(markup).toContain("Response cards stay compact in Messages");
    expect(markup).toContain("Managed OpenAI web search works again");
    expect(markup).toContain("Completed workout rows keep their checkmark");
    expect(markup).not.toContain("Ask Murph to search");
    expect(markup).toContain("Voice memos keep your chosen voice");
    expect(markup).toContain("Referrals, Max, and a more capable Murph");
    expect(markup).toContain(
      "Exact experiment links and steadier background work",
    );
    expect(markup).toContain(
      "A personal first read, richer automations, clearer trends",
    );
    expect(markup).toContain(
      "Faster starts, richer X answers, better continuity",
    );
    expect(markup).toContain("More ways to connect, prepare, and finish");
    expect(markup).toContain("Ask about images and video on X");
    expect(markup).toContain("More control over data, models, and connections");
    expect(markup).not.toContain(
      "Connected apps recover with a clearer next step",
    );
    expect(markup).not.toContain("Recovery that stops at the right moment");
    expect(markup).not.toContain("More ways to finish what you started");
    expect(markup).not.toContain("A clearer view of home, stronger follow-through");
    expect(markup).not.toContain("More ways through, less waiting around");
    expect(markup).not.toContain("Corrections that carry forward");
    expect(markup).not.toContain("A first text that goes somewhere");
    expect(markup).not.toContain(
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
    expect(markup).toContain('href="/changelog?edition=2026-08-03"');
    expect(markup).toContain(
      'href="/changelog?edition=2026-08-10#personal-patterns"',
    );
    expect(markup).toContain(
      'href="/changelog?edition=2026-08-10#voice-memos-use-your-voice"',
    );
    expect(markup).toContain(
      'href="/changelog?edition=2026-08-09#public-referral-home"',
    );
    expect(markup).toContain(
      'href="/changelog?edition=2026-08-06#x-post-media-understanding"',
    );
    expect(markup).toContain(
      'href="/changelog?edition=2026-08-05#official-local-alert-health-context"',
    );
    expect(markup).toContain(
      'href="/changelog?edition=2026-08-04#custom-inference-endpoint"',
    );
    expect(markup).not.toContain(
      "The physical-note delivery record does not store the postal address",
    );
    expect(markup).not.toContain("plaintext conversation memory");
    expect(markup).toContain("Older");
    expect(markup).not.toContain(">Newer<");
  });

  it("renders the new try-it controls with their exact prompts", async () => {
    const markup = renderToStaticMarkup(
      await ChangelogPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).not.toContain("Open model settings");
    expect(markup).toContain("Ask about today&#x27;s conditions");
    expect(markup).toContain("Open privacy settings");
    expect(markup).toContain('href="/settings/data-privacy"');
    expect(markup).toContain("Ask for today&#x27;s nutrition card");
    expect(markup).toContain("Manage connections");
    expect(markup).not.toContain("Open Environment");
    expect(markup).not.toContain('href="/environment"');
    expect(markup).toContain("Explore referrals");
    expect(markup).toContain('href="/refer"');
    expect(markup).toContain("Compare plans");
    expect(markup).toContain('href="/settings#subscription"');
    expect(markup).toContain("Browse connections");
    expect(markup).toContain('href="/connect"');
    expect(
      mocks.resolveHostedMurphContactOptions.mock.calls.map(([input]) => input),
    ).toEqual(
      expect.arrayContaining([
        {
          message: {
            body: "Remind me every day at 9 PM Central to wind down.",
            subject: "Try it: Reminders keep the time you asked for",
          },
        },
        {
          message: {
            body: "Look at the images or video in this X post and tell me what they show: [paste X post URL]",
            subject: "Try it: Ask about images and video on X",
          },
        },
        {
          message: {
            body: "I feel more tired than usual and planned an outdoor workout today. Check whether an official local alert should change my plan.",
            subject: "Try it: Murph can account for official local alerts",
          },
        },
        {
          message: {
            body: "Show me today's nutrition card.",
            subject: "Try it: Ask for today's nutrition card",
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
    const [latestPage, previousPage, olderPage] = await Promise.all([
      ChangelogPage({ searchParams: Promise.resolve({}) }),
      ChangelogPage({
        searchParams: Promise.resolve({ edition: "2026-07-29" }),
      }),
      ChangelogPage({
        searchParams: Promise.resolve({ edition: "2026-07-26" }),
      }),
    ]);
    const markup = [latestPage, previousPage, olderPage]
      .map((page) => renderToStaticMarkup(page))
      .join("\n");

    expect(markup).toContain("Add usage");
    expect(markup).toContain("Add to Contacts");
    expect(markup).toContain("Scheduled reminders");
    expect(markup).toContain("Group funding recovery");
    expect(markup).toContain("Verified line after setup");
    expect(markup).toContain("One-time follow-up");
    expect(markup).toContain("Sponsor this group");
    expect(markup).toContain("Private attachment");
    expect(markup.match(/>Usage credit</gu)).toHaveLength(7);
    expect(markup.toLowerCase()).not.toContain(RETIRED_USAGE_TERM);
    expect(markup).not.toContain("Ways to earn Murph time");
    expect(markup).not.toContain("Credit belongs to the room");
    expect(markup).not.toContain("Group time");
    expect(markup).toContain("Live workout");
    expect(markup).toContain("Fasting glucose");
    expect(markup).toContain("Current browser task");
    expect(markup).not.toContain("Polar via Apple Health");
    expect(markup).not.toContain("Via Apple Health");
    expect(markup).not.toContain("Murph via your connected email");
    expect(markup).not.toContain("Approved follow-up");
    expect(markup).not.toContain(
      "The exact email you approved was sent from the connected account.",
    );
    expect(markup).not.toContain("I’ll include");
    expect(markup).not.toContain("without your private details");
    expect(markup).not.toContain("Sanitized issue summary");
    expect(markup).not.toContain(
      "no raw conversation, credentials, or health details",
    );
    expect(markup).toContain("Conversation handoff");
    expect(markup).toContain("Paused-member privacy cleanup");
    expect(markup).toContain("Daily nutrition card");
    expect(markup).toContain("Live storage maintenance");
  });

  it("renders the latest production edition and synthetic archive studies", () => {
    const markup = renderToStaticMarkup(<ChangelogArchiveStudy />);

    expect(markup).toContain('data-design-study="changelog-archive"');
    expect(markup).toContain('data-design-state="latest-production-edition"');
    expect(markup).toContain("Managed OpenAI web search works again");
    expect(markup).not.toContain("Ask Murph to search");
    expect(markup).toContain("A week that closes its own loops");
    expect(markup).toContain("Follow-ups arrive where the work started");
    expect(markup).toContain("Confirmed appointments come with a reminder");
    expect(markup).toContain("Tell Murph about an appointment");
    expect(markup).toContain("Confirmed appointment");
    expect(markup).toContain("Recovery explains what to do next");
    expect(markup).toContain("Contact details stay tied to the right line");
    expect(markup).toContain("Corrections stay attached to the conversation");
    expect(markup).toContain("Compact tables make dense changes scannable");
    expect(markup).toContain("Reference context stays visible");
    expect(markup).toContain("Scheduled follow-up");
    expect(markup).toContain("Stay in the app");
    expect(markup).toContain("Verified line after setup");
    expect(markup).toContain("Private conversation");
    expect(markup).toContain("Compact response");
    expect(markup).toContain("70 mg/dL");
    expect(markup).toContain('href="#design-follow-up"');
    expect(markup).toContain('href="#appointment-reminders-by-default"');
    expect(markup).toContain("inert");
    expect(markup).not.toContain("Group memory, clearer recovery");
  });

  it("renders the requested older seven-day window with newer and older links", async () => {
    const requestedEdition = "2026-07-08";
    const requestedPage = resolveChangelogEditionPage(requestedEdition);
    expect(requestedPage).not.toBeNull();
    const markup = renderToStaticMarkup(
      await ChangelogPage({
        searchParams: Promise.resolve({ edition: requestedEdition }),
      }),
    );

    expect(markup).toContain("Advice grounded in your own data");
    expect(markup).not.toContain("A lighter way to say yes");
    expect(markup).toContain(
      "Seven days of features and improvements from the full Murph archive.",
    );
    expect(markup).not.toContain("The latest seven days");
    expect(markup).toContain(
      `href="${buildChangelogPagePath((requestedPage ?? 1) - 1)}"`,
    );
    expect(markup).toContain(
      `href="${buildChangelogPagePath((requestedPage ?? 1) + 1)}"`,
    );
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
