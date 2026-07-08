export const FEATURE_CATALOG_FEED_SCHEMA = "murph.feature-catalog-feed.v1";

const FEATURE_CATALOG_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const FEATURE_CATALOG_TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const COPY_FORBIDDEN_PATTERN = /[\u2014]| - /u;

export interface FeatureCatalogItem {
  alreadyUsing: string;
  details?: string;
  id: string;
  priority: 1 | 2 | 3 | 4 | 5;
  relevanceTags: readonly string[];
  requires?: string;
  sourcePullRequests?: readonly number[];
  summary: string;
  title: string;
  tryIt: {
    label: string;
    prompt: string;
  };
}

const RAW_FEATURE_CATALOG_ITEMS = [
  {
    id: "group-challenge-referee",
    title: "Group challenge referee",
    summary:
      "A bet with your friends is the most fun way to actually do the thing: loser buys dinner, or does the forfeit the group picks. Murph referees so the trash talk stays fun: fair scoring across everyone's different devices, daily standings in the chat, and a clear winner when the stakes come due.",
    details:
      "Challenge state lives on a knowledge page in the group's vault, so rules, stakes, and standings survive any reset.",
    relevanceTags: ["groups", "challenges", "messaging"],
    priority: 5,
    tryIt: {
      label: "Start a challenge",
      prompt: "Start a 5-day steps challenge with us. Loser buys dinner.",
    },
    alreadyUsing:
      "the user is in a Murph group chat with an active or completed group challenge",
    sourcePullRequests: [410],
  },
  {
    id: "group-chat-murph",
    title: "Murph in group chats",
    summary:
      "Your group chat is already where the fun happens; Murph just makes it better at it. Add Murph to the room and it can hype the group, settle arguments with actual data, react at the right moments, and stay quiet when the chat does not need it.",
    details:
      "Murph can create a join link so someone can sign in and join the room. Joining alone does not share anyone's health data.",
    relevanceTags: ["groups", "messaging", "imessage"],
    priority: 5,
    tryIt: {
      label: "Use Murph with friends",
      prompt: "Can I add you to a group chat with my friends for a walking challenge?",
    },
    alreadyUsing: "the user is in any group chat with Murph",
    sourcePullRequests: [363, 369],
  },
  {
    id: "family-private-accounts",
    title: "Private family accounts",
    summary:
      "Give Murph to your parents or partner without becoming their tech support or seeing their private stuff. You cover the household at a lower per-person price than separate plans, and each person gets a private Murph that is fully theirs.",
    relevanceTags: ["family", "privacy", "plans"],
    priority: 4,
    tryIt: {
      label: "Invite family",
      prompt: "Help me invite my partner to Murph while keeping our accounts private.",
    },
    alreadyUsing:
      "the user owns, belongs to, or has invited someone through a Murph family plan",
    sourcePullRequests: [222],
  },
  {
    id: "connect-wearables",
    title: "Connect wearable data",
    summary:
      "You already paid for the ring or the strap; most of what it learns just sits in a dashboard. Connect it and you can finally ask real questions: why you slept badly, whether the training is working, what changed since you started that new habit.",
    relevanceTags: ["wearables", "data", "assistant"],
    priority: 5,
    tryIt: {
      label: "Connect a device",
      prompt: "Connect my wearable so you can help me understand sleep and workouts.",
    },
    alreadyUsing:
      "the user has any active wearable or device connection",
    sourcePullRequests: [72, 73, 138, 336],
  },
  {
    id: "meal-app-imports",
    title: "Meal app imports",
    summary:
      "If you already log meals in MyFitnessPal or Cronometer, that effort should buy you more than a calorie count. Murph pulls your meals in and connects them to the rest of your life: sleep, training, energy, the afternoon crash you keep blaming on work.",
    relevanceTags: ["nutrition", "meals", "wearables"],
    priority: 4,
    tryIt: {
      label: "Ask about meals",
      prompt: "How did my meals this week line up with my training?",
    },
    alreadyUsing:
      "the user has connected a meal logging provider or asked Murph about imported meals",
    requires: "a meal logging app like MyFitnessPal or Cronometer",
    sourcePullRequests: [72],
  },
  {
    id: "food-label-lookup",
    title: "Food label lookup",
    summary:
      "Was that yogurt actually high protein, or did the front of the package just say so? Murph reads the real label for branded foods, so answers about servings, allergens, and macros come from the package, not a guess.",
    relevanceTags: ["food", "nutrition", "data"],
    priority: 5,
    tryIt: {
      label: "Ask about a food",
      prompt: "How much protein is in a serving of Trader Joe's Greek yogurt?",
    },
    alreadyUsing:
      "the user has asked Murph to look up a food label or saved a label-backed food",
    sourcePullRequests: [169],
  },
  {
    id: "food-contaminant-checks",
    title: "Contaminant checks on foods you eat",
    summary:
      "The protein powder or snack you buy every month may have shown up in third-party testing for heavy metals. Ask Murph about a specific product and find out whether it has ever been flagged and how worried to actually be, before you buy the next tub.",
    relevanceTags: ["food", "safety", "data"],
    priority: 5,
    tryIt: {
      label: "Check a food",
      prompt: "Has my protein powder ever been flagged for heavy metals?",
    },
    alreadyUsing:
      "the user has asked Murph about contaminants, heavy metals, recalls, or product safety flags",
  },
  {
    id: "supplement-label-lookup",
    title: "Supplement label lookup",
    summary:
      "Half the supplement aisle is the same ingredient at different doses and prices. Murph pulls the label for the exact product, so you know what is actually in the bottle and whether the dose matches what the research used.",
    relevanceTags: ["supplements", "nutrition", "data"],
    priority: 5,
    tryIt: {
      label: "Look up a supplement",
      prompt: "Look up Thorne magnesium glycinate and tell me the typical dose.",
    },
    alreadyUsing:
      "the user has asked Murph to look up a supplement label or saved a label-backed supplement",
    sourcePullRequests: [48, 65],
  },
  {
    id: "health-record-import",
    title: "Health record import",
    summary:
      "Walk into your next appointment already knowing your trend. Text Murph a lab PDF or visit summary and it gets filed for good, so what your LDL was last year becomes a question you just ask instead of a folder you dig through.",
    relevanceTags: ["vault", "health", "records"],
    priority: 5,
    tryIt: {
      label: "Share a record",
      prompt:
        "Here's my latest lipid panel PDF. File it under blood tests and tell me what stands out.",
    },
    alreadyUsing:
      "the user has uploaded a lab report, visit summary, medication list, imaging report, or other health record for Murph to file",
    sourcePullRequests: [322],
  },
  {
    id: "personal-experiments",
    title: "Personal experiments",
    summary:
      "You have been wondering for months whether the magnesium, the earlier dinners, or the cold room actually helps. Murph helps you settle it: one change, a real baseline, a couple of honest weeks, and an answer about your body instead of a vibe.",
    details:
      "For an active experiment, Murph can share a compact progress readout with trends, movers, a session timeline, and likely confounders.",
    relevanceTags: ["experiments", "protocols", "health"],
    priority: 5,
    tryIt: {
      label: "Start an experiment",
      prompt: "Help me start a lightweight sleep consistency experiment.",
    },
    alreadyUsing: "the user has an active or completed Murph experiment",
    sourcePullRequests: [141],
  },
  {
    id: "scheduled-reminders",
    title: "Scheduled reminders",
    summary:
      "Follow-through is easier when the nudge comes from the conversation you already live in, sounds like a person, and can hear you back. Murph reminds you about routines, supplements, and workouts, and when you reply, it is already mid-conversation.",
    relevanceTags: ["reminders", "automations", "messaging"],
    priority: 4,
    tryIt: {
      label: "Set a reminder",
      prompt: "Remind me every weekday at 8am to take my morning supplements.",
    },
    alreadyUsing: "the user has any active reminder or scheduled nudge automation",
    sourcePullRequests: [92, 111, 185],
  },
  {
    id: "activity-triggered-automations",
    title: "Activity-triggered automations",
    summary:
      "The best time for a check-in is the moment the thing happens, not that evening. Murph can respond to what your wearable records, like a one-line recovery note right after each workout, so it feels less like an app and more like a coach who noticed.",
    relevanceTags: ["automations", "wearables", "reminders"],
    priority: 4,
    tryIt: {
      label: "Set one up",
      prompt: "After every WHOOP workout, drop me a one-line recovery prompt.",
    },
    alreadyUsing: "the user has an activity-triggered automation",
    requires: "a connected wearable",
    sourcePullRequests: [59],
  },
  {
    id: "sleep-review-followups",
    title: "Morning sleep and recovery check-ins",
    summary:
      "Someone noticing how you slept and telling you what it means for today is a small luxury. Once your wearable syncs the night, Murph can check in each morning: what happened, why it might have happened, and how hard to push today.",
    relevanceTags: ["sleep", "wearables", "automations"],
    priority: 4,
    tryIt: {
      label: "Set up a morning check-in",
      prompt: "After my sleep syncs each morning, check in with me about my recovery.",
    },
    alreadyUsing:
      "the user has a sleep-triggered or morning recovery check-in automation",
    requires: "a connected wearable that records sleep",
  },
  {
    id: "exercise-image-demos",
    title: "Exercise demos with images",
    summary:
      "Nobody wants to be the person squinting at their phone mid-gym trying to decode a movement. Ask Murph about an unfamiliar exercise and you get a few clear images and a simple stop-if rule, so you walk in knowing what you are doing.",
    relevanceTags: ["exercise", "images", "coaching"],
    priority: 4,
    tryIt: {
      label: "Ask for a demo",
      prompt: "Show me how to do a glute bridge with a picture.",
    },
    alreadyUsing:
      "the user has asked for exercise walkthroughs or received exercise images",
    sourcePullRequests: [56, 60],
  },
  {
    id: "pain-and-rehab-help",
    title: "Pain and rehab help",
    summary:
      "A sore knee at 11pm usually ends in an hour of scary search results. Tell Murph instead and it works through it calmly, the way a good clinician would: what would be a red flag, what to try this week, how much, and when to push further.",
    relevanceTags: ["rehab", "pain", "health"],
    priority: 4,
    tryIt: {
      label: "Ask about pain",
      prompt: "My knee gets sore after runs. Help me think through what to try safely.",
    },
    alreadyUsing:
      "the user has asked Murph for pain, injury, or rehab guidance",
  },
  {
    id: "chronic-condition-experiments",
    title: "Chronic condition experiments",
    summary:
      "Living with a chronic condition means running experiments on yourself anyway; you are just doing them untracked. Murph helps you make one small change testable, or turns the pattern you suspect into a sharper question for your clinician.",
    relevanceTags: ["health", "chronic-illness", "experiments"],
    priority: 4,
    tryIt: {
      label: "Frame an experiment",
      prompt: "Help me think through a low-risk experiment for my chronic fatigue symptoms.",
    },
    alreadyUsing:
      "the user has asked Murph for chronic condition, chronic pain, or self-management experiment guidance",
  },
  {
    id: "red-light-dose-guidance",
    title: "Red light dose guidance",
    summary:
      "If you own a red light panel, the difference between a useful session and wasted time is dose, not vibes. Tell Murph your panel and distance and it works out what a session is actually delivering and how long to sit.",
    relevanceTags: ["recovery", "skills", "health"],
    priority: 3,
    tryIt: {
      label: "Ask about a panel",
      prompt: "I sit about a foot from my red light panel. How long should sessions be?",
    },
    alreadyUsing:
      "the user has asked Murph for red light or photobiomodulation dose guidance",
    sourcePullRequests: [347, 351],
  },
  {
    id: "voice-memo-replies",
    title: "Voice memo replies",
    summary:
      "Some updates are nicer to hear than read: press play on your week's recap while you make coffee. On channels that support audio, Murph can answer with a spoken voice memo instead of a wall of text.",
    relevanceTags: ["voice", "messaging", "media"],
    priority: 4,
    tryIt: {
      label: "Ask for voice",
      prompt: "Reply with a quick voice memo summarizing my workouts this week.",
    },
    alreadyUsing: "the user has asked for or received a generated voice memo",
    requires: "a chat channel that can receive audio messages",
    sourcePullRequests: [221],
  },
  {
    id: "image-generation",
    title: "Image generation in chat",
    summary:
      "Sometimes the answer that lands is a picture: a poster for tonight's workout, a visual for the group challenge, a quick illustration of the plan. Murph makes images right in the conversation, ready to share.",
    details:
      "A sketch, product photo, room photo, or style reference you send can be used as context for the next generated image.",
    relevanceTags: ["images", "media", "assistant"],
    priority: 5,
    tryIt: {
      label: "Ask for an image",
      prompt: "Make me a simple poster for tonight's workout.",
    },
    alreadyUsing: "the user has asked Murph to generate an image",
    sourcePullRequests: [77],
  },
  {
    id: "pdfs-in-chat",
    title: "PDFs in chat",
    summary:
      "Hand your doctor a clean one-pager instead of scrolling your phone in the exam room. Ask Murph and it turns your training week or lab history into a tidy PDF you can print, forward, or bring to the appointment.",
    relevanceTags: ["documents", "pdf", "assistant"],
    priority: 5,
    tryIt: {
      label: "Ask for a PDF",
      prompt: "Make me a one-page PDF of my training week with sessions, totals, and one note per day.",
    },
    alreadyUsing: "the user has asked Murph to create a PDF",
    sourcePullRequests: [272],
  },
  {
    id: "song-generation",
    title: "Songs in chat",
    summary:
      "Your group's inside joke deserves a soundtrack. Murph can turn tonight's workout, the challenge kickoff, or whatever the chat is laughing about into a short original song, which is a surprisingly effective way to get people moving.",
    relevanceTags: ["voice", "media", "assistant"],
    priority: 4,
    tryIt: {
      label: "Ask for a song",
      prompt: "Write me a 30-second hype song for tonight's workout, upbeat and no lyrics.",
    },
    alreadyUsing: "the user has asked Murph to create a song",
    requires: "a chat channel that can receive audio messages",
    sourcePullRequests: [279],
  },
  {
    id: "email-channel-replies",
    title: "Email Murph",
    summary:
      "Some things are just easier over email: a long lab report, a slow question, an attachment. Email Murph and the answer comes back in the same thread, so the paperwork side of your health has a place to live.",
    relevanceTags: ["email", "channels", "messaging"],
    priority: 4,
    tryIt: {
      label: "Try email",
      prompt: "Can I email you my lab report and get the reply in that same thread?",
    },
    alreadyUsing: "the user has emailed Murph or has hosted email as a connected channel",
    sourcePullRequests: [89, 109],
  },
  {
    id: "connected-apps",
    title: "Connected apps",
    summary:
      "Murph gets more useful when it can actually reach your stuff. Connect Gmail, Google Drive, Notion, Todoist, and more, and asking becomes doing: the note gets written, the doc gets pulled, the task gets added.",
    details:
      "Useful for drafting a note to your trainer from Gmail, saving a meal plan to Notion, pulling a lab PDF from Drive, or adding supplement refills to your task list.",
    relevanceTags: ["integrations", "automation", "tools"],
    priority: 5,
    tryIt: {
      label: "Connect an app",
      prompt: "Connect my Google Calendar so you can add events for me.",
    },
    alreadyUsing:
      "the user has connected Gmail, Outlook, Zoho Mail, Google Drive, OneDrive, Dropbox, Notion, Todoist, Google Tasks, or another connected app",
    sourcePullRequests: [256, 282, 284],
  },
  {
    id: "calendar-event-creation",
    title: "Calendar event creation",
    summary:
      "The workout that is on your calendar is the one that happens. Mention it once and Murph puts it there through your connected Google or Outlook calendar: the training block, the dentist appointment, the wind-down hour nobody else can book over.",
    details:
      "Calendar writes stay scoped to the event you asked for. Murph does not add surprise invites or online meeting rooms by default.",
    relevanceTags: ["integrations", "calendar", "automation"],
    priority: 5,
    tryIt: {
      label: "Add an event",
      prompt: "Add my Thursday 6pm lifting session to my calendar every week.",
    },
    alreadyUsing:
      "the user has asked Murph to create a calendar event through a connected calendar",
    requires: "a connected Google or Outlook calendar",
    sourcePullRequests: [284],
  },
  {
    id: "supplement-ordering",
    title: "Murph can order your supplements",
    summary:
      "Running out of creatine is how a two-month streak ends. Tell Murph you are low and the reorder is ready before you forget, like your usual magnesium on Amazon, paused for you to confirm before anything is placed.",
    relevanceTags: ["supplements", "orders", "automation"],
    priority: 5,
    tryIt: {
      label: "Reorder a supplement",
      prompt: "I'm almost out of creatine. Can you get a reorder ready?",
    },
    alreadyUsing:
      "the user has asked Murph to prepare, reorder, or track a supplement purchase",
  },
  {
    id: "browser-automation",
    title: "Browser tasks with handoff",
    summary:
      "That website errand you have been putting off for two weeks, the dentist booking page, the intake form, takes Murph a few minutes. Hand it over and it works the site for you, pausing whenever a login or final confirmation should be yours.",
    relevanceTags: ["browser", "automation", "handoff"],
    priority: 5,
    tryIt: {
      label: "Delegate a browser task",
      prompt: "Book me a dentist cleaning and pause before anything final.",
    },
    alreadyUsing:
      "the user has asked Murph to use the browser or has an active or completed browser handoff",
    sourcePullRequests: [214, 224, 228, 267, 268, 269],
  },
  {
    id: "phone-calls",
    title: "Phone calls on your behalf",
    summary:
      "The pharmacy call you keep not making. Approve a short brief and Murph makes the call, waits on hold, asks the thing, and tells you how it went, whether that is a refill check, clinic intake, or a reservation.",
    relevanceTags: ["phone-calls", "voice", "tools"],
    priority: 4,
    tryIt: {
      label: "Ask Murph to call",
      prompt: "Call my pharmacy and ask if my prescription is ready to pick up.",
    },
    alreadyUsing: "the user has asked Murph to place a phone call",
    sourcePullRequests: [295],
  },
  {
    id: "live-weather",
    title: "Live weather",
    summary:
      "Know before you lace up. Murph checks the sky when it matters, so the long run, the walk, or the travel day gets planned around the forecast instead of surprised by it.",
    relevanceTags: ["weather", "tools", "assistant"],
    priority: 3,
    tryIt: {
      label: "Check the forecast",
      prompt: "What's the weather looking like for my long run Saturday morning?",
    },
    alreadyUsing: "the user has asked Murph for current weather or a forecast",
    sourcePullRequests: [284],
  },
] satisfies readonly FeatureCatalogItem[];

export const FEATURE_CATALOG_ITEMS: readonly FeatureCatalogItem[] = Object.freeze(
  validateFeatureCatalogItems(RAW_FEATURE_CATALOG_ITEMS).map(freezeFeatureCatalogItem),
);

export function validateFeatureCatalogItems(
  items: readonly FeatureCatalogItem[],
): readonly FeatureCatalogItem[] {
  const ids = new Set<string>();

  for (const item of items) {
    if (!isFeatureCatalogId(item.id) || ids.has(item.id)) {
      throw new TypeError(`Invalid or duplicate feature catalog item id: ${item.id}`);
    }
    assertText(item.title, "item title", 120, true);
    assertText(item.summary, "item summary", 500, true);
    if (item.details !== undefined) {
      assertText(item.details, "item details", 1_000, true);
    }
    if (!Number.isInteger(item.priority) || item.priority < 1 || item.priority > 5) {
      throw new TypeError(`Invalid feature catalog item priority: ${item.id}`);
    }
    if (
      item.relevanceTags.length === 0 ||
      item.relevanceTags.some((tag) => !FEATURE_CATALOG_TAG_PATTERN.test(tag))
    ) {
      throw new TypeError(`Invalid feature catalog relevance tags: ${item.id}`);
    }
    assertText(item.tryIt.label, "try-it label", 120, true);
    assertText(item.tryIt.prompt, "try-it prompt", 500, true);
    assertText(item.alreadyUsing, "already-using signal", 700, false);
    if (item.requires !== undefined) {
      assertText(item.requires, "requires note", 200, true);
    }
    if (
      item.sourcePullRequests?.some(
        (pullRequest) => !Number.isInteger(pullRequest) || pullRequest <= 0,
      )
    ) {
      throw new TypeError(`Invalid feature catalog pull request reference: ${item.id}`);
    }
    ids.add(item.id);
  }

  return items;
}

function freezeFeatureCatalogItem(item: FeatureCatalogItem): FeatureCatalogItem {
  return Object.freeze({
    ...item,
    relevanceTags: Object.freeze([...item.relevanceTags]),
    ...(item.sourcePullRequests === undefined
      ? {}
      : { sourcePullRequests: Object.freeze([...item.sourcePullRequests]) }),
    tryIt: Object.freeze({ ...item.tryIt }),
  });
}

function assertText(
  value: string,
  label: string,
  maximum: number,
  userFacing: boolean,
): void {
  if (!value.trim() || value !== value.trim() || value.length > maximum) {
    throw new TypeError(`Feature catalog ${label} must be trimmed and at most ${maximum} characters.`);
  }
  if (userFacing && COPY_FORBIDDEN_PATTERN.test(value)) {
    throw new TypeError(`Feature catalog ${label} contains forbidden copy punctuation.`);
  }
}

function isFeatureCatalogId(value: string): boolean {
  return value.length <= 120 && FEATURE_CATALOG_ID_PATTERN.test(value);
}
