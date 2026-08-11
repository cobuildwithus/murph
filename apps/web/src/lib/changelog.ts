import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

export const CHANGELOG_FEED_SCHEMA = "murph.changelog-feed.v1";
export const CHANGELOG_CARD_VERSION = "v1";
export const CHANGELOG_CARD_MAX_ITEMS = 7;
export const CHANGELOG_PREVIEW_CARD_ITEMS = 5;
export const CHANGELOG_EDITIONS_PER_PAGE = 7;
export const CHANGELOG_FEATURE_LIMIT_MAX = 100;
export const CHANGELOG_IMPROVEMENT_LIMIT_MAX = 25;

const CHANGELOG_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CHANGELOG_TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CHANGELOG_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CHANGELOG_CARD_SEPARATOR = "~";

export type ChangelogItemKind = "feature" | "improvement";
export type ChangelogPriority = 1 | 2 | 3 | 4 | 5;

export interface ChangelogTryIt {
  href?: string;
  label: string;
  prompt?: string;
}

export interface ChangelogItem {
  details?: string;
  id: string;
  kind: ChangelogItemKind;
  priority: ChangelogPriority;
  relevanceTags: readonly string[];
  sourcePullRequests: readonly number[];
  summary: string;
  title: string;
  tryIt?: ChangelogTryIt;
}

export interface ChangelogEdition {
  id: string;
  items: readonly ChangelogItem[];
  publishedOn: string;
  summary: string;
  title: string;
}

export interface PublishedChangelogItem extends ChangelogItem {
  editionId: string;
  editionTitle: string;
  publishedOn: string;
}

export interface ChangelogQuery {
  featureLimit: number;
  from: string;
  improvementLimit: number;
  to: string;
}

export interface ChangelogPage {
  currentPage: number;
  editions: readonly ChangelogEdition[];
  totalPages: number;
}

const RAW_CHANGELOG_EDITIONS = [
  {
    id: "2026-08-11",
    publishedOn: "2026-08-11",
    title: "A clearer way back to shared cards",
    summary:
      "Shared workout and nutrition cards now explain how to get Murph for iPhone and return to the interactive card in Messages.",
    items: [
      {
        id: "shared-card-app-handoff",
        kind: "improvement",
        priority: 4,
        title: "Shared cards point back to Murph",
        summary:
          "Opening a shared workout or nutrition card on the web now shows a focused path to Murph for iPhone and explains how to return to the card in Messages.",
        details:
          "The page keeps the card details opaque and leaves the shared link unchanged. Ordinary homepage links stay unaffected, while Messages continues to own the interactive card.",
        relevanceTags: ["imessage", "cards", "iphone", "recovery"],
        sourcePullRequests: [1630],
      },
    ],
  },
  {
    id: "2026-08-10",
    publishedOn: "2026-08-10",
    title:
      "Starter access, patterns, health history, referrals, reminders, cards, voices, search, and clearer pages",
    summary:
      "Starter usage waits until used; patterns connect actions with next-day sleep; blood-pressure history stays recoverable through source-access changes; referrals stay in the intended conversation; reminders keep local time; workout rows and voice choices stay clear; managed search reaches current information; homepage starts lighter; and private Environment reports show their shape while loading.",
    items: [
      {
        id: "non-expiring-starter-access",
        kind: "feature",
        priority: 5,
        title: "Start with usage that does not expire",
        summary:
          "Eligible new members receive a Starter usage balance that remains available until it is used, with remaining usage and paid plan choices visible in Settings.",
        details:
          "Eligible legacy trial value carries into Starter. When the balance is exhausted, Murph pauses AI work without deleting account state and Settings offers eligible paid plans; usage top-ups remain available only to active paid-plan owners.",
        relevanceTags: ["starter", "usage", "billing", "settings"],
        sourcePullRequests: [1464],
        tryIt: {
          href: "/settings#subscription",
          label: "View Starter usage",
        },
      },
      {
        id: "cleaner-plan-and-model-settings",
        kind: "improvement",
        priority: 1,
        title: "Cleaner plan and model settings",
        summary:
          "Settings now presents Starter usage and unavailable models more concisely while keeping relevant plan and upgrade choices visible.",
        relevanceTags: ["settings", "plans", "models"],
        sourcePullRequests: [1621],
      },
      {
        id: "personal-patterns",
        kind: "feature",
        priority: 5,
        title: "See what tends to change after repeated actions",
        summary:
          "Patterns compares days with and without a repeated activity or logged experiment action, then shows how next-day sleep and recovery differed.",
        details:
          "It uses your existing history when enough comparable days are available, requires the direction to repeat across the observation window, and shows association rather than cause. Murph's weekly health insight checks the same evidence and stays quiet when nothing clears the bar.",
        relevanceTags: [
          "patterns",
          "wearables",
          "sleep",
          "recovery",
          "experiments",
        ],
        sourcePullRequests: [1563],
        tryIt: {
          href: "/patterns",
          label: "View your patterns",
        },
      },
      {
        id: "referral-notification-route-recovery",
        kind: "improvement",
        priority: 4,
        title: "Referral celebrations stay in the right conversation",
        summary:
          "Referral reward celebrations now stay attached to their intended direct conversation, and an interrupted one can safely resume without leaving later work waiting behind it.",
        details:
          "Murph resumes the already-pending celebration itself and rechecks the original direct conversation before any new response work. It never switches to a newer route; if the original conversation is no longer authorized, that celebration ends without sending so later notifications can continue.",
        relevanceTags: ["referrals", "messaging", "reliability", "privacy"],
        sourcePullRequests: [1592],
      },
      {
        id: "blood-pressure-history-completion",
        kind: "improvement",
        priority: 4,
        title: "Blood-pressure history waits for the whole sync",
        summary:
          "When Murph is recovering older blood-pressure readings, a temporary change in source access no longer lets an unfinished history import look complete.",
        details:
          "Murph keeps the same history window available to retry after access returns and marks it complete only after every remaining day finishes under the currently connected source.",
        relevanceTags: ["blood-pressure", "wearables", "health-data", "reliability"],
        sourcePullRequests: [1523, 1625],
      },
      {
        id: "reminders-keep-requested-timezone",
        kind: "improvement",
        priority: 4,
        title: "Reminders keep the time you asked for",
        summary:
          "When you schedule a recurring reminder in a named timezone, Murph now preserves that local time through saving and later edits.",
        details:
          "The confirmation comes from the saved schedule and scheduler's next deliverable occurrence. If timing cannot be verified, or an old one-time reminder can no longer fire, Murph says so and offers a bounded recovery instead of inventing a time.",
        relevanceTags: ["reminders", "automations", "timezones", "reliability"],
        sourcePullRequests: [1546],
        tryIt: {
          label: "Schedule a local-time reminder",
          prompt: "Remind me every day at 9 PM Central to wind down.",
        },
      },
      {
        id: "voice-memos-use-your-voice",
        kind: "improvement",
        priority: 4,
        title: "Voice memos keep your chosen voice",
        summary:
          "Ordinary voice memos now use the voice already selected for your Murph instead of switching voices on their own.",
        details:
          "A different named voice is used only when you explicitly ask to test it or request that voice for one memo. Saving a named voice and asking to hear it immediately still works as a one-time preview.",
        relevanceTags: ["voice", "messaging", "personalization", "reliability"],
        sourcePullRequests: [1587],
      },
      {
        id: "cleaner-workout-cards-in-messages",
        kind: "improvement",
        priority: 4,
        title: "Response cards stay compact in Messages",
        summary:
          "Workout detail and nutrition goal direction now stay inside their cards instead of repeating a long summary beneath the static image.",
        details:
          "Fallback cards have no duplicate badge or corner mask. Nutrition goals use short in-card direction labels without repeating target amounts, older sent workout cards remain readable, and generic tables keep their optional subtitle.",
        relevanceTags: ["workouts", "nutrition", "imessage", "cards", "design"],
        sourcePullRequests: [1588],
      },
      {
        id: "web-search-restored",
        kind: "improvement",
        priority: 5,
        title: "Managed OpenAI web search works again",
        summary:
          "When Murph uses managed OpenAI, its built-in web search can reach current information again instead of stopping with a forbidden-request error.",
        details:
          "Search still runs through Murph's existing protected managed OpenAI provider connection and returns in the same conversation. Other provider choices keep their current search behavior.",
        relevanceTags: ["assistant", "search", "research", "reliability"],
        sourcePullRequests: [1583],
      },
      {
        id: "appointment-reminders-by-default",
        kind: "improvement",
        priority: 4,
        title: "Confirmed appointments come with a reminder",
        summary:
          "When a future care appointment is confirmed in a private conversation, Murph now creates one useful reminder by default unless you opt out.",
        details:
          "Morning appointments use the prior evening, later appointments use the same morning, and Murph keeps the same reminder up to date when an appointment is rescheduled or canceled.",
        relevanceTags: ["appointments", "reminders", "automations", "care"],
        sourcePullRequests: [1586],
        tryIt: {
          label: "Tell Murph about an appointment",
          prompt:
            "I have a confirmed dentist appointment next Thursday at 2 PM.",
        },
      },
      {
        id: "workout-card-status-rendering",
        kind: "improvement",
        priority: 3,
        title: "Completed workout rows keep their checkmark",
        summary:
          "Completed exercises now keep a clear checkmark in Messages workout cards, including their static previews.",
        details:
          "The status mark is part of the card image itself, so it stays visible anywhere the static preview is shown.",
        relevanceTags: ["workouts", "imessage", "cards", "reliability"],
        sourcePullRequests: [1599],
      },
      {
        id: "lighter-accessible-homepage",
        kind: "improvement",
        priority: 3,
        title: "The homepage starts lighter",
        summary:
          "The public homepage now uses compact avatar images while continuing to prepare secure sign-in automatically in the background.",
        details:
          "Cold sign-in still opens immediately, announces its loading state, keeps keyboard focus when the form arrives, and retries a temporary loading failure. Text contrast is also clearer across the updated sections.",
        relevanceTags: ["homepage", "performance", "accessibility", "sign-in"],
        sourcePullRequests: [1573],
        tryIt: {
          href: "/",
          label: "Visit the homepage",
        },
      },
      {
        id: "environment-report-loading-preview",
        kind: "improvement",
        priority: 3,
        title: "Environment reports show their shape while loading",
        summary:
          "The private Environment report now opens with a clear preparing state and a report-shaped preview instead of a mostly empty page.",
        details:
          "The preview mirrors the printable report and gives immediate feedback while the existing private Browser Vault opens. The finished report, empty state, and error recovery continue unchanged.",
        relevanceTags: ["environment", "reports", "web", "privacy"],
        sourcePullRequests: [1617],
        tryIt: {
          href: "/environment/print",
          label: "Open your Environment report",
        },
      },
    ],
  },
  {
    id: "2026-08-09",
    publishedOn: "2026-08-09",
    title: "Referrals, Max, and a more capable Murph",
    summary:
      "A public referral home, the Max plan, personalized contact cards, live workout logging, safer Family setup, private group follow-ups, clearer connection paths, and stronger conversation recovery all landed together.",
    items: [
      {
        id: "group-sleep-challenges-use-fresh-data",
        kind: "improvement",
        priority: 4,
        title: "Group sleep checks use fresh shared data",
        summary:
          "Murph now checks the current shared sleep record before answering, counts reported Deep and REM sleep as soon as those values are shared, and includes explicit manual corrections.",
        details:
          "The latest manual correction for a sleep date wins and is labeled Manual instead of a connected source. Reconnected sources no longer combine an old disconnected status with a newer sync time. Future-dated entries stay excluded, and missing data remains unverified.",
        relevanceTags: ["groups", "sleep", "health-data", "connections"],
        sourcePullRequests: [1565, 1593],
      },
      {
        id: "public-referral-home",
        kind: "feature",
        priority: 5,
        title: "Referral rewards have a public home",
        summary:
          "The new Referral page explains the earning paths currently available, shows rewards in Murph usage days, and keeps your reusable link ready to copy when link rewards are on.",
        details:
          "The page separates personal signup rewards from group missions, states eligibility before you share, returns you after sign-in, and keeps another member's identity and private data out of reward confirmations.",
        relevanceTags: ["referrals", "usage", "groups", "privacy"],
        sourcePullRequests: [
          1450, 1459, 1483, 1485, 1487, 1492, 1497, 1498, 1499, 1515,
        ],
        tryIt: {
          href: "/refer",
          label: "Explore referrals",
        },
      },
      {
        id: "murph-max-plan",
        kind: "feature",
        priority: 5,
        title: "Meet Murph Max",
        summary:
          "Max is a new $50 monthly personal plan with Murph's highest included AI usage for frequent deep research, analysis, and heavier ongoing use.",
        details:
          "Settings uses the existing plan-change confirmation and Stripe handoff. Upgrades activate after payment confirmation, scheduled downgrades stay visible, and an exhausted Max plan points to the existing add-usage or reset recovery.",
        relevanceTags: ["plans", "billing", "usage", "settings"],
        sourcePullRequests: [1440],
        tryIt: {
          href: "/settings#subscription",
          label: "Compare plans",
        },
      },
      {
        id: "generated-contact-card-avatar",
        kind: "feature",
        priority: 5,
        title: "Give Murph a new contact photo",
        summary:
          "Ask Murph in a private iMessage conversation for a new contact photo and get one saveable contact card with the generated square image and your current Murph line.",
        details:
          "The request is one-shot and stays bound to the turn that asked for it. Murph refuses an ambiguous route before generation and never reports a card as delivered unless the sending service confirms it.",
        relevanceTags: ["contacts", "images", "imessage", "privacy"],
        sourcePullRequests: [1458, 1488],
      },
      {
        id: "family-setup-from-group",
        kind: "feature",
        priority: 5,
        title: "Start Family setup safely from a group",
        summary:
          "When someone asks about a Murph Family plan in a group, Murph now offers a private conversation or a stable browser handoff into that person's Family settings.",
        details:
          "The group never reads Family status or creates billing and invite links. Sign-in happens before the personal Settings handoff, and Family requests stay distinct from sponsoring or adding usage to the current room.",
        relevanceTags: ["family", "groups", "billing", "privacy"],
        sourcePullRequests: [1527],
        tryIt: {
          href: "/family/setup",
          label: "Open Family setup",
        },
      },
      {
        id: "live-workout-logging",
        kind: "feature",
        priority: 5,
        title: "Run a workout set by set",
        summary:
          "Murph can start a live structured workout, add exercises, log or correct one exact set, clear a mistake without shifting later sets, and finish with the elapsed duration.",
        details:
          "Saved routine targets remain plans, never completed work. Repeating an explicit set update changes the same recorded set, and repeated same-day workout tallies now count planned occurrences without inventing missing repetitions.",
        relevanceTags: ["workouts", "tracking", "assistant", "health-data"],
        sourcePullRequests: [1455, 1504],
        tryIt: {
          label: "Start a live workout",
          prompt:
            "Start a live workout called Upper Body and help me log each set as I go.",
        },
      },
      {
        id: "private-group-follow-up",
        kind: "feature",
        priority: 4,
        title: "Continue a group question privately",
        summary:
          "Ask Murph in a group to continue with you privately, and your personal Murph can send the answer only to your verified direct chat on the same channel.",
        details:
          "Murph uses the exact group message author and checks the direct chat before personal work begins. If no eligible direct chat is available, Murph asks you to open one on that channel and retry.",
        relevanceTags: ["groups", "messaging", "privacy", "assistant"],
        sourcePullRequests: [1481],
      },
      {
        id: "clearer-health-source-handoffs",
        kind: "improvement",
        priority: 5,
        title: "Connections explain the route before you leave",
        summary:
          "Direct connections now explain the handoff before authorization, Apple Health relay sources use recognizable service icons, and unsupported sources get verified export guidance.",
        details:
          "Relay cards still make Apple Health ownership clear. Manual exports are described as snapshots rather than live sync, private files move to your private Murph, and Murph does not invent an export menu it cannot verify.",
        relevanceTags: ["connections", "wearables", "imports", "privacy"],
        sourcePullRequests: [1432, 1447, 1506],
        tryIt: {
          href: "/connect",
          label: "Browse connections",
        },
      },
      {
        id: "body-composition-guidance",
        kind: "improvement",
        priority: 5,
        title: "Body-composition guidance fits the actual goal",
        summary:
          "Murph now routes weight loss, weight gain, cutting, bulking, recomposition, and maintenance into one evidence-backed body-composition approach.",
        details:
          "The guidance keeps the roles of nutrition and training clear, compares trends in consistent units, minimizes tracking burden, and uses separate safety handling when pregnancy, postpartum recovery, breastfeeding, or under-fueling changes the answer.",
        relevanceTags: ["body-composition", "nutrition", "training", "safety"],
        sourcePullRequests: [1512],
        tryIt: {
          label: "Talk through a goal",
          prompt:
            "Help me choose a realistic body-composition goal and the minimum useful way to track progress.",
        },
      },
      {
        id: "group-replies-respect-the-room",
        kind: "improvement",
        priority: 5,
        title: "Group replies respect who has the floor",
        summary:
          "Murph now understands the native reply relationship between group messages and gives ordinary conversations a longer beat before answering.",
        details:
          "A reply edge never invents the target's words or identity. Human-owned beats can finish silently, urgent coordination skips avoidable delay, and a burst still produces at most one terminal action for the room's current moment.",
        relevanceTags: ["groups", "imessage", "replies", "conversation"],
        sourcePullRequests: [1443, 1514],
      },
      {
        id: "sponsorship-creative-opt-in",
        kind: "improvement",
        priority: 5,
        title: "Group sponsorship stays quiet by default",
        summary:
          "Funding a group no longer produces a song or other public creative response unless the payer opens the optional personalization and chooses one.",
        details:
          "Message, poem, and 15-second song are explicit formats. Usage credit is granted independently of creative success, and missing or older customization state never counts as song consent.",
        relevanceTags: ["groups", "sponsorship", "music", "consent"],
        sourcePullRequests: [1446, 1490],
      },
      {
        id: "response-cards-survive-long-turns",
        kind: "improvement",
        priority: 4,
        title: "Response cards survive long turns and newer messages",
        summary:
          "Private nutrition and compact-table cards now keep their full structure when a long conversation is condensed and still use Murph's verified web address.",
        details:
          "The result returns as one card in the same conversation with an accurate static or text fallback. Empty fallbacks stay silent, and invalid card data is rejected.",
        relevanceTags: ["imessage", "cards", "nutrition", "reliability"],
        sourcePullRequests: [1473, 1489, 1501],
      },
      {
        id: "cleaner-imessage-nutrition-cards",
        kind: "improvement",
        priority: 4,
        title: "Nutrition cards fit Messages cleanly",
        summary:
          "Static nutrition cards now use Messages' own app icon and rounded frame, with only the date and meal count beneath the card unless totals are partial.",
        details:
          "Calories, nutrient totals, and goal status stay inside the card without a second Murph badge or a long repeat below it. Provider chrome keeps only a short partial-data warning when needed.",
        relevanceTags: ["imessage", "cards", "nutrition", "design"],
        sourcePullRequests: [1567, 1588],
      },
      {
        id: "typing-prewarms-private-chat",
        kind: "improvement",
        priority: 4,
        title: "Typing can warm Murph before you send",
        summary:
          "For an established private chat, an authenticated typing hint can help Murph get ready while you compose the message.",
        details:
          "Typing is never treated as a message, permission, or delivery claim. Unknown or ineligible hints quietly fall back to the normal path, and the later accepted message still owns the reply.",
        relevanceTags: ["performance", "messaging", "privacy", "reliability"],
        sourcePullRequests: [1476, 1482, 1503],
      },
      {
        id: "automation-output-variety",
        kind: "improvement",
        priority: 4,
        title: "Recurring automations repeat themselves less",
        summary:
          "Dynamic recurring automations can now use a small recent-output history to avoid substantially repeating the same quote, fact, prompt, suggestion, or recommendation.",
        details:
          "The history stays tied to the current version of the automation. Exact-text reminders remain exact, and old output is treated as history rather than a new instruction.",
        relevanceTags: ["automations", "assistant", "personalization", "reliability"],
        sourcePullRequests: [1494],
      },
      {
        id: "ios-app-footer-link",
        kind: "improvement",
        priority: 4,
        title: "The iOS app is one click from the website",
        summary:
          "Murph's public footer now includes a direct link to the official iOS App Store listing alongside the existing product links.",
        details:
          "The link opens in a new tab with the existing external-link safeguards and keeps the current footer hierarchy intact on desktop and mobile.",
        relevanceTags: ["ios", "website", "navigation", "mobile"],
        sourcePullRequests: [1530],
      },
      {
        id: "runtime-replacement-continuity",
        kind: "improvement",
        priority: 4,
        title: "Restarts keep the latest conversation work",
        summary:
          "When Murph restarts while saving its latest work, the new instance now waits for that exact handoff instead of restoring an older conversation.",
        details:
          "The handoff remains automatic and limited in time. A faster save preserves the same protection for restored and newly arrived messages without adding routine startup delay.",
        relevanceTags: ["assistant", "continuity", "reliability", "performance"],
        sourcePullRequests: [1472, 1522],
      },
      {
        id: "paused-member-retention-cleanup",
        kind: "improvement",
        priority: 4,
        title: "Privacy cleanup continues while Murph is paused",
        summary:
          "Pausing Murph no longer blocks already-authorized cleanup of expired private inbox media.",
        details:
          "Ordinary replies stay paused. Only already-approved retention cleanup can briefly resume, remove expired media, and save the cleaned state.",
        relevanceTags: ["privacy", "retention", "media", "reliability"],
        sourcePullRequests: [1493],
      },
      {
        id: "background-results-use-less-shared-capacity",
        kind: "improvement",
        priority: 4,
        title: "Background results leave more room for current replies",
        summary:
          "Proactive follow-ups and completed phone-call results now do less blocking background work, leaving current replies more room to run during busy moments.",
        details:
          "Current replies still keep priority, while card and call destinations, duplicate protection, and recovery stay unchanged.",
        relevanceTags: ["performance", "calls", "messaging", "reliability"],
        sourcePullRequests: [1475, 1510],
      },
      {
        id: "feedback-reproduction-guidance",
        kind: "improvement",
        priority: 4,
        title: "Feedback can carry bounded reproduction context",
        summary:
          "When a product problem has useful reproduction evidence, the internal feedback path can store a bounded model-written summary with concise steps and environment context instead of attaching the raw conversation or service response.",
        details:
          "Ordinary feedback remains silent and best-effort. Recognizable shaped identifiers and secrets receive deterministic scrubbing, but the path does not claim that every private meaning can be detected or removed.",
        relevanceTags: ["feedback", "privacy", "support", "reliability"],
        sourcePullRequests: [1465],
      },
    ],
  },
  {
    id: "2026-08-08",
    publishedOn: "2026-08-08",
    title: "Exact experiment links and steadier background work",
    summary:
      "Murph can point to the precise private experiment you asked for, while group funding, scheduled work, device sync, room memory, and shared-page previews recover more cleanly.",
    items: [
      {
        id: "custom-experiment-deep-links",
        kind: "feature",
        priority: 5,
        title: "Ask for the exact experiment page",
        summary:
          "When you explicitly ask to open or share a private custom experiment, Murph can return a direct authenticated link to that exact run instead of sending you to a generic list.",
        details:
          "Normal sign-in and account access still apply. Murph does not add experiment links to unrelated replies or treat the link as permission to disclose experiment data elsewhere.",
        relevanceTags: ["experiments", "links", "assistant", "privacy"],
        sourcePullRequests: [1448],
        tryIt: {
          label: "Ask for an experiment",
          prompt: "Send me the page for my current custom experiment.",
        },
      },
      {
        id: "homepage-runtime-explainer",
        kind: "feature",
        priority: 4,
        title: "See how Murph runs",
        summary:
          "The homepage now explains Murph's private runtime, how tools connect to the conversation, and why that architecture matters without requiring a technical detour.",
        relevanceTags: ["homepage", "privacy", "assistant", "product"],
        sourcePullRequests: [1451],
        tryIt: {
          href: "/#how",
          label: "See how Murph works",
        },
      },
      {
        id: "group-funding-one-recovery-owner",
        kind: "improvement",
        priority: 5,
        title: "Group funding has one clear recovery path",
        summary:
          "Monthly sponsorship and one-time contributions now return to the same group-funding flow when checkout needs to resume, reconcile, or explain what happened.",
        details:
          "A verified payment still owns the credit grant, an uncertain checkout stays recoverable without a second charge, and group usage can continue independently of optional public creative output.",
        relevanceTags: ["groups", "billing", "usage", "reliability"],
        sourcePullRequests: [1419],
      },
      {
        id: "room-memory-status-recovers",
        kind: "improvement",
        priority: 4,
        title: "Room context survives longer conversations",
        summary:
          "Group-room memory maintenance now preserves the latest trustworthy room context when a long conversation needs compaction or a background refresh fails.",
        details:
          "The room keeps one trusted, limited history. A maintenance failure does not replace known context with an empty or misleading status.",
        relevanceTags: ["groups", "memory", "assistant", "reliability"],
        sourcePullRequests: [1449],
      },
      {
        id: "due-automations-drain-cleanly",
        kind: "improvement",
        priority: 4,
        title: "A backlog of automations clears more cleanly",
        summary:
          "When several scheduled jobs become due together, Murph can collect and clear the limited backlog in one coordinated pass instead of repeatedly waking around the same work.",
        details:
          "Each occurrence keeps its existing approval and delivery path. Capacity stays limited, and one busy lane cannot silently create duplicate work.",
        relevanceTags: ["automations", "performance", "reliability", "scheduling"],
        sourcePullRequests: [1434],
      },
      {
        id: "shared-pages-unfurl-again",
        kind: "improvement",
        priority: 4,
        title: "Shared Murph pages unfurl again",
        summary:
          "Referral, experiment, biomarker, and other shareable pages now trace their social-preview assets correctly instead of losing the image during route rendering.",
        relevanceTags: ["sharing", "links", "images", "web"],
        sourcePullRequests: [1456],
      },
      {
        id: "device-sync-webhook-recovery",
        kind: "improvement",
        priority: 4,
        title: "Device sync recovers from brief service contention",
        summary:
          "If a sync update briefly collides with another write, Murph releases the contested step quickly and asks the wearable service to try again.",
        details:
          "The retry stays with the same sync job and cannot turn one update into a second import or duplicate health event.",
        relevanceTags: ["wearables", "sync", "health-data", "reliability"],
        sourcePullRequests: [1454],
      },
      {
        id: "proactive-group-thread-routing",
        kind: "improvement",
        priority: 4,
        title: "Proactive group messages return to the right room",
        summary:
          "Before sending a proactive group update, Murph now verifies that the saved conversation route belongs to that exact room.",
        details:
          "It cannot borrow another member's route or guess a room from private identity. If the room is ambiguous, nothing sends.",
        relevanceTags: ["groups", "messaging", "routing", "reliability"],
        sourcePullRequests: [1468],
      },
    ],
  },
  {
    id: "2026-08-07",
    publishedOn: "2026-08-07",
    title: "A personal first read, richer automations, clearer trends",
    summary:
      "Murph can offer one useful personal read after onboarding, keep scheduled work within its supported delivery route, send a bounded email from a connected account in a current private conversation, research a focused public question, and show repeated experiments and biomarker ranges more clearly.",
    items: [
      {
        id: "first-personal-health-read",
        kind: "feature",
        priority: 5,
        title: "A useful first read after onboarding",
        summary:
          "After completed onboarding, Murph can offer one specific interpretation grounded in your available health evidence and one optional low-burden next action.",
        details:
          "The read is private, focused, and scheduled only once. It does not automatically create a plan, habit, experiment, or reminder, and it stays honest when the evidence is too thin for a useful interpretation.",
        relevanceTags: ["onboarding", "insights", "health-data", "assistant"],
        sourcePullRequests: [1390],
      },
      {
        id: "reusable-referral-links",
        kind: "feature",
        priority: 5,
        title: "Your referral link stays yours",
        summary:
          "Eligible members now have one reusable referral link instead of needing a fresh invitation for every person they want to share Murph with.",
        details:
          "The recipient follows ordinary signup, a reward settles only after genuine activation and eligibility checks, and the referrer never gets the recipient's identity or health information.",
        relevanceTags: ["referrals", "signup", "usage", "privacy"],
        sourcePullRequests: [1337],
      },
      {
        id: "scheduled-direct-call",
        kind: "feature",
        priority: 5,
        title: "A scheduled private call can run when it is due",
        summary:
          "When a saved private conversation supports scheduled calling, its automation can place the exact requested phone call when the occurrence is due and return the result there.",
        details:
          "Email, Telegram, and group conversations are not eligible. Manual or mismatched occurrences also fail closed, and an uncertain call start is not automatically repeated.",
        relevanceTags: ["automations", "calls", "privacy", "reliability"],
        sourcePullRequests: [1336],
      },
      {
        id: "scheduled-tools-follow-the-route",
        kind: "improvement",
        priority: 4,
        title: "Scheduled tools follow the delivery route",
        summary:
          "Scheduled work can generate an image where the route supports image delivery, show an explicitly requested response card in a private direct chat, and offer a Clinical Records handoff that begins only after you open it.",
        details:
          "Email delivery stays text-only, private and group boundaries stay intact, and Clinical Records sign-in does not start until you open its launcher.",
        relevanceTags: ["automations", "images", "cards", "health-data"],
        sourcePullRequests: [1367],
      },
      {
        id: "group-calls-without-redundant-preview",
        kind: "improvement",
        priority: 4,
        title: "Group calls can start without a duplicate preview",
        summary:
          "In an authenticated group chat, a current participant can ask Murph to make one bounded public-venue or service call for the room without a special second approval step when the request is already complete.",
        details:
          "Murph still asks for any missing commitment bound or requester fact. Participant, current-message, membership, privacy, and transfer checks remain in place, and a call start never claims the later outcome.",
        relevanceTags: ["groups", "calls", "privacy", "assistant"],
        sourcePullRequests: [1386],
      },
      {
        id: "connected-email-from-private-chat",
        kind: "feature",
        priority: 5,
        title: "Send a bounded email from your connected account",
        summary:
          "In a current private conversation, you can ask Murph to send an ordinary email from an active Gmail or Outlook connection when the sender, recipients, and content are clear.",
        details:
          "Attachments and scheduled sends are not included. A send completes only after the email service confirms success; if the result is uncertain, Murph checks Sent mail narrowly and never automatically repeats the send.",
        relevanceTags: ["email", "connected-apps", "privacy", "reliability"],
        sourcePullRequests: [1392],
      },
      {
        id: "focused-current-research",
        kind: "feature",
        priority: 5,
        title: "Research one focused public question",
        summary:
          "When current evidence would materially improve an answer, Murph can run one bounded research lookup over a finite public health scope and map the answer back to usable sources.",
        details:
          "Names, private notes, arbitrary question prose, and account data never enter the live research request. If the scope cannot be represented or no source is usable, Murph says the lookup did not run or found nothing usable.",
        relevanceTags: ["research", "evidence", "assistant", "privacy"],
        sourcePullRequests: [1393],
      },
      {
        id: "repeated-experiment-cadence",
        kind: "feature",
        priority: 5,
        title: "Repeated experiments show today's occurrence",
        summary:
          "Experiment progress can now distinguish the specific occurrence due today from the overall repeated cadence instead of collapsing the schedule into one generic day.",
        relevanceTags: ["experiments", "tracking", "calendar", "health-data"],
        sourcePullRequests: [1444],
      },
      {
        id: "biomarker-reference-bands",
        kind: "feature",
        priority: 5,
        title: "Biomarker charts show the reference band",
        summary:
          "Result charts now place the reported value against its available lower and upper reference bounds, making in-range and out-of-range context easier to scan.",
        details:
          "The band reflects the source result's own reference context. Missing or one-sided bounds stay visibly incomplete instead of being replaced with a universal range.",
        relevanceTags: ["biomarkers", "charts", "health-data", "results"],
        sourcePullRequests: [1445],
      },
      {
        id: "interactive-imessage-cards-restored",
        kind: "improvement",
        priority: 5,
        title: "Interactive iMessage cards are back",
        summary:
          "Private structured responses can once again arrive as interactive iMessage cards, with the existing static layout or deterministic text recovery when the extension is unavailable.",
        relevanceTags: ["imessage", "cards", "messaging", "reliability"],
        sourcePullRequests: [1394, 1426],
      },
      {
        id: "group-room-context-grounding",
        kind: "improvement",
        priority: 5,
        title: "Group answers use the room's own context",
        summary:
          "Murph now grounds a group reply in the room's learned norms and recent shared context without dropping that context when the prompt grows.",
        details:
          "Room memory remains separate from private member memory. It guides how Murph participates but never creates identity, permission, or health-data sharing authority.",
        relevanceTags: ["groups", "memory", "assistant", "privacy"],
        sourcePullRequests: [1427, 1433],
      },
      {
        id: "billing-access-recovery",
        kind: "improvement",
        priority: 5,
        title: "Billing recovery leads back to Murph",
        summary:
          "Paused, lapsed, or recently changed subscription states now resolve through one clearer access-recovery path instead of leaving Home or a browser return in a contradictory state.",
        details:
          "Stripe remains the billing authority. Settings and conversational recovery wait for that projection, preserve scheduled plan changes, and avoid creating a second checkout while the first result is still uncertain.",
        relevanceTags: ["billing", "access", "settings", "reliability"],
        sourcePullRequests: [1406, 1418, 1429],
      },
      {
        id: "cancel-pending-file-delivery",
        kind: "improvement",
        priority: 4,
        title: "Cancel a file that has not been delivered",
        summary:
          "Murph can now cancel a pending generated-file delivery before the send begins, without deleting the underlying private file or affecting a delivery that already started.",
        relevanceTags: ["files", "messaging", "privacy", "reliability"],
        sourcePullRequests: [1387],
      },
      {
        id: "meal-capture-toggle-ordering",
        kind: "improvement",
        priority: 4,
        title: "Meal capture respects your latest choice",
        summary:
          "Rapidly enabling and disabling meal-photo capture now preserves the newest explicit choice even when an older setup or closeout operation finishes later.",
        details:
          "A delayed operation cannot silently re-enable capture, duplicate a daily closeout, or override a later opt-out.",
        relevanceTags: ["meals", "photos", "consent", "reliability"],
        sourcePullRequests: [1343],
      },
    ],
  },
  {
    id: "2026-08-06",
    publishedOn: "2026-08-06",
    title: "Faster starts, richer X answers, better continuity",
    summary:
      "The companion can start before a device is connected, X answers can use images and video, browser work reports progress in the current turn, health-data choices read more clearly, and late cards, images, support escalations, and first-contact messages stay attached to the right place.",
    items: [
      {
        id: "companion-admission-before-device",
        kind: "feature",
        priority: 5,
        title: "Open the companion before connecting a device",
        summary:
          "A signed-in member can now enter or resume the native companion without first choosing a wearable or health source.",
        details:
          "Device setup remains available when useful, but it is no longer the admission gate for the app or the member's existing account state.",
        relevanceTags: ["companion", "onboarding", "mobile", "wearables"],
        sourcePullRequests: [1341],
      },
      {
        id: "turn-local-browser-progress",
        kind: "feature",
        priority: 5,
        title: "Browser work shows progress in the current turn",
        summary:
          "When Murph uses the browser for noticeable work, progress now stays visible and belongs to the exact conversation turn that started it.",
        details:
          "A later turn cannot inherit an old browsing status, and a finished or abandoned browser task clears its own progress rather than leaving the conversation looking stuck.",
        relevanceTags: ["browser", "assistant", "progress", "reliability"],
        sourcePullRequests: [1359],
      },
      {
        id: "recovery-readiness-insight",
        kind: "feature",
        priority: 4,
        title: "Recovery insights require corroboration",
        summary:
          "A weekly insight can now notice a sustained recovery or readiness decline only after checking source freshness and finding an independent signal or relevant context.",
        details:
          "One proprietary score is never enough. When the evidence clears the bar, Murph offers at most one reversible low-burden adjustment with a guardrail and reassessment trigger.",
        relevanceTags: ["recovery", "wearables", "insights", "safety"],
        sourcePullRequests: [1353],
      },
      {
        id: "x-post-media-understanding",
        kind: "feature",
        priority: 4,
        title: "Ask about images and video on X",
        summary:
          "Murph can inspect the images and video in a relevant X post, instead of relying only on its text.",
        details:
          "The existing live X search now asks Grok to inspect relevant media. Murph keeps the source link, separates the post text from what the media shows or says, and treats the result as unverified third-party content.",
        relevanceTags: ["assistant", "x-search", "images", "video"],
        sourcePullRequests: [1399],
        tryIt: {
          label: "Ask about an X post",
          prompt:
            "Look at the images or video in this X post and tell me what they show: [paste X post URL]",
        },
      },
      {
        id: "health-consent-actions-clarified",
        kind: "improvement",
        priority: 5,
        title: "Health-data choices are easier to distinguish",
        summary:
          "Settings now gives health-data consent actions a clearer hierarchy. Deep sleep and REM sleep now each use one clear permission, with source details included in that stage's choice instead of appearing as a second version.",
        details:
          "Pausing processing remains distinct from export or account deletion. The app keeps the consequence visible before a change and does not hide the recovery action when processing is paused.",
        relevanceTags: ["consent", "health-data", "settings", "sleep"],
        sourcePullRequests: [1338, 1339, 1350],
        tryIt: {
          href: "/settings/data-privacy",
          label: "Review health-data choices",
        },
      },
      {
        id: "first-contact-starts-faster",
        kind: "improvement",
        priority: 4,
        title: "A first message gets moving sooner",
        summary:
          "First contact now uses the faster welcome path and starts preparing the conversation after enrollment, reducing avoidable work before Murph's first useful reply.",
        details:
          "Consent and activation still finish before the assistant can use member data. A failed prewarm quietly falls back to the ordinary durable message path.",
        relevanceTags: ["onboarding", "performance", "messaging", "reliability"],
        sourcePullRequests: [1333, 1345, 1347, 1436],
      },
      {
        id: "late-media-origin-continuity",
        kind: "improvement",
        priority: 5,
        title: "Late cards and images return where they started",
        summary:
          "A nutrition card or generated image that finishes late now resumes in its exact originating conversation and session instead of attaching to newer work.",
        details:
          "Attachment transfer retries only before the send could have started. If delivery is ambiguous, Murph will not make a blind second attempt or duplicate the media.",
        relevanceTags: ["images", "cards", "messaging", "reliability"],
        sourcePullRequests: [1334, 1346, 1374, 1389],
      },
      {
        id: "support-escalation-issue-summary",
        kind: "improvement",
        priority: 4,
        title: "Support escalations carry the issue, not the conversation",
        summary:
          "After an explicit request in a verified private conversation, the support email can include a short model-written problem summary instead of attaching the raw conversation or service response.",
        details:
          "The email stays linked to the member for follow-up and can contain free-form issue context. Recognizable shaped identifiers and secrets receive deterministic scrubbing, but the route does not guarantee that every private meaning is removed or promise a response time or ticket status.",
        relevanceTags: ["support", "privacy", "assistant", "recovery"],
        sourcePullRequests: [1284, 1305],
      },
    ],
  },
  {
    id: "2026-08-05",
    publishedOn: "2026-08-05",
    title: "More ways to connect, prepare, and finish",
    summary:
      "Apple Health relay wearables, next-group preparation, compact response tables, more reliable nutrition cards, clearer public links, and several setup, delivery, and maintenance recoveries all shipped together.",
    items: [
      {
        id: "apple-health-relay-wearables",
        kind: "feature",
        priority: 5,
        title: "Bring more wearables through Apple Health",
        summary:
          "Connections now includes guided Apple Health relay paths for Huawei Health, Xiaomi or Mi Fitness, Zepp or Amazfit, COROS, Suunto, and RingConn.",
        details:
          "Each card explains that Apple Health remains the sync source and opens the existing companion setup guide. Relay source cards never appear as direct connections or show a false disconnect state.",
        relevanceTags: ["wearables", "apple-health", "connections", "companion"],
        sourcePullRequests: [1316],
        tryIt: {
          href: "/connect",
          label: "Find your wearable",
        },
      },
      {
        id: "prepare-next-group",
        kind: "feature",
        priority: 5,
        title: "Prepare your next Murph group",
        summary:
          "A group owner can prepare one upcoming room for a short window, optionally choosing the room style and guidance before the new group starts.",
        details:
          "Preparation applies only to the next new room, expires after 30 minutes, and cannot modify an existing group or create ownership for someone else.",
        relevanceTags: ["groups", "setup", "assistant", "privacy"],
        sourcePullRequests: [1117],
      },
      {
        id: "tracked-compact-table-cards",
        kind: "feature",
        priority: 5,
        title: "Structured answers can arrive as compact tables",
        summary:
          "Murph can now return a small tracked or untracked table in a private iMessage card when rows and columns make the answer easier to scan.",
        details:
          "The card stays presentation-only unless the request has an explicit tracking contract. It keeps a deterministic text fallback and returns to the originating thread as one response.",
        relevanceTags: ["imessage", "cards", "tracking", "assistant"],
        sourcePullRequests: [1288, 1293, 1329],
      },
      {
        id: "connected-app-authorization-preview",
        kind: "feature",
        priority: 5,
        title: "See the connected-app handoff before leaving Murph",
        summary:
          "Before a connected-app authorization opens, Murph now shows a short first-party preview that explains the external handoff and lets you continue manually.",
        details:
          "The countdown pauses when the page is hidden, authorization does not start before the handoff is visible, and closing the preview leaves the existing connection flow unchanged.",
        relevanceTags: ["connected-apps", "authorization", "privacy", "web"],
        sourcePullRequests: [1320],
      },
      {
        id: "daily-nutrition-card-delivery",
        kind: "improvement",
        priority: 5,
        title: "Daily nutrition cards render in the conversation",
        summary:
          "Daily nutrition cards now use the supported iMessage layout, so the compact totals appear directly in the private conversation.",
        details:
          "The card keeps the date, logged-meal count, every available total, one exact saved goal and status, and a visible partial-totals marker when meal support is incomplete. Text fallback remains available when the card route cannot be used.",
        relevanceTags: ["nutrition", "imessage", "cards", "reliability"],
        sourcePullRequests: [1312],
      },
      {
        id: "mobile-one-time-contribution",
        kind: "improvement",
        priority: 5,
        title: "One-time group contributions fit on a phone",
        summary:
          "On mobile, the one-time group contribution flow now opens as a focused bottom drawer with the amount and next action in reach; desktop keeps the dialog treatment.",
        details:
          "Monthly sponsorship remains primary, a one-time contribution stays explicitly separate, and no payment starts until the contributor chooses the amount and continues.",
        relevanceTags: ["groups", "billing", "mobile", "accessibility"],
        sourcePullRequests: [1311],
      },
      {
        id: "official-local-alert-health-context",
        kind: "feature",
        priority: 5,
        title: "Murph can account for official local alerts",
        summary:
          "When heat, cold, or outdoor air quality matters, Murph can check the official alert for your location and use it as added health context.",
        details:
          "Murph uses the official service's location-specific alert instead of applying one temperature or air-quality threshold everywhere. An alert alone does not trigger outreach, unrelated hazards stay out of health reasoning, and a failed check does not block the rest of the answer.",
        relevanceTags: ["assistant", "weather", "air-quality", "recovery"],
        sourcePullRequests: [1307],
        tryIt: {
          label: "Ask about today's conditions",
          prompt:
            "I feel more tired than usual and planned an outdoor workout today. Check whether an official local alert should change my plan.",
        },
      },
      {
        id: "scheduled-reminder-authority",
        kind: "improvement",
        priority: 5,
        title: "Scheduled reminders keep their own approval",
        summary:
          "Editing or reviewing one scheduled reminder no longer borrows authority from another reminder or loses an independently approved occurrence.",
        details:
          "Each reminder keeps its own audience, schedule, and approval evidence. A review regression cannot silently send, suppress, or rewrite a different reminder.",
        relevanceTags: ["reminders", "automations", "consent", "reliability"],
        sourcePullRequests: [1317, 1323],
      },
      {
        id: "onboarding-and-group-activation-recovery",
        kind: "improvement",
        priority: 4,
        title: "Setup recovery stops at the right point",
        summary:
          "Onboarding follow-up now expires after three days, and a group join can recover after activation without replaying setup that already finished.",
        details:
          "The companion sync status also uses the server time for a trustworthy freshness comparison. Recovery resumes the existing activation and sync instead of starting a second one.",
        relevanceTags: ["onboarding", "groups", "companion", "reliability"],
        sourcePullRequests: [1309, 1314, 1321],
      },
      {
        id: "venice-usage-before-save",
        kind: "improvement",
        priority: 4,
        title: "Venice explains the usage tradeoff before save",
        summary:
          "The model choice now states, in shorter language, that Venice can use included AI capacity faster before you commit the setting.",
        details:
          "The explanation applies to future usage and keeps the actual model-rate accounting already introduced on the previous day.",
        relevanceTags: ["models", "venice", "usage", "settings"],
        sourcePullRequests: [1319, 1324],
      },
      {
        id: "feedback-starts-with-the-problem",
        kind: "improvement",
        priority: 4,
        title: "Product feedback starts with what went wrong",
        summary:
          "When you share product feedback, Murph now clarifies the underlying problem and impact before jumping to a proposed solution.",
        details:
          "The conversation stays user-facing and concise, and an escalation still requires the separate explicit support path.",
        relevanceTags: ["feedback", "assistant", "support", "product"],
        sourcePullRequests: [1290],
      },
      {
        id: "environment-panel-full-width",
        kind: "improvement",
        priority: 4,
        title: "Environment setup uses the full dashboard width",
        summary:
          "The empty Environment panel now lines up with the rest of the dashboard instead of sitting inside a second, narrower page cap.",
        details:
          "The existing voice walkthrough, chat alternative, report preview, desktop columns, and mobile stack keep their current behavior.",
        relevanceTags: ["environment", "dashboard", "accessibility", "web"],
        sourcePullRequests: [1330],
      },
      {
        id: "public-status-footer-link",
        kind: "improvement",
        priority: 3,
        title: "Murph's status page is easier to find",
        summary:
          "The public website footer now links directly to Murph's verified status page in a new tab.",
        relevanceTags: ["website", "status", "navigation", "reliability"],
        sourcePullRequests: [1328],
      },
      {
        id: "maintenance-without-global-pause",
        kind: "improvement",
        priority: 4,
        title: "Storage maintenance no longer needs a global pause",
        summary:
          "Murph can keep ordinary replies, saved conversations, attachments, and uploads available while its saved data moves safely.",
        details:
          "If Murph cannot confirm that the new storage is ready, the move stops safely. Messages already received remain available when the conversation resumes.",
        relevanceTags: ["reliability", "storage", "messaging", "maintenance"],
        sourcePullRequests: [1318],
      },
    ],
  },
  {
    id: "2026-08-04",
    publishedOn: "2026-08-04",
    title: "More control over data, models, and connections",
    summary:
      "You can bring a compatible model endpoint, pause health-data processing, ask for a nutrition card, disconnect one wearable source, and get clearer recovery across usage, device sync, physical notes, photos, and follow-up timing.",
    items: [
      {
        id: "custom-inference-endpoint",
        kind: "feature",
        priority: 5,
        title: "Bring your own model endpoint",
        summary:
          "Settings now lets you use Murph's managed models or a compatible custom endpoint for core replies in your personal conversation.",
        details:
          "Murph verifies a public HTTPS endpoint, encrypts its connection details, and never silently falls back to a managed model if the custom route fails. Murph's health tools and other hosted services keep their existing funding and privacy boundaries.",
        relevanceTags: ["assistant", "models", "settings", "privacy"],
        sourcePullRequests: [1202],
      },
      {
        id: "health-data-consent-controls",
        kind: "feature",
        priority: 5,
        title: "Pause health-data processing",
        summary:
          "Health data use in Settings now includes a consent-withdrawal flow that pauses health-data processing without locking you out of Settings, export, or account deletion.",
        details:
          "A confirmation explains the effect before anything changes. Processing stays paused until you explicitly choose to use Murph again and renew consent, including across wearable sync and assistant runtime paths.",
        relevanceTags: ["privacy", "consent", "health-data", "settings"],
        sourcePullRequests: [1215],
        tryIt: {
          href: "/settings/data-privacy",
          label: "Open privacy settings",
        },
      },
      {
        id: "daily-nutrition-cards",
        kind: "feature",
        priority: 5,
        title: "Ask for today's nutrition card",
        summary:
          "In a private conversation, you can ask for a daily nutrition card with the current totals for calories, protein, carbohydrates, fat, and fiber.",
        details:
          "When the date and data are clear, the card can also show an exact saved goal and status. Missing goals stay missing, uncertain dates fall back to a normal reply, and group or unrelated scheduled turns do not produce the card.",
        relevanceTags: ["nutrition", "imessage", "goals", "health-data"],
        sourcePullRequests: [1104, 1280],
        tryIt: {
          label: "Ask for today's nutrition card",
          prompt: "Show me today's nutrition card.",
        },
      },
      {
        id: "single-source-wearable-disconnect",
        kind: "feature",
        priority: 5,
        title: "Disconnect one wearable source at a time",
        summary:
          "The Connections page can now remove one selected wearable source without disconnecting your other sources or deleting their history.",
        details:
          "The chosen source keeps its imported history but stops future sync. A failed removal stays recoverable, and reconnect-required cards now expose the same source-specific action.",
        relevanceTags: ["wearables", "connect", "settings", "privacy"],
        sourcePullRequests: [1274],
        tryIt: {
          href: "/connect",
          label: "Manage connections",
        },
      },
      {
        id: "database-first-nutrition-estimates",
        kind: "improvement",
        priority: 5,
        title: "Food estimates start with label data",
        summary:
          "Murph now looks up a nutrition label or food-database match for each identifiable part of a meal before estimating its nutrients.",
        details:
          "Portions still come from the photo and conversation, while sauces, fats, drinks, and exact supplement labels stay explicit. A general estimate is used only when database and official-source lookup cannot resolve the food.",
        relevanceTags: ["nutrition", "meals", "images", "health-data"],
        sourcePullRequests: [1278],
      },
      {
        id: "physical-note-address-completion",
        kind: "improvement",
        priority: 5,
        title: "Physical notes need fewer address follow-ups",
        summary:
          "When you provide a destination for an approved physical note, Murph can temporarily complete a missing city, state, or ZIP code from the address you supplied.",
        details:
          "The lookup cannot discover where someone lives, saved prompts and notes never gain the address, and Murph's platform-owned return address stays separate from the recipient destination.",
        relevanceTags: ["notes", "mail", "privacy", "assistant"],
        sourcePullRequests: [1261, 1266],
      },
      {
        id: "capacity-without-message-estimates",
        kind: "improvement",
        priority: 4,
        title: "Capacity answers stay in percentages and dates",
        summary:
          "Murph no longer turns remaining AI capacity into a guessed number of messages, even when you ask how many replies are left.",
        details:
          "Usage answers use the known percentage, reset date, trial date, or day-level forecast instead. They do not pretend that differently sized requests consume a predictable message count.",
        relevanceTags: ["usage", "billing", "assistant", "settings"],
        sourcePullRequests: [1265],
      },
      {
        id: "venice-provider-rate-usage",
        kind: "improvement",
        priority: 4,
        title: "Venice usage reflects its provider rate",
        summary:
          "Replies sent through Venice now consume included AI capacity at the underlying provider rate instead of using the managed-model price.",
        details:
          "Settings explains that this choice can use capacity faster. The change applies to new usage only and does not reprice earlier replies.",
        relevanceTags: ["assistant", "models", "venice", "usage"],
        sourcePullRequests: [1277],
      },
      {
        id: "device-sync-artifact-retries",
        kind: "improvement",
        priority: 4,
        title: "Device sync retries transient write failures",
        summary:
          "A temporary failure while saving a replay-safe device-sync artifact now retries through the existing sync job instead of ending the import immediately.",
        details:
          "Only safe transient writes retry. Permanent errors still stop with their specific failure, and the retry does not create a second import or duplicate user action.",
        relevanceTags: ["wearables", "sync", "reliability", "health-data"],
        sourcePullRequests: [1269],
      },
      {
        id: "foreground-after-checkpoint-wake",
        kind: "improvement",
        priority: 4,
        title: "New messages keep priority after a wake",
        summary:
          "A newly accepted message now keeps foreground priority when it arrives just after Murph wakes from a saved checkpoint.",
        details:
          "The change is invisible when timing is normal. In the race it fixes, the new message reaches the ordinary reply path instead of waiting behind restored background work.",
        relevanceTags: ["messaging", "assistant", "reliability", "performance"],
        sourcePullRequests: [1273],
      },
      {
        id: "group-photo-reference-reuse",
        kind: "improvement",
        priority: 4,
        title: "Group photo references carry forward",
        summary:
          "Murph now keeps a bounded room index of captions, positions, and corrections for recent group photos, then checks it before asking for another upload.",
        details:
          "References stay tied to the conversation and do not use face recognition. Corrections can update which known photo the group means without turning the image into an identity record.",
        relevanceTags: ["groups", "images", "memory", "privacy"],
        sourcePullRequests: [1289],
      },
      {
        id: "usage-denials-preserve-pending-work",
        kind: "improvement",
        priority: 4,
        title: "Usage limits no longer turn into runtime errors",
        summary:
          "When managed AI usage is exhausted, accepted work stays safely pending instead of being mislabeled as a runtime failure during a background wake.",
        details:
          "Murph does not consume the conversation or call a metered model while access is denied. The existing usage message explains the block, and the existing continuation path can resume after capacity changes.",
        relevanceTags: ["usage", "reliability", "assistant", "messaging"],
        sourcePullRequests: [1283],
      },
    ],
  },
  {
    id: "2026-08-03",
    publishedOn: "2026-08-03",
    title: "Connected apps recover with a clearer next step",
    summary:
      "Large connected-app results now stay bounded and useful, so Murph can narrow the request or explain the real failure without losing the conversation.",
    items: [
      {
        id: "connected-app-results-stay-in-turn",
        kind: "improvement",
        priority: 5,
        title: "Oversized app results can be narrowed in place",
        summary:
          "When a connected app returns more data than one reply can safely use, Murph now compacts the result and can narrow or retry the request in the same turn.",
        details:
          "A genuinely failed app call keeps its specific safe error instead of looking like an oversized success. Raw service responses stay outside the model conversation.",
        relevanceTags: ["connected-apps", "assistant", "reliability", "privacy"],
        sourcePullRequests: [1259],
      },
    ],
  },
  {
    id: "2026-08-02",
    publishedOn: "2026-08-02",
    title: "Recovery that stops at the right moment",
    summary:
      "Phone transfer, group signup, contact setup, and physical-note delivery now recover from partial completion without repeating work that already succeeded.",
    items: [
      {
        id: "phone-transfer-recovery",
        kind: "improvement",
        priority: 5,
        title: "Phone transfer recovery recognizes success",
        summary:
          "Linking or changing your phone now repairs incomplete local setup while recognizing when the external transfer already finished.",
        details:
          "Murph stops retrying a terminal transfer, preserves the correct home-line route, retires a disposable source account only when it is safe, and shows the existing contact-support path when automatic repair cannot finish.",
        relevanceTags: ["phone", "settings", "onboarding", "reliability"],
        sourcePullRequests: [1191, 1255, 1267],
      },
      {
        id: "unknown-group-signup-recovery",
        kind: "feature",
        priority: 5,
        title: "An unknown group can start with signup",
        summary:
          "When someone who is not active yet messages Murph in a supported group, the group can receive one first-party signup link instead of reaching a dead end.",
        details:
          "The page handles signup only and does not let anyone claim a room or choose an owner. After activation, the next ordinary message continues through the existing group route without duplicate capacity or follow-up claims.",
        relevanceTags: ["groups", "signup", "onboarding", "messaging"],
        sourcePullRequests: [1221, 1257],
      },
      {
        id: "physical-note-claim-recovery",
        kind: "improvement",
        priority: 5,
        title: "Physical-note sends recover after partial completion",
        summary:
          "A physical note that was approved but stranded between claim and delivery can now resume without consuming a second complimentary send.",
        details:
          "Clear refusals explain whether the note needs approval, an address, or remaining eligibility. A retry reuses the existing claim and preserves the exact approved message.",
        relevanceTags: ["notes", "mail", "reliability", "privacy"],
        sourcePullRequests: [1260],
      },
      {
        id: "contact-card-line-recovery",
        kind: "improvement",
        priority: 4,
        title: "Contact setup does not stall on one unusable line",
        summary:
          "Contact-card setup now moves past an unusable unowned line and distinguishes that case from a complete line-inventory outage.",
        details:
          "A healthy available line can still finish setup. If no trustworthy inventory can be loaded, Murph surfaces the outage for recovery instead of silently choosing or retrying the wrong line.",
        relevanceTags: ["contacts", "phone", "onboarding", "reliability"],
        sourcePullRequests: [1244, 1253],
      },
    ],
  },
  {
    id: "2026-08-01",
    publishedOn: "2026-08-01",
    title: "More ways to finish what you started",
    summary:
      "Environment reports can finish and print, physical notes can leave the chat, support can receive a private escalation, and group, signup, reminder, connection, and reply flows keep more of their context.",
    items: [
      {
        id: "environment-processing-and-print",
        kind: "feature",
        priority: 5,
        title: "Finish, revisit, and print your Environment report",
        summary:
          "The Environment page now keeps checking a voice memo until processing finishes, reports progress without a manual reload, and offers a private print view beside Share.",
        details:
          "Signed-out members return to Environment after login. On iOS, the microphone-permission handoff keeps the walkthrough mounted, and moving the page to the background safely ends an active recording.",
        relevanceTags: ["environment", "voice", "privacy", "accessibility"],
        sourcePullRequests: [1228, 1238, 1251],
        tryIt: {
          href: "/environment",
          label: "Open Environment",
        },
      },
      {
        id: "physical-notes-from-chat",
        kind: "feature",
        priority: 5,
        title: "Send a physical note from your conversation",
        summary:
          "Murph can turn a generated image and an explicitly approved message into one complimentary physical note from an eligible conversation.",
        details:
          "Sending requires the postal destination and exact message authority. The physical-note delivery record does not store the postal address, artwork, note text, or image prompt; conversation history follows Murph's existing retention rules, and a retry cannot silently create another claim.",
        relevanceTags: ["notes", "mail", "images", "privacy"],
        sourcePullRequests: [1199, 1248],
      },
      {
        id: "direct-product-support-escalation",
        kind: "feature",
        priority: 5,
        title: "Ask Murph to escalate to product support",
        summary:
          "In a verified private conversation, an explicit request for product support can queue a de-identified escalation to the support team.",
        details:
          "Murph does not promise a ticket number or response time. Group or unverified support requests move to private Murph without an account-linked escalation, and Murph shares the support address in conversation only when asked for it.",
        relevanceTags: ["support", "assistant", "privacy", "settings"],
        sourcePullRequests: [1247],
      },
      {
        id: "calendar-aware-reminder-availability",
        kind: "feature",
        priority: 5,
        title: "Reminders can respect busy calendar time",
        summary:
          "A reminder with skip-when-busy or calendar-only availability can now use the busy timestamps from your connected calendar to decide whether to send.",
        details:
          "Calendar titles, attendees, locations, and descriptions never enter the model. If availability cannot be checked safely, the ordinary reminder sends instead of silently disappearing.",
        relevanceTags: ["reminders", "calendar", "privacy", "automations"],
        sourcePullRequests: [1204],
      },
      {
        id: "one-action-challenge-entry",
        kind: "feature",
        priority: 5,
        title: "One clear reaction can enter a challenge",
        summary:
          "A recent native reaction can now confirm the exact unchanged terms of a group challenge and move that participant into the finalized challenge in one action.",
        details:
          "The shortcut applies only when the participant, scope, terms, and timing all match. Ambiguous or changed terms still require the existing explicit confirmation.",
        relevanceTags: ["groups", "challenges", "reactions", "consent"],
        sourcePullRequests: [1217],
      },
      {
        id: "group-reactions-shape-room-memory",
        kind: "improvement",
        priority: 5,
        title: "Group reactions now shape room memory",
        summary:
          "Supported group reactions now become durable room evidence even when nobody sends another message afterward.",
        details:
          "Adds, removals, custom reactions, and bounded reaction summaries can help Murph learn what lands in the room without triggering a reply by themselves. Reaction evidence stays out of private member memory.",
        relevanceTags: ["groups", "reactions", "memory", "privacy"],
        sourcePullRequests: [1212],
      },
      {
        id: "group-casing-room-tone",
        kind: "feature",
        priority: 4,
        title: "A group can set Murph's casing style",
        summary:
          "A persistent request for sentence case or capitalization now moves the room toward a formal tone, while a persistent lowercase request moves it toward casual.",
        details:
          "A one-reply formatting request stays temporary. The preference belongs to the room rather than changing a participant's private conversation style.",
        relevanceTags: ["groups", "tone", "personalization", "conversation"],
        sourcePullRequests: [1239],
      },
      {
        id: "signup-handoffs-stay-on-course",
        kind: "improvement",
        priority: 5,
        title: "Signup returns to the place that invited you",
        summary:
          "Native companion signup now reuses the hosted onboarding flow, and a first web sign-in still reaches the welcome handoff even when texting created the member record earlier.",
        details:
          "Reacting to an eligible group invite can open one link-free private signup conversation. Consent and activation remain required, and returning members keep their existing destination instead of being sent through first-visit setup again.",
        relevanceTags: ["signup", "onboarding", "groups", "mobile"],
        sourcePullRequests: [1222, 1226, 1243],
      },
      {
        id: "wearable-connect-finish-and-recover",
        kind: "improvement",
        priority: 5,
        title: "Wearable connection returns finish itself",
        summary:
          "After you approve a wearable connection, the callback now completes automatically and returns to the Connections result without an extra confirmation screen.",
        details:
          "If setup fails, the notice explains what happened and offers the relevant next action: log in, try again, or contact support. The signed-out and successful paths keep their original destination.",
        relevanceTags: ["wearables", "connect", "onboarding", "reliability"],
        sourcePullRequests: [1252, 1256],
        tryIt: {
          href: "/connect",
          label: "Open Connections",
        },
      },
      {
        id: "late-followups-stay-eligible",
        kind: "improvement",
        priority: 5,
        title: "Late follow-ups still get their turn",
        summary:
          "A follow-up that arrives too late to affect the current answer now stays pending for the next ordinary reply instead of being recorded as already handled.",
        details:
          "Optional delegated work can also finish after the first reply and return when it is relevant to the next message. Neither path delays the current answer or invents a second background conversation.",
        relevanceTags: ["assistant", "conversation", "reliability", "delegation"],
        sourcePullRequests: [1218, 1219],
      },
      {
        id: "image-errors-explain-the-failure",
        kind: "improvement",
        priority: 4,
        title: "Image failures explain what happened",
        summary:
          "A failed image generation or group-avatar delivery now returns a safe, useful reason through the original conversation instead of ending with a vague failure.",
        details:
          "Documented service errors keep their actionable category without exposing raw responses. Murph does not automatically repeat an image request that may have already been accepted.",
        relevanceTags: ["images", "groups", "reliability", "messaging"],
        sourcePullRequests: [1216, 1227],
      },
      {
        id: "bounded-onboarding-followup",
        kind: "improvement",
        priority: 4,
        title: "Onboarding gets one useful follow-up",
        summary:
          "After signup, Murph can send one bounded follow-up with a single easy question when the conversation still needs a natural next step.",
        details:
          "The attempt is spread away from the signup moment, never retries forever, and does not turn into a nag sequence when you do not answer.",
        relevanceTags: ["onboarding", "conversation", "messaging", "reliability"],
        sourcePullRequests: [1203],
      },
      {
        id: "daily-wrong-line-redirect",
        kind: "improvement",
        priority: 4,
        title: "The wrong direct chat can point home again",
        summary:
          "If you message an old or non-home Murph line directly, that chat can send one short redirect per day with your current home number.",
        details:
          "The reminder is link-free, appears only after a new inbound message, and does not create scheduled outreach from the wrong line.",
        relevanceTags: ["phone", "messaging", "onboarding", "reliability"],
        sourcePullRequests: [1224],
      },
      {
        id: "dashboard-refresh-stays-in-place",
        kind: "improvement",
        priority: 4,
        title: "Dashboard refresh stays on the current page",
        summary:
          "Returning focus to the dashboard now refreshes account data in the background while keeping the current page mounted.",
        details:
          "The update no longer jumps through a blank or replacement state when the existing screen is already usable.",
        relevanceTags: ["dashboard", "settings", "performance", "accessibility"],
        sourcePullRequests: [1235],
      },
      {
        id: "faster-first-imessage-reply",
        kind: "improvement",
        priority: 4,
        title: "The first iMessage reply starts sooner",
        summary:
          "Murph now prewarms the reply service for instant-start conversations and begins the typing hint after durable work is accepted.",
        details:
          "The hint stops on failure and does not count as a message. The actual reply keeps the existing durable delivery path.",
        relevanceTags: ["imessage", "performance", "messaging", "reliability"],
        sourcePullRequests: [1246],
      },
      {
        id: "higher-group-daily-text-capacity",
        kind: "improvement",
        priority: 4,
        title: "Active group chats have more daily room",
        summary:
          "The daily safeguard for supported group chats now allows up to 400 inbound texts, twice the previous limit.",
        details:
          "The higher limit applies to group activity only. Personal-chat safeguards and the existing handling after the group limit remain unchanged.",
        relevanceTags: ["groups", "messaging", "usage", "reliability"],
        sourcePullRequests: [],
      },
    ],
  },
  {
    id: "2026-07-31",
    publishedOn: "2026-07-31",
    title: "A clearer view of home, stronger follow-through",
    summary:
      "Environment turns what Murph knows about your home into a private report and one-memo walkthrough. Group funding and access, link previews, reminders, usage, Venice replies, and delegated work all get clearer or more reliable paths.",
    items: [
      {
        id: "private-environment-report",
        kind: "feature",
        priority: 5,
        title: "See how your environment supports you",
        summary:
          "The new Environment page turns saved facts about sleep, air, light, recovery, and workspace into a private report with category notes, live local conditions, and an A–E audit once enough scoreable conditions are known.",
        details:
          "Missing or skipped facts never lower the grade, and optional equipment never counts against it. Each result explains what is known, what needs attention, and the next useful check.",
        relevanceTags: ["environment", "sleep", "workspace", "context"],
        sourcePullRequests: [573],
        tryIt: {
          href: "/environment",
          label: "Open Environment",
        },
      },
      {
        id: "environment-voice-walkthrough",
        kind: "feature",
        priority: 5,
        title: "Build the report with one voice memo",
        summary:
          "Walk Murph through five short topics in one recording. Murph privately extracts clear facts about your home and workspace, saves them to your vault, and refreshes the open report when processing finishes.",
        details:
          "A partial report asks only about useful missing details, while a complete report switches to a free-form update. Precise addresses are rejected, ambiguous details stay unknown, and the transcript is not added to conversation history.",
        relevanceTags: ["environment", "voice", "privacy", "context"],
        sourcePullRequests: [573],
      },
      {
        id: "native-link-previews",
        kind: "feature",
        priority: 5,
        title: "Links can arrive as native previews",
        summary:
          "In a supported existing chat, a reply with text or media followed by one HTTPS link can send the content first and the link as a native preview.",
        details:
          "A link-only reply can use one native link when it does not need a reply anchor. If the preview is definitively rejected, Murph sends the exact link as text, and retries preserve content that was already accepted.",
        relevanceTags: ["imessage", "links", "messaging", "reliability"],
        sourcePullRequests: [1110],
      },
      {
        id: "family-owner-usage-topups",
        kind: "feature",
        priority: 5,
        title: "Family owners can add usage for themselves",
        summary:
          "An active Family owner can choose Add usage from their own AI-usage row and select $5, $10, or $25 through the existing Family checkout.",
        details:
          "A fulfilled purchase starts a fresh display window at 0% used, and only later usage moves the meter. Each payment return stays with its exact owner or member surface instead of creating competing confirmations.",
        relevanceTags: ["family", "billing", "usage", "settings"],
        sourcePullRequests: [1198],
      },
      {
        id: "group-access-across-channels",
        kind: "feature",
        priority: 5,
        title: "Group access offers fit the current chat",
        summary:
          "A group can ask Murph to create or extend access through one action. Supported iMessage groups keep the native reaction path, while SMS, Telegram, scheduled turns, and standalone requests get the existing first-party link.",
        details:
          "Murph chooses the presentation from the trusted route, includes one usable access surface, and returns a truthful unavailable result when the route cannot be proven.",
        relevanceTags: ["groups", "sharing", "imessage", "telegram"],
        sourcePullRequests: [1184],
      },
      {
        id: "fund-groups-at-any-capacity",
        kind: "feature",
        priority: 5,
        title: "Fund a group whenever you choose",
        summary:
          "Anyone in an active hosted group can open its first-party funding page at any capacity. Unsponsored groups open monthly sponsorship, while other participants in sponsored groups can add a one-time contribution.",
        details:
          "An explicit request to fund, sponsor, contribute, or get the funding link no longer detours into referrals or claims that a healthy group needs funding. The active payer can manage sponsorship on the same page, and every payment still requires explicit confirmation and Stripe reconciliation.",
        relevanceTags: ["groups", "funding", "usage", "billing"],
        sourcePullRequests: [1207],
      },
      {
        id: "one-shot-reminders-survive-restart",
        kind: "improvement",
        priority: 5,
        title: "One-time reminders keep their place",
        summary:
          "A one-time reminder created near its scheduled minute now keeps a durable wake with the saved schedule, so ending or restarting the creating session cannot strand an active reminder.",
        details:
          "The current reply confirms the saved reminder without waiting on the best-effort wake signal. The scheduled message keeps its existing route, timing, and delivery checks.",
        relevanceTags: ["reminders", "automations", "reliability", "messaging"],
        sourcePullRequests: [1209],
      },
      {
        id: "venice-tool-compatible-replies",
        kind: "improvement",
        priority: 5,
        title: "Venice replies keep Murph's tools",
        summary:
          "Members who choose Venice can now receive Murph's normal tool-enabled reply instead of seeing typing end when the provider rejects the request shape.",
        details:
          "The model choice, tools, conversation, and delivery path stay the same. Murph translates only the exact supported tool envelope and rejects malformed or conflicting metadata before provider entry.",
        relevanceTags: ["assistant", "models", "venice", "reliability"],
        sourcePullRequests: [1200],
      },
      {
        id: "core-member-plan-name",
        kind: "improvement",
        priority: 4,
        title: "The direct member plan is now Core",
        summary:
          "Eligible group members now see Core in Settings, trial continuation, billing recovery, usage-limit messages, Clubs pricing, and private plan answers.",
        details:
          "Only the name changed. Core remains $3.50 per month with the same included usage, eligibility, billing transitions, assistant capability, and group continuity.",
        relevanceTags: ["plans", "billing", "settings", "groups"],
        sourcePullRequests: [1206],
      },
      {
        id: "usage-referrals-stay-current",
        kind: "improvement",
        priority: 4,
        title: "Usage says what remains and what is still moving",
        summary:
          "The usage meter now answers how much capacity remains, while waiting, active, final-checking, and reward-pending referrals stay in the current list until they are complete.",
        details:
          "A quiet Details row holds each referral's requirements and selection date. Only completed referrals and usage purchases move into History.",
        relevanceTags: ["usage", "referrals", "settings", "accessibility"],
        sourcePullRequests: [1194],
      },
      {
        id: "safe-group-stakes",
        kind: "improvement",
        priority: 4,
        title: "Safe group stakes keep their edge",
        summary:
          "Murph now judges a proposed group dare by the concrete act, so an ordinary timed stake or playful consequence can stay intact when it is safe and consensual.",
        details:
          "The wording alone does not trigger a veto. Real hazards, coercion, impairment, contraindications, or pressure through distress still get the narrow boundary they require.",
        relevanceTags: ["groups", "challenges", "humor", "safety"],
        sourcePullRequests: [1201],
      },
      {
        id: "experiment-progress-cards-fail-soft",
        kind: "improvement",
        priority: 4,
        title: "Experiment progress cards fail soft",
        summary:
          "Hosted experiment progress cards now keep rendering when optional biomarker-direction context is unavailable, using neutral mover sentiment instead of failing the whole request.",
        details:
          "The card visibly says when direction context was unavailable, and the same accessible description travels with the private image in supported iMessage and Telegram delivery.",
        relevanceTags: ["experiments", "progress", "accessibility", "reliability"],
        sourcePullRequests: [1208],
      },
      {
        id: "delegated-work-before-blocker",
        kind: "improvement",
        priority: 4,
        title: "Murph moves the work forward before asking",
        summary:
          "When you ask Murph to handle, choose, decide, or figure something out, it now completes everything useful that is independent of a blocker before asking for more input.",
        details:
          "If a texting reply still needs a decision-changing fact, Murph asks one highest-value question at the end. Delegation still cannot create new permission to spend, contact, publish, schedule, or take another external action.",
        relevanceTags: ["assistant", "planning", "decisions", "conversation"],
        sourcePullRequests: [1214],
      },
    ],
  },
  {
    id: "2026-07-30",
    publishedOn: "2026-07-30",
    title: "More ways through, less waiting around",
    summary:
      "Capped group sponsorship joins the ways to get more usage, experiments can end in more than a number, and group conversations gain sharper voice, GIF, name, and app-download context. Sign-in, checkout, wearable setup, and cold replies all get a cleaner way through.",
    items: [
      {
        id: "capped-monthly-group-sponsorship",
        kind: "feature",
        priority: 5,
        title: "Sponsor a chat up to a monthly maximum",
        summary:
          "A current participant can authorize up to $5, $10, or $20 per month for a group. Murph starts with one $5 purchase and makes another $5 purchase only when the group needs capacity and the private maximum still allows it.",
        details:
          "The sponsor can privately change, pause, resume, recover, or cancel the authorization. Unused purchased credit stays with the group across sponsorship periods, automatic refills stay silent, and a separate one-time contribution remains available.",
        relevanceTags: ["groups", "billing", "usage", "sponsorship"],
        sourcePullRequests: [],
      },
      {
        id: "usage-credit-without-message-estimates",
        kind: "improvement",
        priority: 4,
        title: "Usage credit is shown without message estimates",
        summary:
          "Personal, Family, and group funding now present dollar-denominated usage credit without converting it into an approximate number of messages.",
        details:
          "Actual model and tool costs vary, so the credit amount is the durable financial truth. Group participants see only whether Murph is sponsored, while exact charges, pending purchases, and monthly maximums stay private to the sponsor.",
        relevanceTags: ["billing", "usage", "groups", "privacy"],
        sourcePullRequests: [],
      },
      {
        id: "usage-options-together",
        kind: "feature",
        priority: 5,
        title: "See every way to get more usage",
        summary:
          "Ask Murph how to get more usage and it now checks the available plan, top-up, group funding, and referral options together. Settings also shows recent credits and each current or completed group referral.",
        details:
          "Choosing one or both group referral options remains explicit. Each tracks and can be cancelled independently, and an option past its action deadline reads as final activity being checked rather than still actionable.",
        relevanceTags: ["usage", "credits", "referrals", "settings"],
        sourcePullRequests: [1120, 1136, 1138, 1157],
        tryIt: {
          label: "Ask about more usage",
          prompt: "How can I get more Murph usage?",
        },
      },
      {
        id: "open-ended-experiment-outcomes",
        kind: "feature",
        priority: 5,
        title: "Experiments can end in more than a number",
        summary:
          "Murph can now save custom experiments with numeric, photo, document, or structured-review outcomes when the intervention, capture route, and review timing are clear.",
        details:
          "Numeric outcomes use their declared comparison. Qualitative evidence gets an honest before-and-after review receipt instead of a made-up numeric effect, and incomplete evidence stays recoverable.",
        relevanceTags: ["experiments", "results", "photos", "documents"],
        sourcePullRequests: [1094],
      },
      {
        id: "core-reply-provider-choice",
        kind: "feature",
        priority: 4,
        title: "Choose the provider for core replies",
        summary:
          "Eligible personal members can choose OpenAI or Venice beneath the Luna, Terra, and Sol model choices in Settings, then save both choices together.",
        details:
          "The compact setting always says which provider is saved and when a draft will take effect. The choice changes future core replies only; specialized tools keep their own managed providers.",
        relevanceTags: ["assistant", "models", "settings", "providers"],
        sourcePullRequests: [1114, 1152],
      },
      {
        id: "schoolwork-conversation-help",
        kind: "feature",
        priority: 4,
        title: "Bring Murph your schoolwork",
        summary:
          "Murph can now help with assignments, essays, exam questions, drafts, and educational code in the current private or group conversation.",
        details:
          "The boundary follows the purpose of the request: schoolwork is in scope even when the subject is professional, while production code, client deliverables, and operational work stay out.",
        relevanceTags: ["assistant", "schoolwork", "learning", "groups"],
        sourcePullRequests: [1143],
      },
      {
        id: "group-voice-only-punchlines",
        kind: "feature",
        priority: 4,
        title: "Some group punchlines can be just a voice memo",
        summary:
          "When a group clearly keeps a playful jab going, Murph may answer with one short, self-deprecating voice memo and no duplicate text.",
        details:
          "A stop request, a correction, a human-owned beat, or ambiguous hostility still means silence or a plain reply. Saved Humor 0 disables the unprompted sarcastic memo.",
        relevanceTags: ["groups", "voice", "humor", "messaging"],
        sourcePullRequests: [1141, 1144],
      },
      {
        id: "animated-gif-filmstrips",
        kind: "feature",
        priority: 4,
        title: "Murph can see the beat inside a GIF",
        summary:
          "Animated GIFs sent through a supported iMessage conversation now become a compact left-to-right filmstrip that Murph can inspect in the ordinary reply.",
        details:
          "Frame selection follows playback time so held reactions and punchlines survive. Malformed or oversized animations keep the existing unavailable-attachment path and are not stored.",
        relevanceTags: ["imessage", "gifs", "images", "assistant"],
        sourcePullRequests: [1140],
      },
      {
        id: "ios-app-link-in-chat",
        kind: "improvement",
        priority: 5,
        title: "Get the iPhone app link right in chat",
        summary:
          "Ask Murph how to download the iPhone app in a private or group conversation and it now shares the canonical App Store listing in the same reply.",
        details:
          "The public download link can be shared with the room, while personal sign-in, Apple Health authorization, and wearable setup still stay private or in the app.",
        relevanceTags: ["ios", "groups", "download", "assistant"],
        sourcePullRequests: [1150],
      },
      {
        id: "time-aware-immediate-advice",
        kind: "improvement",
        priority: 5,
        title: "Advice now knows what time it is",
        summary:
          "In a private hosted chat, Murph now uses the current time with your saved timezone before suggesting an immediate meal, workout, caffeine choice, or bedtime step.",
        details:
          "Group Murph can reason about the room's current clock without treating the room timezone as any participant's personal local time.",
        relevanceTags: ["assistant", "time", "recommendations", "context"],
        sourcePullRequests: [1121],
      },
      {
        id: "group-bursts-one-turn",
        kind: "improvement",
        priority: 5,
        title: "Group bursts become one named conversation",
        summary:
          "Several group messages arriving together now become one natural Murph turn and one reply, with safe participant names used naturally when they are available.",
        details:
          "Names remain presentation help, never identity or permission. Explicit alternatives stay visible, and participant-specific actions still resolve from the exact source message.",
        relevanceTags: ["groups", "assistant", "names", "messaging"],
        sourcePullRequests: [1032, 1133],
      },
      {
        id: "homepage-auth-stays-usable",
        kind: "improvement",
        priority: 5,
        title: "Sign-in stays usable while auth wakes up",
        summary:
          "Opening Signup or Log in from a cold homepage now shows the ordinary phone, Telegram, and email form immediately instead of replacing it with an inert loading state.",
        details:
          "The chosen method becomes busy at once, waits for the shared auth runtime when needed, and keeps the same action in place through account setup and consent.",
        relevanceTags: ["signup", "login", "homepage", "reliability"],
        sourcePullRequests: [1127, 1154],
      },
      {
        id: "wearable-connect-owner-confirmation",
        kind: "improvement",
        priority: 5,
        title: "Wearable setup finishes where it started",
        summary:
          "A hosted wearable connection now returns to the same signed-in browser that started it and waits for an explicit Finish connection before attaching the account.",
        details:
          "Adding or retrying one source leaves established sources active. A pending or disconnected source stays inert until the owner-bound confirmation succeeds.",
        relevanceTags: ["wearables", "connect", "privacy", "reliability"],
        sourcePullRequests: [1059],
      },
      {
        id: "checkout-resumes-one-session",
        kind: "improvement",
        priority: 5,
        title: "Checkout picks up the same payment",
        summary:
          "Starting or retrying standard or Pulse Checkout now returns to the same open Stripe session instead of creating a competing payment path.",
        details:
          "Only the first valid completion can become the subscription. Conflicting, stale, or ambiguous ownership keeps the existing recovery guidance rather than starting another charge.",
        relevanceTags: ["billing", "checkout", "subscriptions", "reliability"],
        sourcePullRequests: [1041],
      },
      {
        id: "group-newsletters-compose-once",
        kind: "improvement",
        priority: 4,
        title: "Group newsletters compose once and keep delivering",
        summary:
          "Scheduled group newsletters now use the seven completed local days before the run, regardless of weekday, and continue delivery from one accepted edition.",
        details:
          "A restart or later receipt repair no longer recomposes the newsletter. If no usable completed-day stats exist, the edition says only that.",
        relevanceTags: ["groups", "newsletters", "email", "reliability"],
        sourcePullRequests: [1128],
      },
      {
        id: "group-sponsorship-cleaner-finish",
        kind: "improvement",
        priority: 4,
        title: "One-time group contributions have a cleaner finish",
        summary:
          "The one-time contribution dialog keeps optional context under Add a note and turns verified success into a clear receipt with Open Messages.",
        details:
          "Amount choice, payment verification, recovery, and group-credit delivery keep their existing owners. The receipt stays honest that Messages opens at the app level.",
        relevanceTags: ["groups", "billing", "usage", "design"],
        sourcePullRequests: [1134, 1137, 1163],
      },
      {
        id: "cold-replies-start-sooner",
        kind: "improvement",
        priority: 4,
        title: "Cold replies start sooner",
        summary:
          "When a supported message wakes a stopped hosted Murph, it can begin warming up while the message finishes arriving, shortening the cold path before the same reply starts.",
        details:
          "The reply, conversation history, model, and delivery path stay the same. If the early start cannot be reused safely, Murph falls back to the ordinary startup path.",
        relevanceTags: ["assistant", "messaging", "latency", "reliability"],
        sourcePullRequests: [1149],
      },
      {
        id: "obscure-group-references-grounded",
        kind: "improvement",
        priority: 3,
        title: "Murph checks the obscure reference before joking",
        summary:
          "In a playful group turn, Murph can do one brief public lookup when it needs the premise or vocabulary for a specific reference-native reply.",
        details:
          "Known references add no lookup. If the reference stays unresolved, Murph replies plainly instead of bluffing, and it never turns the joke into a research summary.",
        relevanceTags: ["groups", "humor", "research", "assistant"],
        sourcePullRequests: [1132],
      },
    ],
  },
  {
    id: "2026-07-29",
    publishedOn: "2026-07-29",
    title: "Corrections that carry forward",
    summary:
      "iMessage edits become real corrections, dense reminders become a natural reply loop, group challenges gain team and multi-metric scorecards, Telegram can hand off the right iMessage line, and onboarding, clubs, group context, images, experiments, and the public site all get clearer.",
    items: [
      {
        id: "post-onboarding-choice-point",
        kind: "feature",
        priority: 5,
        title: "Murph circles back once after onboarding",
        summary:
          "Around three weeks after answered onboarding, Murph can send one low-pressure question about what feels worth improving, understanding, or handling now, or stay quiet when the context is not useful enough.",
        details:
          "It is a one-time choice point, not a recurring nudge. Existing eligible members get one future catch-up rather than an immediate late message, and nothing changes until they reply.",
        relevanceTags: ["onboarding", "assistant", "follow-up", "goals"],
        sourcePullRequests: [1061],
      },
      {
        id: "additive-group-challenge-scorecards",
        kind: "feature",
        priority: 5,
        title: "Group challenges can score the game you meant",
        summary:
          "Murph can now run individual, team, or whole-group challenges with up to five additive scoring components, including weighted combinations such as steps, logged protein, and qualifying workouts.",
        details:
          "Rules and team membership freeze before scoring. Missing data stays visibly partial instead of becoming zero, and cumulative challenges can roll forward without rewriting earlier results.",
        relevanceTags: ["groups", "challenges", "scoring", "wearables"],
        sourcePullRequests: [1097],
      },
      {
        id: "dense-reminders-become-conversation",
        kind: "improvement",
        priority: 5,
        title: "Frequent reminders become one conversation",
        summary:
          "When you ask for several same-purpose reminders in one day, Murph can offer one finite check-in loop that asks naturally about the previous action while cueing the current one.",
        details:
          "It carries forward at most one unresolved occurrence, never builds reminder debt, and goes quiet after one unanswered combined check-in until you re-engage.",
        relevanceTags: ["reminders", "automation", "assistant", "messaging"],
        sourcePullRequests: [1116],
      },
      {
        id: "clubs-challenge-pilot-page",
        kind: "feature",
        priority: 4,
        title: "Club challenges have a home",
        summary:
          "The Clubs page explains collective, team, and head-to-head challenges, shows how iMessage and supported wearables keep standings current, and makes it easy to email Murph to start.",
        details:
          "Organizers can preview setup, scoring, private member support, and launch details without a spreadsheet. The page stays public, and the email address remains visible if a mail app cannot open.",
        relevanceTags: ["clubs", "groups", "challenges", "web"],
        sourcePullRequests: [1098, 1105, 1115],
        tryIt: {
          href: "/clubs",
          label: "Explore club challenges",
        },
      },
      {
        id: "group-chat-title-on-demand",
        kind: "feature",
        priority: 4,
        title: "Murph can read the room name",
        summary:
          "When the current group title matters, Murph can now read it on demand and carry the exact name into a new-group setup instead of guessing.",
        details:
          "Missing, synthetic, or unavailable titles stay unnamed, and the title is treated as display text rather than an instruction.",
        relevanceTags: ["groups", "assistant", "messaging", "setup"],
        sourcePullRequests: [1088],
      },
      {
        id: "telegram-imessage-contact-handoff",
        kind: "feature",
        priority: 4,
        title: "Ask Telegram for your iMessage number",
        summary:
          "In a private Telegram chat, ask Murph for its iMessage number and it can return your existing assigned line or reserve one healthy line for the exact verified phone on your account.",
        details:
          "A success names the masked phone that should send the first iMessage. Email-only, mismatched-phone, or unavailable-capacity cases keep Telegram working and point to Settings when account proof needs attention.",
        relevanceTags: ["telegram", "imessage", "messaging", "setup"],
        sourcePullRequests: [1103],
      },
      {
        id: "imessage-edits-become-corrections",
        kind: "improvement",
        priority: 5,
        title: "Edited iMessages become real corrections",
        summary:
          "When you edit a message, Murph can use the corrected wording in the active or next turn instead of silently keeping the first version.",
        details:
          "If Murph already answered, it follows up only when the edit materially changes the answer or action. Typo-only edits stay quiet.",
        relevanceTags: ["imessage", "assistant", "messaging", "reliability"],
        sourcePullRequests: [1085],
      },
      {
        id: "group-participant-changes-in-context",
        kind: "improvement",
        priority: 4,
        title: "Group joins and leaves reach the next real turn",
        summary:
          "When someone is added to or removed from a supported iMessage group, Murph can carry that bounded context into the next ordinary message instead of losing the change or announcing it on its own.",
        details:
          "Duplicate events do not restage it, and optional contact labels remain advisory rather than identity.",
        relevanceTags: ["groups", "assistant", "messaging", "context"],
        sourcePullRequests: [1100],
      },
      {
        id: "confident-image-generation-status",
        kind: "improvement",
        priority: 4,
        title: "Image requests sound underway",
        summary:
          "After accepting a direct image request, Murph now says it is making the image and that the result should return separately, without an awkward success caveat.",
        details:
          "Simple requests may be described as taking about a minute. The existing background result and failure paths remain in charge.",
        relevanceTags: ["images", "assistant", "messaging", "copy"],
        sourcePullRequests: [1099],
      },
      {
        id: "home-experiment-history-hierarchy",
        kind: "improvement",
        priority: 3,
        title: "Experiment history leads with the result",
        summary:
          "Completed experiment cards on Home now give the lead result more space and tuck supporting results into a compact ledger, making history faster to scan without hiding any comparable result.",
        relevanceTags: ["experiments", "home", "results", "design"],
        sourcePullRequests: [1093],
      },
      {
        id: "homepage-private-murph-first",
        kind: "improvement",
        priority: 3,
        title: "The homepage starts with private Murph",
        summary:
          "The homepage now opens with one private health question and evidence-backed answer before showing group challenges, so Murph's one-to-one role is clear first.",
        details:
          "Reduced-motion visitors see the complete private exchange immediately, and the group story remains as the second act.",
        relevanceTags: ["homepage", "assistant", "privacy", "design"],
        sourcePullRequests: [1090],
      },
      {
        id: "conflicting-contact-aliases-preserved",
        kind: "improvement",
        priority: 2,
        title: "Conflicting contact names stay visible",
        summary:
          "When several shared contact cards use different safe names for the same phone, Murph can now keep up to four explicit alternatives instead of dropping the name entirely.",
        details:
          "The alternatives remain unverified display help and never become identity or membership authority.",
        relevanceTags: ["contacts", "groups", "iphone", "privacy"],
        sourcePullRequests: [1087],
      },
    ],
  },
  {
    id: "2026-07-28",
    publishedOn: "2026-07-28",
    title: "A first text that goes somewhere",
    summary:
      "Eligible new people can start Murph from one iMessage, generated media stays on the private path, and group sharing, sponsorship, recovery, challenge setup, usage, and image requests all have cleaner ways through.",
    items: [
      {
        id: "imessage-instant-start",
        kind: "feature",
        priority: 5,
        title: "Start Murph with one iMessage",
        summary:
          "Eligible new people in supported launch markets can text Murph a normal question and receive the answer in the same thread while a full 14-day Pulse trial starts behind the scenes.",
        details:
          "The path is limited to direct iMessage and one verified line. Unsupported messages, unsafe admission, or enrollment trouble keep the existing signup-link fallback.",
        relevanceTags: ["imessage", "onboarding", "pulse", "messaging"],
        sourcePullRequests: [1030, 1079],
      },
      {
        id: "current-sender-group-disclosure",
        kind: "feature",
        priority: 5,
        title: "Tell the group about your own data, once",
        summary:
          "In an authenticated group, a participant can ask Murph to share a specific piece of their own private context with that exact room, without setting up a standing group permission.",
        details:
          "The request expires within ten minutes, runs through an isolated private read and disclosure review, and grants no future access.",
        relevanceTags: ["groups", "privacy", "sharing", "assistant"],
        sourcePullRequests: [1053],
      },
      {
        id: "join-offer-private-continuation",
        kind: "feature",
        priority: 4,
        title: "Like the join offer, then continue privately",
        summary:
          "An eligible nonmember who likes a group's ordinary join offer now gets one short private opener. Replying returns the phone-bound link for that same group.",
        details:
          "Nothing extra is announced in the room, and there is no automated follow-up sequence.",
        relevanceTags: ["groups", "onboarding", "reactions", "messaging"],
        sourcePullRequests: [932],
      },
      {
        id: "group-sponsorship-moments",
        kind: "feature",
        priority: 4,
        title: "Sponsor the room and make it a bit",
        summary:
          "A current participant can make one $5, $10, or $20 contribution, add an optional public alias or note, and turn a larger one-time contribution into a short-lived running bit.",
        details:
          "Verified payment adds ordinary group usage credit first. Murph then sends one short original sponsor song in that group; the optional creative moment never controls the credit.",
        relevanceTags: ["groups", "billing", "usage", "music"],
        sourcePullRequests: [1026, 1135],
      },
      {
        id: "generated-media-private-path",
        kind: "improvement",
        priority: 5,
        title: "Generated media takes the private path",
        summary:
          "Generated images and experiment result cards now stay in the member vault and travel through private message attachments instead of public asset links.",
        details:
          "Group-avatar updates use a short-lived opaque handoff only for the immediate import. Signed-in experiment participants keep the explicit browser Share or Download flow.",
        relevanceTags: ["images", "experiments", "privacy", "messaging"],
        sourcePullRequests: [966],
      },
      {
        id: "saved-card-usage-topups",
        kind: "improvement",
        priority: 5,
        title: "Saved cards make usage top-ups quicker",
        summary:
          "Eligible personal members and Family owners topping up their own seat can ask Murph for the right page, choose $5, $10, or $25, and use one reusable saved card when available.",
        details:
          "The amount is never preselected. Card authentication or collection falls back to secure checkout, and only verified payment adds usage.",
        relevanceTags: ["billing", "usage", "family", "settings"],
        sourcePullRequests: [1052, 1106],
      },
      {
        id: "overall-ai-usage-bar",
        kind: "improvement",
        priority: 4,
        title: "One AI usage bar shows everything available",
        summary:
          "Settings now combines unused monthly allowance and added or earned usage into one AI usage bar, so a top-up or referral visibly moves the same bar backward.",
        details:
          "The recurring reset date stays visible while the internal allowance and credit-source split stays private.",
        relevanceTags: ["billing", "usage", "settings", "privacy"],
        sourcePullRequests: [1047],
      },
      {
        id: "group-access-recovery-stays-private",
        kind: "improvement",
        priority: 4,
        title: "Group access recovery stays private",
        summary:
          "If a recognized member cannot activate Murph in a group because setup, billing, or a trial needs attention, Murph now sends the recovery step privately when a safe direct route exists.",
        details:
          "The room never sees account state. Unknown or unsafe cases stay silent or get account-neutral group guidance.",
        relevanceTags: ["groups", "access", "billing", "privacy"],
        sourcePullRequests: [1043],
      },
      {
        id: "group-humans-get-first-refusal",
        kind: "improvement",
        priority: 4,
        title: "People get first refusal in the group",
        summary:
          "Murph now gives friends the floor when a message is a personal artifact, shared memory, relationship question, or human-to-human beat, even when it ends with a question mark.",
        details:
          "A direct ask to Murph still gets a brief answer. If Murph lacks authority to answer a personal fact, it says so plainly instead of guessing or turning the correction into a bit.",
        relevanceTags: ["groups", "assistant", "messaging", "privacy"],
        sourcePullRequests: [1060, 1080],
      },
      {
        id: "room-native-group-challenges",
        kind: "improvement",
        priority: 4,
        title: "Group challenges start with the room",
        summary:
          "A loose challenge idea now starts from the group's existing energy and habits instead of a generic intake or an unrequested exercise program.",
        details:
          "Concrete games can start immediately, human-owned stakes come first, and photos or cast material stay optional.",
        relevanceTags: ["groups", "challenges", "assistant", "setup"],
        sourcePullRequests: [1062],
      },
      {
        id: "supportive-proactive-health-outreach",
        kind: "improvement",
        priority: 4,
        title: "Health outreach helps without grading",
        summary:
          "Weekly and monthly health outreach now favors verified progress, meaningful context, and useful questions over step-score judgment, tracking guilt, or generic nudges.",
        details:
          "Silence is the default when evidence or goal relevance is weak. Zone 2 experiments can also count qualifying walking, cycling, rowing, and elliptical sessions.",
        relevanceTags: ["assistant", "insights", "experiments", "activity"],
        sourcePullRequests: [1055],
      },
      {
        id: "image-requests-stay-one-request",
        kind: "improvement",
        priority: 3,
        title: "Slow image requests stay one request",
        summary:
          "If you ask where an image is, Murph now reports whether the original is still generating or queued instead of starting a duplicate.",
        details:
          "After delivery, later turns also remember that the prior reply included an image, so Murph does not contradict what arrived.",
        relevanceTags: ["images", "assistant", "messaging", "reliability"],
        sourcePullRequests: [1065, 1078],
      },
      {
        id: "named-voice-memo-overrides",
        kind: "improvement",
        priority: 3,
        title: "One-off voice requests use the voice you named",
        summary:
          "Ask for a named Murph voice for one voice memo and Murph now resolves that voice correctly, including a save-and-demo in the same turn.",
        details:
          "A one-off override does not change your saved voice unless you ask to save it.",
        relevanceTags: ["voice", "assistant", "personalization", "messaging"],
        sourcePullRequests: [1054],
      },
    ],
  },
  {
    id: "2026-07-27",
    publishedOn: "2026-07-27",
    title: "Reminders on your time, not ours",
    summary:
      "iMessage reminders can now land at the overnight time you actually ask for, the iPhone app can recover updated consent without sending you to the web, and long-running group chats keep their maintenance out of the conversation.",
    items: [
      {
        id: "overnight-imessage-reminders",
        kind: "improvement",
        priority: 5,
        title: "Midnight means midnight",
        summary:
          "Ask Murph for an iMessage reminder at 2 AM and it now saves the time you chose instead of warning you away, suggesting a nearby hour, or asking for one more confirmation.",
        details:
          "Your own quiet-hour settings and Murph's existing pacing, line-health, consent, and routing safeguards still apply.",
        relevanceTags: ["reminders", "imessage", "automation", "messaging"],
        sourcePullRequests: [1027],
      },
      {
        id: "iphone-consent-recovery",
        kind: "improvement",
        priority: 5,
        title: "Missing launch consent stays inside the iPhone app",
        summary:
          "If launch consent is missing, the Murph app now presents the current documents and one clear I Consent action, then resumes the setup or sync flow that was waiting.",
        details:
          "Home, Settings, legal links, account deletion, and sign-out remain available. Health and automatic meal access pause only when the account has no complete historical consent.",
        relevanceTags: ["iphone", "consent", "onboarding", "privacy"],
        sourcePullRequests: [1022],
      },
      {
        id: "group-compaction-stays-quiet",
        kind: "improvement",
        priority: 4,
        title: "Long group chats tidy themselves up quietly",
        summary:
          "When a group conversation gets very long, Murph now compacts its working thread during idle time and keeps the synthetic maintenance update out of the room.",
        details:
          "The final reply, real progress, errors, and usage accounting still arrive normally. Personal conversations keep their existing in-turn compaction update.",
        relevanceTags: ["groups", "assistant", "performance", "messaging"],
        sourcePullRequests: [1019],
      },
    ],
  },
  {
    id: "2026-07-26",
    publishedOn: "2026-07-26",
    title: "Group memory, clearer recovery",
    summary:
      "Group Murph can hold onto a room's rhythm, signup and access problems now answer with a way forward, and billing, meal capture, and deletion recover without leaving people stranded.",
    items: [
      {
        id: "group-room-memory",
        kind: "feature",
        priority: 5,
        title: "Group Murph remembers the room",
        summary:
          "A group chat can now keep one small, room-local set of recurring bits, preferences, and house rules so Murph does not have to rediscover the room every time.",
        details:
          "The current conversation, safety, and explicit room settings always outrank these fallible notes. The group can correct or forget them, and Murph uses a callback only when it naturally fits.",
        relevanceTags: ["groups", "assistant", "memory", "personalization"],
        sourcePullRequests: [950],
      },
      {
        id: "contact-card-after-invite-signup",
        kind: "feature",
        priority: 4,
        title: "Murph's contact card arrives after invite signup",
        summary:
          "After a delivered iMessage invite signup reply, Murph now shares the verified line's native contact card in that direct or group thread so the new member can save it without hunting for it.",
        details:
          "The automatic share stays on the line that delivered the reply and remains replay-safe across retries.",
        relevanceTags: ["onboarding", "contacts", "groups", "messaging"],
        sourcePullRequests: [915],
      },
      {
        id: "secondary-onboarding-outcomes-visible",
        kind: "improvement",
        priority: 5,
        title: "Setup problems answer with the next step",
        summary:
          "An expired Family invite, an unavailable group connection, a messy Telegram link, or a setup link that was already sent now gets a plain reply instead of looking like Murph ignored the message.",
        details:
          "Direct chats can receive the account-specific recovery step. Group replies stay generic so Murph does not disclose anyone's membership or billing state to the room.",
        relevanceTags: ["onboarding", "messaging", "telegram", "reliability"],
        sourcePullRequests: [957],
      },
      {
        id: "recognized-members-always-get-an-answer",
        kind: "improvement",
        priority: 5,
        title: "Paused and lapsed members get a recovery reply",
        summary:
          "When a paused or lapsed member texts Murph from a recognized direct chat, Murph now answers with the existing access or subscription recovery path.",
        details:
          "This shared recovery covers billing-access states across eligible iMessage and Telegram direct chats. Suspended accounts keep their existing channel-specific handling.",
        relevanceTags: ["messaging", "billing", "access", "reliability"],
        sourcePullRequests: [954],
      },
      {
        id: "group-funding-speaks-in-messages",
        kind: "improvement",
        priority: 4,
        title: "Group top-ups speak in messages, not credit",
        summary:
          "The group funding page now says how many messages each one-time top-up is expected to add, with the price secondary and the middle option ready to choose.",
        details:
          "The counts stay approximate because real model and media costs vary, but every funding surface now derives them from the same estimate.",
        relevanceTags: ["groups", "billing", "usage", "copy"],
        sourcePullRequests: [],
      },
      {
        id: "included-usage-follows-plan",
        kind: "improvement",
        priority: 4,
        title: "Included usage now follows the plan",
        summary:
          "Paid Pulse and Edge access now derives included monthly AI usage from the recurring plan price instead of a separate fixed allowance.",
        details:
          "The included amount is 80% of the catalog price for the member's billing mode and tier. An open period keeps any higher existing amount until renewal, and newly created group chats begin with their own $7.50 included limit.",
        relevanceTags: ["billing", "usage", "plans", "groups"],
        sourcePullRequests: [962],
      },
      {
        id: "pulse-return-survives-sign-out",
        kind: "improvement",
        priority: 4,
        title: "A paid Pulse return survives sign-out",
        summary:
          "If you finish the Pulse payment flow and return to Settings in a signed-out browser, Murph now preserves the signed handoff through authentication and resumes it for the right member.",
        details:
          "Expired, duplicated, altered, or wrong-member returns stay inert.",
        relevanceTags: ["billing", "pulse", "auth", "settings"],
        sourcePullRequests: [955],
      },
      {
        id: "meal-enrollment-survives-stale-consent",
        kind: "improvement",
        priority: 4,
        title: "Automatic meal capture survives a document refresh",
        summary:
          "An active member who already granted both launch permissions can now turn on automatic meal capture even when a newer legal-document version made the recorded acceptance stale.",
        details:
          "No consent or partial consent still fails closed, and every upload continues to recheck current access and the historical grants.",
        relevanceTags: ["meals", "iphone", "consent", "reliability"],
        sourcePullRequests: [1003],
      },
      {
        id: "grok-long-answers-explain-the-cutoff",
        kind: "improvement",
        priority: 3,
        title: "Long X answers keep more of the useful part",
        summary:
          "Murph now keeps up to twice as much of a long Grok answer about X and says plainly when the returned result was cut short.",
        details:
          "The unverified answer remains isolated from Murph's own instructions, and Murph does not invent missing posts, links, or authors to fill the gap.",
        relevanceTags: ["assistant", "search", "x", "reliability"],
        sourcePullRequests: [945],
      },
      {
        id: "account-deletion-cleanup-retries",
        kind: "improvement",
        priority: 3,
        title: "Account deletion cleanup keeps its place",
        summary:
          "If cleanup is interrupted after account deletion begins, Murph now retains the exact remaining work and safely resumes it instead of losing ownership between systems.",
        details:
          "Stale billing or access events cannot quietly restore a deleted member while cleanup is still draining.",
        relevanceTags: ["privacy", "account", "deletion", "reliability"],
        sourcePullRequests: [974, 1160],
      },
      {
        id: "destructive-requests-check-targets",
        kind: "improvement",
        priority: 3,
        title: "Destructive requests check the target first",
        summary:
          "Before deleting or overwriting something, Murph is now explicitly instructed to verify the exact target and prefer a recoverable path when one exists.",
        relevanceTags: ["assistant", "safety", "privacy"],
        sourcePullRequests: [],
      },
      {
        id: "homepage-cards-fit-small-iphones",
        kind: "improvement",
        priority: 2,
        title: "Homepage examples fit the smallest iPhones",
        summary:
          "The newsletter, bloodwork, errands, and recovery cards now recompose at 320 to 390 pixels instead of squeezing desktop-sized artifacts into the phone.",
        relevanceTags: ["homepage", "iphone", "design", "polish"],
        sourcePullRequests: [961],
      },
    ],
  },
  {
    id: "2026-07-25",
    publishedOn: "2026-07-25",
    title: "A Murph that knows when to speak",
    summary:
      "Group Murph reads the floor, gets more creative, and knows who is speaking on Telegram. Murph can also ask Grok about X, adapt outdoor reminders to the weather, and close billing and phone-call loops that used to strand people.",
    items: [
      {
        id: "ask-grok-x-research",
        kind: "feature",
        priority: 5,
        title: "Ask Grok what people are saying on X",
        summary:
          "Murph can now ask Grok to search X about an account, a topic, or a post you share, then bring Grok's returned answer back into your conversation.",
        details:
          "Murph labels the answer as Grok's unverified report and is instructed not to add links or authors beyond what Grok returned. The exact provider cost for the call counts toward your Murph usage with no markup.",
        relevanceTags: ["assistant", "search", "x", "research"],
        sourcePullRequests: [911],
        tryIt: {
          label: "Ask about X",
          prompt: "What are people on X saying about zone 2 training this week?",
        },
      },
      {
        id: "unhinged-style-dial",
        kind: "feature",
        priority: 5,
        title: "Ask Murph to loosen up",
        summary:
          "A new conversation-only Unhinged dial from 0 to 10 controls how restrained Murph keeps its wording, without changing safety, truth, privacy, consent, tool access, or reminder frequency.",
        details:
          "It works in private conversations and group chats with verified members, stays out of onboarding and web Settings, and moves in a small step when you ask for a little more or less. In a group, Murph raises it only when the room's own tone supports it.",
        relevanceTags: ["assistant", "personalization", "groups", "messaging"],
        sourcePullRequests: [916],
        tryIt: {
          label: "Turn it up",
          prompt: "Turn up my Unhinged setting a little.",
        },
      },
      {
        id: "group-chat-creative-formats",
        kind: "feature",
        priority: 4,
        title: "Group Murph has more ways to land the bit",
        summary:
          "When the room earns it, Murph can turn a shared photo into a new chat icon or over-deliver an apology as a song instead of waiting for someone to commission the joke.",
        details:
          "The room's own joke is the material. Murph keeps bodies and anyone visibly not in on it out of the bit, changes the icon if someone objects, and stays quiet when the complaint is that Murph spoke at all.",
        relevanceTags: ["groups", "assistant", "images", "music"],
        sourcePullRequests: [938],
      },
      {
        id: "telegram-group-sender-attribution",
        kind: "feature",
        priority: 4,
        title: "Telegram group Murph knows who just spoke",
        summary:
          "When a linked member writes in a Telegram group, Murph now attributes that turn to the right person and can use their username when no room name exists.",
        details:
          "Challenge opt-ins no longer arrive anonymous, so Murph can tell who accepted and keep the group's conversation and shared state attached to the right member.",
        relevanceTags: ["telegram", "groups", "challenges", "messaging"],
        sourcePullRequests: [927],
      },
      {
        id: "weather-aware-outdoor-reminders",
        kind: "feature",
        priority: 4,
        title: "Outdoor reminders check the weather first",
        summary:
          "A reminder that tells you to go outside can now check current conditions and adapt the wording instead of sending you into the rain.",
        details:
          "Murph uses only a city or region you already shared, or offers once to save one. Declining does not block the reminder, and a failed weather read never prevents it from going out.",
        relevanceTags: ["reminders", "weather", "privacy", "automation"],
        sourcePullRequests: [934],
      },
      {
        id: "group-murph-reads-the-floor",
        kind: "improvement",
        priority: 5,
        title: "Group Murph knows when the floor belongs to someone else",
        summary:
          "Murph now distinguishes a live volley from catch-up, a joke from a plausible emergency, and a human-to-human beat from an opening that actually wants Murph.",
        details:
          "It may wait a few seconds while people are mid-burst, gives human punchlines more stage, and asks one short question when the health context is genuinely unclear. Timing never overrides the room's silence, reaction, or not-for-you rules.",
        relevanceTags: ["groups", "assistant", "messaging", "safety"],
        sourcePullRequests: [906, 928],
      },
      {
        id: "phone-call-results-return-to-chat",
        kind: "improvement",
        priority: 5,
        title: "Phone-call results come back to you",
        summary:
          "When a call Murph started finishes, Murph now sends the meaningful result back through the chat where it can reach you, in its own voice.",
        details:
          "The result is encrypted at rest, Murph treats the call transcript as untrusted, and a replay cannot send the same outcome twice.",
        relevanceTags: ["phone-calls", "assistant", "messaging", "reliability"],
        sourcePullRequests: [857],
      },
      {
        id: "billing-recovery-finishes",
        kind: "improvement",
        priority: 5,
        title: "Subscription recovery now has a way through",
        summary:
          "If your subscription lapses, Murph answers on your home line and points you to Subscription controls instead of dropping the text or sending you to a blocked signup wall.",
        details:
          "Resuming a paused subscription now carries the saved card onto the invoice, avoids an update the provider rejects while paused, and offers the billing page when the provider is still finishing.",
        relevanceTags: ["billing", "messaging", "subscriptions", "reliability"],
        sourcePullRequests: [925],
      },
      {
        id: "one-click-launch-consent",
        kind: "improvement",
        priority: 4,
        title: "Launch consent is one clear choice",
        summary:
          "After sign-in, accepting Murph's terms and health-data notices now takes one affirmative action instead of a row of checkboxes, with an equally clear Decline path.",
        details:
          "The prompt states that Murph does not sell your health data or train general-purpose AI models on Murph-managed health data. After repeated save failures, it offers a support route instead of trapping you in retries.",
        relevanceTags: ["onboarding", "consent", "privacy", "auth"],
        sourcePullRequests: [881],
      },
      {
        id: "group-usage-pause-in-murphs-voice",
        kind: "improvement",
        priority: 4,
        title: "A paused group hears from Murph, not a billing system",
        summary:
          "When a group runs out of included usage, Murph now explains the pause in its own voice and, when funding is available, gives the whole room a clear way to bring it back.",
        relevanceTags: ["groups", "billing", "messaging", "copy"],
        sourcePullRequests: [933],
      },
      {
        id: "contact-card-in-app-browser-handoff",
        kind: "improvement",
        priority: 4,
        title: "Contact cards escape in-app browsers",
        summary:
          "On iPhone, Add Murph to Contacts now hands off from an in-app browser to Safari instead of letting the embedded window swallow the contact-card download.",
        details:
          "The short-lived handoff stays bound to your account and chosen avatar. Setup completes only after Safari actually opens; if the launch is blocked, the picker stays open with a retry.",
        relevanceTags: ["onboarding", "contacts", "iphone", "reliability"],
        sourcePullRequests: [917],
      },
      {
        id: "experiment-check-ins-survive-stray-files",
        kind: "improvement",
        priority: 4,
        title: "Experiment check-ins survive stray files",
        summary:
          "A leftover folder in experiment storage can no longer disable every managed automation or archive active experiment check-ins. Unrelated reminders keep running while Murph retries a temporary experiment scan failure.",
        relevanceTags: ["experiments", "reminders", "automation", "reliability"],
        sourcePullRequests: [943],
      },
      {
        id: "group-chat-renames-without-a-hosted-record",
        kind: "improvement",
        priority: 3,
        title: "Even a lightweight group chat can be renamed",
        summary:
          "Murph can now rename the chat it is already in even when the group has not started a challenge or created a shared workspace. Updating Murph's own label follows when possible.",
        relevanceTags: ["groups", "messaging", "tools", "reliability"],
        sourcePullRequests: [939],
      },
      {
        id: "voice-memo-failures-have-a-reason",
        kind: "improvement",
        priority: 3,
        title: "Voice-memo failures are no longer a mystery",
        summary:
          "Murph now receives a safe description of why voice generation failed, while the maximum script length and generation timeout share one limit so overlong memos do not fail by design.",
        details:
          "Provider status and request identifiers reach secret-safe logs, giving Murph and support enough information to distinguish a timeout from a quota or request error.",
        relevanceTags: ["voice", "assistant", "reliability", "support"],
        sourcePullRequests: [935, 937],
      },
      {
        id: "safe-database-start-retries",
        kind: "improvement",
        priority: 3,
        title: "Brief database connection failures get a safe retry",
        summary:
          "If a database timeout proves that no query or transaction started, Murph's web service now retries it briefly instead of failing the request.",
        details:
          "A failure that may have reached the database is never replayed, so the retry cannot duplicate a completed action.",
        relevanceTags: ["web", "database", "reliability", "retries"],
        sourcePullRequests: [940],
      },
      {
        id: "group-roster-durable-murph-activation",
        kind: "improvement",
        priority: 3,
        title: "Group Murph knows who already set up Murph",
        summary:
          "The iMessage roster now separates people who completed Murph setup from people who never activated, without treating current plan status as identity. A paused or lapsed member is no longer mistaken for a stranger.",
        relevanceTags: ["groups", "imessage", "onboarding", "privacy"],
        sourcePullRequests: [929],
      },
      {
        id: "silent-device-source-stalls-are-visible",
        kind: "improvement",
        priority: 3,
        title: "Silent device stalls now leave a signal",
        summary:
          "If a push-based device source still looks connected but stops delivering data, Murph now records the silence as a source-stalled signal instead of treating every empty sync as a normal empty day.",
        details:
          "The check is observation only: it does not disconnect the source, block ingestion, or launch a recovery on its own.",
        relevanceTags: ["devices", "sync", "reliability", "monitoring"],
        sourcePullRequests: [930],
      },
      {
        id: "homepage-group-challenge-story",
        kind: "improvement",
        priority: 3,
        title: "The homepage gets to the group challenge faster",
        summary:
          "The hero now tells one story from the start: friends enter the chat, the challenge begins, and Murph carries it through standings, a roast voice memo, and the Sunday recap.",
        details:
          "The separate solo-demo act and its decorative controls are gone, and the security promises now read in one clean column.",
        relevanceTags: ["homepage", "groups", "design", "polish"],
        sourcePullRequests: [],
      },
    ],
  },
  {
    id: "2026-07-24",
    publishedOn: "2026-07-24",
    title: "Group chats that read the room",
    summary:
      "Group replies stay as short as the question allows, Home points Telegram members to the first message Murph needs, and you can ask Murph what changed in the product.",
    items: [
      {
        id: "group-replies-stay-short",
        kind: "improvement",
        priority: 4,
        title: "Group replies stay as short as the question allows",
        summary:
          "A group's Detail setting is now a hard ceiling on message length rather than a target, covering the whole turn including every follow-on bubble.",
        details:
          "A direct question still gets its complete answer, as tight as accuracy allows. What the ceiling cuts is volunteered length: scoring frameworks, multi-topic essays, and background nobody asked for.",
        relevanceTags: ["groups", "assistant", "messaging", "polish"],
        sourcePullRequests: [913, 921],
      },
      {
        id: "group-usage-always-fundable",
        kind: "feature",
        priority: 4,
        title: "Every group chat has a working way to add usage",
        summary:
          "A group that never created a join code now still gets a first-party funding link, and Murph offers it while the conversation can still continue instead of after it stops.",
        relevanceTags: ["groups", "billing", "usage", "messaging"],
        sourcePullRequests: [905],
        tryIt: {
          label: "Check group usage",
          prompt: "How much usage does this group have left?",
        },
      },
      {
        id: "group-contact-card-reshare",
        kind: "improvement",
        priority: 3,
        title: "Murph resends its contact card when someone missed it",
        summary:
          "Asking Murph to share its card again in a group now posts a new card instead of refusing, with a 90-second guard that only collapses duplicate retries.",
        relevanceTags: ["groups", "imessage", "messaging"],
        sourcePullRequests: [912, 918],
      },
      {
        id: "group-work-requests-declined",
        kind: "improvement",
        priority: 3,
        title: "Murph stays out of work tasks in group chats",
        summary:
          "Group rooms and unverified outside threads now decline code reviews and work deliverables in one plain sentence, while ordinary conversation and quick general questions stay in scope.",
        relevanceTags: ["groups", "assistant", "safety"],
        sourcePullRequests: [922],
      },
      {
        id: "group-join-permissions-preselected",
        kind: "improvement",
        priority: 3,
        title: "Group joins arrive with the requested sharing already selected",
        summary:
          "The join screen now preselects exactly the permissions a group or challenge asked for and explains them in one line, so joining is a single confirmation.",
        relevanceTags: ["groups", "sharing", "privacy", "challenges"],
        sourcePullRequests: [],
      },
      {
        id: "usage-top-up-returns-to-chat",
        kind: "improvement",
        priority: 3,
        title: "Adding usage returns you to the conversation",
        summary:
          "Family top-ups now start from each member's manage window, and a finished purchase opens Messages instead of ending at a confirmation with nowhere to go.",
        relevanceTags: ["billing", "usage", "family", "settings"],
        sourcePullRequests: [],
      },
      {
        id: "telegram-signup-completes-setup",
        kind: "improvement",
        priority: 3,
        title: "Linking Telegram finishes the signup step",
        summary:
          "A linked Telegram account now completes messaging setup at join instead of asking again how Murph should reach you. Until you send the first message Telegram requires, Home puts Message Murph first and links straight to the chat.",
        relevanceTags: ["telegram", "onboarding", "auth"],
        sourcePullRequests: [],
      },
      {
        id: "ask-murph-whats-new",
        kind: "feature",
        priority: 4,
        title: "Ask Murph what changed",
        summary:
          "In an ordinary conversation, Murph can now read the public changelog and feature catalog to answer what is new or whether a capability has shipped, instead of answering from memory.",
        details:
          "Those two public feeds are the source of truth. If either feed is unavailable, Murph says so rather than guessing.",
        relevanceTags: ["assistant", "changelog", "search", "messaging"],
        sourcePullRequests: [],
        tryIt: {
          label: "Ask what's new",
          prompt: "What changed in Murph this week?",
        },
      },
      {
        id: "account-deletion-exit-feedback",
        kind: "improvement",
        priority: 3,
        title: "Account deletion asks one optional why",
        summary:
          "Before the final delete confirmation, you can pick a reason for leaving and add a note, or skip the question in one tap. The answer never gates deletion.",
        details:
          "If you answer, Murph keeps the optional feedback only after account deletion finishes and stores it without your member id.",
        relevanceTags: ["settings", "privacy", "feedback", "account"],
        sourcePullRequests: [926],
      },
    ],
  },
  {
    id: "2026-07-23",
    publishedOn: "2026-07-23",
    title: "Updated documents, honest reactions, usage you can see",
    summary:
      "Murph's refreshed legal set went live without interrupting anyone's chat, a heart on a message stopped being read as yes, and a group can now ask how much usage it has left.",
    items: [
      {
        id: "updated-legal-documents-keep-chat-working",
        kind: "improvement",
        priority: 5,
        title: "Updated legal documents without losing your conversation",
        summary:
          "The refreshed privacy, health-data, and health-AI documents ask for one review while your account, connections, sync, and current conversation keep working.",
        details:
          "Members whose acceptance was merely out of date no longer hit silent failures: hearting a group join offer, sending a meal photo, and tapping a confirmation inside Messages all keep working while the review reminder is outstanding. The homepage also carries a distinct Consumer Health Data Privacy Notice link.",
        relevanceTags: ["privacy", "security", "health", "messaging"],
        sourcePullRequests: [884, 889, 907],
      },
      {
        id: "reactions-read-in-context",
        kind: "improvement",
        priority: 5,
        title: "A heart on a message no longer means yes",
        summary:
          "Murph now sees which reaction you used and reads it as acknowledgement by default, treating it as agreement only when the message it answers asked a single yes-or-no question.",
        relevanceTags: ["reactions", "imessage", "safety", "assistant"],
        sourcePullRequests: [899],
      },
      {
        id: "group-usage-percent-visible",
        kind: "feature",
        priority: 4,
        title: "Ask a group chat how much usage is left",
        summary:
          "Group Murph now answers with the percent remaining for the current period, when it resets, and a funding link, instead of only saying usage is healthy.",
        details:
          "Settings dropped the exact purchased credit balance in the same change. Percentages and reset timing stay visible; dollar accounting, who paid, and purchase history do not.",
        relevanceTags: ["groups", "usage", "billing", "settings"],
        sourcePullRequests: [895, 901],
        tryIt: {
          label: "Ask about group usage",
          prompt: "What's our usage at right now?",
        },
      },
      {
        id: "group-daily-text-cap-doubled",
        kind: "improvement",
        priority: 4,
        title: "Group threads get 200 texts a day",
        summary:
          "Everyone's messages in a group share one daily bucket, so the cap that was sized for a one-to-one chat doubled to 200. Direct chats keep 100.",
        relevanceTags: ["groups", "imessage", "messaging"],
        sourcePullRequests: [900],
      },
      {
        id: "challenge-kickoff-asks-for-intros",
        kind: "improvement",
        priority: 4,
        title: "Challenge kickoffs ask everyone for an intro and a photo",
        summary:
          "Every confirmed participant now gets one short ask for a one-line intro and a photo for challenge comics, and someone who opts in later gets the same ask.",
        details:
          "Sharing either one stays optional and the challenge starts without waiting. Setup also asks its next question directly instead of first announcing that setup is about to happen.",
        relevanceTags: ["groups", "challenges", "images", "messaging"],
        sourcePullRequests: [887, 888],
      },
      {
        id: "generated-images-actually-arrive",
        kind: "improvement",
        priority: 4,
        title: "Pictures Murph makes actually arrive",
        summary:
          "A generated image now uploads and sends instead of failing after generation and leaving Murph to report that the upload did not work.",
        relevanceTags: ["images", "messaging", "reliability", "groups"],
        sourcePullRequests: [902],
      },
      {
        id: "daily-activity-totals-count-every-workout",
        kind: "improvement",
        priority: 4,
        title: "Daily activity totals count every workout",
        summary:
          "A day with more than one workout now reports the full count and combined duration in replies, group comparisons, and newsletters, with the current day labeled so far.",
        relevanceTags: ["wearables", "data", "groups", "reliability"],
        sourcePullRequests: [892],
      },
      {
        id: "signup-holds-under-a-rush",
        kind: "improvement",
        priority: 3,
        title: "Signing up holds up under a rush",
        summary:
          "Account creation, trial activation, and phone-line assignment no longer queue behind one global lock, and a brief database stall shows the ordinary homepage instead of an error.",
        relevanceTags: ["auth", "reliability", "performance"],
        sourcePullRequests: [886, 896, 903],
      },
      {
        id: "meal-capture-closes-the-day-itself",
        kind: "improvement",
        priority: 3,
        title: "Meal capture closes out the day on its own",
        summary:
          "Accepting your first automatic meal capture now sets up the 9pm local closeout without another setting or prompt.",
        relevanceTags: ["nutrition", "meals", "automation", "iphone"],
        sourcePullRequests: [890],
      },
      {
        id: "whoop-at-capacity-opens-full-sync-guide",
        kind: "improvement",
        priority: 3,
        title: "WHOOP at capacity opens the full-sync guide",
        summary:
          "When direct WHOOP slots are full, connecting now opens the same Apple Health setup guide with its voice walkthrough instead of a separate inline dead end.",
        relevanceTags: ["wearables", "whoop", "apple-health", "connect"],
        sourcePullRequests: [879],
      },
      {
        id: "home-survives-a-failed-panel",
        kind: "improvement",
        priority: 3,
        title: "Home keeps working when one panel fails",
        summary:
          "A section of the dashboard that cannot load is now left out with one retry notice, instead of taking down the page or recommending you connect devices Murph cannot currently see.",
        relevanceTags: ["dashboard", "reliability", "web"],
        sourcePullRequests: [882],
      },
      {
        id: "invites-explain-which-email-to-use",
        kind: "improvement",
        priority: 3,
        title: "Invites say which email address to use",
        summary:
          "Joining from an emailed invite now locks to the invited address and explains how to switch senders, instead of failing with a mismatch you cannot act on.",
        relevanceTags: ["invites", "auth", "family", "email"],
        sourcePullRequests: [],
      },
      {
        id: "group-song-and-contact-card-together",
        kind: "improvement",
        priority: 3,
        title: "A group can ask for a song and a contact card at once",
        summary:
          "Murph now completes both supported requests in the same turn instead of doing one and describing the other as a messaging limitation that did not exist.",
        relevanceTags: ["groups", "music", "messaging"],
        sourcePullRequests: [894],
      },
    ],
  },
  {
    id: "2026-07-22",
    publishedOn: "2026-07-22",
    title: "Onboarding that sounds like a person",
    summary:
      "First-run questions now show what a useful answer looks like, biomarker pages explain the number you are looking at, and approved files finish sending on their own.",
    items: [
      {
        id: "onboarding-sounds-like-a-conversation",
        kind: "improvement",
        priority: 5,
        title: "Onboarding sounds like a conversation, not a form",
        summary:
          "The early questions now give concrete examples of a useful answer, repeat your actual goals back to you, and hand off a device connection in Murph's own words.",
        details:
          "Murph no longer asks you to come back and say a quoted magic word after connecting a wearable, and it only asks the labs question by voice if you answered by voice.",
        relevanceTags: ["onboarding", "assistant", "voice", "polish"],
        sourcePullRequests: [853, 854, 863, 864, 869, 870],
      },
      {
        id: "biomarker-pages-explain-the-number",
        kind: "feature",
        priority: 4,
        title: "Biomarker pages explain the number you are looking at",
        summary:
          "A result page now leads with status, value, and date, plots one-sided lab limits such as under 5.7 percent, and can add a reviewed plain-language description.",
        details:
          "When an imported result arrives without its own range, the page can show a clearly labeled published adult comparator without changing the reporting lab's status or presenting the comparator as that lab's range.",
        relevanceTags: ["biomarkers", "labs", "health", "dashboard"],
        sourcePullRequests: [838, 844, 871],
        tryIt: {
          href: "/biomarkers",
          label: "Open Biomarkers",
        },
      },
      {
        id: "family-usage-top-ups",
        kind: "feature",
        priority: 4,
        title: "Buy usage for one family member",
        summary:
          "A family plan owner can add a $5, $10, or $25 usage pack to a specific member from Settings, with every step naming who the credit is for.",
        relevanceTags: ["family", "billing", "usage", "settings"],
        sourcePullRequests: [855],
        tryIt: {
          href: "/settings",
          label: "Open Settings",
        },
      },
      {
        id: "garmin-historical-permission-preflight",
        kind: "feature",
        priority: 4,
        title: "A reminder before Garmin's permission screen",
        summary:
          "Garmin leaves Historical Data sharing off by default, so Murph now shows one sentence and plays a short reminder in your chosen voice before sending you to authorize.",
        relevanceTags: ["wearables", "garmin", "connect", "voice"],
        sourcePullRequests: [875],
      },
      {
        id: "knowledge-page",
        kind: "feature",
        priority: 4,
        title: "A page explaining what Murph actually knows",
        summary:
          "A public Knowledge page covers the research, specialist skills, evidence grades, and personal data Murph works from, linked from the main navigation.",
        relevanceTags: ["web", "health", "search"],
        sourcePullRequests: [862],
        tryIt: {
          href: "/knowledge",
          label: "Open Knowledge",
        },
      },
      {
        id: "two-week-experiment-baselines",
        kind: "improvement",
        priority: 4,
        title: "Experiments measure two weeks before they change anything",
        summary:
          "New repeated-measure runs baseline for 14 days instead of 7, which makes the before-and-after comparison far less noisy. Saved runs keep their original timing.",
        relevanceTags: ["experiments", "health", "data"],
        sourcePullRequests: [848, 868],
      },
      {
        id: "progress-updates-before-slow-work",
        kind: "improvement",
        priority: 4,
        title: "Murph says what it is doing before a slow step",
        summary:
          "A newly shared lab report gets one short receipt before Murph preserves and reads it, and a check across several health areas says which areas it is about to read.",
        details:
          "Routine single reads stay quiet, and overlapping onboarding work collapses into one update rather than several.",
        relevanceTags: ["assistant", "onboarding", "labs", "messaging"],
        sourcePullRequests: [856],
      },
      {
        id: "approved-files-send-themselves",
        kind: "improvement",
        priority: 4,
        title: "Approved files send themselves",
        summary:
          "After you approve a secure file, Murph finishes that exact send on its own as one attachment, without a second approval request, a typed confirmation, or a caption bubble.",
        relevanceTags: ["approvals", "vault", "media", "reliability"],
        sourcePullRequests: [814, 831, 841],
      },
      {
        id: "group-ask-answers-come-back-promptly",
        kind: "improvement",
        priority: 4,
        title: "An answer from a group you asked comes back promptly",
        summary:
          "Asking a group you joined now starts the read-only group turn right away and wakes your own Murph when the answer lands, instead of parking it until your next message.",
        relevanceTags: ["groups", "assistant", "performance", "hosted"],
        sourcePullRequests: [832, 840],
      },
      {
        id: "hosted-work-runs-on-two-cores",
        kind: "improvement",
        priority: 3,
        title: "Murph's hosted work runs on twice the CPU",
        summary:
          "Hosted containers moved from one to two vCPU with double the memory, which shortens the heavier reads Murph does mid-conversation.",
        relevanceTags: ["performance", "hosted", "reliability"],
        sourcePullRequests: [878],
      },
      {
        id: "text-murph-after-personalizing",
        kind: "improvement",
        priority: 3,
        title: "Personalizing Murph ends with a way to text it",
        summary:
          "Finishing the first-visit persona and tone step now opens the welcome dialog with a Text Murph action on your resolved channel, instead of ending on a blank page.",
        relevanceTags: ["onboarding", "messaging", "web"],
        sourcePullRequests: [852],
      },
      {
        id: "mobile-settings-and-connect-polish",
        kind: "improvement",
        priority: 3,
        title: "Settings and Connect read properly on a phone",
        summary:
          "The family manager becomes readable cards instead of a clipped table, the customization drawers fill the screen, and every Connect card anchors its action to the same place.",
        relevanceTags: ["settings", "mobile", "polish", "connect"],
        sourcePullRequests: [872, 873],
      },
      {
        id: "whoop-full-sync-dialog-actions",
        kind: "improvement",
        priority: 3,
        title: "The WHOOP full-sync guide has real buttons",
        summary:
          "The guide after connecting WHOOP now offers a clear Download App action and a Continue with Murph handoff to your existing Messages or Telegram thread.",
        relevanceTags: ["wearables", "whoop", "apple-health", "polish"],
        sourcePullRequests: [867],
      },
    ],
  },
  {
    id: "2026-07-21",
    publishedOn: "2026-07-21",
    title: "Pick who Murph is",
    summary:
      "New members choose one of fifteen Murph personas with a matching voice, a group can ask your private Murph a question you explicitly allowed, and Biomarkers became a page you can scan.",
    items: [
      {
        id: "murph-personas",
        kind: "feature",
        priority: 5,
        title: "Choose who Murph is",
        summary:
          "First run now opens with a main Murph personality, an optional supporting one to blend in, a text style, and voices you can preview before saving.",
        details:
          "The personality sets sensible defaults for tone and voice; Humor, Push, and Detail stay adjustable afterwards in Settings or mid-conversation. Skipping writes nothing.",
        relevanceTags: ["onboarding", "personalization", "voice", "assistant"],
        sourcePullRequests: [801, 833],
        tryIt: {
          href: "/settings",
          label: "Change your Murph",
        },
      },
      {
        id: "consented-group-to-member-questions",
        kind: "feature",
        priority: 5,
        title: "A group can ask your Murph one question, with your permission",
        summary:
          "Group Murph posts the exact permission it wants, you accept by liking that message, and your own Murph answers one bounded question. Membership alone is never consent.",
        details:
          "The group runtime never receives your vault or your connected accounts. A second fresh reviewer sees only the permission, the question, and the draft answer, and can allow or deny it.",
        relevanceTags: ["groups", "privacy", "sharing", "consent"],
        sourcePullRequests: [750],
      },
      {
        id: "group-usage-funding",
        kind: "feature",
        priority: 4,
        title: "Anyone in a group can chip in for usage",
        summary:
          "A person with the group link can add a $5, $10, or $25 usage pack to that group, even without a paid plan of their own.",
        details:
          "Group Murph can report only healthy, low, or exhausted and the period end. Internal accounting, who paid, and purchase history stay hidden.",
        relevanceTags: ["groups", "billing", "usage"],
        sourcePullRequests: [821, 845],
      },
      {
        id: "biomarkers-index-rebuilt",
        kind: "feature",
        priority: 4,
        title: "Biomarkers is a page you can actually scan",
        summary:
          "Device readings come first, recognized lab results group into health areas you can search and filter, and each history now uses one canonical unit.",
        details:
          "Equivalent lab spellings such as BUN and blood urea nitrogen collapse into a single history, and report metadata no longer lands in a catch-all Other group. Qualitative and incompatible-unit results stay in the form the lab reported them.",
        relevanceTags: ["biomarkers", "labs", "dashboard", "design"],
        sourcePullRequests: [816, 817, 818, 826, 829],
        tryIt: {
          href: "/biomarkers",
          label: "Open Biomarkers",
        },
      },
      {
        id: "low-usage-mentioned-in-conversation",
        kind: "improvement",
        priority: 4,
        title: "Low usage comes up in conversation, not as a billing notice",
        summary:
          "At the existing 20 percent threshold Murph finishes what you asked first, then may add one casual sentence that the conversation could pause soon. The separate automated warning is gone.",
        relevanceTags: ["usage", "billing", "assistant", "messaging"],
        sourcePullRequests: [823],
      },
      {
        id: "group-newsletter-setup",
        kind: "improvement",
        priority: 4,
        title: "Set up a recurring group newsletter in one pass",
        summary:
          "From an authenticated group chat, Murph collects the name, cadence, delivery target, tone, and health scopes and saves them once, then waits for the natural first occurrence.",
        details:
          "Delivery stays pinned to the chat that was authorized. If that thread is replaced or revoked, the occurrence fails instead of sending shared health data somewhere new.",
        relevanceTags: ["groups", "newsletter", "automations", "privacy"],
        sourcePullRequests: [813, 827],
      },
      {
        id: "completed-experiments-show-daily-points",
        kind: "improvement",
        priority: 4,
        title: "Completed experiments show every measured day again",
        summary:
          "A finished report now draws the saved baseline and intervention measurements day by day, with the summary averages consistent with those points.",
        relevanceTags: ["experiments", "data", "dashboard"],
        sourcePullRequests: [836, 839],
      },
      {
        id: "experiment-results-match-the-dashboard",
        kind: "improvement",
        priority: 3,
        title: "Private experiment results read like the rest of the dashboard",
        summary:
          "Run reports now use the ordinary page margins, one metric chart per row, and the standard trend chart, and finished runs drop the repetitive saved-result narrative.",
        relevanceTags: ["experiments", "dashboard", "design", "polish"],
        sourcePullRequests: [825],
      },
    ],
  },
  {
    id: "2026-07-20",
    publishedOn: "2026-07-20",
    title: "Standings that explain themselves, payments that finish",
    summary:
      "Group standings now explain partial coverage, starting Pulse completes itself after Stripe, and scheduled messages run as ordinary Murph turns rather than a stripped-down second profile.",
    items: [
      {
        id: "challenge-standings-explain-missing-data",
        kind: "feature",
        priority: 5,
        title: "Challenge standings show who is still waiting",
        summary:
          "Scheduled group updates now separate current scores from participants whose data is missing, state the coverage clearly, and explain the next useful step for each person instead of silently leaving them out.",
        details:
          "A real zero still counts. Missing sharing permission, a stale sync, a disconnected source, and a source that needs attention stay distinct. When an exact required share has not been granted, Murph may offer one separate Like-or-heart permission card; the standings message itself never becomes a consent surface.",
        relevanceTags: ["groups", "challenges", "sharing", "wearables"],
        sourcePullRequests: [769, 1463],
        tryIt: {
          label: "Review missing standings data",
          prompt:
            "Help me review what may be missing from my current challenge standings.",
        },
      },
      {
        id: "phone-link-settings-recovery",
        kind: "improvement",
        priority: 5,
        title: "Linking a phone no longer stalls in Settings",
        summary:
          "An authenticated member can now link or replace a phone number without a false signup-completion error, and the dialog opens directly on the focused phone field instead of repeating the Settings status card.",
        details:
          "The fix still requires a fresh login for the exact same account and continues to reject a phone identity that resolves to another member.",
        relevanceTags: ["settings", "phone", "auth", "reliability"],
        sourcePullRequests: [],
      },
      {
        id: "weekly-insights-skip-obvious-weekend",
        kind: "improvement",
        priority: 4,
        title: "Weekly insights skip the obvious weekend lecture",
        summary:
          "Murph no longer turns one bad night into an alcohol assumption or sends a weekly insight whose main point is that drinking or a late weekend hurt sleep or recovery.",
        details:
          "That conclusion is treated as obvious and unhelpful here, so Murph can choose a different evidence-backed candidate while keeping causal claims appropriately cautious.",
        relevanceTags: ["insights", "sleep", "recovery", "assistant"],
        sourcePullRequests: [],
      },
      {
        id: "scheduled-messages-get-the-full-murph",
        kind: "improvement",
        priority: 4,
        title: "Scheduled messages get the same Murph as a live chat",
        summary:
          "An automation now runs as an ordinary conversation turn with your usual prompt, skills, style, and tools, instead of a separate reduced profile with its own thread policy.",
        relevanceTags: ["automations", "assistant", "reminders"],
        sourcePullRequests: [800],
      },
      {
        id: "pulse-finishes-after-payment-setup",
        kind: "improvement",
        priority: 4,
        title: "Starting Pulse finishes after you add a card",
        summary:
          "Confirming Start Pulse once now completes automatically when you return from Stripe, whether you began in Settings or from a link Murph sent in chat.",
        details:
          "Cancelling returns to ordinary Settings without starting billing, and a terminal failure offers one retry you control.",
        relevanceTags: ["billing", "pulse", "settings", "web"],
        sourcePullRequests: [798, 804],
      },
      {
        id: "contaminant-tests-on-product-pages",
        kind: "feature",
        priority: 4,
        title: "Product pages carry independent contaminant test results",
        summary:
          "Food and supplement records now show source-attributed contaminant observations with their sample provenance and honest result ranges, matched only by exact product identity.",
        details:
          "Bounded results are never collapsed into exact values, and no safe or unsafe verdict is inferred from the presence of testing. The same evidence is available through public search and the CLI.",
        relevanceTags: ["supplements", "nutrition", "search", "health"],
        sourcePullRequests: [786],
      },
      {
        id: "private-experiments-open-from-home",
        kind: "improvement",
        priority: 4,
        title: "Every private experiment on Home opens again",
        summary:
          "Runs whose source protocol left the public catalog kept their saved data but lost their links. They now open to the progress, measurements, and conclusions already saved in your vault.",
        relevanceTags: ["experiments", "dashboard", "vault"],
        sourcePullRequests: [807],
      },
      {
        id: "named-lab-marker-answers-faster",
        kind: "improvement",
        priority: 3,
        title: "Asking about one blood marker answers faster",
        summary:
          "A question about a single named marker now uses one targeted lookup that carries the value, unit, flag, and reference range, instead of loading your whole lab history first.",
        relevanceTags: ["labs", "biomarkers", "performance", "assistant"],
        sourcePullRequests: [802],
        tryIt: {
          label: "Ask about a marker",
          prompt: "What was my last ferritin result?",
        },
      },
      {
        id: "dense-voice-memo-keeps-onboarding-moving",
        kind: "improvement",
        priority: 3,
        title: "A dense voice memo no longer stalls onboarding",
        summary:
          "When one memo covers movement, supplements, and medical history, Murph sorts all three at once and says it is working instead of going quiet.",
        relevanceTags: ["onboarding", "voice", "performance"],
        sourcePullRequests: [809],
      },
      {
        id: "welcome-continues-your-conversation",
        kind: "improvement",
        priority: 3,
        title: "Your first message continues the welcome",
        summary:
          "Murph now sees the welcome it already sent when you reply, so it answers your message instead of introducing itself a second time.",
        relevanceTags: ["onboarding", "messaging", "telegram", "imessage"],
        sourcePullRequests: [811],
      },
      {
        id: "approval-page-sign-in-recovery",
        kind: "improvement",
        priority: 3,
        title: "An approval link recovers when the browser is signed out",
        summary:
          "The approval screen now offers Sign in to approve as soon as it knows the browser is not authenticated, rather than waiting out a loading timeout.",
        relevanceTags: ["approvals", "auth", "web", "reliability"],
        sourcePullRequests: [805],
      },
      {
        id: "strava-connections-paused",
        kind: "improvement",
        priority: 3,
        title: "Strava connections are paused",
        summary:
          "Murph no longer offers new or renewed Strava connections and says so plainly. Existing connections keep their data, status, and disconnect control.",
        relevanceTags: ["wearables", "connect", "integrations"],
        sourcePullRequests: [808],
      },
    ],
  },
  {
    id: "2026-07-19",
    publishedOn: "2026-07-19",
    title: "Medical records, without the integration jargon",
    summary:
      "Medical records now starts from where you get care and the patient portal you already use. The page explains what Murph can copy, how often it checks, and what actually happened after the import.",
    items: [
      {
        id: "medical-records-plain-language",
        kind: "improvement",
        priority: 5,
        title: "Medical records now speaks in patient-portal language",
        summary:
          "The connection flow now asks where you get care, describes supported patient portals plainly, and keeps search, return, retry, and disconnect states understandable on both phone and desktop.",
        details:
          "Before sign-in, Murph explains that the beta copies available lab results and report summaries once, does not keep checking your chart, never receives your patient-portal password, and does not claim to copy a complete chart. Finished imports also say when zero records were added instead of implying success from status alone.",
        relevanceTags: ["medical-records", "labs", "dashboard", "privacy"],
        sourcePullRequests: [792],
        tryIt: {
          href: "/records",
          label: "Open Medical records",
        },
      },
    ],
  },
  {
    id: "2026-07-18",
    publishedOn: "2026-07-18",
    title: "Replies that know what they are answering",
    summary:
      "Murph can anchor a reply or reaction to the exact message it means and guide automatic iPhone meal capture more reliably. Medical-record imports and cold replies also recover with less friction.",
    items: [
      {
        id: "native-replies-to-exact-message",
        kind: "feature",
        priority: 5,
        title: "Replies and reactions can target the exact message",
        summary:
          "In supported iMessage and Telegram conversations, Murph can send a native threaded reply to one specific message or react to an earlier message from the same turn.",
        details:
          "Ordinary replies stay flat unless anchoring helps. If a selected message is stale, invented, or belongs to another conversation, the marked action stops instead of replying or reacting to the wrong thing.",
        relevanceTags: ["messaging", "imessage", "telegram", "reactions"],
        sourcePullRequests: [779],
      },
      {
        id: "automatic-meal-capture-guidance",
        kind: "improvement",
        priority: 5,
        title: "Meal capture has a real setup and recovery guide",
        summary:
          "Murph now knows the supported iPhone setup, photo-permission and background limits, the on-device review list, and the checks that distinguish a delayed import from a failed upload.",
        details:
          "When calorie or macro tracking is active, Murph can review unresolved device meal photos on the next nutrition conversation and enrich the existing meal without logging the same eating occasion twice. It never promises instant background work, historical scanning, Android support, or indefinite uploads without reopening the app.",
        relevanceTags: ["nutrition", "meals", "iphone", "assistant"],
        sourcePullRequests: [791],
        tryIt: {
          label: "Set up meal capture",
          prompt: "Help me set up automatic meal capture on my iPhone.",
        },
      },
      {
        id: "medical-records-import-recovery",
        kind: "improvement",
        priority: 4,
        title: "Medical-record imports are harder to strand",
        summary:
          "The one-time patient-portal beta now protects against stale browser actions, separates a member denial from a provider failure, validates supported record pages more strictly, and can nudge the same stuck import to resume when its first signal is missed.",
        details:
          "The beta still does not add continuous access, ongoing sync, or a second import attempt. Ambiguous lab ranges stay out of your Murph record until they can be reviewed safely.",
        relevanceTags: ["medical-records", "labs", "reliability"],
        sourcePullRequests: [793],
      },
      {
        id: "cold-replies-drop-finished-media",
        kind: "improvement",
        priority: 3,
        title: "Cold replies carry less finished media",
        summary:
          "Once a one-time generated file is safely delivered and no retry still needs it, Murph clears the temporary copy so a later reply after a quiet stretch has less to restore.",
        details:
          "Active deliveries remain restart-safe, and ordinary files are untouched. The change makes those later replies lighter without weakening approval or retry behavior.",
        relevanceTags: ["assistant", "performance", "reliability", "media"],
        sourcePullRequests: [764],
      },
    ],
  },
  {
    id: "2026-07-17",
    publishedOn: "2026-07-17",
    title: "Your records and measurements, in one place",
    summary:
      "A new Medical records beta can copy supported evidence from selected patient portals, Biomarkers now shows your measured lab and device history, and completed experiment results open again. Onboarding also gathers the broader story in one voice memo and turns an accepted first step into concrete support. Computer handoffs and bounded background work keep the conversation moving too.",
    items: [
      {
        id: "medical-records-one-time-copy",
        kind: "feature",
        priority: 5,
        title: "Copy supported medical records into Murph",
        summary:
          "When the beta is available for your patient portal, Medical records guides a private sign-in and one-time copy of supported lab results and diagnostic report summaries into your Murph record.",
        details:
          "You can start from the web page or ask private Murph for a short-lived connection link. The beta does not request ongoing chart access, copy a complete chart, or delete already imported records when you disconnect.",
        relevanceTags: ["medical-records", "labs", "patient-portals", "privacy"],
        sourcePullRequests: [757],
        tryIt: {
          href: "/records",
          label: "Open Medical records",
        },
      },
      {
        id: "measured-biomarker-history",
        kind: "feature",
        priority: 5,
        title: "See your measured biomarkers in private history",
        summary:
          "The Biomarkers page now groups the lab markers you have actually measured, with the dated readings saved in Murph for each analyte and a chart only when those values are truly comparable.",
        details:
          "Qualitative results, comparator values, unit changes, custom analytes, and lab-reported reference ranges stay visible without being forced into a misleading numeric series. Raw reports and external identifiers stay out of the browser view.",
        relevanceTags: ["biomarkers", "labs", "history", "dashboard"],
        sourcePullRequests: [771],
        tryIt: {
          href: "/biomarkers",
          label: "Open your biomarkers",
        },
      },
      {
        id: "device-metrics-on-biomarkers",
        kind: "improvement",
        priority: 4,
        title: "Device-backed metrics join the Biomarkers index",
        summary:
          "A new From your devices section shows only metrics with real private readings, including the latest value, reading count, history span, and an out-of-date label when the source is stale.",
        details:
          "Manual entries and lab values never qualify a metric for this section. Signed-out members and members without device readings do not see an empty catalog of things they could track.",
        relevanceTags: ["biomarkers", "wearables", "dashboard"],
        sourcePullRequests: [780],
      },
      {
        id: "completed-experiment-results-return",
        kind: "improvement",
        priority: 4,
        title: "Completed experiment results open again",
        summary:
          "From a protocol page, Your results now opens the matching active run or newest completed run, including the exact saved conclusion, confidence, caveats, confounders, metrics, and analysis window.",
        details:
          "Finished outcomes stay tied to the evidence saved when the run ended. Early-stopped runs remain partial, and later measurements cannot leak backward into the result.",
        relevanceTags: ["experiments", "results", "history", "reliability"],
        sourcePullRequests: [759],
      },
      {
        id: "onboarding-one-health-story",
        kind: "improvement",
        priority: 5,
        title: "One voice memo replaces the long health intake",
        summary:
          "After you name what matters, Murph now asks for one natural voice memo about the health and life context that could change the help, instead of walking through a long sequence of intake questions.",
        details:
          "Murph extracts and saves the useful pieces through their existing private owners, asks only for consequential gaps afterward, and can send one check-in if setup pauses early instead of starting a nagging loop.",
        relevanceTags: ["onboarding", "voice", "context", "assistant"],
        sourcePullRequests: [782, 783],
      },
      {
        id: "first-plan-includes-support",
        kind: "improvement",
        priority: 4,
        title: "The first plan starts with real follow-through",
        summary:
          "Before saving a repeated behavior or experiment, Murph now shows the useful recommendation, proposes the next real occurrence, and names the finite reminders and early review it will create.",
        details:
          "One clear yes authorizes the plan and the exact support package together. Session details arrive near the moment of action instead of as a setup text wall, and onboarding stays open if the promised support could not be saved.",
        relevanceTags: ["onboarding", "plans", "reminders", "follow-through"],
        sourcePullRequests: [],
      },
      {
        id: "background-imports-reply-first",
        kind: "improvement",
        priority: 5,
        title: "Long imports can keep moving while Murph replies",
        summary:
          "When an upload, lab file, or other data import does not need to finish before Murph can answer, Murph can now hand off that bounded background work and keep the conversation moving.",
        details:
          "The source is saved first, the background task stays one-shot and narrowly scoped, and Murph does not treat an extracted result as confirmed until it can read it back.",
        relevanceTags: ["assistant", "imports", "files", "performance"],
        sourcePullRequests: [],
      },
      {
        id: "computer-handoff-done-faster",
        kind: "improvement",
        priority: 4,
        title: "Done gets you back to Messages sooner",
        summary:
          "After you finish a direct login handoff in Murph's browser, the Done screen now returns to Messages once the durable completion is saved instead of making you wait for the remaining browser work.",
        details:
          "Murph finishes securing the private login state before the next authorized browser use. If that work is still in progress, a new browser request retries instead of reusing stale state.",
        relevanceTags: ["computer", "handoff", "performance", "reliability"],
        sourcePullRequests: [707],
      },
      {
        id: "scheduled-messages-name-the-subject",
        kind: "improvement",
        priority: 4,
        title: "Scheduled messages name what they are about",
        summary:
          "Reminders, check-ins, and reviews now name the specific task, habit, or plan they refer to, so the message still makes sense when it arrives outside the conversation that created it.",
        relevanceTags: ["reminders", "notifications", "clarity", "assistant"],
        sourcePullRequests: [],
      },
      {
        id: "exercise-images-when-useful",
        kind: "improvement",
        priority: 4,
        title: "Exercise images arrive when they help",
        summary:
          "Murph now judges familiarity movement by movement, includes catalog images for unfamiliar or uncommon exercises, and waits for a form, cue, or just-in-time instruction turn instead of attaching them during setup.",
        details:
          "Common movements can stay text-only when your experience makes the instruction clear. An image supports the action without crowding the conversation that created the plan.",
        relevanceTags: ["exercise", "media", "coaching", "onboarding"],
        sourcePullRequests: [],
      },
      {
        id: "appointment-calls-start-naturally",
        kind: "improvement",
        priority: 3,
        title: "Appointment calls start more naturally",
        summary:
          "When Murph is preparing to call about an appointment, it now asks for a missing date of birth before the task is ready and lets the call agent open naturally instead of reading a fixed introduction.",
        relevanceTags: ["appointments", "phone-calls", "assistant"],
        sourcePullRequests: [],
      },
      {
        id: "reactions-target-the-message",
        kind: "improvement",
        priority: 3,
        title: "Reactions land on the message that earned them",
        summary:
          "A laugh reaction now targets the actual joke or playful message, not a later haha or other laughter marker that merely refers back to it.",
        relevanceTags: ["messaging", "groups", "reactions", "clarity"],
        sourcePullRequests: [],
      },
      {
        id: "whoop-full-sync-guide",
        kind: "improvement",
        priority: 3,
        title: "WHOOP full sync gets a friendlier guide",
        summary:
          "The Apple Health full-sync completion flow now opens a guided dialog, explains what happens next, and can play the explanation in your selected Murph voice instead of leaving you with a terse status screen.",
        relevanceTags: ["whoop", "apple-health", "wearables", "onboarding"],
        sourcePullRequests: [],
      },
      {
        id: "first-hello-available-imessage-number",
        kind: "improvement",
        priority: 3,
        title: "The first hello uses an available iMessage number",
        summary:
          "When Murph starts a new conversation after setup, it now stays within each number's daily conversation limit and can choose another available number when needed.",
        details:
          "If every available number is at its limit, setup still finishes and Text Murph remains available. A person-started message or an existing conversation is never blocked by this limit.",
        relevanceTags: ["imessage", "onboarding", "reliability", "messaging"],
        sourcePullRequests: [766],
      },
    ],
  },
  {
    id: "2026-07-16",
    publishedOn: "2026-07-16",
    title: "More follow-through, less friction",
    summary:
      "Sleep support now follows a plan instead of handing out one-off tips, you can buy a usage top-up when you run out, and a public product search shows what is actually in a supplement. Supported Pulse and Edge changes work in private chat, each group can have its own Murph style, and onboarding starts from your goals.",
    items: [
      {
        id: "sleep-support-that-stays",
        kind: "feature",
        priority: 5,
        title: "Sleep help that sticks with the plan",
        summary:
          "Murph now treats a sleep complaint as an ongoing project: it screens for red flags, reads your recent wearable sleep pattern, and sets up experiments and check-ins you agree to.",
        details:
          "Reminders, check-ins, and reviews each need your explicit agreement, run for a finite window, and end with a review instead of trailing off. Concerning patterns route to a clinician conversation rather than self-management.",
        relevanceTags: ["sleep", "assistant", "experiments", "wearables"],
        sourcePullRequests: [752],
        tryIt: {
          label: "Work on your sleep",
          prompt: "I keep waking up at 3am and can't fall back asleep. Help me figure out why.",
        },
      },
      {
        id: "conversation-subscription-actions",
        kind: "feature",
        priority: 5,
        title: "Change your subscription in conversation",
        summary:
          "In a private chat, review the current terms, then clearly choose to continue Pulse when your trial ends, start Pulse now, or upgrade an eligible paid Pulse plan to Edge.",
        details:
          "Murph confirms only the result returned by the billing system. Any required payment or payment-method step stays on Stripe. Cancellations, Family changes, usage top-ups, and direct trial-to-Edge changes remain outside this chat flow.",
        relevanceTags: ["billing", "assistant", "subscriptions"],
        sourcePullRequests: [736],
      },
      {
        id: "usage-top-ups",
        kind: "feature",
        priority: 5,
        title: "Add usage when you need more",
        summary:
          "Direct Pulse and Edge members can add $5, $10, or $25 of usage in Settings through Stripe Checkout. Credit carries across monthly resets.",
        details:
          "Purchased credit shows separately from the included-usage percentage. If you run out entirely, your messages wait safely and processing resumes once a purchase is verified. Family plans are not eligible yet.",
        relevanceTags: ["billing", "usage", "plans"],
        sourcePullRequests: [751],
        tryIt: {
          href: "/settings#subscription",
          label: "Add usage in Settings",
        },
      },
      {
        id: "group-owned-murph-style",
        kind: "feature",
        priority: 5,
        title: "Give each group its own Murph style",
        summary:
          "In an authenticated group iMessage conversation, ask to change Tone, Voice, Humor, Push, or Detail and the room now saves those choices for its own Murph.",
        details:
          "The group choices begin with the next reply and never read or overwrite any participant's private Murph settings. Group email remains read-only.",
        relevanceTags: ["groups", "personalization", "privacy"],
        sourcePullRequests: [738, 745],
      },
      {
        id: "context-aware-follow-through",
        kind: "feature",
        priority: 5,
        title: "Follow-through checks the context first",
        summary:
          "Your private Murph now checks what you have already shared, asks the questions that could change the answer, and can offer reminders or check-ins when they would help.",
        details:
          "Accountability check-ins require your explicit agreement; a simple reminder remains a cue. Before asking, Murph checks the relevant conversation and connected evidence, skips known outcomes, treats missing or stale evidence as unknown, and anchors group evidence to the right local occurrence.",
        relevanceTags: ["assistant", "follow-through", "reminders"],
        sourcePullRequests: [733, 737, 753],
      },
      {
        id: "murph-safe-product-search",
        kind: "feature",
        priority: 4,
        title: "Look up what is actually in a supplement",
        summary:
          "A new public search covers supplements and branded foods, showing label contents, linked product-test results, and what has not been tested, with unknowns stated as unknowns.",
        details:
          "Murph Safe names the evidence-checking process; it never stamps a product safe or unsafe. Search terms stay out of URLs, logs, and analytics, and the same records are available through a versioned public API.",
        relevanceTags: ["supplements", "nutrition", "search"],
        sourcePullRequests: [765],
        tryIt: {
          href: "/search",
          label: "Search a product",
        },
      },
      {
        id: "scheduled-replies-keep-context",
        kind: "improvement",
        priority: 5,
        title: "Replies keep their place",
        summary:
          "Replying to a scheduled message now carries the notification context you are answering, so Murph can understand a short yes or follow-up without making you restate it.",
        details:
          "For established iMessage conversations, Murph also starts waking after a safely stored message while the durable handoff finishes, removing one serial wait without weakening duplicate-reply protection.",
        relevanceTags: ["assistant", "messaging", "reliability"],
        sourcePullRequests: [742, 749],
      },
      {
        id: "onboarding-asks-before-it-prescribes",
        kind: "improvement",
        priority: 4,
        title: "Onboarding asks before it prescribes",
        summary:
          "Murph now opens by understanding one or two outcomes you care about and saves them as an anchor, instead of turning your first answer into an unsolicited routine.",
        details:
          "You choose which thread to work on after the health foundation is gathered. Keeping the assistant warm between turns also trims reply time.",
        relevanceTags: ["onboarding", "assistant", "performance"],
        sourcePullRequests: [746],
      },
      {
        id: "whoop-apple-health-fallback",
        kind: "improvement",
        priority: 4,
        title: "WHOOP setup keeps moving through Apple Health",
        summary:
          "When direct WHOOP capacity is full, setup now switches to a clear Apple Health path instead of ending in a generic error, with the exact WHOOP menu steps and the Murph iPhone app link.",
        details:
          "Members who already have a direct WHOOP connection can still reconnect. The fallback appears only when direct capacity is full.",
        relevanceTags: ["whoop", "apple-health", "wearables"],
        sourcePullRequests: [741],
      },
      {
        id: "phone-calls-in-plan-usage",
        kind: "improvement",
        priority: 4,
        title: "Phone calls now count toward plan usage",
        summary:
          "The included-usage percentage now reflects outbound phone calls once they finish, including transferred calls, so Settings and chat show a more complete total.",
        details:
          "Each finished call is counted once. Earlier calls are not added retroactively, and this does not create per-call billing or overage charges.",
        relevanceTags: ["phone-calls", "plans", "usage"],
        sourcePullRequests: [743],
      },
      {
        id: "less-repeated-work-behind-everyday-screens",
        kind: "improvement",
        priority: 4,
        title: "Less repeated work behind everyday screens",
        summary:
          "Settings, connected-device status, and growing group views now avoid repeated lookups, as do fresh sign-in checks and the safety checks behind iMessage replies.",
        details:
          "Multi-part saves also upload their required pieces together instead of one by one, while still waiting for every piece before confirming success. Permissions and privacy checks remain intact.",
        relevanceTags: ["dashboard", "performance", "reliability"],
        sourcePullRequests: [727, 728, 729, 730, 731, 732, 735],
      },
      {
        id: "home-experiment-history-compact",
        kind: "improvement",
        priority: 3,
        title: "Completed experiments take less room on Home",
        summary:
          "Finished experiment cards are denser and show every comparable metric change in order, instead of one hand-picked result that could hide a mixed outcome.",
        relevanceTags: ["experiments", "dashboard"],
        sourcePullRequests: [758],
      },
      {
        id: "biomarker-pages-restored",
        kind: "improvement",
        priority: 3,
        title: "Biomarker detail pages load again",
        summary:
          "The HRV (RMSSD) biomarker page and its research tab render normally in production instead of a 404, with a build check that keeps every published biomarker route intact.",
        relevanceTags: ["biomarkers", "reliability"],
        sourcePullRequests: [756],
      },
    ],
  },
  {
    id: "2026-07-15",
    publishedOn: "2026-07-15",
    title: "A lighter way to say yes",
    summary:
      "A like can now answer Murph on iMessage, existing group members can approve a clearly disclosed sharing request without rejoining, and 250 more exercise guides are illustrated. Family owners can change a member's plan person by person, anyone can leave a group on their own, new Pulse Trials run for two weeks, and replies read more like natural texting.",
    items: [
      {
        id: "affirmative-reactions-as-replies",
        kind: "feature",
        priority: 5,
        title: "A like can answer Murph",
        summary:
          "Like Murph's own iMessage when a simple yes is enough and the reaction now enters the conversation as your reply, in both private and group chats.",
        details:
          "The reaction must point to an exact message Murph sent in the same conversation. Unmatched reactions stay silent instead of guessing what you meant.",
        relevanceTags: ["assistant", "imessage", "reactions"],
        sourcePullRequests: [655, 664],
      },
      {
        id: "reaction-first-group-permissions",
        kind: "feature",
        priority: 5,
        title: "Add group permissions with a like",
        summary:
          "When an existing group needs more shared data, Murph can post the exact request in the chat. Like that message to add only the permissions shown, or open the linked page to customize them.",
        details:
          "Murph now defaults to this in-chat consent flow when existing members approve additional permissions.",
        relevanceTags: ["groups", "permissions", "reactions"],
        sourcePullRequests: [661],
      },
      {
        id: "family-member-plan-management",
        kind: "feature",
        priority: 4,
        title: "Manage Family plans person by person",
        summary:
          "Each Family member row in Settings now has a Manage action to upgrade someone to Edge or bring them back to Pulse, with the prorated difference applied on the next invoice.",
        details:
          "Seat-quantity controls are gone; you manage people, not Stripe inventory. The row shows the pending change until billing confirms it, and Family usage stays attributed to your Family plan during brief billing-data gaps.",
        relevanceTags: ["family", "billing", "settings"],
        sourcePullRequests: [671, 672],
      },
      {
        id: "leave-a-group-yourself",
        kind: "feature",
        priority: 4,
        title: "Leave a group on your own",
        summary:
          "Non-owner members can ask their private Murph to leave a group, or use the Leave group action on the join page. Leaving ends your sharing with that group's Murph.",
        details:
          "It does not remove you from the iMessage thread or erase past messages, and you can rejoin later through the normal join flow.",
        relevanceTags: ["groups", "privacy"],
        sourcePullRequests: [676],
      },
      {
        id: "exercise-library-250-more-visual-guides",
        kind: "feature",
        priority: 4,
        title: "250 more exercises have visual guides",
        summary:
          "Another 250 strength movements, mobility drills, and stretches now include illustrated step-by-step carousels instead of text alone.",
        details:
          "The catalog now has visual guides for 1,655 of 1,748 movements. Each new carousel was checked at full resolution for anatomy, movement order, equipment, and left-right accuracy before it was published.",
        relevanceTags: ["exercise", "images", "accessibility"],
        sourcePullRequests: [],
        tryIt: {
          label: "Ask for an exercise guide",
          prompt: "Show me the steps for a mobility drill with clear visuals.",
        },
      },
      {
        id: "fresh-messages-stay-foreground",
        kind: "improvement",
        priority: 5,
        title: "Fresh messages stay ahead of background work",
        summary:
          "A new text now gets Murph's attention before workspace cleanup, recovery, or checkpoint work. When a conversation is already active, the new message can steer the reply without waiting for background housekeeping to finish.",
        relevanceTags: ["assistant", "messaging", "reliability"],
        sourcePullRequests: [635, 636, 641, 643, 653, 656],
      },
      {
        id: "pulse-trial-two-weeks",
        kind: "feature",
        priority: 4,
        title: "Pulse Trial now runs for two weeks",
        summary:
          "Every new Pulse Trial now lasts 14 days instead of 10. Trials already created keep the policy and end date they started with.",
        relevanceTags: ["pulse", "billing", "trial"],
        sourcePullRequests: [726],
      },
      {
        id: "replies-read-like-texting",
        kind: "improvement",
        priority: 4,
        title: "Replies read like texting again",
        summary:
          "Send a follow-up while Murph is still working and it folds into the reply in progress, and multi-bubble answers now land at a short, readable cadence instead of all at once.",
        relevanceTags: ["assistant", "imessage", "messaging"],
        sourcePullRequests: [705, 713],
      },
      {
        id: "model-settings-refresh",
        kind: "improvement",
        priority: 4,
        title: "Model choices are easier to compare and change",
        summary:
          "Settings shows Luna, Terra, and Sol as clear cards, Family Edge seats can now pick Sol, and asking Murph to change model or reasoning saves immediately without an approval link.",
        relevanceTags: ["settings", "models", "family"],
        sourcePullRequests: [678, 686, 687],
      },
      {
        id: "experiment-cards-honest-colors",
        kind: "improvement",
        priority: 3,
        title: "Experiment cards color results by the biomarker",
        summary:
          "Progress cards now color movement by whether it is good for that biomarker, so a higher HRV reads as favorable even when your hypothesis expected a drop.",
        relevanceTags: ["experiments", "biomarkers"],
        sourcePullRequests: [699],
      },
      {
        id: "voice-previews-pick-the-voice",
        kind: "improvement",
        priority: 3,
        title: "Voice previews respond to a click anywhere",
        summary:
          "In the voice picker, clicking a waveform now plays that preview, and clicking a preview selects that voice, so trying and choosing are one motion.",
        relevanceTags: ["voice", "settings"],
        sourcePullRequests: [695, 718],
      },
      {
        id: "signup-and-email-linking-fixes",
        kind: "improvement",
        priority: 3,
        title: "Sign-up and email linking behave",
        summary:
          "New members who sign up through the shared dialog now land in the first-visit welcome, and linking an email in Settings only reports success after it actually saves, with a clear retry.",
        relevanceTags: ["onboarding", "settings", "reliability"],
        sourcePullRequests: [670, 717],
      },
      {
        id: "billing-settings-handoff",
        kind: "improvement",
        priority: 3,
        title: "Billing questions lead to the right controls",
        summary:
          "Ask about your plan, subscription, or Family billing and Murph can read your current plan summary, then send you to the Subscription section in Settings for any account change.",
        details:
          "The chat handoff never claims a billing change happened. Settings remains the place that owns checkout, subscription, and Family account controls.",
        relevanceTags: ["billing", "settings", "assistant"],
        sourcePullRequests: [667],
        tryIt: {
          href: "/settings#subscription",
          label: "Open subscription settings",
        },
      },
    ],
  },
  {
    id: "2026-07-14",
    publishedOn: "2026-07-14",
    title: "Your plan, groups, and next appointment",
    summary:
      "See monthly plan use as a percentage, ask personal Murph which groups you belong to, and start appointment requests with a complete brief. Apple Health setup can now begin in chat, with a clear handoff to the iPhone companion.",
    items: [
      {
        id: "plan-usage-percentage",
        kind: "feature",
        priority: 5,
        title: "See how much of your monthly plan you have used",
        summary:
          "Settings, chat, and usage notices now describe your monthly allowance with the same percentage, so you can understand where you stand without decoding internal cost figures.",
        details:
          "When there is enough history, Murph can also give a bounded forecast and the next available plan action without treating the estimate as a cutoff.",
        relevanceTags: ["billing", "plans", "usage"],
        sourcePullRequests: [570, 607, 621],
        tryIt: {
          label: "Check plan usage",
          prompt: "How much of my plan have I used this month?",
        },
      },
      {
        id: "personal-group-awareness",
        kind: "feature",
        priority: 5,
        title: "Ask Murph which groups you belong to",
        summary:
          "Your private Murph can now list your groups, your role in each one, what the group has requested, and what you currently share. When an authorized link is available, it also shows where to review those permissions.",
        details:
          "The answer stays scoped to your own memberships and permissions. It does not expose another member's identity or sharing choices.",
        relevanceTags: ["groups", "assistant", "permissions"],
        sourcePullRequests: [542, 620, 634],
        tryIt: {
          label: "Review your groups",
          prompt: "Which Murph groups am I in, and what am I sharing with each one?",
        },
      },
      {
        id: "appointment-scheduling-brief",
        kind: "feature",
        priority: 4,
        title: "Appointment requests start with a complete brief",
        summary:
          "Ask Murph to book, move, cancel, or join a waitlist and it now checks the context you already shared, then asks only for the missing details needed to carry out the request.",
        details:
          "Once the brief is complete, Murph can use the available phone, browser, or connected-app path. One-off appointment details stay with the task unless you explicitly ask to save a reusable preference.",
        relevanceTags: ["appointments", "assistant", "automation"],
        sourcePullRequests: [646],
        tryIt: {
          label: "Plan an appointment",
          prompt: "Help me schedule my next dentist appointment.",
        },
      },
      {
        id: "apple-health-chat-handoff",
        kind: "feature",
        priority: 4,
        title: "Apple Health setup can start in chat",
        summary:
          "Ask Murph to connect Apple Health and it now explains the handoff, then sends the official iPhone companion link where sign-in and Health permissions belong.",
        details:
          "If you use WHOOP, Murph also gives the documented Apple Health forwarding steps before sharing the companion link. It does not invent a WHOOP deep link.",
        relevanceTags: ["apple-health", "wearables", "onboarding"],
        sourcePullRequests: [],
        tryIt: {
          label: "Connect Apple Health",
          prompt: "Help me connect Apple Health to Murph.",
        },
      },
    ],
  },
  {
    id: "2026-07-13",
    publishedOn: "2026-07-13",
    title: "More control, less waiting",
    summary:
      "Choose how Murph thinks, let approved tasks resume on their own, and get into your vault faster. Group joins now get a private check-in, group tools stay group-scoped, and browser logins have a cleaner fallback.",
    items: [
      {
        id: "model-and-reasoning-controls",
        kind: "feature",
        priority: 5,
        title: "Choose Murph's model and reasoning",
        summary:
          "Ask Murph to choose Luna, Terra, or, on Edge, Sol, plus the reasoning effort you want. You can also pick the default model in Settings. A saved change starts with the next reply, so the conversation already underway stays consistent.",
        details:
          "Luna and Terra are available to every active hosted member. Sol remains an Edge choice, and Murph never silently changes your selection when usage runs low.",
        relevanceTags: ["assistant", "models", "personalization"],
        sourcePullRequests: [587],
        tryIt: {
          href: "/settings",
          label: "Choose how Murph thinks",
        },
      },
      {
        id: "private-group-join-confirmation",
        kind: "feature",
        priority: 5,
        title: "Every group join gets a private check-in",
        summary:
          "The first time you join a Murph group, Murph now confirms it in your private chat, asks whether the join was intentional, and links straight to the controls for what you share.",
        details:
          "The check-in is private, arrives once, and never exposes the group's name or your sharing choices in a public response.",
        relevanceTags: ["groups", "privacy", "sharing"],
        sourcePullRequests: [563],
      },
      {
        id: "approved-actions-resume",
        kind: "feature",
        priority: 4,
        title: "Approved actions resume without another text",
        summary:
          "Approve or deny a sensitive action on its secure page and Murph now picks the parked task back up automatically. You no longer have to return to chat and send a second confirmation message.",
        relevanceTags: ["assistant", "approvals", "automation"],
        sourcePullRequests: [549],
      },
      {
        id: "group-tools-stay-group-scoped",
        kind: "improvement",
        priority: 5,
        title: "Group chats no longer borrow anyone's private controls",
        summary:
          "Voice settings, wearable links, connected accounts, Family billing, browser tasks, and phone calls stay in private chats. Group newsletters, sharing, and room-owned automations keep working where they belong.",
        details:
          "Each group runs in its own isolated thread workspace, and the web control plane independently rejects personal operations from that group identity.",
        relevanceTags: ["groups", "privacy", "assistant"],
        sourcePullRequests: [582, 583],
      },
      {
        id: "browser-vault-stays-warm",
        kind: "improvement",
        priority: 5,
        title: "Your vault opens faster and stays warm",
        summary:
          "Moving from the landing page into Home, or between dashboard pages, no longer starts a full reload. One in-memory vault view stays available while fresh data is checked in the background.",
        details:
          "The warm view never moves into browser storage, and logout, account deletion, or lost authorization clears it immediately.",
        relevanceTags: ["dashboard", "performance", "privacy"],
        sourcePullRequests: [586],
        tryIt: {
          href: "/home",
          label: "Open your vault",
        },
      },
      {
        id: "managed-login-live-fallback",
        kind: "improvement",
        priority: 4,
        title: "Browser login handoffs recover cleanly",
        summary:
          "If a managed browser login cannot start, Murph now restores the task browser and moves you to the existing live login handoff instead of sending you through the same failed retry loop.",
        relevanceTags: ["browser", "authentication", "reliability"],
        sourcePullRequests: [594],
      },
      {
        id: "group-weekly-shared-view",
        kind: "improvement",
        priority: 4,
        title: "Group updates use one shared weekly picture",
        summary:
          "Group chat and the weekly newsletter now read the same consented stats, including actual sleep duration, with week boundaries calculated in the group's timezone.",
        details:
          "Newsletter delivery still resolves recipients privately, so email addresses never enter Murph's writing context.",
        relevanceTags: ["groups", "newsletter", "privacy"],
        sourcePullRequests: [589, 601],
      },
      {
        id: "device-replays-storage-noop",
        kind: "improvement",
        priority: 3,
        title: "Repeat syncs stop bloating your vault",
        summary:
          "When a wearable sends the same records again, Murph now treats the replay as a storage no-op. New records, corrections, and genuinely new raw evidence are still preserved.",
        relevanceTags: ["wearables", "sync", "reliability"],
        sourcePullRequests: [521],
      },
    ],
  },
  {
    id: "2026-07-12",
    publishedOn: "2026-07-12",
    title: "Health help with more context",
    summary:
      "Murph learned a careful eye-health playbook, gained 250 illustrated exercise guides, and now starts onboarding with the thing you need today. Supplement advice checks your saved context first, while private calls and restored workspaces got stronger protection.",
    items: [
      {
        id: "eye-health-playbook",
        kind: "feature",
        priority: 5,
        title: "A careful playbook for everyday eye health",
        summary:
          "Ask about dry eyes, screen strain, contact lenses, routine eye exams, or a new symptom and Murph now follows a dedicated evidence-backed path instead of improvising from general health advice.",
        details:
          "Urgent warning signs stay first, routine self-care remains reachable, and contact-lens questions get their own safety and timing checks.",
        relevanceTags: ["assistant", "eye-health", "safety"],
        sourcePullRequests: [574],
        tryIt: {
          label: "Ask about your eyes",
          prompt: "My eyes feel dry after a full day at my laptop. What should I try first?",
        },
      },
      {
        id: "exercise-library-250-visual-guides",
        kind: "feature",
        priority: 5,
        title: "250 more exercises now come with visual guides",
        summary:
          "Strength movements, mobility drills, and stretches that used to be text-only now include short illustrated carousels with readable steps, clear camera angles, and useful alt text.",
        details:
          "The full batch was checked for anatomy, left-right accuracy, and movement order. One opposite-limb guide was corrected before release.",
        relevanceTags: ["exercise", "images", "accessibility"],
        sourcePullRequests: [561, 591],
        tryIt: {
          label: "Ask for an exercise guide",
          prompt: "Show me how to do a dead bug with clear step-by-step visuals.",
        },
      },
      {
        id: "value-first-onboarding",
        kind: "feature",
        priority: 5,
        title: "Onboarding starts with what you need today",
        summary:
          "New members begin with one useful question, decision, task, or change, then build a finite health foundation over later conversations. You no longer have to complete a profile or start an experiment before Murph can help.",
        details:
          "If nothing feels urgent, Murph can offer one optional baseline review and then leave the door open without inventing a problem.",
        relevanceTags: ["onboarding", "assistant", "personalization"],
        sourcePullRequests: [588],
      },
      {
        id: "supplements-use-saved-context",
        kind: "feature",
        priority: 5,
        title: "Supplement advice checks your real context first",
        summary:
          "Before suggesting a supplement, Murph now checks the goals, medications, conditions, and recent bloodwork you have already saved, then grounds the answer in cleaner label and ingredient search results.",
        details:
          "When your context changes the risk or likely benefit, that comes before a generic dose or product list.",
        relevanceTags: ["supplements", "assistant", "personalization"],
        sourcePullRequests: [538, 565],
        tryIt: {
          label: "Review a supplement",
          prompt: "Given my recent bloodwork and current medications, is magnesium worth considering?",
        },
      },
      {
        id: "phone-call-content-encrypted",
        kind: "improvement",
        priority: 5,
        title: "Phone-call details are encrypted at rest",
        summary:
          "The brief Murph uses for a call and the final result are now encrypted before they reach the database. Existing records have a bounded migration path that removes the old plaintext copy without logging it.",
        details:
          "Murph still does not store raw call transcripts, recordings, request bodies, or call audio.",
        relevanceTags: ["phone-calls", "privacy", "security"],
        sourcePullRequests: [567],
      },
      {
        id: "sessions-and-restores-fail-safer",
        kind: "improvement",
        priority: 4,
        title: "Sessions and restored workspaces fail safer",
        summary:
          "Browser sessions are now bound to a server-held signature, and a failed workspace restore preserves the last good copy instead of risking an empty replacement.",
        relevanceTags: ["privacy", "reliability", "security"],
        sourcePullRequests: [566, 568],
      },
      {
        id: "voice-card-tap-preview",
        kind: "improvement",
        priority: 3,
        title: "Tap any voice card to hear it",
        summary:
          "Choosing Murph's voice no longer depends on hitting the tiny play control. The whole card now selects and previews the voice, while the familiar play and pause button still works.",
        relevanceTags: ["voice", "onboarding", "accessibility"],
        sourcePullRequests: [],
        tryIt: {
          href: "/settings",
          label: "Preview Murph's voices",
        },
      },
    ],
  },
  {
    id: "2026-07-11",
    publishedOn: "2026-07-11",
    title: "A cleaner fit on every phone",
    summary:
      "The smallest screens got a focused polish pass, from the homepage's rich demo cards to device connection states. Brand-new group chats also recover cleanly when their shared state has not been created yet.",
    items: [
      {
        id: "small-phone-layout-polish",
        kind: "improvement",
        priority: 4,
        title: "Homepage and connect cards fit small phones",
        summary:
          "The Labs and Habits demos now stay inside an iPhone mini-width screen, and wide connection or reconnect messages stack before they can overlap device details.",
        details:
          "Dense waveforms and duplicate unit text were trimmed where they added width without adding meaning.",
        relevanceTags: ["mobile", "dashboard", "design"],
        sourcePullRequests: [576, 577],
      },
      {
        id: "new-group-state-recovery",
        kind: "improvement",
        priority: 4,
        title: "Brand-new group chats no longer stall on setup",
        summary:
          "If a group messages Murph before its shared workspace has been created, Murph now recognizes the missing first-run state and completes setup instead of treating the group as broken.",
        relevanceTags: ["groups", "onboarding", "reliability"],
        sourcePullRequests: [],
      },
    ],
  },
  {
    id: "2026-07-10",
    publishedOn: "2026-07-10",
    title: "A Murph that sounds more like you",
    summary:
      "Choose how Murph talks, pick a stronger model on Edge, and make group challenges more creative. Conversations also got faster, browser handoffs recover more cleanly, and missing wearable history is less likely to stay missing.",
    items: [
      {
        id: "murph-style-controls",
        kind: "feature",
        priority: 5,
        title: "Make Murph sound more like you",
        summary:
          "Choose Murph's texting tone and voice-memo voice during onboarding or from Settings. In a private chat, you can also set Humor, Push, and Detail anywhere from 0 to 10.",
        details:
          "The three conversation dials persist across future chats, while safety, privacy, and the facts always take priority over style.",
        relevanceTags: ["assistant", "personalization", "voice"],
        sourcePullRequests: [485, 512, 529, 572],
        tryIt: {
          href: "/settings",
          label: "Customize Murph",
        },
      },
      {
        id: "edge-model-choice",
        kind: "feature",
        priority: 4,
        title: "Edge members can choose GPT-5.6 Sol",
        summary:
          "Edge members can switch Murph from the default GPT-5.6 Terra model to GPT-5.6 Sol in Settings, then switch back whenever they want.",
        details:
          "Members who are not on Edge can now see the model choice and the upgrade path in the same place.",
        relevanceTags: ["assistant", "models", "edge"],
        sourcePullRequests: [515, 539],
        tryIt: {
          href: "/settings",
          label: "Choose a model",
        },
      },
      {
        id: "group-challenge-comics-and-stakes",
        kind: "feature",
        priority: 4,
        title: "Group challenges got comics, songs, and better stakes",
        summary:
          "Murph can turn group photos and running jokes into comic-strip standings, write an intro song, and help the group choose stakes that are playful without becoming reckless.",
        details:
          "The group's agreed rules, photos, jokes, and daily dispatches stay attached to the challenge so the bit can keep building over time.",
        relevanceTags: ["groups", "challenges", "images", "music"],
        sourcePullRequests: [503, 520],
      },
      {
        id: "whoop-recovery-strain-healthkit",
        kind: "feature",
        priority: 4,
        title: "WHOOP Recovery and Strain arrive through Apple Health",
        summary:
          "The iPhone companion now picks up WHOOP Recovery scores and workout Strain values that Apple Health stores but ordinary sync can miss.",
        details:
          "The enrichment is bounded to those two values and joins the same private health record as the rest of your wearable data.",
        relevanceTags: ["whoop", "apple-health", "wearables"],
        sourcePullRequests: [502],
      },
      {
        id: "browser-handoffs-recover",
        kind: "improvement",
        priority: 4,
        title: "Browser handoffs recover without starting over",
        summary:
          "If a private browser handoff expires, your next message can let Murph pick the task back up instead of leaving the browser session stuck.",
        details:
          "Fresh handoff links are now guaranteed to reach the reply, and the live page no longer fights the browser over its viewport.",
        relevanceTags: ["browser", "assistant", "reliability"],
        sourcePullRequests: [544],
      },
      {
        id: "faster-cleaner-conversations",
        kind: "improvement",
        priority: 4,
        title: "Replies start faster and stay cleaner",
        summary:
          "Murph does less unrelated maintenance before answering, keeps the typing indicator alive after a progress note, and keeps internal working commentary out of member messages.",
        relevanceTags: ["assistant", "performance", "messaging"],
        sourcePullRequests: [496, 508, 510, 519, 537],
      },
      {
        id: "junction-history-self-heals",
        kind: "improvement",
        priority: 4,
        title: "Missing wearable history keeps trying to recover",
        summary:
          "A successful activity import can no longer make Murph assume your missing sleep history is complete. Historical sync now checks each kind of data independently and retries bounded gaps.",
        details:
          "The evidence window also stays anchored to the period Murph actually requested, so older records do not create a false picture of recent coverage.",
        relevanceTags: ["wearables", "junction", "sync"],
        sourcePullRequests: [516, 545],
      },
      {
        id: "group-chats-stay-grouped",
        kind: "improvement",
        priority: 4,
        title: "Group chats stay in group mode",
        summary:
          "Murph now confirms that an iMessage thread is a group before planning a reply, so a group conversation cannot accidentally fall into someone's private onboarding flow.",
        relevanceTags: ["groups", "imessage", "privacy"],
        sourcePullRequests: [522],
      },
    ],
  },
  {
    id: "2026-07-09",
    publishedOn: "2026-07-09",
    title: "Better answers, better instincts",
    summary:
      "Murph gained focused playbooks for the health questions people actually ask, learned when to offer a useful next step, and stopped recommending setup you already finished.",
    items: [
      {
        id: "health-topic-playbooks",
        kind: "feature",
        priority: 5,
        title: "Fifteen new health topic playbooks",
        summary:
          "Murph now has focused guidance for cardio fitness, body composition, cardiometabolic health, circadian rhythm, focus, hormonal health, daily activity, fatigue, digestion, HRV, supplements, mobility, recovery, sleep, and substance load.",
        details:
          "Each playbook starts with your own context and data, names when the evidence is thin, and keeps clinician handoffs clear for questions that should not be improvised in chat.",
        relevanceTags: ["assistant", "health", "research"],
        sourcePullRequests: [490],
        tryIt: {
          label: "Ask about a health pattern",
          prompt: "Help me understand why my energy has been low lately.",
        },
      },
      {
        id: "relevant-capability-offers",
        kind: "feature",
        priority: 4,
        title: "Murph offers a useful next step when it fits",
        summary:
          "When a conversation clearly points to something Murph can take off your plate, it can now offer one concrete next step instead of waiting for you to know the feature exists.",
        details:
          "Offers stay bounded and situational: one relevant call, browser task, experiment, connection, reminder, or group setup, never a menu or a sales pitch.",
        relevanceTags: ["assistant", "discovery", "automation"],
        sourcePullRequests: [487],
      },
      {
        id: "connected-device-aware-product-notes",
        kind: "improvement",
        priority: 3,
        title: "Connected wearables no longer get pitched twice",
        summary:
          "Background product notes now know when a wearable is already active, so Murph will not suggest connecting the device you already use.",
        relevanceTags: ["wearables", "assistant", "onboarding"],
        sourcePullRequests: [506],
      },
    ],
  },
  {
    id: "2026-07-08",
    publishedOn: "2026-07-08",
    title: "Advice grounded in your own data",
    summary:
      "Ask Murph how to improve your deep sleep and it now opens with what your own data says, instead of a tip list you could have gotten anywhere. Weekly automations got quieter and sharper, the images Murph makes are kept for later, and Apple Health finally shows up on the connect page.",
    items: [
      {
        id: "grounded-health-advice",
        kind: "feature",
        priority: 5,
        title: "Advice grounded in your own data",
        summary:
          "Ask how to fix your deep sleep and Murph leads with what it found in your wearable trends, vault, and memory, or asks the couple of questions it needs before answering.",
        details:
          "When the picture is too thin to beat a generic answer, Murph says so and gathers what's missing rather than guessing at advice that happens to sound personal.",
        relevanceTags: ["assistant", "health", "wearables"],
        sourcePullRequests: [480],
        tryIt: {
          label: "Ask about your sleep",
          prompt: "How do I improve my deep sleep?",
        },
      },
      {
        id: "weekly-improvement-coach",
        kind: "feature",
        priority: 4,
        title: "A Tuesday nudge, only when it's worth one",
        summary:
          "Once a week Murph looks for a single clearly fixable thing in your data, like low deep sleep or no strength training, and offers to work on it with you. Most weeks it stays quiet.",
        relevanceTags: ["automations", "coaching", "health"],
        sourcePullRequests: [481],
      },
      {
        id: "generated-images-saved-to-vault",
        kind: "feature",
        priority: 4,
        title: "The images Murph makes stick around",
        summary:
          "Every image Murph generates, including a group chat photo, is saved to your vault, so you can ask for a variation later instead of starting from scratch.",
        relevanceTags: ["images", "vault", "groups"],
        sourcePullRequests: [477],
      },
      {
        id: "quieter-weekly-messages",
        kind: "improvement",
        priority: 4,
        title: "Weekly notes stay quiet unless they have something",
        summary:
          "The weekly digest and the research scout used to read your dashboard back to you. Now an ordinary week sends nothing, and a note only goes out when it has something you'd remember.",
        relevanceTags: ["automations", "newsletter"],
        sourcePullRequests: [482],
      },
      {
        id: "apple-health-connect-card",
        kind: "improvement",
        priority: 3,
        title: "Apple Health shows up on the connect page",
        summary:
          "Apple Health now appears on the connect page with its real status from your iPhone, instead of being left off the list while its data was already flowing in.",
        relevanceTags: ["wearables", "onboarding", "apple-health"],
        sourcePullRequests: [449],
      },
      {
        id: "whoop-sleep-beats-empty-copies",
        kind: "improvement",
        priority: 3,
        title: "Real sleep data wins over empty copies",
        summary:
          "When Apple Health forwards a hollow copy of a night your WHOOP already recorded, Murph now reads the WHOOP record instead of reporting zero deep and REM sleep.",
        relevanceTags: ["sleep", "wearables", "whoop"],
        sourcePullRequests: [471],
      },
      {
        id: "songs-fit-their-length",
        kind: "improvement",
        priority: 3,
        title: "Generated songs fit their length",
        summary:
          "A 30-second song used to cram a full verse and chorus into the time and come back sung double-time. Murph now writes to a word budget that matches the duration.",
        relevanceTags: ["music", "assistant"],
        sourcePullRequests: [479],
      },
      {
        id: "reminders-follow-your-current-line",
        kind: "improvement",
        priority: 3,
        title: "Scheduled reminders follow your current line",
        summary:
          "If the number you text Murph on changes, scheduled reminders now arrive where you actually are instead of failing against the route they were set up on.",
        relevanceTags: ["reminders", "imessage", "reliability"],
        sourcePullRequests: [476],
      },
      {
        id: "murph-remembers-your-name",
        kind: "improvement",
        priority: 3,
        title: "Murph remembers the name you gave it",
        summary:
          "Your preferred name lives in Murph's memory now, so group chats introduce you by it and existing accounts get it filled in without being asked again.",
        relevanceTags: ["memory", "groups", "onboarding"],
        sourcePullRequests: [478],
      },
      {
        id: "group-bursts-reach-murph",
        kind: "improvement",
        priority: 3,
        title: "Busy group chats don't stall your message",
        summary:
          "A burst of more than ten messages in a group chat used to leave the later ones waiting for the next wake-up. Every message now reaches Murph while it's already awake.",
        relevanceTags: ["groups", "messaging", "performance"],
        sourcePullRequests: [453],
      },
      {
        id: "usage-limit-keeps-your-message",
        kind: "improvement",
        priority: 3,
        title: "Hitting your limit no longer eats your message",
        summary:
          "If your AI allowance runs out mid-conversation, the message you sent is held and answered when the limit resets, and the notice about it goes out exactly once.",
        relevanceTags: ["usage", "messaging"],
        sourcePullRequests: [],
      },
      {
        id: "shorter-group-join-screen",
        kind: "improvement",
        priority: 3,
        title: "A shorter group join screen",
        summary:
          "Joining a group is less reading: trimmed copy throughout, and the consent box only asks for the agreement you haven't already given.",
        relevanceTags: ["groups", "onboarding", "polish"],
        sourcePullRequests: [],
      },
      {
        id: "small-fixes-july-eight",
        kind: "improvement",
        priority: 3,
        title: "A handful of small fixes",
        summary:
          "Murph stops quote-replying your texts, the typing bubble works in group chats again, image generation waits longer before giving up, and a skipped device sync retries instead of waiting a day.",
        relevanceTags: ["polish", "imessage", "reliability"],
        sourcePullRequests: [],
      },
    ],
  },
  {
    id: "2026-07-07",
    publishedOn: "2026-07-07",
    title: "Shorter texts, self-tracking experiments",
    summary:
      "Murph now texts in a few short bubbles instead of one wall of text. Experiments keep their own score: workouts from your watch count automatically, and sessions Murph can't sense (sauna, tretinoin, supplements) count as done unless you say otherwise. Plus a weekly health newsletter for your group, group renames and photos, and faster answers when you interrupt background work.",
    items: [
      {
        id: "reply-message-bubbles",
        kind: "feature",
        priority: 5,
        title: "Murph texts the way people text",
        summary:
          "On iMessage and Telegram, a reply now arrives as two or three short bubbles instead of one block of text, with the question last and nothing after it.",
        relevanceTags: ["messaging", "imessage", "polish"],
        sourcePullRequests: [447],
      },
      {
        id: "experiments-track-themselves",
        kind: "feature",
        priority: 5,
        title: "Experiments track themselves",
        summary:
          "A running experiment counts the sessions your watch already recorded and never asks you to log them. One Murph can't sense, like sauna or tretinoin, counts each planned session as done by default; say you skipped a day and it flips with one message.",
        details:
          "Progress shows how Murph knows: sensed from a wearable, confirmed by you, or assumed on schedule. Results that rest mostly on assumed sessions read one confidence level lower, with the reason stated.",
        relevanceTags: ["experiments", "wearables", "adherence"],
        sourcePullRequests: [416, 441],
        tryIt: {
          label: "Check an experiment",
          prompt: "How's my sauna experiment going?",
        },
      },
      {
        id: "group-health-newsletter",
        kind: "feature",
        priority: 4,
        title: "A weekly health newsletter for your group",
        summary:
          "From inside a group chat, ask Murph to set up a weekly health newsletter. It emails one shared digest to everyone who opted in, celebrating wins and nudging gently, in the tone the group picks.",
        details:
          "It reads only the stats members already share into the group, never texts anyone's address to the model, and waits out an opt-out window before the first edition instead of sending right away.",
        relevanceTags: ["groups", "newsletter", "email"],
        sourcePullRequests: [400],
        tryIt: {
          label: "Start a newsletter",
          prompt: "Set up a weekly health newsletter for our group.",
        },
      },
      {
        id: "group-rename-and-avatar",
        kind: "feature",
        priority: 4,
        title: "Rename your group chat and give it a photo",
        summary:
          "Ask Murph in a group chat to rename it or set the group photo and it changes the real iMessage chat. It can draw the picture or use one someone already sent.",
        relevanceTags: ["groups", "imessage", "images"],
        sourcePullRequests: [452, 457, 460],
        tryIt: {
          label: "Name the group",
          prompt: "Rename this chat to Sunday Crew and make us a group photo.",
        },
      },
      {
        id: "newsletter-setup-questions",
        kind: "improvement",
        priority: 3,
        title: "The newsletter asks before it starts",
        summary:
          "Murph now asks who the group newsletter is for, what belongs in it, and what to call it rather than inventing a name and creating it on the spot.",
        relevanceTags: ["newsletter", "groups", "onboarding"],
        sourcePullRequests: [438, 454, 455],
      },
      {
        id: "challenge-score-sharing",
        kind: "feature",
        priority: 4,
        title: "Challenges score steps, distance, or sessions",
        summary:
          "A group challenge can now ask for the exact daily number it needs, like running distance or strength sessions, and each person approves that one number before anything is shared.",
        details:
          "Murph never sees routes or raw workouts for a challenge, only the bounded daily total the challenge was built on.",
        relevanceTags: ["groups", "challenges", "privacy"],
        sourcePullRequests: [445, 459],
      },
      {
        id: "weekly-note-alternates-features",
        kind: "improvement",
        priority: 3,
        title: "Your weekly note alternates news and features",
        summary:
          "The weekly note from Murph now carries what shipped every other week, and in the off weeks it surfaces a feature you have not tried yet.",
        relevanceTags: ["automations", "discovery"],
        sourcePullRequests: [436],
      },
      {
        id: "homepage-group-chat-morph",
        kind: "improvement",
        priority: 3,
        title: "The homepage tells the group story",
        summary:
          "The hero phone on the homepage now morphs from a one-on-one thread into a group chat mid-demo, and the page explains challenges and the group newsletter for anyone who does not watch it.",
        relevanceTags: ["landing", "design", "groups"],
        sourcePullRequests: [420],
      },
      {
        id: "vault-files-actually-send",
        kind: "improvement",
        priority: 3,
        title: "Files from your vault actually arrive",
        summary:
          "Asking Murph to text you a PDF from your vault used to end with Murph saying it sent one that never showed up. Attachments deliver over iMessage now, and a failed send is reported instead of claimed.",
        relevanceTags: ["imessage", "vault", "reliability"],
        sourcePullRequests: [451],
      },
      {
        id: "faster-recovery-from-stalled-replies",
        kind: "improvement",
        priority: 3,
        title: "A stalled reply recovers in seconds, not minutes",
        summary:
          "When the connection to the model goes silent mid-reply, Murph gives up and reconnects after 90 seconds instead of sitting there for five minutes.",
        relevanceTags: ["performance", "reliability"],
        sourcePullRequests: [442],
      },
      {
        id: "messages-preempt-background-work",
        kind: "improvement",
        priority: 4,
        title: "Your message cuts ahead of Murph's chores",
        summary:
          "Text Murph while it's mid background task, a scheduled scan or a big import, and it now stops and answers you right away instead of finishing the chore first. The background work retries on its own later.",
        relevanceTags: ["performance", "messaging", "reliability"],
        sourcePullRequests: [431],
      },
      {
        id: "usage-limit-notice",
        kind: "improvement",
        priority: 3,
        title: "You hear it when you hit your usage limit",
        summary:
          "When your AI allowance runs out, Murph finishes the reply in flight and then tells you once, instead of going quiet until you text in days later and get turned away.",
        relevanceTags: ["messaging", "usage"],
        sourcePullRequests: [437],
      },
      {
        id: "typing-holds-until-reply-lands",
        kind: "improvement",
        priority: 3,
        title: "The typing bubble stays up until the reply lands",
        summary:
          "On iMessage the typing indicator used to vanish a second or two before Murph's message arrived. It now holds until the reply actually sends, and replies land a touch sooner too.",
        relevanceTags: ["imessage", "polish"],
        sourcePullRequests: [421],
      },
      {
        id: "simpler-family-invite",
        kind: "improvement",
        priority: 3,
        title: "A simpler family invite",
        summary:
          "Inviting someone to your family plan is now one screen: name first, a single contact field that switches between Messages, email, and Telegram, and far less fine print. The privacy line always matches what you actually entered.",
        relevanceTags: ["family", "invites", "polish"],
        sourcePullRequests: [428, 434, 439],
      },
      {
        id: "device-connect-confirmation-heals",
        kind: "improvement",
        priority: 3,
        title: "Connecting a device lands on the right confirmation",
        summary:
          "After a wearable links up, the confirmation screen now reliably shows the connected source and a Text Murph button, even when the browser replays the callback or a fresh sign-in hasn't caught up yet.",
        relevanceTags: ["wearables", "onboarding", "polish"],
        sourcePullRequests: [430],
      },
      {
        id: "better-generated-songs",
        kind: "improvement",
        priority: 3,
        title: "Better reminder songs and challenge tracks",
        summary:
          "Murph got a dedicated playbook for writing music prompts, so the songs it generates for reminders, challenges, and celebrations land closer to the genre and mood it's going for.",
        relevanceTags: ["assistant", "music"],
        sourcePullRequests: [440],
      },
    ],
  },
  {
    id: "2026-07-06",
    publishedOn: "2026-07-06",
    title: "Murph referees your group challenge",
    summary:
      "Group chats can now run multi-day challenges with Murph as referee, complete with daily standings in rotating formats. Friends can join a group just by liking Murph's message, family invites work over plain texting, workouts from your wearable count toward experiments, and replies got faster and steadier across the board.",
    items: [
      {
        id: "group-challenge-referee",
        kind: "feature",
        priority: 5,
        title: "Murph referees your group challenge",
        summary:
          "A group chat can now run a multi-day challenge start to finish: Murph negotiates the metric, kicks off with intros and photos, posts one daily standings drop in a rotating format (text, comic, voice memo, song, or ruling), and settles the stakes at the close.",
        details:
          "Challenge state lives on a knowledge page in the group's vault, so rules, stakes, and standings survive any reset. Kickoff photos stay usable in generated images on every later day of the challenge.",
        relevanceTags: ["groups", "challenges", "assistant"],
        sourcePullRequests: [410],
        tryIt: {
          label: "Start a challenge",
          prompt: "Start a 5-day steps challenge with us. Loser buys dinner.",
        },
      },
      {
        id: "family-invite-imessage-accept",
        kind: "feature",
        priority: 4,
        title: "Family invites now work over plain texting",
        summary:
          "An invite bound to a phone number leads with Continue in Messages: the invitee sends one prefilled text to Murph's line and they're in. Telegram is only offered when the invite is actually bound to a Telegram username.",
        details:
          "Invites with no binding can be claimed by whoever holds the link, but only through an explicit act: sending the join text, opening the deep link, or tapping Accept after signing in. The plan owner gets a heads-up when someone joins.",
        relevanceTags: ["family", "invites", "messaging"],
        sourcePullRequests: [401],
      },
      {
        id: "device-workouts-count-toward-experiments",
        kind: "feature",
        priority: 4,
        title: "Workouts from your wearable count toward experiments",
        summary:
          "A running or cycling experiment now counts the sessions your watch already recorded, so four in-window runs read as 4 of 7 expected instead of 0 logged. Existing experiments heal immediately, no re-setup.",
        relevanceTags: ["experiments", "wearables", "adherence"],
        sourcePullRequests: [399],
        tryIt: {
          label: "Check an experiment",
          prompt: "How's my running experiment going?",
        },
      },
      {
        id: "group-join-by-liking",
        kind: "feature",
        priority: 4,
        title: "Join a group by liking Murph's message",
        summary:
          "When Murph opens a group, anyone who already has Murph can join and share the stats that message names just by liking it. A tapback like or a 👍 is the whole handshake, no web page.",
        relevanceTags: ["groups", "onboarding", "privacy"],
        sourcePullRequests: [412],
      },
      {
        id: "reminders-vary-approach",
        kind: "improvement",
        priority: 4,
        title: "Reminders stop sounding the same",
        summary:
          "Scheduled nudges now rotate their angle: a plain cue one day, a question or a tiny fallback version the next, sometimes a callback, a light challenge, or a song. Same frequency, more reasons to actually read them.",
        relevanceTags: ["reminders", "assistant"],
        sourcePullRequests: [395],
      },
      {
        id: "group-chat-reliability-hardening",
        kind: "improvement",
        priority: 4,
        title: "Group chats got harder to kill",
        summary:
          "A group's Murph now stays alive as long as anyone in the room has an active Murph, not just the person who set it up, and keeps replying when members are added or removed instead of wedging into a silent retry loop.",
        relevanceTags: ["groups", "reliability"],
        sourcePullRequests: [388, 393, 398],
      },
      {
        id: "faster-texting-replies",
        kind: "improvement",
        priority: 4,
        title: "Faster replies, especially the second message",
        summary:
          "Trimmed the wake path end to end: a leaner cold start, a reused warm connection to the runtime, a direct fast-path wake for texts, and quick follow-ups now get picked up by the still-warm runtime instead of waiting minutes.",
        relevanceTags: ["performance", "messaging"],
        sourcePullRequests: [380, 397, 404, 411],
      },
      {
        id: "durable-answered-no-duplicate-replies",
        kind: "improvement",
        priority: 3,
        title: "One question, one answer, even across a restart",
        summary:
          "Murph now durably marks a text answered the moment the reply is delivered, so a runtime restart or an overlapping wake can't replay the same answer twice.",
        relevanceTags: ["reliability", "messaging"],
        sourcePullRequests: [383],
      },
      {
        id: "stale-backfill-summaries-suppressed",
        kind: "improvement",
        priority: 3,
        title: "No morning recap of Tuesday's sleep",
        summary:
          "When a wearable syncs after a day or more offline, Murph no longer narrates the days-old sleep and workouts in the backfill. Anything that ended more than 24 hours before the sync stays quiet.",
        relevanceTags: ["wearables", "notifications"],
        sourcePullRequests: [391],
      },
      {
        id: "murph-contact-card-stays-yours",
        kind: "improvement",
        priority: 3,
        title: "Your saved Murph contact stays the way you set it",
        summary:
          "Murph no longer re-pushes its contact card to people who already saved it, so the name and photo you chose stop getting overwritten. Settings gains a row to swap Murph's character and re-download the card whenever you want.",
        relevanceTags: ["onboarding", "settings", "polish"],
        sourcePullRequests: [422],
      },
      {
        id: "share-link-previews",
        kind: "improvement",
        priority: 3,
        title: "Murph links preview as what they are",
        summary:
          "Invites, group joins, experiments, and biomarker pages now unfurl with their own preview images in iMessage and social. An invite says you're invited, an experiment shows its actual title.",
        relevanceTags: ["web", "sharing", "polish"],
        sourcePullRequests: [392],
      },
    ],
  },
  {
    id: "2026-07-04",
    publishedOn: "2026-07-04",
    title: "Wearable history catches itself up",
    summary:
      "The 180-day history import that runs when you connect a device now re-runs itself after any failure, and connections that never completed one get a one-time repair pass.",
    items: [
      {
        id: "device-history-import-self-heals",
        kind: "improvement",
        priority: 4,
        title: "Device history imports recover on their own",
        summary:
          "The 180-day historical import at connect time now re-runs automatically after any lost or failed attempt. No reconnect, no support ping, and connections that never finished one get a one-time repair pass.",
        relevanceTags: ["wearables", "junction", "reliability"],
        sourcePullRequests: [379],
      },
    ],
  },
  {
    id: "2026-07-03",
    publishedOn: "2026-07-03",
    title: "Group Murph learns everyone's name",
    summary:
      "Group chats get personal: Murph addresses members by their preferred names and challenges can run on steps, workouts, and heart-rate zones. Plus a batch of first-touch fixes across invites, sign-up, and device connects.",
    items: [
      {
        id: "group-preferred-names-roster",
        kind: "feature",
        priority: 4,
        title: "Group Murph knows who's who",
        summary:
          "Joining a group now introduces you by the name you told Murph during onboarding. Murph addresses each member by their preferred name and attributes shared stats to the right person instead of re-asking.",
        relevanceTags: ["groups", "profiles"],
        sourcePullRequests: [369],
      },
      {
        id: "challenge-stat-sharing-kinds",
        kind: "feature",
        priority: 4,
        title: "Challenges can run on steps, workouts, and heart-rate zones",
        summary:
          "Group challenges now support member-approved sharing for steps, activity minutes, workouts, heart-rate-zone minutes, strain, VO2 max, resting heart rate, HRV, and more. Each is a bounded daily stat you approve explicitly, never raw health data.",
        relevanceTags: ["groups", "challenges", "privacy"],
        sourcePullRequests: [382],
      },
      {
        id: "progress-updates-while-working",
        kind: "improvement",
        priority: 4,
        title: "Murph says when it's still working",
        summary:
          "During a slow turn, a big lab upload or a long lookup, Murph's mid-turn progress updates now actually reach your chat instead of silently disappearing while you wait.",
        relevanceTags: ["assistant", "messaging", "polish"],
        sourcePullRequests: [372],
      },
      {
        id: "family-sponsored-access-everywhere",
        kind: "improvement",
        priority: 3,
        title: "Family-sponsored members work everywhere",
        summary:
          "Access checks now understand family sponsorship on every path, so a sponsored member's group-chat message gets answered instead of silently dropped.",
        relevanceTags: ["family", "groups", "reliability"],
        sourcePullRequests: [375],
      },
      {
        id: "family-invite-dialog-honesty",
        kind: "improvement",
        priority: 3,
        title: "The invite dialog says what actually happened",
        summary:
          "After you create a family invite, the dialog stays open, says plainly that Murph did not text the invitee, and gives you the link to share yourself.",
        relevanceTags: ["family", "invites", "polish"],
        sourcePullRequests: [374],
      },
      {
        id: "device-connect-replay-safe",
        kind: "improvement",
        priority: 3,
        title: "Connecting a device survives a browser double-tap",
        summary:
          "If your browser redelivers the connect callback after a wearable links up, you now land back in the app showing the connected state instead of a bare connection-failed page.",
        relevanceTags: ["wearables", "onboarding", "polish"],
        sourcePullRequests: [378],
      },
      {
        id: "stale-welcome-superseded",
        kind: "improvement",
        priority: 3,
        title: "No canned welcome nine minutes into the conversation",
        summary:
          "Text Murph seconds after signing up and the queued welcome message now steps aside once real conversation has started. Silent signups still get the welcome as before.",
        relevanceTags: ["onboarding", "messaging", "polish"],
        sourcePullRequests: [377],
      },
    ],
  },
  {
    id: "2026-07-02",
    publishedOn: "2026-07-02",
    title: "Group chats go live in iMessage",
    summary:
      "Add Murph to an iMessage group and it just works: it sets itself up, introduces itself with a contact card, and knows when to chime in. Plus overnight memory consolidation, a cleaner family seat flow, and Garmin sync recovery.",
    items: [
      {
        id: "imessage-group-chats-self-serve",
        kind: "feature",
        priority: 5,
        title: "Add Murph to any iMessage group",
        summary:
          "Start an iMessage group with friends and Murph's number, send one message, and Murph comes alive in the room: it sets up the group's own private runtime, replies to that first message, and everyone in the chat can talk to it.",
        details:
          "Inside a group Murph behaves like a participant, not a support desk. It sees who said what, knows when to reply, react, or stay quiet, and plays with shared challenge data without punching down.",
        relevanceTags: ["groups", "messaging", "imessage"],
        sourcePullRequests: [363],
      },
      {
        id: "group-contact-card-intro",
        kind: "feature",
        priority: 4,
        title: "Murph introduces itself to the room",
        summary:
          "In a group, Murph can check who already has their own Murph and drop its contact card once: a tappable card with its number, so friends without Murph can save it and text in to get set up.",
        relevanceTags: ["groups", "onboarding", "messaging"],
        sourcePullRequests: [367],
      },
      {
        id: "overnight-memory-consolidation",
        kind: "feature",
        priority: 4,
        title: "Murph tidies its memory of you overnight",
        summary:
          "Three nights a week at 3am, Murph runs an overnight pass that consolidates the last week of conversation into durable memory, so context carries across sessions without you repeating yourself.",
        relevanceTags: ["memory", "assistant"],
        sourcePullRequests: [355],
      },
      {
        id: "family-seat-flow",
        kind: "improvement",
        priority: 4,
        title: "Family seats: one button, honest counts, easy removal",
        summary:
          "Inviting someone to a full plan now adds the $7/mo seat in the same step with the cost shown up front, the seat count waits for billing to reconcile instead of showing a stale number, and empty seats can be removed.",
        relevanceTags: ["family", "billing", "polish"],
        sourcePullRequests: [359],
      },
      {
        id: "garmin-sync-recovery",
        kind: "improvement",
        priority: 4,
        title: "Garmin sync recovered from a broken upstream endpoint",
        summary:
          "One broken optional endpoint at our device-data partner had been failing entire hourly syncs for Garmin connections. Murph now skips just the broken resource, so sleep, activity, and daily timeseries land again.",
        relevanceTags: ["wearables", "garmin", "reliability"],
        sourcePullRequests: [366],
      },
      {
        id: "supplement-search-stemming",
        kind: "improvement",
        priority: 3,
        title: "Supplement lookup forgives plurals and typos",
        summary:
          "Searching Advanced Antioxidant now finds Advanced Antioxidants, creatin monohydrate finds Creatine Monohydrate, and a brand query that matches nothing falls back to normal search instead of coming back empty.",
        relevanceTags: ["supplements", "search"],
        sourcePullRequests: [368],
      },
    ],
  },
  {
    id: "2026-07-01",
    publishedOn: "2026-07-01",
    title: "Invite friends into your Murph group",
    summary:
      "Murph groups get real join links with explicit, bounded health sharing. Plus cleaner Garmin sleep-stage imports and background work that yields to your messages.",
    items: [
      {
        id: "group-join-links",
        kind: "feature",
        priority: 4,
        title: "Ask Murph for a group join link",
        summary:
          "Ask Murph in a group to invite someone and it mints a real join link. The page signs them in and adds them to the group; health sharing stays a separate choice, only the bounded stats they explicitly approve. Joining alone shares nothing.",
        relevanceTags: ["groups", "invites", "privacy"],
        sourcePullRequests: [356, 360],
      },
      {
        id: "garmin-sleep-stage-imports",
        kind: "improvement",
        priority: 3,
        title: "Cleaner Garmin sleep-stage imports",
        summary:
          "Fixed the compact sleep-cycle import and stopped pulling unrelated records alongside it, so Garmin sleep stages land correctly in the vault.",
        relevanceTags: ["wearables", "garmin", "sleep"],
        sourcePullRequests: [353, 358],
      },
      {
        id: "background-yields-to-you",
        kind: "improvement",
        priority: 3,
        title: "Background maintenance yields to your message",
        summary:
          "A scheduled background run no longer delays the reply to a message you just sent. Foreground conversation preempts cron work instead of queueing behind it.",
        relevanceTags: ["performance", "reliability"],
        sourcePullRequests: [354],
      },
    ],
  },
  {
    id: "2026-06-30",
    publishedOn: "2026-06-30",
    title: "Family launches, Pulse Trial gets three more days",
    summary:
      "Sponsor Murph for the people in your house — 2 to 6 private seats with their own monthly allowance. Pulse Trial now runs 10 days. Murph checks whether a wearable needs reconnect before answering about sleep or recovery, and shares its contact card on first outbound so people can save the number.",
    items: [
      {
        id: "hosted-family-plan-mvp",
        kind: "feature",
        priority: 5,
        title: "Sponsor Murph for the people in your house",
        summary:
          "Buy 2 to 6 Family seats at $7 per sponsored person per month. Each sponsored member gets a private account with its own Pulse-level monthly allowance — no shared pool, and the owner can't read their chats, vault, or health data.",
        details:
          "Invite by Telegram username, phone, or verified email. Invites consume already-paid seats; creating one never silently adds a Stripe charge.",
        relevanceTags: ["billing", "family", "plans"],
        sourcePullRequests: [222],
        tryIt: {
          label: "Set up Family",
          prompt: "Set up Family for me and my partner.",
        },
      },
      {
        id: "linq-contact-card-share",
        kind: "feature",
        priority: 4,
        title: "Murph shares its contact card after the first text",
        summary:
          "After Murph's first successful direct iMessage in a Linq chat, it best-effort shares the configured contact card so the recipient can save the name and number before the thread fills up.",
        details:
          "Only one share attempt every 48 hours per chat, and only when the outbound was real direct iMessage delivery.",
        relevanceTags: ["linq", "messaging", "polish"],
        sourcePullRequests: [337],
      },
      {
        id: "pulse-trial-10-days",
        kind: "feature",
        priority: 4,
        title: "Pulse Trial runs 10 days, not 7",
        summary:
          "Every new Pulse Trial now lasts 10 days instead of 7. Trials already in flight keep their original length; fresh signups land on the new policy.",
        relevanceTags: ["pulse", "billing", "trial"],
        sourcePullRequests: [],
      },
      {
        id: "device-sync-reconnect-context",
        kind: "improvement",
        priority: 4,
        title: "Murph notices when a wearable needs reconnect before answering",
        summary:
          "Ask about sleep, recovery, activity, or workouts and Murph now sees which connected source needs reconnect, so it flags the gap and points you to the fix instead of treating the silence as the truth.",
        relevanceTags: ["wearables", "assistant", "data"],
        sourcePullRequests: [341],
        tryIt: {
          label: "Ask about a sleep gap",
          prompt: "Why was my sleep so short last night?",
        },
      },
      {
        id: "onboarding-delegate-slow-saves",
        kind: "improvement",
        priority: 3,
        title: "Onboarding keeps talking while it saves your supplements and labs",
        summary:
          "Slow saves during onboarding — supplement regimens and lab panels — now run in a fresh background subagent so the chat keeps moving instead of stalling while writes finish.",
        relevanceTags: ["onboarding", "performance"],
        sourcePullRequests: [],
      },
      {
        id: "homepage-editorial-refresh",
        kind: "improvement",
        priority: 3,
        title: "Fresh homepage — new hero, editorial asks, honest trust pillars",
        summary:
          "Rebuilt the public homepage with a new clock-in hero, an asymmetric editorial layout for the asks-Murph-handles section, and a flat trust band rewritten to match what the security FAQ actually claims.",
        relevanceTags: ["landing", "design"],
        sourcePullRequests: [],
      },
      {
        id: "red-light-therapy-guidance",
        kind: "feature",
        priority: 3,
        title: "Ask Murph about red light therapy",
        summary:
          "Murph now handles red light and photobiomodulation questions with real dose math: it asks for your panel's model and distance, computes session time from matched dose and irradiance data, and keeps claims inside what studies actually show.",
        relevanceTags: ["skills", "recovery"],
        sourcePullRequests: [347, 351],
        tryIt: {
          label: "Ask about your panel",
          prompt: "I sit about a foot from my red light panel. How long should sessions be?",
        },
      },
    ],
  },
  {
    id: "2026-06-29",
    publishedOn: "2026-06-29",
    title: "Garmin sleep arrives cleanly, and a smoother phone sign-in",
    summary:
      "Garmin sleep, cycles, and hypnograms now arrive as real records. The phone-number sign-in stops freezing right after the verification code lands. Plus quiet reliability fixes on Linq read receipts and scheduled-reminder wakes.",
    items: [
      {
        id: "garmin-junction-sleep-records",
        kind: "feature",
        priority: 4,
        title: "Garmin sleep arrives as real records",
        summary:
          "Garmin sleep, sleep cycles, and hypnograms now land as full records instead of being dropped as skeleton completion events.",
        relevanceTags: ["wearables", "garmin", "junction", "sleep"],
        sourcePullRequests: [336],
      },
      {
        id: "phone-auth-post-code-state",
        kind: "improvement",
        priority: 3,
        title: "Phone sign-in no longer freezes after the code",
        summary:
          "Closed a state bug where the hosted phone-number sign-in could land on a blank step right after the SMS code was accepted.",
        relevanceTags: ["auth", "sign-in"],
        sourcePullRequests: [],
      },
      {
        id: "linq-read-receipts-restore",
        kind: "improvement",
        priority: 3,
        title: "Read receipts came back for active-member Linq chats",
        summary:
          "Restored the read indicator on inbound Linq messages from active members. Closes a regression where receipts had stopped firing on the active-member webhook path.",
        relevanceTags: ["linq", "polish"],
        sourcePullRequests: [],
      },
      {
        id: "linq-reminder-wake-no-replay",
        kind: "improvement",
        priority: 3,
        title: "Scheduled Linq reminders don't fire twice on rewind",
        summary:
          "A consumed scheduled-reminder wake no longer replays when the cron loop reprocesses the same window. Closed a small path that could deliver the same reminder ping twice.",
        relevanceTags: ["reliability", "reminders", "linq"],
        sourcePullRequests: [],
      },
    ],
  },
  {
    id: "2026-06-28",
    publishedOn: "2026-06-28",
    title: "Don't lose real people when the classifier blinks",
    summary:
      "If the first-contact admission classifier is unavailable, Murph now admits the new contact and sends the normal signup reply instead of silent dead-air. Explicit spam blocks still hold.",
    items: [
      {
        id: "first-contact-classifier-fail-open",
        kind: "improvement",
        priority: 4,
        title: "First-contact gate fails open when the classifier is down",
        summary:
          "Unknown senders now get the normal signup-link reply when the OpenAI admission classifier is unavailable. Deterministic spam blocks, content-filter blocks, and budget exhaustion still gate before any side effects.",
        relevanceTags: ["safety", "linq", "onboarding"],
        sourcePullRequests: [334],
      },
      {
        id: "weekly-insight-framing-refresh",
        kind: "improvement",
        priority: 3,
        title: "Weekly health insight finds the actual story",
        summary:
          "Sunday's recap can now lead with stress patterns and cross-metric meta-patterns when those are the real story, instead of always slotting findings into fixed sleep/activity sections.",
        relevanceTags: ["assistant", "weekly-insight"],
        sourcePullRequests: [],
      },
    ],
  },
  {
    id: "2026-06-27",
    publishedOn: "2026-06-27",
    title: "Murph knows your meds before it answers",
    summary:
      "Active conditions, allergies, meds, and supplements ride along in Murph's working context so safety-relevant guidance is shaped before the first vault lookup. Image generation can build on photos you sent, progress shots save durably, and Sunday's digest stays quiet when nothing happened.",
    items: [
      {
        id: "safety-critical-context-snapshot",
        kind: "feature",
        priority: 5,
        title: "Active conditions, meds, and allergies ride in Murph's working context",
        summary:
          "Murph now sees your active conditions, allergies, medication regimens, and supplement regimens at the top of every turn — sorted by severity, capped on size, and linked to the right vault-cli lookup for deeper detail.",
        details:
          "Stopped medications never reappear through a condition's related-regimen link. Absence reads as NKDA, not as missing information.",
        relevanceTags: ["assistant", "safety", "health", "context"],
        sourcePullRequests: [327],
        tryIt: {
          label: "Ask a meds-aware question",
          prompt:
            "I'm thinking about a low-dose magnesium at night — anything in my current meds I should watch out for?",
        },
      },
      {
        id: "image-gen-reference-images",
        kind: "feature",
        priority: 5,
        title: "Generate images that build on photos you sent",
        summary:
          "Send Murph a sketch, a product shot, or a style reference and `generate_image` can use it as the basis for the next image instead of asking you to describe it in words.",
        details:
          "Up to 16 ordered reference images per call, drawn from the current turn's attachments. JPG, PNG, and WebP only; 2 MiB per image, 32 MiB combined.",
        relevanceTags: ["assistant", "images", "tools"],
        sourcePullRequests: [330],
        tryIt: {
          label: "Try reference images",
          prompt:
            "Use that fridge photo I just sent and show me what it would look like with the new produce on the middle shelf.",
        },
      },
      {
        id: "durable-progress-photo-captures",
        kind: "feature",
        priority: 4,
        title: "Progress photos save somewhere you can find them",
        summary:
          "Skin, posture, wound, and form check-in photos now land in your vault as canonical capture records, so the bytes are still there weeks later when you want to compare a series — instead of expiring with inbox media.",
        relevanceTags: ["vault", "images", "captures"],
        sourcePullRequests: [329],
      },
      {
        id: "weekly-digest-substance-gate",
        kind: "improvement",
        priority: 4,
        title: "Sunday digest skips weeks where nothing happened",
        summary:
          "Murph's Sunday health digest now skips itself when there's no real wearable or experiment movement. If your wearable's quietly broken, it sends one short reconnect note instead of a hollow recap.",
        relevanceTags: ["assistant", "weekly-insight", "wearables"],
        sourcePullRequests: [331],
      },
      {
        id: "first-contact-classifier-budget",
        kind: "improvement",
        priority: 4,
        title: "First-contact gate stops blocking real people",
        summary:
          "The unknown-sender classifier now lets through anyone who mentions Murph or asks a real Murph question, with a per-contact cap of 4 attempts so transient outages don't permanently silence one person.",
        relevanceTags: ["safety", "linq", "onboarding"],
        sourcePullRequests: [324],
      },
      {
        id: "home-redirect-notice-dedup",
        kind: "improvement",
        priority: 3,
        title: "Stop announcing your home line on every message",
        summary:
          "If you keep replying on the wrong Linq chat, Murph tells you to switch to your home line once per chat — not on every inbound until you finally move.",
        relevanceTags: ["linq", "messaging", "polish"],
        sourcePullRequests: [325],
      },
      {
        id: "vault-file-approval-durable-park",
        kind: "improvement",
        priority: 3,
        title: "Vault-file sends park durably when approval isn't ready",
        summary:
          "When a vault-file delivery is missing approval state, the outbox now parks the intent durably and resumes when you approve, instead of churning through pre-provider retries.",
        relevanceTags: ["assistant", "reliability", "approvals"],
        sourcePullRequests: [326],
      },
      {
        id: "retell-phone-call-authority-fix",
        kind: "improvement",
        priority: 3,
        title: "Hardened the new phone-call path against stale callbacks",
        summary:
          "Retell now receives call metadata in the fields its API expects, and delayed analysis callbacks can't resurrect a phone call Murph already failed before it started.",
        relevanceTags: ["phone-calls", "reliability"],
        sourcePullRequests: [323],
      },
    ],
  },
  {
    id: "2026-06-26",
    publishedOn: "2026-06-26",
    title: "Murph can call you — and the noise level drops everywhere else",
    summary:
      "Approve a brief and Murph can place an outbound phone call on your behalf. Health records you upload land in your vault, computer handoffs return on the channel that started them, wearable records line up with your calendar, and a wave of polish trims chat noise.",
    items: [
      {
        id: "retell-phone-calls",
        kind: "feature",
        priority: 5,
        title: "Murph can place a phone call for you",
        summary:
          "Approve a call brief and Murph places the outbound call through Retell — pharmacy refills, restaurant reservations, vet check-ins, clinic intake — then drops a clean summary back into chat once the call ends.",
        details:
          "Transfer to you only when the brief explicitly allows it. Retell receives just the bounded brief and an opaque call id; transcripts, recordings, and provider bodies are never persisted.",
        relevanceTags: ["assistant", "phone-calls", "voice", "tools"],
        sourcePullRequests: [295],
        tryIt: {
          label: "Ask Murph to call",
          prompt:
            "Call my pharmacy and ask if my prescription is ready to pick up.",
        },
      },
      {
        id: "uploaded-health-records-vault",
        kind: "feature",
        priority: 4,
        title: "Uploaded health records actually land in your vault",
        summary:
          "Lab reports, visit summaries, medication lists, function-health panels, imaging reports — Murph now writes them to canonical vault surfaces with raw evidence preserved, instead of stranding them in a chat note.",
        details:
          "Large bundles get a fast triage reply, then a non-blocking background parse for the rest. You can stop wondering whether what you sent is actually in your record.",
        relevanceTags: ["vault", "health", "records"],
        sourcePullRequests: [322],
        tryIt: {
          label: "Send a record",
          prompt:
            "Here's my latest lipid panel PDF — file it under blood tests and tell me what stands out.",
        },
      },
      {
        id: "onboarding-name-free-text",
        kind: "feature",
        priority: 3,
        title: "Onboarding asks for your name like a person would",
        summary:
          "Murph now asks for your name as freeform text and treats age and a quick gender ask as optional, instead of routing you through a structured form with required fields.",
        relevanceTags: ["onboarding", "polish"],
        sourcePullRequests: [],
      },
      {
        id: "handoff-return-to-source-channel",
        kind: "improvement",
        priority: 4,
        title: "Computer handoffs return to the channel that started them",
        summary:
          "Finish a browser task that started over text and Murph replies on text. Telegram-origin handoffs return on Telegram. Email-origin handoffs stay in the same email thread instead of opening a fresh compose.",
        relevanceTags: ["browser", "handoff", "messaging"],
        sourcePullRequests: [318, 314],
      },
      {
        id: "whoop-junction-local-day",
        kind: "improvement",
        priority: 4,
        title: "Wearable days line up with your calendar",
        summary:
          "Closed a class of bugs where wearable records could drift into the next calendar day when a source timestamp crossed UTC midnight. Past records repair on replay.",
        relevanceTags: ["wearables", "whoop", "junction", "data"],
        sourcePullRequests: [304],
      },
      {
        id: "assistant-progress-cap",
        kind: "improvement",
        priority: 4,
        title: "Fewer mid-turn progress updates",
        summary:
          "At most two non-required progress updates per turn now, spaced apart and only when silence would hurt. Required system notices still bypass the budget.",
        relevanceTags: ["assistant", "messaging", "polish"],
        sourcePullRequests: [317],
      },
      {
        id: "preflight-outbox-no-churn",
        kind: "improvement",
        priority: 3,
        title: "No more pre-provider retry churn on approval gaps",
        summary:
          "When Murph can't send yet because approval is pending or a config gap exists, the outbox parks the intent before claiming a delivery attempt — no wasted retries, no auto-reply replay.",
        relevanceTags: ["reliability", "messaging"],
        sourcePullRequests: [321],
      },
      {
        id: "vault-file-approval-consume-binding",
        kind: "improvement",
        priority: 3,
        title: "Vault-file approvals bind to the exact media Murph sent",
        summary:
          "Approvals are now consumed atomically against the exact approved media in the model's reply, so stale URLs and replayed retries can't deliver a file you didn't approve.",
        relevanceTags: ["security", "vault", "approvals"],
        sourcePullRequests: [312],
      },
      {
        id: "message-variants-deliverability",
        kind: "improvement",
        priority: 3,
        title: "Refreshed copy on welcome, invite, and quota messages",
        summary:
          "Rewrote the bank of system replies — welcome, invite/signup, daily quota, home-redirect, AI usage notices — for clearer voice and steadier deliverability when many people see the same message.",
        relevanceTags: ["messaging", "polish", "deliverability"],
        sourcePullRequests: [319],
      },
      {
        id: "linq-typing-cadence",
        kind: "improvement",
        priority: 3,
        title: "Calmer typing indicator on Linq",
        summary:
          "Linq typing stays alive across an assistant turn without a 2-second keepalive loop. You still see Murph working — just without the high-frequency churn.",
        relevanceTags: ["linq", "polish"],
        sourcePullRequests: [313],
      },
      {
        id: "linq-audio-bounded-retry",
        kind: "improvement",
        priority: 3,
        title: "Voice memos with slow CDNs don't get stuck",
        summary:
          "When a Linq voice memo's audio hasn't fully landed yet, Murph retries briefly then degrades cleanly. No provider URLs, storage paths, or routing labels leak into the model prompt.",
        relevanceTags: ["linq", "voice", "reliability"],
        sourcePullRequests: [315],
      },
      {
        id: "device-activity-listener-handoff",
        kind: "improvement",
        priority: 3,
        title: "Device-activity reminders fire for every match",
        summary:
          "Multiple matching activities in one wearable sync now each queue the configured reminder. The durable listener stays put for next time, instead of being archived after one fire.",
        relevanceTags: ["wearables", "automations", "reminders"],
        sourcePullRequests: [306],
      },
      {
        id: "managed-automation-schedule-spread",
        kind: "improvement",
        priority: 3,
        title: "Murph-managed automations spread across the day",
        summary:
          "Newly created weekly managed automations now seed at vault-deterministic times across a daytime window, instead of every account receiving the same exact send minute.",
        relevanceTags: ["automations", "reliability"],
        sourcePullRequests: [311],
      },
      {
        id: "handoff-all-set-single-cta",
        kind: "improvement",
        priority: 3,
        title: "One Reply to Murph button after a handoff",
        summary:
          "The 'All set' screen after a browser handoff now offers a single Reply to Murph button instead of stacking every channel CTA at the bottom of the page.",
        relevanceTags: ["handoff", "polish"],
        sourcePullRequests: [],
      },
    ],
  },
  {
    id: "2026-06-25",
    publishedOn: "2026-06-25",
    title: "Six new coaches, plus real help for pain and chronic conditions",
    summary:
      "Sleep, stress, food, running, lifting, and race-prep each get their own coach. Clinical-style pain and rehab help, recommendations for chronic conditions, and goals that pin across sessions.",
    items: [
      {
        id: "coach-skills-six-new",
        kind: "feature",
        priority: 5,
        title: "Six new coaches: sleep, stress, food, running, lifting, race prep",
        summary:
          "Each gets its own routing and reasoning — sleep & recovery readiness, stress regulation, nutrition strategy, running & cardio, strength training, and competition prep.",
        relevanceTags: ["assistant", "health", "coaching", "skills"],
        sourcePullRequests: [298, 299, 300, 301, 302, 303],
        tryIt: {
          label: "Try a coach skill",
          prompt:
            "Half marathon in 8 weeks and I'm lifting twice a week — what should I actually do?",
        },
      },
      {
        id: "linq-first-contact-admission",
        kind: "improvement",
        priority: 5,
        title: "Unknown first contacts get gated before the invite path",
        summary:
          "Strangers texting the Murph line now pass a fail-closed classifier before any invite, member record, or reply gets created.",
        relevanceTags: ["safety", "linq", "onboarding"],
        sourcePullRequests: [309],
      },
      {
        id: "live-browser-replaces-screen-inspection",
        kind: "improvement",
        priority: 4,
        title: "Live browser handoff replaces static screenshots",
        summary:
          "When Murph needs you to look at a paused browser, you get the live, passkey-gated handoff used everywhere else — not a static screenshot.",
        relevanceTags: ["browser", "handoff"],
        sourcePullRequests: [296],
      },
      {
        id: "checkout-confirm-in-chat",
        kind: "improvement",
        priority: 4,
        title: "Confirm the final checkout step in chat",
        summary:
          "A simple \"yes\" or \"go ahead\" lets Murph place the order. The handoff link is still there if you want to take over.",
        relevanceTags: ["browser", "checkout"],
        sourcePullRequests: [307],
      },
      {
        id: "linq-off-hours-reminder-guard",
        kind: "improvement",
        priority: 3,
        title: "Off-hours iMessage reminders ask first",
        summary:
          "Before scheduling a Linq reminder for 11pm–5am local time, Murph flags the spam risk, suggests a nearby waking-hour time, and asks.",
        relevanceTags: ["assistant", "linq", "reminders"],
        sourcePullRequests: [],
      },
      {
        id: "longer-tool-loops-before-compaction",
        kind: "improvement",
        priority: 3,
        title: "Longer tool-using turns before context compacts",
        summary:
          "Hosted auto-compaction now waits until 164k tokens, so long browser/computer-use loops get more room to finish in one piece.",
        relevanceTags: ["assistant", "runtime"],
        sourcePullRequests: [],
      },
      {
        id: "all-current-turn-auto-replies-dispatch",
        kind: "improvement",
        priority: 3,
        title: "Every planned reply in a turn actually sends",
        summary:
          "When Murph plans multiple replies in one turn, all of them dispatch instead of only the first reaching you.",
        relevanceTags: ["assistant", "automation"],
        sourcePullRequests: [],
      },
      {
        id: "proactive-chronic-support",
        kind: "feature",
        priority: 5,
        title: "Recommendations for chronic illness and pain, not just referrals",
        summary:
          "For chronic illness, chronic pain, and at-home self-management experiments, Murph now gives a best-current-assessment plus a recommended next action — not just validation or a pointer to a clinician. Pain or symptom reduction counts as a real outcome.",
        details:
          "Low-risk experiments can go forward without clinician pre-approval. Hard stops still hold for prescription changes, dangerous provocation, fixed graded activity when PEM is in play, emergencies, and direct death-wish language.",
        relevanceTags: ["assistant", "health", "chronic-illness", "chronic-pain", "experiments"],
        sourcePullRequests: [],
      },
      {
        id: "physical-therapy-skill",
        kind: "feature",
        priority: 4,
        title: "Murph thinks like a PT for pain and rehab",
        summary:
          "Mention a strain, an ache, or a rehab program and Murph routes through clinical-reasoning steps — triage and red flags, exercise selection and dosing, follow-up and progression — instead of generic advice.",
        details:
          "Remote-observation cues let Murph make the most of whatever you describe or send. Symptom-free workout programming stays on the regular exercise path, not this one.",
        relevanceTags: ["assistant", "health", "rehab", "pain"],
        sourcePullRequests: [],
      },
      {
        id: "active-plan-context",
        kind: "improvement",
        priority: 4,
        title: "Goals and habits Murph keeps in working memory",
        summary:
          "When you accept a habit, ramp, or non-experiment plan, it now lands on a canonical goal-and-regimen surface — and Murph reads that surface back at the start of each turn, so baselines, ladders, and targets don't get stranded in chat.",
        relevanceTags: ["assistant", "goals", "habits", "memory"],
        sourcePullRequests: [],
      },
      {
        id: "exercise-image-walkthroughs",
        kind: "improvement",
        priority: 4,
        title: "Calmer exercise intros, with pictures",
        summary:
          "When Murph introduces movements you haven't seen before, it now picks 2-4, attaches catalog images, gives only the immediate safety stop rule, and asks whether to walk you through them — instead of dumping a long numbered plan.",
        relevanceTags: ["assistant", "exercise", "images", "polish"],
        sourcePullRequests: [],
      },
      {
        id: "openweather-tool",
        kind: "feature",
        priority: 4,
        title: "Real weather, current and five days out",
        summary:
          "Ask about today's heat, tomorrow's rain, or the forecast for your long run on Saturday — Murph now pulls live current conditions and a five-day forecast from OpenWeather, scoped to wherever you ask about.",
        relevanceTags: ["assistant", "weather", "tools"],
        sourcePullRequests: [284],
        tryIt: {
          label: "Check the forecast",
          prompt:
            "What's the weather looking like for my long run Saturday morning?",
        },
      },
      {
        id: "composio-search-tools",
        kind: "feature",
        priority: 4,
        title: "Search Amazon, Walmart, Google Maps, and find a clinician",
        summary:
          "Murph can now search Amazon and Walmart for products, look places up on Google Maps, and find providers by name or specialty through the national NPI directory — all in chat, no app switch.",
        details:
          "Product and place search lands the actual listing instead of guessing. The NPI lookup returns a real provider record — NPI number, address, taxonomy — so referrals and verifications stop being a dead end.",
        relevanceTags: ["assistant", "search", "shopping", "providers", "tools"],
        sourcePullRequests: [284],
        tryIt: {
          label: "Try a search",
          prompt:
            "Find a cardiologist near me on the NPI registry, and price magnesium glycinate on Amazon and Walmart while you're at it.",
        },
      },
    ],
  },
  {
    id: "2026-06-24",
    publishedOn: "2026-06-24",
    title: "Songs, PDFs, and a tap to approve",
    summary:
      "Ask Murph for a song or a one-page PDF, approve sensitive actions with your passkey, and welcome Outlook and Zoho to connected apps. Inbox media now expires after 14 days, and long browser tasks stay snappy.",
    items: [
      {
        id: "song-generation",
        kind: "feature",
        priority: 5,
        title: "Murph can write you a song",
        summary:
          "Ask for a quick song and Murph generates it with ElevenLabs music, then ships it as a voice memo right in iMessage or Telegram — no new attachment kind, no app switch.",
        details:
          "Lyrics, mood, instrumental, and length are all promptable. Cost rides on the existing voice-memo allowance at $0.15 per generated minute.",
        relevanceTags: ["assistant", "voice", "telegram", "imessage", "media"],
        sourcePullRequests: [279],
        tryIt: {
          label: "Ask for a song",
          prompt:
            "Write me a 30-second hype song for tonight's workout — upbeat, no lyrics.",
        },
      },
      {
        id: "sensitive-action-approval",
        kind: "feature",
        priority: 5,
        title: "Approve big actions with your passkey",
        summary:
          "Before Murph runs a sensitive action on your behalf, you get a one-tap approval link. Sign with your passkey-protected wallet and the action goes through — deny it and nothing happens.",
        details:
          "Same rail powers Settings → Export vault and Delete account, so every irreversible move is gated by the same secure approval flow.",
        relevanceTags: ["security", "auth", "passkeys", "approvals"],
        sourcePullRequests: [283, 274],
      },
      {
        id: "assistant-pdf-skill",
        kind: "feature",
        priority: 5,
        title: "PDFs you can ask for in chat",
        summary:
          "Murph can author and send a clean, typeset PDF — a one-page summary, a workout plan, a lab-results recap — right back into the conversation.",
        details:
          "A pinned Typst 0.15 toolchain runs inside the hosted runner, so layout is deterministic and the output is the same PDF every time.",
        relevanceTags: ["assistant", "documents", "pdf"],
        sourcePullRequests: [272],
        tryIt: {
          label: "Ask for a PDF",
          prompt:
            "Make me a one-page PDF of my training week — sessions, totals, and one note per day.",
        },
      },
      {
        id: "connected-apps-outlook-zoho",
        kind: "feature",
        priority: 4,
        title: "Outlook & Zoho Mail join your inbox apps",
        summary:
          "Connect Outlook or Zoho Mail once and Murph can read, draft, and send through them — same flow as Gmail, same in-chat experience.",
        relevanceTags: ["integrations", "email", "outlook", "zoho"],
        sourcePullRequests: [282],
        tryIt: {
          label: "Connect Outlook",
          prompt: "Connect my Outlook so you can send and draft email for me.",
        },
      },
      {
        id: "connected-apps-files-tasks-notes",
        kind: "feature",
        priority: 4,
        title: "Files, tasks, and notes — all reachable",
        summary:
          "Connect Google Drive, OneDrive, Dropbox, Notion, Todoist, or Google Tasks once. Murph can pull a doc, add a to-do, capture a note, or hand you a file without leaving chat.",
        relevanceTags: ["integrations", "files", "tasks", "notes", "notion"],
        sourcePullRequests: [284],
        tryIt: {
          label: "Connect Notion",
          prompt:
            "Connect my Notion so you can capture notes and pull pages when I ask.",
        },
      },
      {
        id: "connected-apps-calendar-events",
        kind: "feature",
        priority: 5,
        title: "Murph can put it on your calendar",
        summary:
          "Ask Murph to add an event and it actually writes to your Google Calendar or Outlook calendar — title, start, duration, location, notes — with a strict allowlist that keeps it scoped to what you said.",
        details:
          "No surprise invites, no online-meeting rooms by default. Just the event you described, on the calendar you connected.",
        relevanceTags: ["integrations", "calendar", "outlook", "google"],
        sourcePullRequests: [284],
        tryIt: {
          label: "Add an event",
          prompt:
            "Add a 45-minute call with Sam to my calendar tomorrow at 2pm, location: Zoom.",
        },
      },
      {
        id: "home-experiment-result-cards",
        kind: "feature",
        priority: 4,
        title: "Home shows your experiment results",
        summary:
          "The home screen now leads with your own experiment results — the primary metric for finished runs, live progress for active ones — instead of generic protocol art.",
        relevanceTags: ["experiments", "home", "dashboard"],
        sourcePullRequests: [],
        tryIt: {
          href: "/home",
          label: "Open home",
        },
      },
      {
        id: "computer-use-managed-auth",
        kind: "feature",
        priority: 4,
        title: "Browser tasks can hand login pauses to managed auth",
        summary:
          "When a browser task pauses on a login, Murph can hand it off to Kernel's managed auth so you complete the sign-in in a guided flow, then resume the original task right where it stopped.",
        relevanceTags: ["browser", "automation", "auth"],
        sourcePullRequests: [278],
      },
      {
        id: "finite-supply-reorder-check-in",
        kind: "feature",
        priority: 4,
        title: "Reorder check-ins for finite supplies",
        summary:
          "After Murph completes a verified order for a finite consumable — a 30-day supplement supply, weekly meal boxes, contacts — it schedules one calm check-in around when you'll run out.",
        details:
          "No auto-reorder, no nagging. One reminder, framed around when supply is actually low, and only when the supply duration is clear.",
        relevanceTags: ["assistant", "automations", "supplements"],
        sourcePullRequests: [],
      },
      {
        id: "experiment-lifecycle-moments",
        kind: "feature",
        priority: 3,
        title: "Experiments check in mid-run and morning-after",
        summary:
          "Active experiments now get a day-four progress nudge and a morning-after final review — both pinned to your local clock, both skippable if you've opted out.",
        relevanceTags: ["experiments", "automations", "lifecycle"],
        sourcePullRequests: [273],
      },
      {
        id: "computer-use-auto-compact",
        kind: "improvement",
        priority: 5,
        title: "Long browser tasks stay snappy",
        summary:
          "Murph now compacts its working memory partway through long browser sessions, instead of waiting until the end. Multi-step tasks stay quick and cost less, even when they grow.",
        relevanceTags: ["browser", "performance", "assistant"],
        sourcePullRequests: [],
      },
      {
        id: "foreground-wake-preemption-fix",
        kind: "improvement",
        priority: 5,
        title: "Steadier wakes during long-running work",
        summary:
          "Closed a class of races where a long-running turn could overwrite its own next-wake while you sent a follow-up, so reminders, device-sync continuations, and retries no longer slip behind.",
        relevanceTags: ["reliability", "reminders", "messaging"],
        sourcePullRequests: [259],
      },
      {
        id: "inbox-media-retention-window",
        kind: "improvement",
        priority: 4,
        title: "Raw inbox media expires after 14 days",
        summary:
          "Photos, audio, and video you send Murph are now purged from the inbox after 14 days. Murph still remembers what they were — only the raw bytes go.",
        details:
          "Bytes are hash-verified before deletion, so nothing tampered with disappears silently, and anything Murph is still mid-reply about stays protected until the reply lands.",
        relevanceTags: ["privacy", "inbox", "media", "data"],
        sourcePullRequests: [240],
      },
      {
        id: "hosted-egress-container-identity",
        kind: "improvement",
        priority: 4,
        title: "Research and route tools work everywhere again",
        summary:
          "In-container tools that run during a turn — research scout, route estimates, supplement lookups — authorize through the same container-identity fence the rest of Murph uses, instead of failing with a silent 401.",
        relevanceTags: ["reliability", "hosted", "assistant"],
        sourcePullRequests: [275],
      },
      {
        id: "telegram-image-response-fix",
        kind: "improvement",
        priority: 4,
        title: "Image replies land on Telegram",
        summary:
          "Closed a delivery gap where Murph's generated and reference images would sometimes fail to attach on Telegram. They now come through cleanly the same way iMessage does.",
        relevanceTags: ["telegram", "images", "messaging"],
        sourcePullRequests: [],
      },
      {
        id: "messaging-italic-underline",
        kind: "improvement",
        priority: 3,
        title: "Italic and underline on Linq & Telegram",
        summary:
          "Murph can now use italic and underline alongside bold and strikethrough on supported chat channels — emphasis renders natively, not as raw markdown.",
        relevanceTags: ["messaging", "linq", "telegram", "polish"],
        sourcePullRequests: [],
      },
      {
        id: "resume-checkout-from-join",
        kind: "improvement",
        priority: 3,
        title: "Resume checkout from join",
        summary:
          "If you bounced out of checkout, signing back in through /join now drops you right back into the same checkout step instead of restarting the flow.",
        relevanceTags: ["billing", "auth", "onboarding"],
        sourcePullRequests: [280],
      },
    ],
  },
  {
    id: "2026-06-23",
    publishedOn: "2026-06-23",
    title: "Passkeys, and a handoff that fits your phone",
    summary:
      "Add a passkey as your second factor in one tap, computer handoff remembers each device's browser size, and auto-replies remember the conversation that came before them.",
    items: [
      {
        id: "passkey-mfa-setup",
        kind: "feature",
        priority: 5,
        title: "Passkey two-factor in one tap",
        summary:
          "Settings has a new Security section. Tap once to enroll a passkey — Face ID, Touch ID, or your phone's secure enclave — as a second factor on your Murph account.",
        relevanceTags: ["security", "settings", "passkeys", "auth"],
        sourcePullRequests: [],
        tryIt: {
          href: "/settings",
          label: "Set up a passkey",
        },
      },
      {
        id: "handoff-viewport-match",
        kind: "feature",
        priority: 5,
        title: "Browser handoff matches your phone",
        summary:
          "When Murph hands the browser off to you, the page remembers this browser session's last handoff size and corrects it from the live takeover surface.",
        details:
          "Murph starts from the saved size for this device session, then measures the actual handoff surface and resizes the remote browser in the background without blocking takeover.",
        relevanceTags: ["browser", "automation", "mobile"],
        sourcePullRequests: [268],
      },
      {
        id: "handoff-mobile-takeover-overlay",
        kind: "feature",
        priority: 4,
        title: "Tap to take over on mobile",
        summary:
          "Mobile computer handoff now shows a minimal takeover overlay — one clear tap to jump in, type, paste, or finish — instead of fighting the streamed browser controls.",
        relevanceTags: ["browser", "mobile", "automation"],
        sourcePullRequests: [269],
      },
      {
        id: "handoff-keyboard-paste",
        kind: "feature",
        priority: 4,
        title: "Keyboard and paste in the handed-off browser",
        summary:
          "A dedicated Keyboard / Paste button focuses the streamed Safari iframe on every tap, so copy → focus → paste lands cleanly in the remote browser.",
        relevanceTags: ["browser", "automation"],
        sourcePullRequests: [],
      },
      {
        id: "handoff-on-demand-links",
        kind: "feature",
        priority: 4,
        title: "Hand off the browser on request",
        summary:
          "Ask Murph to hand the browser off whenever you want a look — fresh inspection links work for any live computer-use session, not just the ones it paused itself.",
        relevanceTags: ["browser", "automation"],
        sourcePullRequests: [267],
        tryIt: {
          label: "Ask for a handoff",
          prompt: "Hand the browser off to me so I can take a look.",
        },
      },
      {
        id: "auto-reply-cross-session-context",
        kind: "improvement",
        priority: 5,
        title: "Auto-replies remember the conversation",
        summary:
          "When Murph auto-replies to a message that came in while you were away, the reply now sees context from your earlier sessions instead of starting from a blank slate.",
        relevanceTags: ["reliability", "messaging", "assistant"],
        sourcePullRequests: [262],
      },
      {
        id: "os-control-typing-delay-removed",
        kind: "improvement",
        priority: 4,
        title: "Snappier typing in browser tasks",
        summary:
          "Dropped the artificial OS-control typing delay, so Murph fills forms and types into web apps without the slow per-keystroke pause.",
        relevanceTags: ["browser", "performance", "automation"],
        sourcePullRequests: [],
      },
      {
        id: "connected-apps-tool-forwarding",
        kind: "improvement",
        priority: 4,
        title: "Connected apps stay reachable",
        summary:
          "Closed a forwarding gap that silently dropped the connected-apps capability before it reached the Codex turn, so Gmail, Calendar, and the rest stay usable end-to-end.",
        relevanceTags: ["integrations", "reliability", "assistant"],
        sourcePullRequests: [],
      },
      {
        id: "supplement-search-quality",
        kind: "improvement",
        priority: 4,
        title: "Sharper supplement search",
        summary:
          "Search now drops weak supplement tokens and uses the correct trigram operator, so brand and ingredient lookups land the product you meant.",
        relevanceTags: ["supplements", "search"],
        sourcePullRequests: [],
      },
      {
        id: "onboarding-dashboard-recovery",
        kind: "improvement",
        priority: 4,
        title: "Onboarding picks up where you left off",
        summary:
          "If you signed up but didn't finish onboarding, the dashboard sends you back to the hosted onboarding flow instead of dropping you into an empty home.",
        relevanceTags: ["onboarding", "reliability"],
        sourcePullRequests: [270],
      },
      {
        id: "onboarding-followup-managed",
        kind: "improvement",
        priority: 3,
        title: "Onboarding follow-ups reconcile cleanly",
        summary:
          "First-run setup questions got shorter, voice-memo answers are honored, and the onboarding follow-up automation reconciles its own state instead of leaving legacy reminders behind.",
        relevanceTags: ["onboarding", "assistant", "automations"],
        sourcePullRequests: [264],
      },
      {
        id: "changelog-imessage-og-card",
        kind: "improvement",
        priority: 3,
        title: "Changelog previews on iMessage",
        summary:
          "Sharing the changelog link on iMessage now renders a clean five-row digest in Murph's own palette, instead of a generic link preview.",
        relevanceTags: ["changelog", "design", "imessage"],
        sourcePullRequests: [],
      },
    ],
  },
  {
    id: "2026-06-22",
    publishedOn: "2026-06-22",
    title: "A more natural Murph",
    summary:
      "Connected apps, a public changelog, reactions on iMessage, and a calmer place to manage your health work.",
    items: [
      {
        id: "connected-apps-tools",
        kind: "feature",
        priority: 5,
        title: "Connect external apps to Murph",
        summary:
          "Murph can now connect to apps like Gmail and Google Calendar — then read, send, and act inside them when you ask.",
        details:
          "Ask Murph to add an event, draft an email, or move a ticket. Connect each app once and stay in chat for the rest.",
        relevanceTags: ["integrations", "automation", "hosted"],
        sourcePullRequests: [256],
        tryIt: {
          label: "Connect an app",
          prompt: "Connect my Google Calendar so you can add events for me.",
        },
      },
      {
        id: "native-message-formatting",
        kind: "feature",
        priority: 5,
        title: "Better-looking messages",
        summary:
          "Murph can now use natural emphasis in supported messaging channels without showing raw formatting markers.",
        details:
          "Important points, headings, and emphasis are easier to scan in everyday conversations.",
        relevanceTags: ["messaging", "telegram", "imessage", "summaries"],
        sourcePullRequests: [242],
        tryIt: {
          label: "Get a summary",
          prompt:
            "Give me a clean weekly summary and emphasize the three things that matter most.",
        },
      },
      {
        id: "linq-message-reactions",
        kind: "feature",
        priority: 4,
        title: "Reactions arrive on iMessage",
        summary:
          "Murph can react to iMessage threads with a quick emoji when a full reply would be overkill.",
        relevanceTags: ["linq", "imessage", "reactions"],
        sourcePullRequests: [234],
      },
      {
        id: "telegram-reactions",
        kind: "feature",
        priority: 4,
        title: "Murph can react on Telegram",
        summary:
          "On Telegram, Murph can respond with a lightweight reaction when a full message would be unnecessary.",
        relevanceTags: ["messaging", "telegram", "assistant"],
        sourcePullRequests: [227],
        tryIt: {
          label: "Try a reaction",
          prompt: "React to this message instead of sending a full reply.",
        },
      },
      {
        id: "public-changelog-feedback",
        kind: "feature",
        priority: 4,
        title: "Public changelog and product feedback",
        summary:
          "This page is new — check it for weekly updates, and tell Murph what's working or what isn't right from chat.",
        details:
          "Your feedback reaches the team without breaking the conversation.",
        relevanceTags: ["changelog", "feedback", "product"],
        sourcePullRequests: [255],
        tryIt: {
          label: "Send feedback",
          prompt: "I have some feedback on Murph — can you record this for the team?",
        },
      },
      {
        id: "dashboard-polish",
        kind: "improvement",
        priority: 4,
        title: "A calmer dashboard",
        summary:
          "Authentication, biomarkers, experiments, connections, and settings received a focused visual polish pass.",
        relevanceTags: ["dashboard", "biomarkers", "experiments", "wearables"],
        sourcePullRequests: [248],
        tryIt: {
          href: "/",
          label: "Open Murph",
        },
      },
      {
        id: "strict-serving-grams-backfill",
        kind: "improvement",
        priority: 4,
        title: "Accurate gram servings across 1.7M foods",
        summary:
          "Backfilled strict gram serving sizes across 1,710,438 foods and 28,415 supplements using structured evidence only — no volume, count, or container fallbacks.",
        relevanceTags: ["food", "supplements", "data-quality"],
        sourcePullRequests: [230],
      },
      {
        id: "reliable-live-replies",
        kind: "improvement",
        priority: 5,
        title: "More reliable live replies",
        summary:
          "Murph now recovers more reliably when a new message arrives while the hosted assistant is already active.",
        relevanceTags: ["messaging", "reliability", "telegram", "imessage"],
        sourcePullRequests: [232],
      },
      {
        id: "telegram-auto-reply-quotes-removed",
        kind: "improvement",
        priority: 3,
        title: "Cleaner Telegram replies",
        summary:
          "Murph's Telegram text replies no longer quote your last message back to you — reactions still target the specific inbound message when they fit.",
        relevanceTags: ["telegram", "messaging", "polish"],
        sourcePullRequests: [258],
      },
      {
        id: "experiment-progress-secondary-metrics",
        kind: "improvement",
        priority: 3,
        title: "Experiment progress reads secondary metrics",
        summary:
          "Progress cards and follow-up decisions now read from the query metric projection, so secondary analysis metrics with data no longer fall through to a misleading \"no wearable data\" status.",
        relevanceTags: ["experiments", "metrics", "reliability"],
        sourcePullRequests: [250],
      },
    ],
  },
  {
    id: "2026-06-21",
    publishedOn: "2026-06-21",
    title: "Right clock, one saved browser",
    summary:
      "Hosted signup persists your timezone before activation, and Murph keeps a single saved browser session per service instead of juggling profiles.",
    items: [
      {
        id: "signup-timezone-handoff",
        kind: "improvement",
        priority: 4,
        title: "Signup lands the right timezone",
        summary:
          "The timezone captured during hosted signup is now persisted inside the activation transaction, so reminders and schedules start on your real clock from message one.",
        relevanceTags: ["onboarding", "signup"],
        sourcePullRequests: [233],
      },
      {
        id: "single-saved-browser-session",
        kind: "improvement",
        priority: 4,
        title: "One saved browser session per service",
        summary:
          "Murph now reuses a single saved browser session per member per service instead of choosing between profiles, so logins and cookies stay where you left them.",
        relevanceTags: ["browser", "automation"],
        sourcePullRequests: [231],
      },
      {
        id: "signals-page-retired",
        kind: "improvement",
        priority: 3,
        title: "Retired the unused signals dashboard",
        summary:
          "Removed the obsolete /signals dashboard page and public webhook health probes, shrinking the surface area we expose.",
        relevanceTags: ["privacy", "cleanup"],
        sourcePullRequests: [239],
      },
    ],
  },
  {
    id: "2026-06-20",
    publishedOn: "2026-06-20",
    title: "Health automations on a calmer cadence",
    summary:
      "Weekly insights run on predictable days, start working from day one, and email automations fail fast when a route is bad.",
    items: [
      {
        id: "managed-health-cadence",
        kind: "improvement",
        priority: 4,
        title: "Predictable weekly cadence",
        summary:
          "Weekly health insight runs Sundays at noon; the weekly research scout runs Wednesdays at 1 PM local. Both work from day one (no 14-day data wait) and skip cleanly while onboarding is still open.",
        relevanceTags: ["health", "automation"],
        sourcePullRequests: [226],
      },
      {
        id: "email-route-validation",
        kind: "improvement",
        priority: 4,
        title: "Email automations catch bad addresses early",
        summary:
          "If you set up an email automation without a real recipient, Murph tells you right away instead of failing silently when it tries to send.",
        relevanceTags: ["email", "automation"],
        sourcePullRequests: [225],
      },
    ],
  },
  {
    id: "2026-06-19",
    publishedOn: "2026-06-19",
    title: "Voice on Telegram, browser tasks that pause for you",
    summary:
      "Murph can leave Telegram voice memos, and browser automations can hand off mid-task for a confirmation and resume on your next message.",
    items: [
      {
        id: "telegram-voice-memos",
        kind: "feature",
        priority: 5,
        title: "Voice memos on Telegram",
        summary:
          "Murph can now reply with generated voice memos on Telegram, matching the Linq voice-memo experience.",
        relevanceTags: ["telegram", "voice", "messaging"],
        sourcePullRequests: [221],
        tryIt: {
          label: "Ask for a voice memo",
          prompt:
            "Send me a quick voice memo summarizing my workouts this week.",
        },
      },
      {
        id: "computer-use-pause-resume",
        kind: "feature",
        priority: 5,
        title: "Browser tasks can pause for you",
        summary:
          "Browser tasks can pause to ask for a login or final confirmation, then pick up exactly where you left off on your next message.",
        relevanceTags: ["browser", "automation"],
        sourcePullRequests: [214, 224],
        tryIt: {
          label: "Try a paused task",
          prompt:
            "Add oat milk to my Trader Joe's cart, but pause before checkout so I can confirm.",
        },
      },
      {
        id: "auto-reply-delivery-fences",
        kind: "improvement",
        priority: 4,
        title: "Steadier replies when Murph is busy",
        summary:
          "Replies arrive in order and stop dropping when Murph is processing several messages at once.",
        relevanceTags: ["reliability", "messaging"],
        sourcePullRequests: [223],
      },
    ],
  },
  {
    id: "2026-06-18",
    publishedOn: "2026-06-18",
    title: "Stronger browser help",
    summary:
      "Murph's browser automation became more capable while account recovery paths became easier to trust.",
    items: [
      {
        id: "browser-automation-upgrade",
        kind: "feature",
        priority: 5,
        title: "More capable browser automation",
        summary:
          "Murph can drive real websites for you — booking appointments, filling forms, finding info — and pauses for anything sensitive like logins or payments.",
        relevanceTags: ["browser", "automation", "appointments", "forms"],
        sourcePullRequests: [228],
        tryIt: {
          label: "Delegate a task",
          prompt:
            "Help me complete this website task and pause before anything that needs my login, payment, or final confirmation.",
        },
      },
      {
        id: "pulse-trial-recovery",
        kind: "improvement",
        priority: 4,
        title: "Safer Pulse trial recovery",
        summary:
          "Trial redemption and billing recovery paths were tightened so interrupted signup flows are less likely to leave confusing account state.",
        relevanceTags: ["billing", "signup", "hosted"],
        sourcePullRequests: [219],
      },
    ],
  },
  {
    id: "2026-06-17",
    publishedOn: "2026-06-17",
    title: "Calmer first run, sharper weekly insights",
    summary:
      "The first message after signup arrives as exact text, the weekly insight only fires when it earns it, and the auth loader uses Murph's own mark.",
    items: [
      {
        id: "signup-welcome-exact-text",
        kind: "improvement",
        priority: 4,
        title: "Cleaner first message after signup",
        summary:
          "The welcome message you get right after signing up now arrives reliably and exactly as written.",
        relevanceTags: ["onboarding", "reliability"],
        sourcePullRequests: [194],
      },
      {
        id: "behavior-followthrough-skill",
        kind: "feature",
        priority: 4,
        title: "Murph notices when you slip",
        summary:
          "When you fall off a plan you set — missed workouts, skipped supplements, the diet you said you'd try — Murph helps you get back on track instead of cheering you on.",
        relevanceTags: ["assistant", "coaching"],
        sourcePullRequests: [199],
        tryIt: {
          label: "Tell Murph the truth",
          prompt:
            "I missed two of the workouts I planned for this week.",
        },
      },
      {
        id: "weekly-insight-quality-gate",
        kind: "improvement",
        priority: 4,
        title: "Weekly insight rejects filler",
        summary:
          "The Wednesday insight automation now rejects tautological or unsupported findings — it stays silent rather than shipping a hollow note.",
        relevanceTags: ["assistant", "automations", "insights"],
        sourcePullRequests: [186],
      },
      {
        id: "calm-auth-loader",
        kind: "improvement",
        priority: 3,
        title: "Auth uses the Murph mark",
        summary:
          "Replaced the generic spinner on /join and the green-bar provisioning notice with Murph's own dot-constellation mark animated as a sonar ripple, honoring prefers-reduced-motion.",
        relevanceTags: ["web", "auth", "design"],
        sourcePullRequests: [193],
      },
      {
        id: "weekly-research-scout",
        kind: "feature",
        priority: 4,
        title: "Weekly research scout",
        summary:
          "Once a week, Murph scans new research relevant to the things you care about — your conditions, goals, supplements — and brings back what's worth your time.",
        relevanceTags: ["research", "automations", "weekly", "health"],
        sourcePullRequests: [206],
      },
      {
        id: "medication-history",
        kind: "feature",
        priority: 4,
        title: "Record past medications",
        summary:
          "Tell Murph about past medications you've taken — a Z-Pak last spring, an old antidepressant, that one round of antibiotics — and they land in your health history cleanly.",
        relevanceTags: ["medications", "health-history", "records"],
        sourcePullRequests: [203],
        tryIt: {
          label: "Log a past course",
          prompt:
            "Add the 10-day amoxicillin course I finished in March to my history.",
        },
      },
    ],
  },
  {
    id: "2026-06-16",
    publishedOn: "2026-06-16",
    title: "Devices connect in one tap, Telegram reminders land",
    summary:
      "Picking a specific wearable source skips the picker, scheduled Telegram reminders deliver reliably, and the mobile sidebar dismisses on navigation.",
    items: [
      {
        id: "junction-direct-provider-link",
        kind: "improvement",
        priority: 4,
        title: "Picking a source skips the picker",
        summary:
          "Choosing a specific wearable source like Garmin now starts OAuth directly instead of showing a one-option picker first.",
        relevanceTags: ["wearables", "junction", "connect"],
        sourcePullRequests: [179],
        tryIt: {
          href: "/connect",
          label: "Connect a device",
        },
      },
      {
        id: "telegram-reminder-delivery",
        kind: "improvement",
        priority: 5,
        title: "Scheduled Telegram reminders land",
        summary:
          "Cron-scheduled reminders with a Telegram-only route now carry their delivery target end to end, fixing reminders that fired but never reached the chat.",
        relevanceTags: ["telegram", "reminders", "reliability"],
        sourcePullRequests: [185],
        tryIt: {
          label: "Set a reminder",
          prompt:
            "Remind me every weekday at 8am to take my morning supplements.",
        },
      },
      {
        id: "steered-reply-delivery-order",
        kind: "improvement",
        priority: 4,
        title: "Replies arrive in order",
        summary:
          "When you send Murph a few messages in quick succession, the replies come back in the right order instead of overtaking each other.",
        relevanceTags: ["reliability", "messaging"],
        sourcePullRequests: [183],
      },
      {
        id: "mobile-sidebar-auto-close",
        kind: "improvement",
        priority: 3,
        title: "Mobile sidebar closes on navigation",
        summary:
          "The offcanvas sidebar now dismisses automatically when you tap a nav link or a dropdown destination like Settings — so you land on the page instead of a covered one.",
        relevanceTags: ["web", "mobile"],
        sourcePullRequests: [186],
      },
      {
        id: "junction-source-reconnect",
        kind: "improvement",
        priority: 4,
        title: "Reconnect one device without dropping the rest",
        summary:
          "If one wearable needs to be reconnected, the others stay connected and keep syncing in the meantime.",
        relevanceTags: ["wearables", "settings"],
        sourcePullRequests: [187],
      },
      {
        id: "telegram-attachment-retries",
        kind: "improvement",
        priority: 4,
        title: "Stickier Telegram attachment downloads",
        summary:
          "Telegram photo and file fetches now retry on transient failures, treat oversized files as terminal instead of generic errors, and respect run cancellation cleanly.",
        relevanceTags: ["telegram", "attachments", "reliability"],
        sourcePullRequests: [180],
      },
    ],
  },
  {
    id: "2026-06-15",
    publishedOn: "2026-06-15",
    title: "Home learns what you've got running",
    summary:
      "Home reflects active experiments from your vault, Pulse trials start without a card, and route distance estimates work again.",
    items: [
      {
        id: "home-experiments-from-vault",
        kind: "feature",
        priority: 5,
        title: "Home shows your active and past experiments",
        summary:
          "Home now shows the experiment you're running and the ones you've finished, instead of always asking you to start a new one.",
        details:
          "If a run is already active, the Start an experiment card hides itself — you see your real state, not a generic checklist.",
        relevanceTags: ["experiments", "web", "home"],
        sourcePullRequests: [141],
        tryIt: {
          href: "/home",
          label: "Open home",
        },
      },
      {
        id: "auto-pulse-trial-enrollment",
        kind: "feature",
        priority: 4,
        title: "Pulse trials start without a card",
        summary:
          "New members get a Pulse trial automatically — no credit card, no setup. You're in Murph the moment you sign in.",
        relevanceTags: ["pulse", "billing", "onboarding"],
        sourcePullRequests: [173],
      },
      {
        id: "mapbox-route-estimates-restored",
        kind: "improvement",
        priority: 4,
        title: "Route distance estimates work again",
        summary:
          "Distance estimates were silently failing with \"not configured\" — the hosted Codex shell now passes MAPBOX_ACCESS_TOKEN through, so workout and travel questions return real routes.",
        relevanceTags: ["assistant", "hosted", "reliability"],
        sourcePullRequests: [174],
      },
      {
        id: "reliable-usage-limit-notice",
        kind: "improvement",
        priority: 3,
        title: "Usage-limit notice always reaches you",
        summary:
          "Triggers the moment your usage crosses the limit instead of waiting for your next message, and releases its claim cleanly if a send fails.",
        relevanceTags: ["hosted", "reliability", "billing"],
        sourcePullRequests: [144],
      },
    ],
  },
  {
    id: "2026-06-14",
    publishedOn: "2026-06-14",
    title: "A lighter, sturdier foundation",
    summary:
      "Health queries, workspace recovery, and runtime logs became smaller and more predictable.",
    items: [
      {
        id: "lighter-health-queries",
        kind: "improvement",
        priority: 4,
        title: "Faster health answers",
        summary:
          "Murph pulls your biomarker and wearable data faster when you ask, so health questions come back without the wait.",
        relevanceTags: ["biomarkers", "wearables", "performance"],
        sourcePullRequests: [235],
      },
      {
        id: "sturdier-workspace-restore",
        kind: "improvement",
        priority: 5,
        title: "More reliable starts",
        summary:
          "Murph wakes up from a cold start more reliably, so conversations resume cleanly even after a restart.",
        relevanceTags: ["reliability", "hosted", "data"],
        sourcePullRequests: [243, 244, 246],
      },
      {
        id: "bounded-runtime-logs",
        kind: "improvement",
        priority: 3,
        title: "Lighter footprint",
        summary:
          "Murph runs leaner in the background, keeping a tidier memory of recent activity instead of piling up old diagnostics.",
        relevanceTags: ["reliability", "performance", "hosted"],
        sourcePullRequests: [238],
      },
    ],
  },
  {
    id: "2026-06-13",
    publishedOn: "2026-06-13",
    title: "Murph learns the USDA food catalog",
    summary:
      "Roughly two million branded foods land in a hosted catalog, every captured metric becomes queryable, and voice-memo usage shows up in the spend ledger.",
    items: [
      {
        id: "food-label-database",
        kind: "feature",
        priority: 5,
        title: "~2M food labels at hand",
        summary:
          "Murph now knows the nutrition for ~2 million US branded foods — Trader Joe's, Whole Foods, your grocery aisle staples — with ingredients, portions, and per-serving panels.",
        details:
          "Ask about a specific product and Murph answers from the catalog instead of guessing or sending you to a search.",
        relevanceTags: ["food", "nutrition", "data"],
        sourcePullRequests: [169],
        tryIt: {
          label: "Ask about a food",
          prompt:
            "How much protein is in a serving of Trader Joe's Greek yogurt?",
        },
      },
      {
        id: "every-metric-queryable",
        kind: "improvement",
        priority: 5,
        title: "Every captured metric is queryable",
        summary:
          "Metrics that were captured but invisible to queries — caffeine, water, mindfulness, heart-rate recovery, AFib burden, lowest/highest glucose, basal body temp, height, period and cycle length — now surface through the same generic path as measurements and lab samples.",
        details:
          "Queryability is now a property of the canonical data instead of a per-metric registry, so future observation metrics gain query access with zero new wiring.",
        relevanceTags: ["data", "metrics", "queries"],
        sourcePullRequests: [168],
      },
      {
        id: "transcription-usage-ledger",
        kind: "improvement",
        priority: 3,
        title: "Voice-memo usage is now visible",
        summary:
          "Hosted Workers AI transcription writes a per-run usage record, so voice-memo cost shows up in the same ledger as Codex turns and image generation.",
        relevanceTags: ["billing", "voice"],
        sourcePullRequests: [167],
      },
    ],
  },
  {
    id: "2026-06-12",
    publishedOn: "2026-06-12",
    title: "Apple Health expansion, faster cold replies",
    summary:
      "Connecting the companion once captures fourteen more Apple Health series, and cold message-to-reply latency drops noticeably.",
    items: [
      {
        id: "apple-health-expansion",
        kind: "feature",
        priority: 5,
        title: "+14 Apple Health series",
        summary:
          "Connecting the iOS companion once now lands wrist temp, caffeine, water, mindfulness, heart-rate recovery, AFib burden, glucose, blood pressure, menstrual cycles, ECG, and more — fourteen new series in one pass.",
        relevanceTags: ["apple-health", "wearables", "companion"],
        sourcePullRequests: [138],
      },
      {
        id: "hosted-cold-start-cut",
        kind: "improvement",
        priority: 5,
        title: "Faster first reply after a pause",
        summary:
          "When you message Murph after a long quiet stretch, the first reply comes through noticeably sooner.",
        relevanceTags: ["performance", "reliability"],
        sourcePullRequests: [147, 149, 151],
      },
      {
        id: "whoop-query-unification",
        kind: "improvement",
        priority: 4,
        title: "All your WHOOP data in one answer",
        summary:
          "Asking about WHOOP now pulls from your live sync and any historical ZIP exports together, instead of splitting them.",
        relevanceTags: ["wearables", "whoop"],
        sourcePullRequests: [155],
        tryIt: {
          label: "Ask about WHOOP",
          prompt: "Show me my WHOOP sleep for the last two weeks.",
        },
      },
      {
        id: "long-audio-transcription",
        kind: "improvement",
        priority: 4,
        title: "Voice memos over 15 minutes transcribe cleanly",
        summary:
          "Hosted transcription now passes verified original audio straight through to Workers AI when it is safe, and routes blocked or oversized formats through ffmpeg into 64 kbps mono MP3 — practical support reaches 15+ minute clips.",
        relevanceTags: ["voice", "transcription"],
        sourcePullRequests: [163],
      },
    ],
  },
  {
    id: "2026-06-11",
    publishedOn: "2026-06-11",
    title: "Long chats stay cheap and snappy",
    summary:
      "Threads auto-compact at 128k tokens, the CLI cold-starts 12-26% faster, and SMS-code autofill no longer leaves blue handles on the sign-in screen.",
    items: [
      {
        id: "thread-auto-compaction",
        kind: "improvement",
        priority: 5,
        title: "Lower AI cost in long chats",
        summary:
          "Long conversations now keep themselves trim in the background, so Murph stays faster and cheaper to use the longer you chat.",
        relevanceTags: ["performance", "assistant"],
        sourcePullRequests: [125, 130],
      },
      {
        id: "vault-cli-cold-start",
        kind: "improvement",
        priority: 4,
        title: "Snappier replies",
        summary:
          "Murph's internal tools start faster between turns, so replies that need them feel quicker.",
        relevanceTags: ["performance"],
        sourcePullRequests: [131, 134],
      },
      {
        id: "ios-otp-handles",
        kind: "improvement",
        priority: 3,
        title: "Cleaner SMS autofill on iOS",
        summary:
          "After autofilling a verification code from Messages, iOS no longer leaves blue selection handles floating over the sign-in OTP boxes.",
        relevanceTags: ["auth", "mobile", "polish"],
        sourcePullRequests: [136],
      },
      {
        id: "transport-failure-recovery",
        kind: "improvement",
        priority: 4,
        title: "No long waits after a network blip",
        summary:
          "Brief connection hiccups no longer leave your next message hanging for minutes.",
        relevanceTags: ["reliability", "messaging"],
        sourcePullRequests: [129],
      },
      {
        id: "companion-app-sign-in",
        kind: "feature",
        priority: 4,
        title: "Groundwork for the iOS app",
        summary:
          "Sign-in plumbing landed for the upcoming Murph iOS app, so the companion can hook into your account the moment it ships.",
        relevanceTags: ["companion", "ios"],
        sourcePullRequests: [132],
      },
    ],
  },
  {
    id: "2026-06-10",
    publishedOn: "2026-06-10",
    title: "Email replies, image generation, instant voice memos",
    summary:
      "Murph can answer by email, attach generated images, and turn a one-minute voice memo around in seconds instead of nine minutes.",
    items: [
      {
        id: "email-auto-reply",
        kind: "feature",
        priority: 5,
        title: "Murph now replies by email",
        summary:
          "Email Murph and get a real reply back — same thread, same address.",
        details:
          "Existing members start getting email replies automatically — no settings change, just send a message.",
        relevanceTags: ["email", "channels", "reliability"],
        sourcePullRequests: [89, 109],
        tryIt: {
          label: "Email Murph",
          prompt: "Try emailing Murph and ask for today's recap.",
        },
      },
      {
        id: "image-generation-tool",
        kind: "feature",
        priority: 5,
        title: "Murph can make images in chat",
        summary:
          "Murph can generate and send images — a quick illustration, a workout layout, a poster for tonight's group ride — directly in the conversation.",
        relevanceTags: ["assistant", "tools", "media"],
        sourcePullRequests: [77],
        tryIt: {
          label: "Ask for an image",
          prompt: "Make me a simple poster for tonight's workout.",
        },
      },
      {
        id: "voice-memo-transcription",
        kind: "improvement",
        priority: 5,
        title: "Voice memos: ~9 min → seconds",
        summary:
          "Hosted voice-memo transcription moved off the local whisper.cpp path to Workers AI. A 65-second clip now transcribes in seconds instead of roughly nine minutes.",
        relevanceTags: ["voice", "performance"],
        sourcePullRequests: [105],
      },
      {
        id: "experiment-progress-cards",
        kind: "feature",
        priority: 4,
        title: "Mid-experiment progress cards",
        summary:
          "Murph can send a snapshot image of how a running experiment is trending, with movers, a session timeline, and confounders called out.",
        relevanceTags: ["experiments", "media"],
        sourcePullRequests: [97],
        tryIt: {
          label: "Check progress",
          prompt: "How is my current experiment going so far?",
        },
      },
      {
        id: "no-duplicate-replies-on-deploy",
        kind: "improvement",
        priority: 4,
        title: "No duplicate replies after updates",
        summary:
          "When Murph ships an update in the middle of a conversation, you no longer get the same reply twice.",
        relevanceTags: ["reliability", "messaging"],
        sourcePullRequests: [110],
      },
      {
        id: "reminders-respect-todays-logs",
        kind: "improvement",
        priority: 4,
        title: "Reminders see what you logged today",
        summary:
          "Scheduled reminder agents now read your full vault, so a nightly protein nudge won't pretend you ate nothing after you already logged lunch.",
        relevanceTags: ["reminders", "vault"],
        sourcePullRequests: [92],
      },
      {
        id: "preserve-reminders-thread-continuity",
        kind: "improvement",
        priority: 4,
        title: "Daily reminders continue the same conversation",
        summary:
          "Recurring reminders (the PT reset, the nightly meditation prompt) now thread back into the iMessage conversation they were scheduled from instead of starting a fresh session.",
        relevanceTags: ["reminders", "messaging"],
        sourcePullRequests: [111],
      },
      {
        id: "linq-group-chat-privacy-guard",
        kind: "improvement",
        priority: 5,
        title: "Stronger privacy guard on iMessage rebinds",
        summary:
          "Inbound iMessage now requires explicit direct-chat attestation before Murph will rebind your home thread, closing a potential leak where a missing is_group flag could route 1:1 replies into a family group.",
        relevanceTags: ["privacy", "imessage"],
        sourcePullRequests: [121],
      },
    ],
  },
  {
    id: "2026-06-09",
    publishedOn: "2026-06-09",
    title: "Sidebar contact picker and hourly wearable refresh",
    summary:
      "Chat opens straight to a channel picker, email verification fits in one dialog, and an affected wearable import path refreshes every hour instead of every six.",
    items: [
      {
        id: "sidebar-chat-contact-picker",
        kind: "feature",
        priority: 4,
        title: "Pick a chat channel from the sidebar",
        summary:
          "When you have more than one chat channel connected, the sidebar now offers a picker for SMS, Telegram, or hosted email instead of guessing.",
        relevanceTags: ["dashboard", "messaging"],
        sourcePullRequests: [79],
        tryIt: {
          href: "/home",
          label: "Open the dashboard",
        },
      },
      {
        id: "junction-hourly-reconcile",
        kind: "improvement",
        priority: 5,
        title: "Hourly wearable refresh",
        summary:
          "An affected connected-wearable import path now reconciles every hour instead of every six. Morning sleep and recovery show up sooner.",
        relevanceTags: ["wearables", "junction", "whoop", "oura", "garmin"],
        sourcePullRequests: [73],
      },
      {
        id: "junction-meal-imports",
        kind: "feature",
        priority: 4,
        title: "Meals flow in from MyFitnessPal & Cronometer",
        summary:
          "Meals you log in MyFitnessPal, Cronometer, and other connected apps now flow into Murph with ingredients and nutrition, ready for questions about food alongside training and sleep.",
        relevanceTags: ["nutrition", "junction", "meals"],
        sourcePullRequests: [72],
        tryIt: {
          label: "Ask about meals",
          prompt: "How did my meals this week line up with my training?",
        },
      },
      {
        id: "inline-email-verification",
        kind: "improvement",
        priority: 4,
        title: "One-step email verification",
        summary:
          "Changing your email is now a single dialog with an inline auto-submitting OTP step, replacing the previous nested modal stack.",
        relevanceTags: ["settings", "auth"],
        sourcePullRequests: [78],
        tryIt: {
          href: "/settings",
          label: "Open settings",
        },
      },
      {
        id: "armed-reminder-wake-protected",
        kind: "improvement",
        priority: 5,
        title: "Device syncs no longer clobber reminder wakes",
        summary:
          "Device-sync passes were silently overwriting the runtime's next wake — confirmed misses last week included a 15:00 PT reminder delayed 179 minutes. Wake selection now merges in the armed assistant cron, earliest wins.",
        relevanceTags: ["reminders", "reliability"],
        sourcePullRequests: [98],
      },
      {
        id: "weekly-health-digest-seed",
        kind: "feature",
        priority: 3,
        title: "Weekly health digest, on by default",
        summary:
          "Everyone now gets a weekly health digest from Murph automatically — no setup, just shows up.",
        relevanceTags: ["automations", "digest"],
        sourcePullRequests: [74],
      },
    ],
  },
  {
    id: "2026-06-08",
    publishedOn: "2026-06-08",
    title: "Automations that fire on activity",
    summary:
      "Automations can trigger off device activity, supplement brand search gets sharper, and onboarding keeps moving after you share context.",
    items: [
      {
        id: "device-activity-automations",
        kind: "feature",
        priority: 5,
        title: "Automations triggered by activity",
        summary:
          "Schedule automations that fire on wearable activity (for example, a workout finishing) instead of only on a clock.",
        relevanceTags: ["automations", "wearables"],
        sourcePullRequests: [59],
        tryIt: {
          label: "Set one up",
          prompt:
            "After every WHOOP workout, send me a one-line recovery prompt.",
        },
      },
      {
        id: "supplement-brand-search",
        kind: "improvement",
        priority: 4,
        title: "Brand-aware supplement search",
        summary:
          "Searching by brand now scopes results to that brand's catalog, so Thorne or Pure Encapsulations queries land on the right product.",
        relevanceTags: ["supplements", "search"],
        sourcePullRequests: [65],
        tryIt: {
          label: "Try a brand search",
          prompt: "Find Pure Encapsulations magnesium glycinate.",
        },
      },
    ],
  },
  {
    id: "2026-06-07",
    publishedOn: "2026-06-07",
    title: "Pictures in chat, +250 exercises",
    summary:
      "Replies can include images where the channel supports them, and the exercise catalog grows by 250 at-home strength entries.",
    items: [
      {
        id: "assistant-response-media",
        kind: "feature",
        priority: 5,
        title: "Murph can attach images to replies",
        summary:
          "Murph can send pictures alongside replies — exercise demos, food labels, references — anywhere your channel supports it.",
        relevanceTags: ["messaging", "images", "exercise"],
        sourcePullRequests: [56, 60],
        tryIt: {
          label: "Ask for a demo",
          prompt: "Show me how to do a glute bridge with a picture.",
        },
      },
      {
        id: "exercise-catalog-250",
        kind: "feature",
        priority: 4,
        title: "+250 exercises in the library",
        summary:
          "The exercise library grows by 250 at-home strength entries, with paired images for staples like glute bridges, squats, push-ups, and lunges.",
        relevanceTags: ["exercise", "content"],
        sourcePullRequests: [60],
        tryIt: {
          label: "Plan a session",
          prompt:
            "Give me a 20-minute at-home glute session I can do without equipment.",
        },
      },
      {
        id: "paced-exercise-walkthroughs",
        kind: "improvement",
        priority: 3,
        title: "Calmer exercise walkthroughs",
        summary:
          "Multi-step exercise instructions are paced one move at a time instead of dumped into a single reply.",
        relevanceTags: ["exercise", "messaging"],
        sourcePullRequests: [60],
      },
      {
        id: "account-deletion-vendor-wipe",
        kind: "improvement",
        priority: 4,
        title: "Delete account wipes Stripe and Privy too",
        summary:
          "Settings now offers a single typed-DELETE confirm dialog that cancels any Stripe subscription before the local wipe (fail-closed) and best-effort removes the Stripe customer and Privy user after.",
        relevanceTags: ["privacy", "settings", "billing"],
        sourcePullRequests: [82],
        tryIt: {
          href: "/settings",
          label: "Open settings",
        },
      },
    ],
  },
  {
    id: "2026-06-06",
    publishedOn: "2026-06-06",
    title: "Lighter wearable history, sharper first run",
    summary:
      "Biomarkers gets a clearer first-run path, dense wearable timeseries no longer clog sync, and stale reminders skip when they're more than 30 min late.",
    items: [
      {
        id: "biomarkers-onboarding-callout",
        kind: "feature",
        priority: 4,
        title: "Clearer next step on Biomarkers",
        summary:
          "If you haven't connected a wearable or uploaded labs, the Biomarkers page now tells you exactly what to do next.",
        relevanceTags: ["dashboard", "biomarkers", "onboarding"],
        sourcePullRequests: [54],
        tryIt: {
          href: "/biomarkers",
          label: "Open biomarkers",
        },
      },
      {
        id: "leaner-wearable-imports",
        kind: "improvement",
        priority: 4,
        title: "Faster wearable sync",
        summary:
          "Murph syncs your wearable data in lighter daily summaries, so device connections stay quick instead of slowing under heavy data.",
        relevanceTags: ["wearables", "performance"],
        sourcePullRequests: [54],
      },
      {
        id: "stale-reminders-expire",
        kind: "improvement",
        priority: 4,
        title: "Stale reminders skip cleanly",
        summary:
          "Scheduled reminders that miss their occurrence by more than 30 minutes are now skipped instead of pinging hours later.",
        relevanceTags: ["reminders", "reliability"],
        sourcePullRequests: [69],
      },
    ],
  },
  {
    id: "2026-06-05",
    publishedOn: "2026-06-05",
    title: "214,000 supplements at hand",
    summary:
      "Murph can look up ingredients across the full DSLD supplement label catalog, the CLI cold-starts in 0.2-0.3s, and back-to-back replies share one warm process.",
    items: [
      {
        id: "supplement-label-lookup",
        kind: "feature",
        priority: 5,
        title: "214k+ supplements at hand",
        summary:
          "Murph can look up 214,000+ supplements — Thorne, Pure Encapsulations, Athletic Greens, Now Foods, the lot — when you ask about ingredients, brands, or doses.",
        relevanceTags: ["supplements", "nutrition", "data"],
        sourcePullRequests: [48],
        tryIt: {
          label: "Look up a supplement",
          prompt:
            "Look up Thorne magnesium glycinate and tell me the typical dose.",
        },
      },
      {
        id: "warm-codex-process",
        kind: "improvement",
        priority: 4,
        title: "Quicker back-to-back replies",
        summary:
          "Murph stays warm between your messages, so a quick follow-up comes through almost instantly instead of starting from scratch.",
        relevanceTags: ["performance", "assistant"],
        sourcePullRequests: [46],
      },
      {
        id: "faster-cli-startup",
        kind: "improvement",
        priority: 4,
        title: "Faster first reply of the day",
        summary:
          "Murph's internal tools start up faster after a quiet stretch, so the first reply of the day comes through sooner.",
        relevanceTags: ["performance"],
        sourcePullRequests: [45],
      },
    ],
  },
] satisfies readonly ChangelogEdition[];

export const CHANGELOG_EDITIONS: readonly ChangelogEdition[] =
  validateChangelogEditions(RAW_CHANGELOG_EDITIONS);

export function listChangelogEditions(): readonly ChangelogEdition[] {
  return CHANGELOG_EDITIONS;
}

export function resolveChangelogEditionPage(
  value: string | readonly string[] | undefined,
): number | null {
  if (value === undefined) {
    return 1;
  }
  if (typeof value !== "string" || !isChangelogDate(value)) {
    return null;
  }
  const editionIndex = CHANGELOG_EDITIONS.findIndex(
    (edition) => edition.id === value,
  );
  return editionIndex === -1
    ? null
    : Math.floor(editionIndex / CHANGELOG_EDITIONS_PER_PAGE) + 1;
}

export function resolveChangelogPage(page: number): ChangelogPage | null {
  const totalPages = Math.ceil(
    CHANGELOG_EDITIONS.length / CHANGELOG_EDITIONS_PER_PAGE,
  );
  if (!Number.isSafeInteger(page) || page < 1 || page > totalPages) {
    return null;
  }
  const start = (page - 1) * CHANGELOG_EDITIONS_PER_PAGE;
  return {
    currentPage: page,
    editions: CHANGELOG_EDITIONS.slice(
      start,
      start + CHANGELOG_EDITIONS_PER_PAGE,
    ),
    totalPages,
  };
}

export function buildChangelogPagePath(page: number): string {
  if (!resolveChangelogPage(page)) {
    throw new TypeError("Changelog page is invalid.");
  }
  if (page === 1) {
    return "/changelog";
  }
  const firstEdition = CHANGELOG_EDITIONS[(page - 1) * CHANGELOG_EDITIONS_PER_PAGE];
  if (!firstEdition) {
    throw new TypeError("Changelog page has no edition.");
  }
  return `/changelog?edition=${firstEdition.id}`;
}

export function listPublishedChangelogItems(): readonly PublishedChangelogItem[] {
  return CHANGELOG_EDITIONS
    .flatMap((edition) =>
      edition.items.map((item) => ({
        ...item,
        editionId: edition.id,
        editionTitle: edition.title,
        publishedOn: edition.publishedOn,
      })),
    )
    .sort(comparePublishedChangelogItems);
}

export function queryChangelogItems(query: ChangelogQuery): readonly PublishedChangelogItem[] {
  assertChangelogDate(query.from, "from");
  assertChangelogDate(query.to, "to");
  if (query.from >= query.to) {
    throw new TypeError("Changelog query from must be before to.");
  }
  assertQueryLimit(query.featureLimit, CHANGELOG_FEATURE_LIMIT_MAX, "featureLimit");
  assertQueryLimit(
    query.improvementLimit,
    CHANGELOG_IMPROVEMENT_LIMIT_MAX,
    "improvementLimit",
  );

  const candidates = listPublishedChangelogItems().filter(
    (item) => item.publishedOn >= query.from && item.publishedOn < query.to,
  );
  const features = candidates
    .filter((item) => item.kind === "feature")
    .slice(0, query.featureLimit);
  const improvements = candidates
    .filter((item) => item.kind === "improvement")
    .slice(0, query.improvementLimit);

  return [...features, ...improvements].sort(comparePublishedChangelogItems);
}

export function resolveChangelogCardItems(
  ids: readonly string[],
): readonly PublishedChangelogItem[] | null {
  if (ids.length === 0 || ids.length > CHANGELOG_CARD_MAX_ITEMS) {
    return null;
  }
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== ids.length || uniqueIds.some((id) => !isChangelogId(id))) {
    return null;
  }
  const byId = new Map(listPublishedChangelogItems().map((item) => [item.id, item]));
  const items = uniqueIds.map((id) => byId.get(id) ?? null);
  return items.some((item) => item === null)
    ? null
    : items as PublishedChangelogItem[];
}

export function parseChangelogCardItemSegment(
  segment: string | null | undefined,
): readonly string[] | null {
  if (!segment?.endsWith(".png")) {
    return null;
  }
  const raw = segment.slice(0, -".png".length);
  const ids = raw.split(CHANGELOG_CARD_SEPARATOR);
  return resolveChangelogCardItems(ids) ? ids : null;
}

export function buildChangelogCardPath(ids: readonly string[]): string {
  if (!resolveChangelogCardItems(ids)) {
    throw new TypeError("Changelog card item ids are invalid.");
  }
  return `/changelog/card/${CHANGELOG_CARD_VERSION}/${ids.join(CHANGELOG_CARD_SEPARATOR)}.png`;
}

export function buildChangelogItemPath(id: string): string {
  if (!isChangelogId(id)) {
    throw new TypeError("Changelog item id is invalid.");
  }
  const edition = CHANGELOG_EDITIONS.find((edition) =>
    edition.items.some((item) => item.id === id),
  );
  if (!edition) {
    throw new TypeError("Changelog item does not exist.");
  }
  return `/changelog?edition=${edition.id}#${id}`;
}

export function buildAbsoluteChangelogUrl(
  pathname: string,
  origin: string = MURPH_PRODUCT_ORIGIN,
): string {
  const normalizedOrigin = origin.replace(/\/+$/u, "");
  return new URL(pathname, `${normalizedOrigin}/`).toString();
}

export function isChangelogDate(value: string): boolean {
  if (!CHANGELOG_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateChangelogEditions(
  editions: readonly ChangelogEdition[],
): readonly ChangelogEdition[] {
  const editionIds = new Set<string>();
  const itemIds = new Set<string>();
  let previousDate: string | null = null;

  for (const edition of editions) {
    assertChangelogDate(edition.publishedOn, "edition publishedOn");
    if (edition.id !== edition.publishedOn) {
      throw new TypeError("Changelog edition id must equal publishedOn.");
    }
    if (editionIds.has(edition.id)) {
      throw new TypeError(`Duplicate changelog edition id: ${edition.id}`);
    }
    if (previousDate !== null && edition.publishedOn >= previousDate) {
      throw new TypeError("Changelog editions must be newest first.");
    }
    assertText(edition.title, "edition title", 120);
    assertText(edition.summary, "edition summary", 400);
    if (edition.items.length === 0) {
      throw new TypeError(`Changelog edition ${edition.id} must contain an item.`);
    }
    editionIds.add(edition.id);
    previousDate = edition.publishedOn;

    for (const item of edition.items) {
      if (!isChangelogId(item.id) || itemIds.has(item.id)) {
        throw new TypeError(`Invalid or duplicate changelog item id: ${item.id}`);
      }
      if (item.kind !== "feature" && item.kind !== "improvement") {
        throw new TypeError(`Invalid changelog item kind: ${item.id}`);
      }
      if (!Number.isInteger(item.priority) || item.priority < 1 || item.priority > 5) {
        throw new TypeError(`Invalid changelog item priority: ${item.id}`);
      }
      assertText(item.title, "item title", 120);
      assertText(item.summary, "item summary", 500);
      if (item.details !== undefined) {
        assertText(item.details, "item details", 1_000);
      }
      if (
        item.relevanceTags.length === 0 ||
        item.relevanceTags.some((tag) => !CHANGELOG_TAG_PATTERN.test(tag))
      ) {
        throw new TypeError(`Invalid changelog relevance tags: ${item.id}`);
      }
      if (
        item.sourcePullRequests.some(
          (pullRequest) => !Number.isInteger(pullRequest) || pullRequest <= 0,
        )
      ) {
        throw new TypeError(`Invalid changelog pull request reference: ${item.id}`);
      }
      if (item.tryIt) {
        assertText(item.tryIt.label, "try-it label", 120);
        if (item.tryIt.prompt !== undefined) {
          assertText(item.tryIt.prompt, "try-it prompt", 500);
        }
        if (item.tryIt.href !== undefined) {
          assertText(item.tryIt.href, "try-it href", 500);
        }
      }
      itemIds.add(item.id);
    }
  }

  return editions;
}

function comparePublishedChangelogItems(
  left: PublishedChangelogItem,
  right: PublishedChangelogItem,
): number {
  return right.publishedOn.localeCompare(left.publishedOn) ||
    right.priority - left.priority ||
    left.id.localeCompare(right.id);
}

function assertQueryLimit(value: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`Changelog query ${label} must be between 0 and ${maximum}.`);
  }
}

function assertChangelogDate(value: string, label: string): void {
  if (!isChangelogDate(value)) {
    throw new TypeError(`Changelog ${label} must be a strict YYYY-MM-DD date.`);
  }
}

function assertText(value: string, label: string, maximum: number): void {
  if (!value.trim() || value !== value.trim() || value.length > maximum) {
    throw new TypeError(`Changelog ${label} must be trimmed and at most ${maximum} characters.`);
  }
}

function isChangelogId(value: string): boolean {
  return value.length <= 120 && CHANGELOG_ID_PATTERN.test(value);
}
