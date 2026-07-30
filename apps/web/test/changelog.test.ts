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

  it("keeps each try-it action bound to exactly one behavior", () => {
    const invalidItems = listPublishedChangelogItems().flatMap((item) => {
      const tryIt = item.tryIt;
      if (!tryIt) {
        return [];
      }
      const modes = [tryIt.href, tryIt.prompt].filter(
        (value) => value !== undefined,
      );
      return modes.length === 1 ? [] : [item.id];
    });

    expect(invalidItems).toEqual([]);
  });

  it("bounds direct-chat access recovery to shared billing states", () => {
    const item = listPublishedChangelogItems().find(
      (candidate) => candidate.id === "recognized-members-always-get-an-answer",
    );

    expect(item).toMatchObject({
      details:
        "This shared recovery covers billing-access states across eligible iMessage and Telegram direct chats. Suspended accounts keep their existing channel-specific handling.",
      summary:
        "When a paused or lapsed member texts Murph from a recognized direct chat, Murph now answers with the existing access or subscription recovery path.",
      title: "Paused and lapsed members get a recovery reply",
    });
    expect(`${item?.title} ${item?.summary} ${item?.details}`).not.toContain(
      "otherwise blocked",
    );
  });

  it("ties the Clubs launch note to every shipped page iteration", () => {
    const item = listPublishedChangelogItems().find(
      (candidate) => candidate.id === "clubs-challenge-pilot-page",
    );

    expect(item).toMatchObject({
      sourcePullRequests: [1098, 1105, 1115],
      tryIt: {
        href: "/clubs",
        label: "Explore club challenges",
      },
    });
  });

  it("bounds participant-change context to supported iMessage groups", () => {
    const item = listPublishedChangelogItems().find(
      (candidate) => candidate.id === "group-participant-changes-in-context",
    );

    expect(item).toMatchObject({
      sourcePullRequests: [1100],
      summary: expect.stringContaining("supported iMessage group"),
    });
  });

  it("keeps the Telegram handoff bound to the exact verified phone", () => {
    const item = listPublishedChangelogItems().find(
      (candidate) => candidate.id === "telegram-imessage-contact-handoff",
    );

    expect(item).toMatchObject({
      sourcePullRequests: [1103],
      summary: expect.stringContaining("exact verified phone"),
    });
  });

  it("keeps additive challenge scorecards bounded and evidence-aware", () => {
    const item = listPublishedChangelogItems().find(
      (candidate) => candidate.id === "additive-group-challenge-scorecards",
    );

    expect(item).toMatchObject({
      sourcePullRequests: [1097],
      summary: expect.stringContaining("up to five additive scoring components"),
      details: expect.stringContaining("Missing data stays visibly partial"),
    });
  });

  it("keeps dense reminder conversations finite", () => {
    const item = listPublishedChangelogItems().find(
      (candidate) => candidate.id === "dense-reminders-become-conversation",
    );

    expect(item).toMatchObject({
      sourcePullRequests: [1116],
      details: expect.stringContaining("at most one unresolved occurrence"),
    });
  });

  it("keeps the July 30 usage and experiment claims bounded", () => {
    const items = new Map(
      listPublishedChangelogItems().map((item) => [item.id, item]),
    );

    expect(items.get("usage-options-together")).toMatchObject({
      sourcePullRequests: [1120, 1136, 1138, 1157],
      details: expect.stringContaining("can be cancelled independently"),
    });
    expect(items.get("open-ended-experiment-outcomes")).toMatchObject({
      sourcePullRequests: [1094],
      details: expect.stringContaining("instead of a made-up numeric effect"),
    });
  });

  it("keeps the July 30 identity and payment claims narrow", () => {
    const items = new Map(
      listPublishedChangelogItems().map((item) => [item.id, item]),
    );

    expect(items.get("group-bursts-one-turn")).toMatchObject({
      sourcePullRequests: [1032, 1133],
      details: expect.stringContaining("never identity or permission"),
    });
    expect(items.get("checkout-resumes-one-session")).toMatchObject({
      sourcePullRequests: [1041],
      summary: expect.stringContaining("same open Stripe session"),
    });
    expect(items.get("wearable-connect-owner-confirmation")).toMatchObject({
      sourcePullRequests: [1059],
      summary: expect.stringContaining("explicit Finish connection"),
    });
    expect(items.get("ios-app-link-in-chat")).toMatchObject({
      sourcePullRequests: [1150],
      details: expect.stringContaining("still stay private or in the app"),
    });
  });

  it("publishes the complete July 21 through July 30 shipment set", () => {
    expect(
      listChangelogEditions().slice(0, 10).map((edition) => ({
        id: edition.id,
        itemIds: edition.items.map((item) => item.id),
      })),
    ).toEqual([
      {
        id: "2026-07-30",
        itemIds: [
          "usage-options-together",
          "open-ended-experiment-outcomes",
          "core-reply-provider-choice",
          "schoolwork-conversation-help",
          "group-voice-only-punchlines",
          "animated-gif-filmstrips",
          "ios-app-link-in-chat",
          "time-aware-immediate-advice",
          "group-bursts-one-turn",
          "homepage-auth-stays-usable",
          "wearable-connect-owner-confirmation",
          "checkout-resumes-one-session",
          "group-newsletters-compose-once",
          "group-sponsorship-cleaner-finish",
          "cold-replies-start-sooner",
          "obscure-group-references-grounded",
        ],
      },
      {
        id: "2026-07-29",
        itemIds: [
          "post-onboarding-choice-point",
          "additive-group-challenge-scorecards",
          "dense-reminders-become-conversation",
          "clubs-challenge-pilot-page",
          "group-chat-title-on-demand",
          "telegram-imessage-contact-handoff",
          "imessage-edits-become-corrections",
          "group-participant-changes-in-context",
          "confident-image-generation-status",
          "home-experiment-history-hierarchy",
          "homepage-private-murph-first",
          "conflicting-contact-aliases-preserved",
        ],
      },
      {
        id: "2026-07-28",
        itemIds: [
          "imessage-instant-start",
          "current-sender-group-disclosure",
          "join-offer-private-continuation",
          "group-sponsorship-moments",
          "generated-media-private-path",
          "saved-card-usage-topups",
          "overall-ai-usage-bar",
          "group-access-recovery-stays-private",
          "group-humans-get-first-refusal",
          "room-native-group-challenges",
          "supportive-proactive-health-outreach",
          "image-requests-stay-one-request",
          "named-voice-memo-overrides",
        ],
      },
      {
        id: "2026-07-27",
        itemIds: [
          "overnight-imessage-reminders",
          "iphone-consent-recovery",
          "group-compaction-stays-quiet",
        ],
      },
      {
        id: "2026-07-26",
        itemIds: [
          "group-room-memory",
          "contact-card-after-invite-signup",
          "secondary-onboarding-outcomes-visible",
          "recognized-members-always-get-an-answer",
          "group-funding-speaks-in-messages",
          "included-usage-follows-plan",
          "pulse-return-survives-sign-out",
          "meal-enrollment-survives-stale-consent",
          "grok-long-answers-explain-the-cutoff",
          "account-deletion-cleanup-retries",
          "destructive-requests-check-targets",
          "homepage-cards-fit-small-iphones",
        ],
      },
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
    expect(firstPage?.editions[0]?.publishedOn).toBe("2026-07-30");
    expect(firstPage?.editions.at(-1)?.publishedOn).toBe("2026-07-24");
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
