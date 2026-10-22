import { fileURLToPath } from "node:url";
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
import { loadChangelogFragmentEditions } from "../src/lib/changelog-fragments";
import {
  buildAbsoluteChangelogUrl,
  buildChangelogCardPath,
  buildChangelogPagePath,
  CHANGELOG_EDITIONS_PER_PAGE,
  CHANGELOG_PREVIEW_CARD_ITEMS,
  listChangelogEditions,
  listPublishedChangelogItems,
  resolveChangelogEditionPage,
  resolveChangelogPage,
} from "../src/lib/changelog";

describe("ChangelogPage", () => {
  it("keeps historical and current workout announcements in chat", async () => {
    const ids = ["private-training-review", "workout-routines-in-chat"];
    const items = listPublishedChangelogItems().filter((item) => ids.includes(item.id));
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.tryIt).toMatchObject({ prompt: expect.stringContaining("chat") });
      expect(item.tryIt).not.toHaveProperty("href");
    }
    const markup = await renderChangelogItems(ids);
    expect(markup).not.toContain('href="/training"');
    expect(markup).toContain("Workout review stays in chat");
    expect(markup).toContain("Clearer saved workout routines");
  });

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

  it("server-renders every authored fragment through the production archive", async () => {
    const fragmentEditions = loadChangelogFragmentEditions(
      fileURLToPath(new URL("../changelog/", import.meta.url)),
    );
    const pageMarkupByNumber = new Map<number, string>();

    for (const edition of fragmentEditions) {
      const pageNumber = resolveChangelogEditionPage(edition.id);
      expect(pageNumber).not.toBeNull();
      if (pageNumber === null) {
        throw new TypeError(`Missing changelog archive page for ${edition.id}`);
      }

      let markup = pageMarkupByNumber.get(pageNumber);
      if (!markup) {
        markup = renderToStaticMarkup(
          await ChangelogPage({
            searchParams: Promise.resolve({ edition: edition.id }),
          }),
        );
        pageMarkupByNumber.set(pageNumber, markup);
      }

      expect(markup).toContain(`id="edition-${edition.id}"`);
      expect(markup).toContain(renderToStaticMarkup(<>{edition.title}</>));
      expect(markup).toContain(renderToStaticMarkup(<>{edition.summary}</>));

      for (const item of edition.items) {
        const itemMarkup = extractChangelogItemMarkup(markup, item.id);
        expect(itemMarkup).toContain(
          item.kind === "feature" ? "Feature" : "Improvement",
        );
        expect(itemMarkup).toContain(renderToStaticMarkup(<>{item.title}</>));
        expect(itemMarkup).toContain(renderToStaticMarkup(<>{item.summary}</>));
        if (item.details) {
          expect(itemMarkup).toContain(
            renderToStaticMarkup(<>{item.details}</>),
          );
        }
        if (item.tryIt) {
          expect(itemMarkup).toContain(
            renderToStaticMarkup(<>{item.tryIt.label}</>),
          );
          if (item.tryIt.href) {
            expect(itemMarkup).toContain(`href="${item.tryIt.href}"`);
          }
        }
      }
    }

    const promptRequests = mocks.resolveHostedMurphContactOptions.mock.calls.map(
      ([input]) => input.message,
    );
    const expectedPromptRequests = fragmentEditions.flatMap((edition) =>
      edition.items.flatMap((item) =>
        item.tryIt?.prompt
          ? [{ body: item.tryIt.prompt, subject: `Try it: ${item.title}` }]
          : [],
      ),
    );
    expect(promptRequests).toEqual(
      expect.arrayContaining(expectedPromptRequests),
    );
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
