import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

export const CHANGELOG_FEED_SCHEMA = "murph.changelog-feed.v1";
export const CHANGELOG_CARD_VERSION = "v1";
export const CHANGELOG_CARD_MAX_ITEMS = 7;
export const CHANGELOG_PREVIEW_CARD_ITEMS = 5;
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

const RAW_CHANGELOG_EDITIONS = [
  {
    id: "2026-06-29",
    publishedOn: "2026-06-29",
    title: "Garmin sleep through Junction, and a smoother phone sign-in",
    summary:
      "Garmin sleep, cycles, and hypnograms imported through Junction now arrive as real records. The phone-number sign-in stops freezing right after the verification code lands.",
    items: [
      {
        id: "garmin-junction-sleep-records",
        kind: "feature",
        priority: 4,
        title: "Garmin sleep arrives through Junction as real records",
        summary:
          "Garmin sleep, sleep cycles, and hypnograms pushed through Junction now land as full records instead of being dropped as skeleton completion events.",
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
      "Approve a brief and Murph can place an outbound phone call on your behalf. Health records you upload land in your vault, computer handoffs return on the channel that started them, WHOOP and Junction days line up with your calendar, and a wave of polish trims chat noise.",
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
        title: "WHOOP and Junction days line up with your calendar",
        summary:
          "Closed a class of bugs where WHOOP or Junction records could drift into the next calendar day when the provider timestamp crossed UTC midnight — including WHOOP records flowing through Junction. Past records repair on replay.",
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
          "Hosted auto-compaction now waits until 100k tokens instead of 84k, so long browser/computer-use loops finish in one piece.",
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
