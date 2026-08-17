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
  buildChangelogItemPath,
  buildChangelogPagePath,
  CHANGELOG_EDITIONS_PER_PAGE,
  CHANGELOG_PREVIEW_CARD_ITEMS,
  listChangelogEditions,
  listPublishedChangelogItems,
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

  it("renders the current archive window with compact older navigation", async () => {
    const markup = renderToStaticMarkup(
      await ChangelogPage({ searchParams: Promise.resolve({}) }),
    );
    const firstPage = resolveChangelogPage(1);
    const secondPage = resolveChangelogPage(2);
    expect(firstPage).not.toBeNull();
    expect(secondPage).not.toBeNull();
    if (!firstPage || !secondPage) {
      throw new TypeError("The changelog fixture must span at least two pages.");
    }

    expect(firstPage.editions).toHaveLength(CHANGELOG_EDITIONS_PER_PAGE);
    for (const edition of firstPage.editions) {
      expect(markup).toContain(`id="edition-${edition.id}"`);
      expect(markup).toContain(renderToStaticMarkup(<>{edition.title}</>));
      for (const item of edition.items) {
        expect(markup).toContain(`id="${item.id}"`);
        expect(markup).toContain(`href="${buildChangelogItemPath(item.id)}"`);
      }
    }
    for (const edition of secondPage.editions) {
      expect(markup).not.toContain(`id="edition-${edition.id}"`);
    }

    const correctedEdition = listChangelogEditions().find(
      (edition) => edition.id === "2026-08-10",
    );
    expect(correctedEdition).toBeDefined();
    if (!correctedEdition) {
      throw new TypeError(
        "The changelog archive must include the corrected edition.",
      );
    }
    const correctedEditionMarkup = renderToStaticMarkup(
      await ChangelogPage({
        searchParams: Promise.resolve({ edition: correctedEdition.id }),
      }),
    );
    expect(correctedEditionMarkup).toContain(
      renderToStaticMarkup(<>{correctedEdition.summary}</>),
    );
    expect(correctedEdition.summary).toContain("Training shows saved workouts");
    expect(correctedEdition.summary).toContain("group photos on request");
    expect(correctedEdition.summary).toContain("Luna, Terra, and Sol on OpenAI");
    expect(correctedEdition.summary).toContain("one first photo");
    expect(correctedEdition.summary).toContain("wearable recovery");
    expect(correctedEdition.summary).not.toContain("original detail");

    expect(markup).toContain('aria-label="Changelog pages"');
    expect(markup).toContain(`href="${buildChangelogPagePath(2)}"`);
    expect(markup).toContain('aria-label="Changelog pages"');
    expect(markup).toContain(`href="${buildChangelogPagePath(2)}"`);
    expect(markup).toContain("Older");
    expect(markup).not.toContain(">Newer<");
  });

  it("renders the new try-it controls with their exact prompts", async () => {
    const itemIds = [
      "reminders-keep-requested-timezone",
      "public-referral-home",
      "murph-max-plan",
      "clearer-health-source-handoffs",
      "x-post-media-understanding",
      "official-local-alert-health-context",
      "health-data-consent-controls",
      "daily-nutrition-cards",
      "single-source-wearable-disconnect",
    ];
    const markup = await renderChangelogItems(itemIds);

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
    const markup = await renderChangelogItems([
      "family-usage-top-ups",
      "usage-top-ups",
      "generated-contact-card-avatar",
      "contact-card-after-invite-signup",
      "group-contact-card-reshare",
      "overnight-imessage-reminders",
      "group-funding-one-recovery-owner",
      "post-onboarding-choice-point",
      "group-sponsorship-moments",
      "generated-media-private-path",
      "group-funding-speaks-in-messages",
      "live-workout-logging",
      "biomarker-reference-bands",
      "turn-local-browser-progress",
      "clearer-health-source-handoffs",
      "scheduled-tools-follow-the-route",
      "feedback-reproduction-guidance",
      "support-escalation-issue-summary",
      "runtime-replacement-continuity",
      "paused-member-retention-cleanup",
      "daily-nutrition-card-delivery",
      "maintenance-without-global-pause",
    ]);

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

  it("renders the synthetic archive study without production-entry coupling", () => {
    const markup = renderToStaticMarkup(<ChangelogArchiveStudy />);

    expect(markup).toContain('data-design-study="changelog-archive"');
    expect(markup).toContain('data-design-state="synthetic-edition"');
    expect(markup).toContain("A week of follow-through");
    expect(markup).toContain("Generated images can become group photos");
    expect(markup).toContain("Confirmed appointments come with a reminder");
    expect(markup).toContain("Tell Murph about an appointment");
    expect(markup).toContain("Confirmed appointment");
    expect(markup).toContain("Recovery explains what to do next");
    expect(markup).toContain("Contact details stay tied to the right line");
    expect(markup).toContain("Corrections stay attached to the conversation");
    expect(markup).toContain("Compact tables make dense changes scannable");
    expect(markup).toContain("Reference context stays visible");
    expect(markup).toContain("Stay in the app");
    expect(markup).toContain("Verified line after setup");
    expect(markup).toContain("Private conversation");
    expect(markup).toContain("Compact response");
    expect(markup).toContain("70 mg/dL");
    expect(markup).toContain('href="#design-appointment-reminder"');
    expect(markup).toContain('href="#design-generated-group-photo"');
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

function extractChangelogItemMarkup(markup: string, itemId: string): string {
  const start = markup.indexOf(`<article id="${itemId}"`);
  const end = markup.indexOf("</article>", start);
  if (start === -1 || end === -1) {
    throw new TypeError(`Missing rendered changelog item: ${itemId}`);
  }
  return markup.slice(start, end + "</article>".length);
}

async function renderChangelogItems(itemIds: readonly string[]): Promise<string> {
  const publishedItemsById = new Map(
    listPublishedChangelogItems().map((item) => [item.id, item]),
  );
  const owningEditionIds = [
    ...new Set(
      itemIds.map((itemId) => {
        const item = publishedItemsById.get(itemId);
        if (!item) {
          throw new TypeError(`Missing changelog test item: ${itemId}`);
        }
        return item.editionId;
      }),
    ),
  ];
  const pageMarkupByEditionId = new Map(
    await Promise.all(
      owningEditionIds.map(async (editionId) => [
        editionId,
        renderToStaticMarkup(
          await ChangelogPage({
            searchParams: Promise.resolve({ edition: editionId }),
          }),
        ),
      ] as const),
    ),
  );

  return itemIds
    .map((itemId) => {
      const editionId = publishedItemsById.get(itemId)?.editionId;
      const pageMarkup = editionId
        ? pageMarkupByEditionId.get(editionId)
        : undefined;
      if (!pageMarkup) {
        throw new TypeError(`Missing changelog test page for: ${itemId}`);
      }
      return extractChangelogItemMarkup(pageMarkup, itemId);
    })
    .join("\n");
}
