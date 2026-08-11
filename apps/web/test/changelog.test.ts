import { describe, expect, it } from "vitest";

import { listAppleHealthRelayConnectSources } from "../app/(dashboard)/connect/apple-health-relay-connect-sources";
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

  it("bounds restored web search to the managed OpenAI provider", () => {
    const item = listPublishedChangelogItems().find(
      (candidate) => candidate.id === "web-search-restored",
    );

    expect(item).toMatchObject({
      details: expect.stringContaining("managed OpenAI"),
      summary: expect.stringContaining("managed OpenAI"),
      title: expect.stringContaining("Managed OpenAI"),
    });
    expect(item?.tryIt).toBeUndefined();
    expect(`${item?.title} ${item?.summary} ${item?.details}`).not.toContain(
      "Murph can search the web",
    );
  });

  it("keeps the voice-memo default and named exception explicit", () => {
    const item = listPublishedChangelogItems().find(
      (candidate) => candidate.id === "voice-memos-use-your-voice",
    );

    expect(item).toMatchObject({
      editionId: "2026-08-10",
      sourcePullRequests: [1587],
      summary: expect.stringContaining("voice already selected"),
      details: expect.stringContaining("only when you explicitly ask"),
    });
    expect(item?.details).toContain("one-time preview");
  });

  it("keeps support escalation private and contact disclosure opt-in", () => {
    const item = listPublishedChangelogItems().find(
      (candidate) => candidate.id === "direct-product-support-escalation",
    );

    expect(item).toMatchObject({
      details: expect.stringContaining(
        "shares the support address in conversation only when asked for it",
      ),
    });
    expect(item?.details).toContain(
      "Group or unverified support requests move to private Murph",
    );
    expect(item?.details).not.toContain(
      "Group conversations receive the support email",
    );
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

  it("keeps the July 31 Environment claims private and evidence-aware", () => {
    const items = new Map(
      listPublishedChangelogItems().map((item) => [item.id, item]),
    );

    expect(items.get("private-environment-report")).toMatchObject({
      sourcePullRequests: [573],
      details: expect.stringContaining("optional equipment never counts against it"),
      tryIt: {
        href: "/environment",
        label: "Open Environment",
      },
    });
    expect(items.get("environment-voice-walkthrough")).toMatchObject({
      sourcePullRequests: [573],
      details: expect.stringContaining("Precise addresses are rejected"),
    });
  });

  it("keeps the July 31 reliability and permission claims bounded", () => {
    const items = new Map(
      listPublishedChangelogItems().map((item) => [item.id, item]),
    );

    expect(items.get("group-access-across-channels")).toMatchObject({
      sourcePullRequests: [1184],
      details: expect.stringContaining("trusted route"),
    });
    expect(items.get("fund-groups-at-any-capacity")).toMatchObject({
      sourcePullRequests: [1207],
      details: expect.stringContaining("explicit confirmation"),
    });
    expect(items.get("one-shot-reminders-survive-restart")).toMatchObject({
      sourcePullRequests: [1209],
      details: expect.stringContaining("best-effort wake signal"),
    });
    expect(items.get("delegated-work-before-blocker")).toMatchObject({
      sourcePullRequests: [1214],
      details: expect.stringContaining("cannot create new permission"),
    });
  });

  it("keeps the August 1 through August 4 privacy and recovery claims bounded", () => {
    const items = new Map(
      listPublishedChangelogItems().map((item) => [item.id, item]),
    );

    expect(items.get("custom-inference-endpoint")).toMatchObject({
      sourcePullRequests: [1202],
      details: expect.stringContaining("never silently falls back"),
    });
    expect(items.get("custom-inference-endpoint")?.tryIt).toBeUndefined();
    expect(items.get("health-data-consent-controls")).toMatchObject({
      sourcePullRequests: [1215],
      summary: expect.stringContaining("without locking you out"),
      tryIt: {
        href: "/settings/data-privacy",
        label: "Open privacy settings",
      },
    });
    expect(items.get("daily-nutrition-cards")).toMatchObject({
      sourcePullRequests: [1104, 1280],
      details: expect.stringContaining("Missing goals stay missing"),
    });
    expect(items.get("physical-note-address-completion")).toMatchObject({
      sourcePullRequests: [1261, 1266],
      details: expect.stringContaining("cannot discover where someone lives"),
    });
    expect(items.get("physical-notes-from-chat")).toMatchObject({
      sourcePullRequests: [1199, 1248],
      details: expect.stringContaining(
        "conversation history follows Murph's existing retention rules",
      ),
    });
    expect(items.get("physical-notes-from-chat")?.details).not.toContain(
      "plaintext conversation memory",
    );
    expect(items.get("phone-transfer-recovery")).toMatchObject({
      sourcePullRequests: [1191, 1255, 1267],
      details: expect.stringContaining("stops retrying a terminal transfer"),
    });
    expect(items.get("calendar-aware-reminder-availability")).toMatchObject({
      sourcePullRequests: [1204],
      details: expect.stringContaining("never enter the model"),
    });
    expect(items.get("group-reactions-shape-room-memory")).toMatchObject({
      sourcePullRequests: [1212],
      details: expect.stringContaining("out of private member memory"),
    });
  });

  it("keeps official local alerts contextual and non-triggering", () => {
    const item = listPublishedChangelogItems().find(
      (candidate) => candidate.id === "official-local-alert-health-context",
    );

    expect(item).toMatchObject({
      sourcePullRequests: [1307],
      summary: expect.stringContaining("official alert for your location"),
      details: expect.stringContaining("does not trigger outreach"),
    });
    expect(item?.details).toContain(
      "instead of applying one temperature or air-quality threshold everywhere",
    );
  });

  it("keeps the August 7 through August 10 feature claims bounded", () => {
    const items = new Map(
      listPublishedChangelogItems().map((item) => [item.id, item]),
    );

    expect(items.get("reminders-keep-requested-timezone")).toMatchObject({
      sourcePullRequests: [1546],
      summary: expect.stringContaining("preserves that local time"),
      details: expect.stringContaining("next deliverable occurrence"),
      tryIt: {
        label: "Schedule a local-time reminder",
        prompt: "Remind me every day at 9 PM Central to wind down.",
      },
    });
    expect(items.get("personality-settings-and-chat")).toMatchObject({
      sourcePullRequests: [1589],
      summary: expect.stringContaining("main and optional supporting personality"),
      details: expect.stringContaining("same saved personality"),
      tryIt: {
        href: "/settings",
        label: "Edit Murph's personality",
      },
    });
    expect(items.get("personality-settings-and-chat")?.details).toContain(
      "changes only that room's Murph",
    );
    expect(items.get("group-sleep-challenges-use-fresh-data")).toMatchObject({
      sourcePullRequests: [1565, 1593],
      summary: expect.stringContaining("explicit manual corrections"),
      details: expect.stringContaining(
        "latest manual correction for a sleep date wins",
      ),
    });
    expect(items.get("workout-card-status-rendering")).toMatchObject({
      sourcePullRequests: [1599],
      summary: expect.stringContaining("including their static previews"),
      details: expect.stringContaining("part of the card image itself"),
    });
    expect(items.get("workout-card-status-rendering")?.tryIt).toBeUndefined();
    expect(items.get("public-referral-home")).toMatchObject({
      sourcePullRequests: [
        1450, 1459, 1483, 1485, 1487, 1492, 1497, 1498, 1499, 1515,
      ],
      details: expect.stringContaining(
        "another member's identity and private data",
      ),
      tryIt: { href: "/refer", label: "Explore referrals" },
    });
    expect(items.get("generated-contact-card-avatar")).toMatchObject({
      sourcePullRequests: [1458, 1488],
      details: expect.stringContaining("bound to the turn that asked for it"),
    });
    expect(items.get("generated-contact-card-avatar")?.tryIt).toBeUndefined();
    expect(items.get("family-setup-from-group")).toMatchObject({
      sourcePullRequests: [1527],
      details: expect.stringContaining(
        "The group never reads Family status or creates billing and invite links",
      ),
    });
    expect(items.get("clearer-health-source-handoffs")).toMatchObject({
      sourcePullRequests: [1432, 1447, 1506],
      details: expect.stringContaining("snapshots rather than live sync"),
    });
    expect(items.get("first-personal-health-read")).toMatchObject({
      sourcePullRequests: [1390],
      details: expect.stringContaining(
        "does not automatically create a plan, habit, experiment, or reminder",
      ),
    });
    expect(items.get("scheduled-direct-call")).toMatchObject({
      sourcePullRequests: [1336],
      summary: expect.stringContaining(
        "When a saved private conversation supports scheduled calling",
      ),
      details: expect.stringContaining(
        "Email, Telegram, and group conversations are not eligible",
      ),
    });
    expect(items.get("scheduled-tools-follow-the-route")).toMatchObject({
      sourcePullRequests: [1367],
      details: expect.stringContaining("Email delivery stays text-only"),
    });
    expect(items.get("group-calls-without-redundant-preview")).toMatchObject({
      sourcePullRequests: [1386],
      details: expect.stringContaining("a call start never claims the later outcome"),
    });
    expect(items.get("connected-email-from-private-chat")).toMatchObject({
      sourcePullRequests: [1392],
      summary: expect.stringContaining("current private conversation"),
      details: expect.stringContaining("scheduled sends are not included"),
    });
    expect(items.get("focused-current-research")).toMatchObject({
      sourcePullRequests: [1393],
      details: expect.stringContaining(
        "Names, private notes, arbitrary question prose, and account data never enter",
      ),
    });
    expect(items.get("runtime-replacement-continuity")).toMatchObject({
      sourcePullRequests: [1472, 1522],
      details: expect.stringContaining("A faster save"),
    });
    expect(items.get("paused-member-retention-cleanup")).toMatchObject({
      sourcePullRequests: [1493],
      details: expect.stringContaining("already-approved retention cleanup"),
    });
    expect(items.get("background-results-use-less-shared-capacity")).toMatchObject({
      sourcePullRequests: [1475, 1510],
      details: expect.stringContaining("duplicate protection"),
    });
    const feedbackSummary = items.get("feedback-reproduction-guidance");
    expect(feedbackSummary).toMatchObject({
      sourcePullRequests: [1465],
      summary: expect.stringContaining(
        "instead of attaching the raw conversation or service response",
      ),
      details: expect.stringContaining(
        "Ordinary feedback remains silent and best-effort",
      ),
    });
    expect(`${feedbackSummary?.summary} ${feedbackSummary?.details}`).not.toMatch(
      /excludes raw conversation wording|without your private details/iu,
    );

    const experimentLinks = items.get("custom-experiment-deep-links");
    expect(experimentLinks).toMatchObject({
      sourcePullRequests: [1448],
      summary: expect.stringContaining("direct authenticated link"),
      details: expect.stringContaining(
        "Normal sign-in and account access still apply",
      ),
    });
    expect(`${experimentLinks?.summary} ${experimentLinks?.details}`).not.toMatch(
      /request-bound|signed link/iu,
    );

    const relaySources = listAppleHealthRelayConnectSources();
    const relayEntry = items.get("apple-health-relay-wearables");
    expect(relaySources).toHaveLength(6);
    for (const source of relaySources) {
      for (const publicName of source.name.split(" / ")) {
        expect(relayEntry?.summary).toContain(publicName);
      }
    }
    expect(relayEntry).toMatchObject({
      sourcePullRequests: [1316],
      details: expect.stringContaining(
        "never appear as direct connections or show a false disconnect state",
      ),
    });
    expect(relayEntry?.summary).not.toContain("Polar");

    const augustSevenCopy = listPublishedChangelogItems()
      .filter((item) => item.publishedOn === "2026-08-07")
      .map((item) => `${item.summary} ${item.details ?? ""}`)
      .join(" ");
    expect(augustSevenCopy).not.toContain(
      "sending an approved connected-app email",
    );
    expect(augustSevenCopy).not.toContain(
      "same approved tools as an ordinary private conversation",
    );
  });

  it("keeps the August 5 through August 9 copy outcome-oriented", () => {
    const copy = listPublishedChangelogItems()
      .filter((item) => item.publishedOn >= "2026-08-05")
      .map((item) => `${item.title} ${item.summary} ${item.details ?? ""}`)
      .join(" ");

    expect(copy).not.toMatch(
      /\b(?:Codex|Composio|Linq)\b|approved owners|byte-transfer|database (?:contention|lock)|existing runtime|hosted group container|provider (?:payloads?|work)|server clock/iu,
    );
  });

  it("keeps the August 5 and August 6 recovery claims attached to their owners", () => {
    const items = new Map(
      listPublishedChangelogItems().map((item) => [item.id, item]),
    );

    expect(items.get("tracked-compact-table-cards")).toMatchObject({
      sourcePullRequests: [1288, 1293, 1329],
      details: expect.stringContaining("presentation-only"),
    });
    expect(items.get("scheduled-reminder-authority")).toMatchObject({
      sourcePullRequests: [1317, 1323],
      details: expect.stringContaining("Each reminder keeps its own audience"),
    });
    expect(items.get("late-media-origin-continuity")).toMatchObject({
      sourcePullRequests: [1334, 1346, 1374, 1389],
      details: expect.stringContaining("will not make a blind second attempt"),
    });
    const supportSummary = items.get("support-escalation-issue-summary");
    expect(supportSummary).toMatchObject({
      sourcePullRequests: [1284, 1305],
      summary: expect.stringContaining(
        "instead of attaching the raw conversation or service response",
      ),
      details: expect.stringContaining(
        "does not guarantee that every private meaning is removed",
      ),
    });
    expect(`${supportSummary?.summary} ${supportSummary?.details}`).not.toMatch(
      /excludes (?:raw transcripts|health details)|no .*health details/iu,
    );
    expect(items.get("daily-nutrition-card-delivery")).toMatchObject({
      sourcePullRequests: [1312],
      details: expect.stringContaining("partial-totals marker"),
    });
    const healthConsent = items.get("health-consent-actions-clarified");
    expect(healthConsent).toMatchObject({
      sourcePullRequests: [1338, 1339, 1350],
      summary: expect.stringContaining(
        "Deep sleep and REM sleep now each use one clear permission",
      ),
    });
    expect(healthConsent?.summary).not.toContain(
      "sleep sharing uses one understandable permission",
    );
    expect(items.get("maintenance-without-global-pause")).toMatchObject({
      sourcePullRequests: [1318],
      details: expect.stringContaining("Messages already received remain available"),
    });
    expect(items.get("interactive-imessage-cards-restored")).toMatchObject({
      sourcePullRequests: [1394, 1426],
    });
    expect(items.get("first-contact-starts-faster")).toMatchObject({
      sourcePullRequests: [1333, 1345, 1347, 1436],
    });
  });

  it("publishes the complete July 20 through August 10 shipment set", () => {
    expect(
      listChangelogEditions().slice(0, 22).map((edition) => ({
        id: edition.id,
        itemIds: edition.items.map((item) => item.id),
      })),
    ).toEqual([
      {
        id: "2026-08-10",
        itemIds: [
          "non-expiring-starter-access",
          "personal-patterns",
          "personality-settings-and-chat",
          "reminders-keep-requested-timezone",
          "voice-memos-use-your-voice",
          "web-search-restored",
          "appointment-reminders-by-default",
          "workout-card-status-rendering",
        ],
      },
      {
        id: "2026-08-09",
        itemIds: [
          "group-sleep-challenges-use-fresh-data",
          "public-referral-home",
          "murph-max-plan",
          "generated-contact-card-avatar",
          "family-setup-from-group",
          "live-workout-logging",
          "clearer-health-source-handoffs",
          "body-composition-guidance",
          "group-replies-respect-the-room",
          "sponsorship-creative-opt-in",
          "response-cards-survive-long-turns",
          "cleaner-imessage-nutrition-cards",
          "typing-prewarms-private-chat",
          "automation-output-variety",
          "ios-app-footer-link",
          "runtime-replacement-continuity",
          "paused-member-retention-cleanup",
          "background-results-use-less-shared-capacity",
          "feedback-reproduction-guidance",
        ],
      },
      {
        id: "2026-08-08",
        itemIds: [
          "custom-experiment-deep-links",
          "homepage-runtime-explainer",
          "group-funding-one-recovery-owner",
          "room-memory-status-recovers",
          "due-automations-drain-cleanly",
          "shared-pages-unfurl-again",
          "device-sync-webhook-recovery",
          "proactive-group-thread-routing",
        ],
      },
      {
        id: "2026-08-07",
        itemIds: [
          "first-personal-health-read",
          "reusable-referral-links",
          "scheduled-direct-call",
          "scheduled-tools-follow-the-route",
          "group-calls-without-redundant-preview",
          "connected-email-from-private-chat",
          "focused-current-research",
          "repeated-experiment-cadence",
          "biomarker-reference-bands",
          "interactive-imessage-cards-restored",
          "group-room-context-grounding",
          "billing-access-recovery",
          "cancel-pending-file-delivery",
          "meal-capture-toggle-ordering",
        ],
      },
      {
        id: "2026-08-06",
        itemIds: [
          "companion-admission-before-device",
          "turn-local-browser-progress",
          "recovery-readiness-insight",
          "x-post-media-understanding",
          "health-consent-actions-clarified",
          "first-contact-starts-faster",
          "late-media-origin-continuity",
          "support-escalation-issue-summary",
        ],
      },
      {
        id: "2026-08-05",
        itemIds: [
          "apple-health-relay-wearables",
          "prepare-next-group",
          "tracked-compact-table-cards",
          "connected-app-authorization-preview",
          "daily-nutrition-card-delivery",
          "mobile-one-time-contribution",
          "official-local-alert-health-context",
          "scheduled-reminder-authority",
          "onboarding-and-group-activation-recovery",
          "venice-usage-before-save",
          "feedback-starts-with-the-problem",
          "environment-panel-full-width",
          "public-status-footer-link",
          "maintenance-without-global-pause",
        ],
      },
      {
        id: "2026-08-04",
        itemIds: [
          "custom-inference-endpoint",
          "health-data-consent-controls",
          "daily-nutrition-cards",
          "single-source-wearable-disconnect",
          "database-first-nutrition-estimates",
          "physical-note-address-completion",
          "capacity-without-message-estimates",
          "venice-provider-rate-usage",
          "device-sync-artifact-retries",
          "foreground-after-checkpoint-wake",
          "group-photo-reference-reuse",
          "usage-denials-preserve-pending-work",
        ],
      },
      {
        id: "2026-08-03",
        itemIds: ["connected-app-results-stay-in-turn"],
      },
      {
        id: "2026-08-02",
        itemIds: [
          "phone-transfer-recovery",
          "unknown-group-signup-recovery",
          "physical-note-claim-recovery",
          "contact-card-line-recovery",
        ],
      },
      {
        id: "2026-08-01",
        itemIds: [
          "environment-processing-and-print",
          "physical-notes-from-chat",
          "direct-product-support-escalation",
          "calendar-aware-reminder-availability",
          "one-action-challenge-entry",
          "group-reactions-shape-room-memory",
          "group-casing-room-tone",
          "signup-handoffs-stay-on-course",
          "wearable-connect-finish-and-recover",
          "late-followups-stay-eligible",
          "image-errors-explain-the-failure",
          "bounded-onboarding-followup",
          "daily-wrong-line-redirect",
          "dashboard-refresh-stays-in-place",
          "faster-first-imessage-reply",
          "higher-group-daily-text-capacity",
        ],
      },
      {
        id: "2026-07-31",
        itemIds: [
          "private-environment-report",
          "environment-voice-walkthrough",
          "native-link-previews",
          "family-owner-usage-topups",
          "group-access-across-channels",
          "fund-groups-at-any-capacity",
          "one-shot-reminders-survive-restart",
          "venice-tool-compatible-replies",
          "core-member-plan-name",
          "usage-referrals-stay-current",
          "safe-group-stakes",
          "experiment-progress-cards-fail-soft",
          "delegated-work-before-blocker",
        ],
      },
      {
        id: "2026-07-30",
        itemIds: [
          "capped-monthly-group-sponsorship",
          "usage-credit-without-message-estimates",
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

  it("keeps Personal Patterns historical and non-causal", () => {
    const item = listPublishedChangelogItems().find(
      (candidate) => candidate.id === "personal-patterns",
    );

    expect(item).toMatchObject({
      sourcePullRequests: [1563],
      tryIt: {
        href: "/patterns",
        label: "View your patterns",
      },
    });
    expect(item?.details).toContain("existing history");
    expect(item?.details).toContain("association rather than cause");
  });

  it("keeps historical one-time sponsorship copy and publishes monthly sponsorship only in the current edition", () => {
    const items = new Map(
      listPublishedChangelogItems().map((item) => [item.id, item]),
    );
    const historical = items.get("group-sponsorship-moments");
    const current = items.get("capped-monthly-group-sponsorship");
    const estimateRemoval = items.get("usage-credit-without-message-estimates");

    expect(historical).toMatchObject({
      publishedOn: "2026-07-28",
      sourcePullRequests: [1026, 1135],
      summary: expect.stringContaining("one $5, $10, or $20 contribution"),
    });
    expect(`${historical?.summary} ${historical?.details}`).not.toMatch(
      /monthly sponsorship|monthly maximum/iu,
    );
    expect(current).toMatchObject({
      publishedOn: "2026-07-30",
      summary: expect.stringContaining("up to $5, $10, or $20 per month"),
    });
    expect(estimateRemoval).toMatchObject({
      publishedOn: "2026-07-30",
      summary: expect.stringContaining("without converting it into an approximate number of messages"),
    });
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
    expect(firstPage?.editions[0]?.publishedOn).toBe("2026-08-10");
    expect(firstPage?.editions.at(-1)?.publishedOn).toBe("2026-08-04");
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
