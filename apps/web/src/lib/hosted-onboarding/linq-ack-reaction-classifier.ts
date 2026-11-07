/**
 * Classifies one inbound member message for the "on it" emoji tapback the Web
 * puts on slow-work requests before the runner's reply arrives. One OpenAI
 * Decisions call answers two questions: what Murph is about to do (choice) and
 * whether the message is emotionally heavy (predicate). The prompt wording is
 * pinned by the live eval in `apps/web/scripts/linq-ack-reaction-eval.ts`;
 * change it only with a fresh eval run.
 */

import OpenAI from "openai";

export const HOSTED_LINQ_ACK_REACTION_MODEL = "gpt-6-luna";
export const HOSTED_LINQ_ACK_REACTION_HEAVY_THRESHOLD = 0.5;
/** Production drops a decision slower than this; the live eval uses it too. */
export const HOSTED_LINQ_ACK_REACTION_CLASSIFY_TIMEOUT_MS = 3_000;

export const HOSTED_LINQ_ACK_REACTION_KINDS = [
  "reminder",
  "my_data",
  "research",
  "make",
  "look",
  "picture",
  "song",
  "calendar",
  "challenge",
  "do",
  "log",
  "none",
] as const;
export type HostedLinqAckReactionKind =
  typeof HOSTED_LINQ_ACK_REACTION_KINDS[number];

/** Quick asks need no extra acknowledgment while the conversation is live. */
export const HOSTED_LINQ_ACK_REACTION_QUICK_KINDS: readonly HostedLinqAckReactionKind[] = [
  "my_data",
  "calendar",
  "reminder",
  "challenge",
];

/**
 * The go-ahead tapback. Linq sends it as iMessage's native Like, not a custom
 * emoji, so it looks like a person's thumbs up.
 */
export const HOSTED_LINQ_ACK_REACTION_LIKE = "👍";

/** Kinds that get a tapback. `log` and `none` never react. */
export const HOSTED_LINQ_ACK_REACTION_EMOJI: Readonly<
  Partial<Record<HostedLinqAckReactionKind, string>>
> = {
  calendar: "📅",
  challenge: "🏆",
  do: HOSTED_LINQ_ACK_REACTION_LIKE,
  look: "👀",
  make: "📝",
  my_data: "👀",
  picture: "🎨",
  reminder: "⏰",
  research: "🔎",
  song: "🎶",
};

const DEVELOPER_CONTEXT =
  "Murph is a health coach people text over iMessage. Murph can set reminders, read the member's own health data (sleep, heart rate, steps, meals, weight), research questions, make plans and files, look at photos, create images and songs, read and change the member's calendar, run challenges with friends, and update the member's goals, plans, and settings. You are judging the member's latest message only, using earlier messages as context.";

const KIND_DESCRIPTIONS: Readonly<Record<HostedLinqAckReactionKind, string>> = {
  reminder:
    "Set, change, pause, or stop a reminder, nudge, alarm, or scheduled check-in from Murph.",
  my_data:
    "Check the member's own logged or device data: sleep, heart rate, HRV, steps, workouts, calories, weight, goals, trends, recaps.",
  research:
    "Look up something Murph has to search for right now: specific studies, nutrition facts for a named food or menu item, products, places, weather, routes. General health questions Murph can answer from what it already knows are none.",
  make:
    "Write or build something sizeable that is not a picture or a song: a meal or training plan, a list, a document, an email draft, an export.",
  look:
    "Study a photo, screenshot, or file for health details: a meal, a food label, a menu, lab results, workout or device stats.",
  picture:
    "Create an image: a drawing, poster, cartoon, badge, or picture, including turning the member's photo into art.",
  song: "Create music: a song, jingle, lullaby, rap, or diss track.",
  calendar:
    "Read or change the member's calendar: what is scheduled, finding free time, adding events, sending invites.",
  challenge:
    "Start, change, join, leave, or check standings in a challenge or game with other people.",
  do:
    "Carry out a change or a go-ahead that fits none of the kinds above: update a goal, target, preference, or setting; swap, move, drop, or cancel something in a plan Murph made; save, send, or delete something; or the member telling Murph to go ahead (sure, please do; yes go ahead) with something Murph offered to do. A bare ok, sounds good, got it, cool, or thanks that only acknowledges is none, and so is a yes that answers a question or reports something already done (yep did it; yes it went fine).",
  log:
    "Record something the member describes in words that they just did or ate: a meal, a workout, a weigh-in, drinks, or a short yes confirming they did a habit Murph asked about. A photo of food is look, not log.",
  none:
    "Anything else: chat, thanks, feelings, questions about what Murph can do, quick questions Murph can answer from what it already knows, casual photos (pets, selfies, scenery, memes, art).",
};

const HEAVY_INSTRUCTIONS =
  "Is the member sharing something heavy: grief or loss, a frightening diagnosis, an injury or emergency, a crisis like losing a job, panic, depression, or shame, where a cheerful emoji reaction would feel tone-deaf? Ordinary venting about being busy, tired, sore, or stressed does not count, and neither do routine health questions or test results.";

const KIND_INSTRUCTIONS = "What is Murph about to do for the latest message?";

export interface HostedLinqAckReactionMessage {
  /** Publicly fetchable image URLs from the message (Linq media parts). */
  imageUrls: readonly string[];
  /** Concatenated text parts; may be empty for a photo-only message. */
  text: string;
}

export interface HostedLinqAckReactionDecision {
  emoji: string | null;
  heavy: number;
  kind: HostedLinqAckReactionKind;
  kindConfidence: number | null;
}

export function buildHostedLinqAckReactionDecisionsRequest(
  message: HostedLinqAckReactionMessage,
): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [
    ...message.imageUrls.map((url) => ({ image_url: url, type: "input_image" })),
  ];
  const text = message.text.trim();
  if (text) {
    content.push({ text, type: "input_text" });
  }
  return {
    input: [
      { content: DEVELOPER_CONTEXT, role: "developer" },
      { content, role: "user" },
    ],
    model: HOSTED_LINQ_ACK_REACTION_MODEL,
    questions: [
      { instructions: HEAVY_INSTRUCTIONS, name: "heavy", type: "predicate" },
      {
        choices: HOSTED_LINQ_ACK_REACTION_KINDS.map((value) => ({
          description: KIND_DESCRIPTIONS[value],
          value,
        })),
        instructions: KIND_INSTRUCTIONS,
        name: "kind",
        type: "choice",
      },
    ],
  };
}

/**
 * Returns null for anything unexpected (refusal, missing answer, unknown kind)
 * so callers stay quiet rather than guess.
 */
export function parseHostedLinqAckReactionDecision(
  payload: unknown,
): HostedLinqAckReactionDecision | null {
  const answers = readRecord(payload)?.answers;
  if (!Array.isArray(answers)) {
    return null;
  }
  let heavy: number | null = null;
  let kind: HostedLinqAckReactionKind | null = null;
  let kindConfidence: number | null = null;
  for (const entry of answers) {
    const answer = readRecord(entry);
    if (!answer) continue;
    if (answer.name === "heavy" && answer.type === "predicate") {
      heavy = readProbability(answer.probability);
    } else if (answer.name === "kind" && answer.type === "choice") {
      kind = readKind(answer.choice);
      kindConfidence = readProbability(answer.confidence);
    }
  }
  if (heavy === null || kind === null) {
    return null;
  }
  return {
    emoji: heavy < HOSTED_LINQ_ACK_REACTION_HEAVY_THRESHOLD
      ? HOSTED_LINQ_ACK_REACTION_EMOJI[kind] ?? null
      : null,
    heavy,
    kind,
    kindConfidence,
  };
}

/**
 * Burst rule: a burst is the member's messages since Murph last sent anything
 * in the chat. At most one tapback per burst, on the first message that earns
 * one; once any message in the burst reads heavy, the rest stays quiet.
 * Production enforces this with the per-chat claim in
 * `linq-ack-reaction-store.ts`; the eval replays it in memory with this
 * function.
 */
export function stepHostedLinqAckReactionBurst(
  state: { acked: boolean; heavySeen: boolean },
  decision: HostedLinqAckReactionDecision,
): { emoji: string | null; heavy: boolean } {
  const heavy = decision.heavy >= HOSTED_LINQ_ACK_REACTION_HEAVY_THRESHOLD;
  return {
    emoji: state.acked || state.heavySeen || heavy ? null : decision.emoji,
    heavy,
  };
}

type HostedLinqAckReactionOpenAiClient = Pick<OpenAI, "post">;

let cachedClient: { apiKey: string; client: HostedLinqAckReactionOpenAiClient } | null = null;

/** One SDK client per key: no retries, and the 3 s budget doubles as its timeout. */
function readHostedLinqAckReactionOpenAiClient(apiKey: string): HostedLinqAckReactionOpenAiClient {
  if (cachedClient?.apiKey !== apiKey) {
    cachedClient = {
      apiKey,
      client: new OpenAI({
        apiKey,
        maxRetries: 0,
        timeout: HOSTED_LINQ_ACK_REACTION_CLASSIFY_TIMEOUT_MS,
      }),
    };
  }
  return cachedClient.client;
}

/**
 * The installed SDK has no Decisions resource yet, so this posts through the
 * SDK's generic request path. HTTP errors throw the SDK's `APIError`, and an
 * abort throws `APIUserAbortError`.
 */
export async function classifyHostedLinqAckReaction(input: {
  apiKey: string;
  client?: HostedLinqAckReactionOpenAiClient;
  message: HostedLinqAckReactionMessage;
  signal: AbortSignal;
}): Promise<HostedLinqAckReactionDecision | null> {
  const client = input.client ?? readHostedLinqAckReactionOpenAiClient(input.apiKey);
  const response = await client.post<unknown>("/decisions", {
    body: buildHostedLinqAckReactionDecisionsRequest(input.message),
    maxRetries: 0,
    signal: input.signal,
  });
  return parseHostedLinqAckReactionDecision(response);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readProbability(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function readKind(value: unknown): HostedLinqAckReactionKind | null {
  return typeof value === "string"
    && (HOSTED_LINQ_ACK_REACTION_KINDS as readonly string[]).includes(value)
    ? value as HostedLinqAckReactionKind
    : null;
}
