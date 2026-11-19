import 'server-only';
import OpenAI from 'openai';
import * as z from '@murphai/contracts/zod-runtime';
import { hostedAuthRateLimitStorage } from '../../better-auth/rate-limit';
import { getPrisma } from '../../prisma';
import type { FoundPlace, PlaceFixer } from './mapbox';

export const PLACE_FIX_MODEL = 'gpt-6-luna';
const FIX_MS = 4_000;
/** A pick this sure or more is the place; anything less is a miss. */
export const PLACE_FIX_BAR = 0.6;
/** Fixes one member can ask for in a day: only a miss with close spellings asks. */
const FIXES_A_DAY = 30;

const answers = z.object({ answers: z.array(z.object({ type: z.literal('choice'), name: z.literal('place'),
  probabilities: z.array(z.object({ value: z.string(), probability: z.number().min(0).max(1) })) })).length(1) });

/** One Decisions choice: which of Mapbox's close spellings the words meant, or none. Luna can only pick one Mapbox found. */
export function placeFixQuestion(typed: string, candidates: readonly FoundPlace[]) {
  return {
    model: PLACE_FIX_MODEL,
    input: `Someone typed "${typed}" as one end of a walking route, and a map search found nothing by that name. These are the closest places it knows.`,
    questions: [{ type: 'choice', name: 'place', instructions: `Which place did they mean by "${typed}"? Pick none unless "${typed}" is a misspelling or short form of that place's name.`,
      choices: [...candidates.map((candidate, index) => ({ value: `p${index}`, description: candidate.label })), { value: 'none', description: 'none of these' }] }],
  };
}

/** The candidate Luna picked, clear of the bar; none for anything else, a malformed answer included. */
export function pickedPlace(payload: unknown, candidates: readonly FoundPlace[]): FoundPlace | null {
  const parsed = answers.safeParse(payload);
  if (!parsed.success) return null;
  const best = parsed.data.answers[0]!.probabilities.reduce((top, item) => item.probability > top.probability ? item : top, { value: 'none', probability: 0 });
  const index = /^p([0-4])$/u.exec(best.value)?.[1];
  return index !== undefined && best.probability >= PLACE_FIX_BAR ? candidates[Number(index)] ?? null : null;
}

/** The goals preview's fixer for one member, inside their daily allowance; any failure is a miss. */
export function memberPlaceFixer(memberId: string, options: { client?: OpenAI } = {}): PlaceFixer {
  return async (typed, candidates) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!options.client && !apiKey) return null;
    const allowed = await hostedAuthRateLimitStorage(getPrisma()).consume(`progress-place-fix:member:${memberId}`, { max: FIXES_A_DAY, window: 86_400 });
    if (!allowed.allowed) return null;
    try {
      const client = options.client ?? new OpenAI({ apiKey, maxRetries: 0, timeout: FIX_MS });
      const payload = await client.post<unknown>('/decisions', { body: placeFixQuestion(typed, candidates), timeout: FIX_MS, maxRetries: 0 });
      return pickedPlace(payload, candidates);
    } catch {
      return null;
    }
  };
}
