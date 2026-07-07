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
      "Murph can run a challenge in the group chat you already have. It helps settle the metric, keeps standings moving, varies the daily check-in, and closes with the result.",
    details:
      "Useful when a challenge would otherwise need one person to chase updates, keep rules straight, and make the group care after day two.",
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
      "Add Murph to an iMessage group and it can participate in the room, understand who said what, and decide when a reply, reaction, or silence fits.",
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
    id: "group-join-links",
    title: "Group join links",
    summary:
      "Murph can create a join link for a group so someone can sign in and join the room. Joining alone does not share health data, and any challenge stats stay a separate explicit choice.",
    relevanceTags: ["groups", "invites", "privacy"],
    priority: 4,
    tryIt: {
      label: "Invite someone",
      prompt: "Invite my brother to this Murph group.",
    },
    alreadyUsing:
      "the user has created, accepted, or shared a Murph group join link",
    sourcePullRequests: [356, 360],
  },
  {
    id: "bounded-challenge-stat-sharing",
    title: "Bounded challenge stat sharing",
    summary:
      "For group challenges, Murph can work with scoped daily stats like steps, activity minutes, workouts, heart-rate-zone minutes, strain, resting heart rate, or HRV after members approve what fits the challenge.",
    relevanceTags: ["groups", "challenges", "privacy"],
    priority: 4,
    tryIt: {
      label: "Pick a challenge metric",
      prompt: "What stats could we safely use for a sleep or walking challenge?",
    },
    alreadyUsing:
      "the user has approved bounded stat sharing for a Murph group challenge",
    sourcePullRequests: [382],
  },
  {
    id: "family-private-accounts",
    title: "Private family accounts",
    summary:
      "A family owner can sponsor Murph for household members while each person keeps a private account. The owner cannot read another member's chats, vault, or health data.",
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
      "Murph can use connected wearable data from sources like WHOOP, Oura, Garmin, and Apple Health to answer questions about sleep, activity, workouts, recovery, and experiment progress.",
    relevanceTags: ["wearables", "data", "assistant"],
    priority: 5,
    tryIt: {
      label: "Connect a device",
      prompt: "Connect my wearable so you can help me understand sleep and workouts.",
    },
    alreadyUsing:
      "the user has any active wearable, device, or Apple Health connection",
    sourcePullRequests: [72, 73, 138, 336],
  },
  {
    id: "wearable-reconnect-help",
    title: "Wearable reconnect help",
    summary:
      "When sleep, recovery, activity, or workouts look missing, Murph can check whether a connected source needs attention before treating silence as the truth.",
    relevanceTags: ["wearables", "reliability", "assistant"],
    priority: 4,
    tryIt: {
      label: "Check a data gap",
      prompt: "Why does my sleep data look missing this week?",
    },
    alreadyUsing:
      "the user has asked Murph to diagnose a wearable data gap or reconnect a device",
    sourcePullRequests: [341],
  },
  {
    id: "wearable-workout-adherence",
    title: "Wearable workouts count toward experiments",
    summary:
      "Running and cycling experiments can count workouts your watch already recorded, so progress reflects the sessions you actually did without a second manual log.",
    relevanceTags: ["experiments", "wearables", "adherence"],
    priority: 4,
    tryIt: {
      label: "Check an experiment",
      prompt: "How's my running experiment going?",
    },
    alreadyUsing:
      "the user has an active or completed experiment whose adherence used wearable workouts",
    sourcePullRequests: [399],
  },
  {
    id: "apple-health-relay",
    title: "Apple Health relay",
    summary:
      "The iOS companion can relay Apple Health series like wrist temperature, caffeine, water, mindfulness, heart-rate recovery, glucose, blood pressure, menstrual cycles, ECG, and more into Murph.",
    relevanceTags: ["apple-health", "wearables", "companion"],
    priority: 4,
    tryIt: {
      label: "Connect Apple Health",
      prompt: "Can we connect Apple Health so you can see more than just workouts?",
    },
    alreadyUsing: "the user has connected Apple Health through the companion relay",
    sourcePullRequests: [138],
  },
  {
    id: "meal-app-imports",
    title: "Meal app imports",
    summary:
      "Meals logged in apps like MyFitnessPal or Cronometer can flow into Murph with ingredients and nutrition, ready for questions about food alongside training and sleep.",
    relevanceTags: ["nutrition", "meals", "wearables"],
    priority: 4,
    tryIt: {
      label: "Ask about meals",
      prompt: "How did my meals this week line up with my training?",
    },
    alreadyUsing:
      "the user has connected a meal logging provider or asked Murph about imported meals",
    sourcePullRequests: [72],
  },
  {
    id: "food-label-lookup",
    title: "Food label lookup",
    summary:
      "Murph can look up nutrition labels for branded foods and use the label instead of guessing when product identity, ingredients, allergens, or serving facts matter.",
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
    id: "supplement-label-lookup",
    title: "Supplement label lookup",
    summary:
      "Murph can look up supplement labels by brand, ingredient, or product name, then ground ingredient and dose questions in the label it found.",
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
      "Share a lab report, visit summary, medication list, imaging report, or other health document and Murph can file the useful facts into your vault with the raw evidence preserved.",
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
    id: "expanded-health-metrics",
    title: "Expanded health metric questions",
    summary:
      "Murph can answer from more captured metric types, including caffeine, water, mindfulness, heart-rate recovery, glucose, blood pressure, basal body temperature, height, and cycle data when those records exist.",
    relevanceTags: ["metrics", "data", "health"],
    priority: 4,
    tryIt: {
      label: "Ask about a metric",
      prompt: "What changed in my blood pressure and caffeine logs this month?",
    },
    alreadyUsing:
      "the user has asked about a captured metric such as glucose, blood pressure, caffeine, water, mindfulness, or cycle data",
    sourcePullRequests: [168],
  },
  {
    id: "personal-experiments",
    title: "Personal experiments",
    summary:
      "Murph can help you choose a bounded health experiment, set a baseline, track adherence and confounders, and review what changed afterward.",
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
    id: "experiment-progress-cards",
    title: "Experiment progress cards",
    summary:
      "For an active experiment, Murph can share a compact progress readout with trends, movers, a session timeline, and likely confounders.",
    relevanceTags: ["experiments", "media", "progress"],
    priority: 4,
    tryIt: {
      label: "Check progress",
      prompt: "How is my current experiment going so far?",
    },
    alreadyUsing:
      "the user has requested an experiment progress check or received an experiment progress card",
    sourcePullRequests: [97],
  },
  {
    id: "goals-and-habits-memory",
    title: "Goals and habits Murph remembers",
    summary:
      "When you accept a habit, ramp, target, or non-experiment plan, Murph can keep it in working context so later replies do not have to reconstruct it from chat.",
    relevanceTags: ["goals", "habits", "memory"],
    priority: 4,
    tryIt: {
      label: "Save a plan",
      prompt: "Help me set a simple two-week walking plan and remember it for check-ins.",
    },
    alreadyUsing:
      "the user has a saved goal, habit, regimen, or active plan that Murph already reads",
  },
  {
    id: "behavior-followthrough",
    title: "Follow-through repair",
    summary:
      "If you miss a workout, supplement, diet plan, or other commitment, Murph can help repair the plan instead of pretending everything is fine.",
    relevanceTags: ["coaching", "habits", "assistant"],
    priority: 4,
    tryIt: {
      label: "Repair a plan",
      prompt: "I missed two of the workouts I planned for this week.",
    },
    alreadyUsing:
      "the user has told Murph they missed a plan or asked for help repairing follow-through",
    sourcePullRequests: [199],
  },
  {
    id: "scheduled-reminders",
    title: "Scheduled reminders",
    summary:
      "Murph can set scheduled nudges for routines, supplements, workouts, and experiment support, with the reminder continuing in the conversation where it started.",
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
      "Murph can run an automation after a matching wearable activity, such as a one-line recovery prompt after each logged workout.",
    relevanceTags: ["automations", "wearables", "reminders"],
    priority: 4,
    tryIt: {
      label: "Set one up",
      prompt: "After every WHOOP workout, drop me a one-line recovery prompt.",
    },
    alreadyUsing: "the user has an activity-triggered automation",
    sourcePullRequests: [59],
  },
  {
    id: "weekly-health-digest",
    title: "Weekly health digest",
    summary:
      "Murph can make a concise weekly digest when there is real wearable, log, or experiment movement, and skip when a hollow recap would be noise.",
    relevanceTags: ["automations", "digest", "health"],
    priority: 4,
    tryIt: {
      label: "Ask about digests",
      prompt: "What would you put in my weekly health digest right now?",
    },
    alreadyUsing:
      "the user has received, configured, or already has an active weekly health digest automation",
    sourcePullRequests: [74, 331],
  },
  {
    id: "weekly-research-scout",
    title: "Weekly research scout",
    summary:
      "Murph can scan for recent research relevant to your saved goals, conditions, supplements, and experiments, then share only the single insight that clears the bar.",
    relevanceTags: ["research", "automations", "health"],
    priority: 4,
    tryIt: {
      label: "Ask about research",
      prompt: "What new research would be worth watching for my current health goals?",
    },
    alreadyUsing:
      "the user has received, configured, or already has an active weekly research scout automation",
    sourcePullRequests: [206, 226],
  },
  {
    id: "memory-consolidation",
    title: "Murph remembers durable context",
    summary:
      "Murph can consolidate useful conversation context into durable memory so preferences, stable plans, and recurring details carry forward without making you repeat them.",
    relevanceTags: ["memory", "assistant", "context"],
    priority: 4,
    tryIt: {
      label: "Save context",
      prompt: "Remember that I prefer morning workouts and vegetarian dinners.",
    },
    alreadyUsing:
      "the user has saved durable memory or Murph has run overnight memory consolidation for them",
    sourcePullRequests: [355],
  },
  {
    id: "exercise-image-demos",
    title: "Exercise demos with images",
    summary:
      "Murph can introduce unfamiliar movements with a few images and a short safety stop rule instead of dumping a long exercise plan.",
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
      "Mention a strain, ache, or rehab program and Murph can reason through red flags, exercise selection, dosing, follow-up, and progression in a clinical-style flow.",
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
    id: "specialized-health-coaches",
    title: "Specialized health coaches",
    summary:
      "Murph can route through specialized coaching modes for sleep, stress, food, running, lifting, and race prep when the question calls for that lens.",
    relevanceTags: ["coaching", "health", "skills"],
    priority: 4,
    tryIt: {
      label: "Try a coach",
      prompt: "Half marathon in 8 weeks and I'm lifting twice a week. What should I actually do?",
    },
    alreadyUsing:
      "the user has used a specialized Murph coach for sleep, stress, food, running, lifting, or race prep",
    sourcePullRequests: [298, 299, 300, 301, 302, 303],
  },
  {
    id: "chronic-condition-experiments",
    title: "Chronic condition experiments",
    summary:
      "For chronic illness, chronic pain, and at-home self-management questions, Murph can help frame a low-risk experiment or a clinician discussion prompt without treating a symptom as a verdict.",
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
      "If you use red light therapy, Murph can ask for the panel and distance, then reason from dose and irradiance instead of giving a generic session length.",
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
      "Murph can reply with a generated voice memo on supported channels when a spoken summary would fit better than text.",
    relevanceTags: ["voice", "messaging", "media"],
    priority: 4,
    tryIt: {
      label: "Ask for voice",
      prompt: "Reply with a quick voice memo summarizing my workouts this week.",
    },
    alreadyUsing: "the user has asked for or received a generated voice memo",
    sourcePullRequests: [221],
  },
  {
    id: "image-generation",
    title: "Image generation in chat",
    summary:
      "Murph can create images directly in conversation, from quick illustrations to workout visuals or a poster for a group activity.",
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
    id: "reference-image-generation",
    title: "Image generation from references",
    summary:
      "Share a sketch, product photo, room photo, or style reference and Murph can use that image as context for the next generated image.",
    relevanceTags: ["images", "media", "tools"],
    priority: 4,
    tryIt: {
      label: "Use a reference",
      prompt: "Use that fridge photo I just shared and show me a cleaner shelf layout.",
    },
    alreadyUsing: "the user has shared an image as a reference for image generation",
    sourcePullRequests: [330],
  },
  {
    id: "pdfs-in-chat",
    title: "PDFs in chat",
    summary:
      "Murph can author a clean PDF from chat, such as a one-page workout plan, training recap, or lab-results summary.",
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
      "Murph can create a short generated song and share it in the conversation when a playful audio reply fits.",
    relevanceTags: ["voice", "media", "assistant"],
    priority: 4,
    tryIt: {
      label: "Ask for a song",
      prompt: "Write me a 30-second hype song for tonight's workout, upbeat and no lyrics.",
    },
    alreadyUsing: "the user has asked Murph to create a song",
    sourcePullRequests: [279],
  },
  {
    id: "email-channel-replies",
    title: "Email Murph",
    summary:
      "Murph can reply by email in the same thread, so longer context, files, and asynchronous questions can stay in email instead of moving back to chat.",
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
      "Connect apps like Gmail, Outlook, Google Drive, OneDrive, Dropbox, Notion, Todoist, or Google Tasks and Murph can use them when you ask.",
    details:
      "Useful for drafting email, pulling a document, capturing a note, checking task context, or keeping a health-related workflow in chat.",
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
      "With a connected Google or Outlook calendar, Murph can add the event you described with title, start time, duration, location, and notes.",
    details:
      "Calendar writes stay scoped to the event you asked for. Murph does not add surprise invites or online meeting rooms by default.",
    relevanceTags: ["integrations", "calendar", "automation"],
    priority: 5,
    tryIt: {
      label: "Add an event",
      prompt: "Add a 45-minute call with Sam to my calendar tomorrow at 2pm.",
    },
    alreadyUsing:
      "the user has asked Murph to create a calendar event through a connected calendar",
    sourcePullRequests: [284],
  },
  {
    id: "browser-automation",
    title: "Browser tasks with handoff",
    summary:
      "Murph can drive websites for health-relevant tasks like booking appointments, filling forms, finding information, or preparing orders, then pause for logins, payment, or final confirmation.",
    relevanceTags: ["browser", "automation", "handoff"],
    priority: 5,
    tryIt: {
      label: "Delegate a browser task",
      prompt: "Help me complete this website task and pause before anything that needs my login, payment, or final confirmation.",
    },
    alreadyUsing:
      "the user has asked Murph to use the browser or has an active or completed browser handoff",
    sourcePullRequests: [214, 224, 228, 267, 268, 269],
  },
  {
    id: "phone-calls",
    title: "Phone calls on your behalf",
    summary:
      "After you approve a compact call brief, Murph can place an outbound phone call for tasks like pharmacy refills, clinic intake, reservations, or quick check-ins, then summarize the outcome.",
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
      "Murph can check current weather and near-term forecasts when weather matters for a run, walk, travel day, or outdoor plan.",
    relevanceTags: ["weather", "tools", "assistant"],
    priority: 3,
    tryIt: {
      label: "Check the forecast",
      prompt: "What's the weather looking like for my long run Saturday morning?",
    },
    alreadyUsing: "the user has asked Murph for current weather or a forecast",
    sourcePullRequests: [284],
  },
  {
    id: "product-feedback",
    title: "Product feedback from chat",
    summary:
      "If something in Murph feels confusing, useful, broken, or missing, you can tell Murph in chat and it can record concise product feedback for the team.",
    relevanceTags: ["feedback", "product", "assistant"],
    priority: 3,
    tryIt: {
      label: "Share feedback",
      prompt: "I have some feedback on Murph. Can you record this for the team?",
    },
    alreadyUsing: "the user has asked Murph to record product feedback",
    sourcePullRequests: [255],
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
