import { describe, expect, it } from "vitest";

import {
  CHANGELOG_CARD_MAX_ITEMS,
  CHANGELOG_EDITIONS_PER_PAGE,
  buildChangelogCardPath,
  buildChangelogItemPath,
  buildChangelogPagePath,
  listChangelogEditions,
  listPublishedChangelogItems,
  parseChangelogCardItemSegment,
  queryChangelogItems,
  resolveChangelogCardItems,
  resolveChangelogEditionPage,
  resolveChangelogPage,
} from "../src/lib/changelog";

describe("changelog registry", () => {
  it("keeps item ids unique and stable", () => {
    const ids = listPublishedChangelogItems().map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("publishes the complete July 20 through July 25 shipment set", () => {
    expect(
      listChangelogEditions().slice(0, 6).map((edition) => ({
        id: edition.id,
        itemIds: edition.items.map((item) => item.id),
      })),
    ).toEqual([
      {
        id: "2026-07-25",
        itemIds: [
          "ask-grok-x-research",
          "unhinged-style-dial",
          "group-chat-creative-formats",
          "telegram-group-sender-attribution",
          "weather-aware-outdoor-reminders",
          "group-murph-reads-the-floor",
          "phone-call-results-return-to-chat",
          "billing-recovery-finishes",
          "one-click-launch-consent",
          "group-usage-pause-in-murphs-voice",
          "contact-card-in-app-browser-handoff",
          "experiment-check-ins-survive-stray-files",
          "group-chat-renames-without-a-hosted-record",
          "voice-memo-failures-have-a-reason",
          "safe-database-start-retries",
          "group-roster-durable-murph-activation",
          "silent-device-source-stalls-are-visible",
          "homepage-group-challenge-story",
        ],
      },
      {
        id: "2026-07-24",
        itemIds: [
          "group-replies-stay-short",
          "group-usage-always-fundable",
          "group-contact-card-reshare",
          "group-work-requests-declined",
          "group-join-permissions-preselected",
          "usage-top-up-returns-to-chat",
          "telegram-signup-completes-setup",
          "ask-murph-whats-new",
          "account-deletion-exit-feedback",
        ],
      },
      {
        id: "2026-07-23",
        itemIds: [
          "updated-legal-documents-keep-chat-working",
          "reactions-read-in-context",
          "group-usage-percent-visible",
          "group-daily-text-cap-doubled",
          "challenge-kickoff-asks-for-intros",
          "generated-images-actually-arrive",
          "daily-activity-totals-count-every-workout",
          "signup-holds-under-a-rush",
          "meal-capture-closes-the-day-itself",
          "whoop-at-capacity-opens-full-sync-guide",
          "home-survives-a-failed-panel",
          "invites-explain-which-email-to-use",
          "group-song-and-contact-card-together",
        ],
      },
      {
        id: "2026-07-22",
        itemIds: [
          "onboarding-sounds-like-a-conversation",
          "biomarker-pages-explain-the-number",
          "family-usage-top-ups",
          "garmin-historical-permission-preflight",
          "knowledge-page",
          "two-week-experiment-baselines",
          "progress-updates-before-slow-work",
          "approved-files-send-themselves",
          "group-ask-answers-come-back-promptly",
          "hosted-work-runs-on-two-cores",
          "text-murph-after-personalizing",
          "mobile-settings-and-connect-polish",
          "whoop-full-sync-dialog-actions",
        ],
      },
      {
        id: "2026-07-21",
        itemIds: [
          "murph-personas",
          "consented-group-to-member-questions",
          "group-usage-funding",
          "biomarkers-index-rebuilt",
          "low-usage-mentioned-in-conversation",
          "group-newsletter-setup",
          "completed-experiments-show-daily-points",
          "experiment-results-match-the-dashboard",
        ],
      },
      {
        id: "2026-07-20",
        itemIds: [
          "challenge-standings-explain-missing-data",
          "phone-link-settings-recovery",
          "weekly-insights-skip-obvious-weekend",
          "scheduled-messages-get-the-full-murph",
          "pulse-finishes-after-payment-setup",
          "contaminant-tests-on-product-pages",
          "private-experiments-open-from-home",
          "named-lab-marker-answers-faster",
          "dense-voice-memo-keeps-onboarding-moving",
          "welcome-continues-your-conversation",
          "approval-page-sign-in-recovery",
          "strava-connections-paused",
        ],
      },
    ]);
  });

  it("keeps internal provider branding out of published changelog copy", () => {
    const copy = listChangelogEditions().flatMap((edition) => [
      edition.title,
      edition.summary,
      ...edition.items.flatMap((item) => [
        item.title,
        item.summary,
        item.details ?? "",
        item.tryIt?.label ?? "",
        item.tryIt?.prompt ?? "",
      ]),
    ]).join("\n");

    expect(copy).not.toMatch(/junction/iu);
  });

  it("preserves historical changelog identities and relevance tags", () => {
    const itemsById = new Map(
      listPublishedChangelogItems().map((item) => [item.id, item]),
    );
    const expectedTags = {
      "device-history-import-self-heals": ["wearables", "junction", "reliability"],
      "garmin-junction-sleep-records": ["wearables", "garmin", "junction", "sleep"],
      "junction-direct-provider-link": ["wearables", "junction", "connect"],
      "junction-history-self-heals": ["wearables", "junction", "sync"],
      "junction-hourly-reconcile": ["wearables", "junction", "whoop", "oura", "garmin"],
      "junction-meal-imports": ["nutrition", "junction", "meals"],
      "junction-source-reconnect": ["wearables", "settings"],
      "whoop-junction-local-day": ["wearables", "whoop", "junction", "data"],
    } as const;

    for (const [id, relevanceTags] of Object.entries(expectedTags)) {
      expect(itemsById.get(id)?.relevanceTags).toEqual(relevanceTags);
    }
  });

  it("applies independent feature and improvement candidate limits", () => {
    const items = queryChangelogItems({
      featureLimit: 1,
      from: "2026-06-01",
      improvementLimit: 2,
      to: "2026-07-01",
    });
    expect(items.filter((item) => item.kind === "feature")).toHaveLength(1);
    expect(items.filter((item) => item.kind === "improvement")).toHaveLength(2);
  });

  it("round-trips deterministic card item paths", () => {
    const ids = listPublishedChangelogItems()
      .slice(0, CHANGELOG_CARD_MAX_ITEMS)
      .map((item) => item.id);
    const path = buildChangelogCardPath(ids);
    const segment = path.split("/").at(-1);
    expect(parseChangelogCardItemSegment(segment)).toEqual(ids);
    expect(resolveChangelogCardItems(ids)?.map((item) => item.id)).toEqual(ids);
  });

  it("fails closed for unknown or duplicate card items", () => {
    expect(parseChangelogCardItemSegment("not-a-real-item.png")).toBeNull();
    const first = listPublishedChangelogItems()[0]?.id;
    expect(first).toBeTruthy();
    expect(parseChangelogCardItemSegment(`${first}~${first}.png`)).toBeNull();
  });

  it("paginates the archive seven dated editions at a time", () => {
    const editions = listChangelogEditions();
    const firstPage = resolveChangelogPage(1);
    const secondPage = resolveChangelogPage(2);

    expect(firstPage).toMatchObject({
      currentPage: 1,
      editions: editions.slice(0, CHANGELOG_EDITIONS_PER_PAGE),
      totalPages: Math.ceil(editions.length / CHANGELOG_EDITIONS_PER_PAGE),
    });
    expect(secondPage).toMatchObject({
      currentPage: 2,
      editions: editions.slice(
        CHANGELOG_EDITIONS_PER_PAGE,
        CHANGELOG_EDITIONS_PER_PAGE * 2,
      ),
      totalPages: Math.ceil(editions.length / CHANGELOG_EDITIONS_PER_PAGE),
    });
    expect(resolveChangelogPage(0)).toBeNull();
    expect(
      resolveChangelogPage(
        Math.ceil(editions.length / CHANGELOG_EDITIONS_PER_PAGE) + 1,
      ),
    ).toBeNull();
  });

  it("keeps the default archive window to seven calendar days", () => {
    const firstPage = resolveChangelogPage(1);
    expect(firstPage?.editions).toHaveLength(7);
    expect(firstPage?.editions[0]?.publishedOn).toBe("2026-07-25");
    expect(firstPage?.editions.at(-1)?.publishedOn).toBe("2026-07-19");
  });

  it("resolves only known canonical edition cursors", () => {
    const editions = listChangelogEditions();

    expect(resolveChangelogEditionPage(undefined)).toBe(1);
    expect(resolveChangelogEditionPage(editions[1]?.id)).toBe(1);
    expect(
      resolveChangelogEditionPage(editions[CHANGELOG_EDITIONS_PER_PAGE]?.id),
    ).toBe(2);
    expect(resolveChangelogEditionPage("2026-7-09")).toBeNull();
    expect(resolveChangelogEditionPage("2099-01-01")).toBeNull();
    expect(resolveChangelogEditionPage(["2026-07-09", "2026-07-08"])).toBeNull();
  });

  it("builds stable page and item links for the paginated archive", () => {
    const editions = listChangelogEditions();
    const newestItem = editions[0]?.items[0];
    const olderItem = editions[CHANGELOG_EDITIONS_PER_PAGE]?.items[0];

    expect(newestItem).toBeTruthy();
    expect(olderItem).toBeTruthy();
    if (!newestItem || !olderItem) {
      throw new Error("Expected the changelog to contain at least two editions.");
    }
    expect(buildChangelogPagePath(1)).toBe("/changelog");
    expect(buildChangelogPagePath(2)).toBe(
      `/changelog?edition=${editions[CHANGELOG_EDITIONS_PER_PAGE]?.id}`,
    );
    expect(buildChangelogItemPath(newestItem.id)).toBe(
      `/changelog?edition=${editions[0]?.id}#${newestItem.id}`,
    );
    expect(buildChangelogItemPath(olderItem.id)).toBe(
      `/changelog?edition=${editions[CHANGELOG_EDITIONS_PER_PAGE]?.id}#${olderItem.id}`,
    );
    expect(() => buildChangelogItemPath("not-a-real-item")).toThrow(
      "does not exist",
    );
  });
});
