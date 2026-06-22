import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

export const CHANGELOG_FEED_SCHEMA = "murph.changelog-feed.v1";
export const CHANGELOG_CARD_VERSION = "v1";
export const CHANGELOG_CARD_MAX_ITEMS = 7;
export const CHANGELOG_FEATURE_LIMIT_MAX = 20;
export const CHANGELOG_IMPROVEMENT_LIMIT_MAX = 5;

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

const RAW_CHANGELOG_EDITIONS = [
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
        title: "Email automations fail fast on bad routes",
        summary:
          "Saving, importing, or running an email automation without a real recipient now errors clearly at save time instead of failing quietly during delivery.",
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
        title: "Steadier auto-reply ordering",
        summary:
          "Auto-reply ordering is now serialized and quiesced around checkpoints, so replies no longer race or drop under load.",
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
        title: "Welcome arrives as exact text",
        summary:
          "The first message after signup now ships through the outbox as a deterministic exact-text send, removing welcome-message drift and races on first contact.",
        relevanceTags: ["hosted", "onboarding", "reliability"],
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
      "Picking a Junction provider skips the picker, scheduled Telegram reminders deliver reliably, and the mobile sidebar dismisses on navigation.",
    items: [
      {
        id: "junction-direct-provider-link",
        kind: "improvement",
        priority: 4,
        title: "Picking a source skips the picker",
        summary:
          "Choosing a specific Junction provider like Garmin now starts OAuth directly instead of showing a one-option provider picker first.",
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
        title: "Steered replies arrive in order",
        summary:
          "Hosted outbox now promotes due same-turn intents at the right boundary, so a later foreground reply can no longer overtake a retryable predecessor.",
        relevanceTags: ["hosted", "reliability", "messaging"],
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
        title: "Sub-source reconnects without dropping the parent",
        summary:
          "When one Junction child source needs reauthentication, that source is flagged for reconnect in settings while the parent account stays connected and other sources keep syncing.",
        relevanceTags: ["wearables", "junction", "settings"],
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
        title: "Lighter health queries",
        summary:
          "Metric projections now store compact supplemental data and reconstruct rich values only when needed.",
        relevanceTags: ["biomarkers", "wearables", "performance"],
        sourcePullRequests: [235],
      },
      {
        id: "sturdier-workspace-restore",
        kind: "improvement",
        priority: 5,
        title: "Sturdier workspace recovery",
        summary:
          "Hosted workspace restores now use a smaller authenticated path with stronger integrity checks and fewer redundant passes.",
        relevanceTags: ["reliability", "hosted", "data"],
        sourcePullRequests: [243, 244, 246],
      },
      {
        id: "bounded-runtime-logs",
        kind: "improvement",
        priority: 3,
        title: "Bounded runtime logs",
        summary:
          "Assistant runtime logs now keep one bounded tail instead of accumulating unbounded diagnostic history.",
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
        title: "Cold replies start sooner",
        summary:
          "The hosted runner now boots from a bundled entrypoint and overlaps restore legs, trimming the gap between your first message of the morning and Murph's first response on cold containers.",
        relevanceTags: ["performance", "reliability"],
        sourcePullRequests: [147, 149, 151],
      },
      {
        id: "whoop-query-unification",
        kind: "improvement",
        priority: 4,
        title: "WHOOP queries cover ZIP + live sync",
        summary:
          "Asking about WHOOP data now returns both your manual ZIP export and the live Junction stream as one provider, instead of splitting on a hidden whoop-v2 alias.",
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
        title: "Auto-compaction at 128k tokens",
        summary:
          "Threads now auto-compact at 128k tokens, and oversized threads compact in the background at idle — so your next message doesn't stall while Murph trims history.",
        relevanceTags: ["performance", "assistant"],
        sourcePullRequests: [125, 130],
      },
      {
        id: "vault-cli-cold-start",
        kind: "improvement",
        priority: 4,
        title: "CLI runs 12-26% faster",
        summary:
          "The vault CLI now boots from a split esbuild bundle and skips loading the chat UI per invocation, shaving 12-26% off command latency in the hosted runner.",
        relevanceTags: ["performance", "cli"],
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
        title: "No 2-minute replies after a blip",
        summary:
          "Murph now verifies the live runner before declaring a transport failure dead, so a brief network blip stops stranding the next message behind a 3-minute orphan timer.",
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
        title: "No duplicate replies across deploys",
        summary:
          "A durable consumed-watermark and SIGTERM checkpoint stop the runner from re-replying to already-answered messages when a deploy rolls during a conversation.",
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
      "Chat opens straight to a channel picker, email verification fits in one dialog, and Junction wearables refresh every hour instead of every six.",
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
          "Junction-backed wearables — WHOOP, Oura, Garmin and friends — now reconcile every hour instead of every six. Morning sleep and recovery show up sooner.",
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
        title: "Lighter wearable imports",
        summary:
          "Dense wearable timeseries are no longer pulled into normal sync — Murph stores compact daily evidence so connections stay fast and uncluttered.",
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
        title: "Warm assistant process across turns",
        summary:
          "Back-to-back messages now reuse a single warm Codex process instead of spawning fresh per turn, so follow-up replies start sooner.",
        relevanceTags: ["performance", "assistant"],
        sourcePullRequests: [46],
      },
      {
        id: "faster-cli-startup",
        kind: "improvement",
        priority: 4,
        title: "CLI cold-starts in 0.2-0.3s",
        summary:
          "The vault CLI lazy-loads only the command family it needs, dropping common command startup to roughly 0.2-0.3 seconds.",
        relevanceTags: ["cli", "performance"],
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
  return `/changelog#${id}`;
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
