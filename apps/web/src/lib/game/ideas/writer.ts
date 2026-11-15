import OpenAI from "openai";
import { normalizeGameText } from "../text";
import { isGameTextRefused } from "../moderation";
import { isRecord } from "../../primitives";
import { gameIdeasBrief, gameIdeasFits, isGameIdeasApart } from "./brief";
import { parseGameIdeasInput, SCHEDULES, type GameIdea, type GameIdeasInput } from "./input";
import { BANNED, dareQuestion, MAX_CHARS, PRIZE_CHORE, PRIZE_STRETCH, stakeInput, stakeQuestion, STAKE_BAR, TASK_UNSEEN } from "./rules";
import { tidy } from "./tidy";
import { capLeads, ideaShape } from "./variety";

export const GAME_IDEAS_TIMEOUT_MS = 8_000;
export const GAME_IDEAS_MODEL = "gpt-6-luna";
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["ideas"],
  properties: { ideas: { type: "array", maxItems: 12, items: {
    type: "object", additionalProperties: false, required: ["text", "schedule"],
    properties: { text: { type: "string", maxLength: 120 }, schedule: { type: "string", enum: [...SCHEDULES] } },
  } } },
};

// Broader suggestion restrictions supplement the bank's exact copied BANNED rule.
const ALCOHOL = /\b(alcohol|liquor|spirits|cider|sake|rum|gin|whisky|bourbon|scotch|sangria|hard seltzer)\b/i;
const MONEY_OR_BET = /\b(money|bucks?|currency|wager\w*|betting|poker|blackjack|roulette|scratch.?cards?)\b/i;

/** Normalize after cleanup with the same pure acceptance used for manual commands. */
export function cleanGameIdea(text: string, step: GameIdeasInput["step"]): string | null {
  let cleaned: string;
  try {
    cleaned = normalizeGameText(tidy(text, step === "task"), "text");
  } catch {
    return null;
  }
  if (isGameTextRefused(step, cleaned)) return null;
  const plain = cleaned.normalize("NFKC");
  if (cleaned.length > MAX_CHARS[step] || BANNED.test(plain) || ALCOHOL.test(plain) || MONEY_OR_BET.test(plain) || /\u2014/.test(plain)) return null;
  if (step === "prize" && (PRIZE_STRETCH.test(plain) || PRIZE_CHORE.test(plain) || /\b(loser|winner|you|your)\b/i.test(plain))) return null;
  if (step === "dare" && /\b(your|my)\b/i.test(plain)) return null;
  if (step !== "task" && /\b(cozy|scenic|fancy|thoughtful)\b/i.test(plain)) return null;
  if (step === "task" && (TASK_UNSEEN.test(plain) || /\b(do|for|brisk|easy|light|slowly|quietly|bodyweight|cozy)\b/i.test(plain))) return null;
  return cleaned;
}

/** Strict provider parsing is still necessary even with structured output. */
function parseIdeas(payload: unknown): GameIdea[] {
  if (!isRecord(payload) || Object.keys(payload).length !== 1 || !Array.isArray(payload.ideas) || payload.ideas.length > 12) throw new Error("Invalid ideas.");
  return payload.ideas.map(item => {
    if (!isRecord(item) || Object.keys(item).length !== 2 || typeof item.text !== "string" || item.text.length > 120) throw new Error("Invalid idea.");
    const schedule = SCHEDULES.find(value => value === item.schedule);
    if (!schedule) throw new Error("Invalid schedule.");
    return { text: item.text, schedule };
  });
}

const TASK_SITUATION = "Ideas for a daily task two people will each do and prove with a photo for a week in a health challenge app.";
const realTask = (text: string) =>
  `Is "${text}" a real, recognizable thing people actually do as a daily habit (exercise, rest, sleep, eating well, keeping a home, or a good daily habit)? Answer no for gimmicks, jokes, jargon, props used for their own sake, and trivial or made-up activities.`;

/** One Decisions call, as the lab tuned it: is each idea good for this pair
 * (the offline build's calibrated input and question), is a dare not a favor
 * (the build's dare question), and does it fit what was asked. */
export function gameIdeasCheck(ctx: GameIdeasInput, ideas: GameIdea[]) {
  const fits = gameIdeasFits(ctx);
  return {
    model: GAME_IDEAS_MODEL,
    input: ctx.step === "task" ? TASK_SITUATION : stakeInput(ctx.relationship, isGameIdeasApart(ctx) ? "far" : "near"),
    questions: ideas.flatMap((idea, index) => [
      { type: "predicate", name: `r${index}`, instructions: ctx.step === "task" ? realTask(idea.text) : stakeQuestion(ctx.step, idea.text) },
      ...(ctx.step === "dare" ? [{ type: "predicate", name: `d${index}`, instructions: dareQuestion(idea.text) }] : []),
      { type: "predicate", name: `f${index}`, instructions: `Could "${idea.text}" be ${fits.join(" and ")}?` },
    ]),
  };
}

/** Good enough for the pair, then best fit first; clear misses go when at
 * least four others are left. */
function acceptedIdeas(payload: unknown, ideas: GameIdea[], step: GameIdeasInput["step"]): GameIdea[] {
  if (!isRecord(payload) || !Array.isArray(payload.answers)) throw new Error("Invalid decisions.");
  const probabilities = new Map<string, number>();
  for (const answer of payload.answers) {
    if (!isRecord(answer) || answer.type !== "predicate" || typeof answer.name !== "string"
      || typeof answer.probability !== "number" || !Number.isFinite(answer.probability)
      || answer.probability < 0 || answer.probability > 1 || probabilities.has(answer.name)) throw new Error("Invalid decision.");
    probabilities.set(answer.name, answer.probability);
  }
  const probability = (name: string) => {
    const value = probabilities.get(name);
    if (value === undefined) throw new Error("Missing decision.");
    return value;
  };
  const scored = ideas.map((idea, index) => ({
    idea,
    good: probability(`r${index}`) >= (step === "task" ? 0.5 : STAKE_BAR) && (step !== "dare" || probability(`d${index}`) >= 0.5),
    fit: probability(`f${index}`),
  }));
  if (probabilities.size !== ideas.length * (step === "dare" ? 3 : 2)) throw new Error("Unexpected decisions.");
  const kept = scored.filter(item => item.good).sort((a, b) => b.fit - a.fit);
  const hits = kept.filter(item => item.fit >= 0.3);
  return (hits.length >= 4 ? hits : kept).map(item => item.idea);
}

/** At most two writes and two checks, sequential and inside one deadline. */
async function generate(ctx: GameIdeasInput, client: OpenAI, signal: AbortSignal, deadline: number): Promise<GameIdea[]> {
  const options = () => {
    signal.throwIfAborted();
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Ideas deadline.");
    return { signal, timeout: remaining, maxRetries: 0 };
  };
  const writeOnce = async (input: GameIdeasInput) => {
    const response = await client.responses.create({
      model: GAME_IDEAS_MODEL, reasoning: { effort: "none" }, store: false,
      max_output_tokens: 1_200, instructions: gameIdeasBrief(input), input: JSON.stringify(input),
      text: { format: { type: "json_schema", name: "game_ideas", strict: true, schema: SCHEMA } },
    }, options());
    options();
    if (response.status !== "completed") throw new Error("Incomplete ideas.");
    const skipped = new Set([...ctx.skipped, ...input.skipped].map(text => ideaShape(tidy(text, input.step === "task"))));
    const ideas = parseIdeas(JSON.parse(response.output_text)).flatMap(idea => {
      const text = cleanGameIdea(idea.text, input.step);
      return text && !skipped.has(ideaShape(text)) ? [{ text, schedule: input.step === "task" ? idea.schedule : "every_day" as const }] : [];
    });
    if (!ideas.length) return [];
    const checked = await client.post<unknown>("/decisions", { body: gameIdeasCheck(input, ideas), ...options() });
    options();
    return capLeads(acceptedIdeas(checked, ideas, input.step));
  };
  const first = await writeOnce(ctx);
  if (first.length >= 4) return first.slice(0, 9);
  const second = await writeOnce({ ...ctx, skipped: [...ctx.skipped, ...first.map(idea => idea.text)].slice(-24) });
  return capLeads([...first, ...second]).slice(0, 9);
}

/** Fail soft without logging private input or provider error bodies. */
export async function writeGameIdeas(input: GameIdeasInput, options: { client?: OpenAI; apiKey?: string } = {}): Promise<GameIdea[]> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey && !options.client) return [];
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Reapply the allowlist for non-route callers, including the live eval.
    const ctx = parseGameIdeasInput(input);
    const client = options.client ?? new OpenAI({ apiKey, maxRetries: 0, timeout: GAME_IDEAS_TIMEOUT_MS });
    const deadline = Date.now() + GAME_IDEAS_TIMEOUT_MS;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Ideas deadline.")); }, GAME_IDEAS_TIMEOUT_MS);
    });
    return await Promise.race([generate(ctx, client, controller.signal, deadline), expired]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
