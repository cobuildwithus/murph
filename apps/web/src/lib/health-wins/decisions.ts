import "server-only";
import OpenAI from "openai";
import * as z from "@murphai/contracts/zod-runtime";
import { GAME_IDEAS_MODEL } from "../game/ideas/writer";
import type { CardSpec } from "./engine";
import { newestHealthWinsFirst, type SelectedHealthWin } from "./engine/ranking";

const timeout = 3_000;
const probability = z.number().min(0).max(1);
const response = z.object({ answers: z.array(z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), name: z.literal("lead"),
    probabilities: z.array(z.object({ value: z.string(), probability })) }),
  z.object({ type: z.literal("predicate"), name: z.string(), probability }),
])) });

/** The provider sees a closed category and achievement kind. No free text, health values, dates, or identity leave the service. */
async function decisionOrder(cards: SelectedHealthWin[], requestSignal: AbortSignal): Promise<SelectedHealthWin[]> {
  if (process.env.MURPH_HEALTH_WINS_RANKING !== "true" || !process.env.OPENAI_API_KEY || cards.length < 2) return cards;
  const choices = cards.map(({ card }, index) => ({ value: `c${index}`, description: `${card.filter}: ${card.kind}` }));
  try {
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(timeout)]);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout });
    const payload = await client.post<unknown>("/decisions", { signal, timeout, maxRetries: 0, body: {
      model: GAME_IDEAS_MODEL,
      input: "Rank these kinds of personal milestones for a member picking a card to share with game partners.",
      questions: [
        { type: "choice", name: "lead", instructions: "Which would you put first?", choices },
        ...choices.map(choice => ({ type: "predicate", name: choice.value,
          instructions: `Would a friend cheer a milestone of this kind? ${choice.description}` })),
      ],
    } });
    const parsed = response.safeParse(payload);
    if (!parsed.success || parsed.data.answers.length !== choices.length + 1) return cards;
    const probabilities = new Map<string, number>(), cheer = new Map<string, number>();
    for (const answer of parsed.data.answers) {
      if (answer.type === "predicate") cheer.set(answer.name, answer.probability);
      else {
        if (answer.probabilities.length !== choices.length) return cards;
        for (const item of answer.probabilities) probabilities.set(item.value, item.probability);
      }
    }
    if (choices.some(({ value }) => !cheer.has(value) || !probabilities.has(value))
      || probabilities.size !== choices.length || cheer.size !== choices.length) return cards;
    // Preserve the engine's category balance in the first twelve places.
    const scored = choices.map(({ value }, index) => ({
      card: cards[index], score: probabilities.get(value)! * cheer.get(value)!,
    }));
    return [scored.slice(0, 12), scored.slice(12)].flatMap(group =>
      group.sort((a, b) => b.score - a.score).map(({ card }) => card));
  } catch {
    return cards;
  }
}

export async function rankHealthCards(cards: SelectedHealthWin[], requestSignal: AbortSignal): Promise<CardSpec[]> {
  return newestHealthWinsFirst(await decisionOrder(cards, requestSignal));
}
