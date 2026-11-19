import 'server-only';
import OpenAI from 'openai';
import * as z from '@murphai/contracts/zod-runtime';
import { hostedAuthRateLimitStorage } from '../../better-auth/rate-limit';
import { getPrisma } from '../../prisma';
import { gameNotFound } from '../http/errors';
import type { StoryQuery, StoryView } from './contract';
import { openProgress, progressLookup } from './crypto';
import { ArtError, MAX_ATTEMPTS, claimArt, finishArt, type ArtFailure, type ClaimRules } from './place-art';
import type { BeforeProgressMutation, MeasureState } from './state';

/**
 * The back of a town's postcard: a short title and three plain facts, written
 * once per public place by Luna and kept for everyone, next to its poster in
 * the shared art table. The prompt sees the place's public label only.
 */
export const STORY_MODEL = 'gpt-6-luna';
const WRITE_MS = 9_000;
/** The writer's deadline plus room to save; a failure is tried again a minute later, three times in all. */
const RULES: ClaimRules = { deadlineMs: 12_000, retryAfterMs: 60_000, budgeted: false };
const TYPICAL_SECONDS = 3;
/** Stories one member can start in a day; reading saved ones is free. */
const STORIES_A_DAY = 30;

export const storyKey = (placeId: string) => `story:v1:${placeId}`;

export const STORY_BRIEF = [
  'You write the back of a travel postcard for a town that someone passed on a walking route.',
  'You get the place as "Town, Region, Country". Write a short title of two to six words that names something the place is known for, and exactly three facts about the place itself.',
  'Each fact is one plain sentence of 10 to 30 words: its history, what it is known for, or where it sits (a river, a coast, a range, a nearby city).',
  'Use only well known facts you are sure of. Leave out any number, date or name you are not sure of. Never invent a landmark.',
  'Say nothing about the reader, walking, steps or the postcard. No em dashes, no exclamation marks, no emoji, no quotes around the title.',
].join(' ');

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'facts'],
  properties: {
    title: { type: 'string', maxLength: 40 },
    facts: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', maxLength: 220 } },
  },
} as const;

const written = z.strictObject({ title: z.string(), facts: z.array(z.string()).length(3) });
type Story = { title: string; facts: string[] };

/** A story's words as kept and shown: one line each, dashes as commas, short; null when they don't pass. */
export function cleanStory(value: unknown): Story | null {
  const parsed = written.safeParse(value);
  if (!parsed.success) return null;
  const tidy = (text: string) => text.replace(/\s*[—–]\s*/gu, ', ').replace(/\s+/gu, ' ').trim().replace(/^["'“]+|["'”]+$/gu, '');
  const fits = (text: string, max: number) => text.length > 0 && text.length <= max && /\p{L}/u.test(text);
  const title = tidy(parsed.data.title), facts = parsed.data.facts.map(tidy);
  return fits(title, 40) && facts.every(fact => fits(fact, 220)) ? { title, facts } : null;
}

type Row = { status: string; bytes: Uint8Array | null; startedAt: Date; attempts: number } | null;

/**
 * What a row shows: ready, someone else still writing it, or failed; null only when a claim could take it (the
 * claim's own conditions), so a failure waiting for its retry spends no one's allowance.
 */
export function shown(row: Row, now = Date.now()): StoryView | null {
  if (!row) return null;
  if (row.status === 'ready') {
    let story: Story | null = null;
    try { story = row.bytes ? cleanStory(JSON.parse(Buffer.from(row.bytes).toString('utf8'))) : null; } catch { /* failed below */ }
    return story ? { state: 'ready', ...story } : { state: 'failed' };
  }
  const age = now - row.startedAt.getTime();
  if (row.status === 'making' && age <= RULES.deadlineMs) return { state: 'making', typicalSeconds: TYPICAL_SECONDS };
  if (row.attempts >= MAX_ATTEMPTS) return { state: 'failed' };
  if (row.status === 'failed' && age <= RULES.retryAfterMs) return { state: 'failed' };
  return null;
}

async function write(label: string, client: OpenAI, signal: AbortSignal): Promise<Story> {
  const response = await client.responses.create({
    model: STORY_MODEL, reasoning: { effort: 'none' }, store: false, max_output_tokens: 700,
    instructions: STORY_BRIEF, input: JSON.stringify({ place: label }),
    text: { format: { type: 'json_schema', name: 'place_story', strict: true, schema: SCHEMA } },
  }, { signal, timeout: WRITE_MS, maxRetries: 0 });
  if (response.status !== 'completed') throw new ArtError('generation_failed');
  let story: Story | null = null;
  try { story = cleanStory(JSON.parse(response.output_text)); } catch { /* refused below */ }
  if (!story) throw new ArtError('refused');
  return story;
}

/**
 * A place's story, written now if no one has: the first reader to claim it
 * writes it inside this request, under a fixed deadline, and everyone after
 * reads the saved one. While another reader writes it, it's being made.
 */
export async function readPlaceStory(place: { id: string; label: string },
  options: { client?: OpenAI; admit?: () => Promise<boolean> } = {}): Promise<StoryView> {
  const key = storyKey(place.id), db = getPrisma();
  const read = (): Promise<Row> => db.gamePlaceArt.findUnique({ where: { key }, select: { status: true, bytes: true, startedAt: true, attempts: true } });
  const before = shown(await read());
  if (before) return before;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!options.client && !apiKey) return { state: 'failed' };
  // Only a write counts against the member's allowance; a denied one claims nothing.
  if (options.admit && !await options.admit()) return { state: 'failed' };
  const attempt = await claimArt(key, 'story', new Date(), RULES);
  if (attempt === null) return shown(await read()) ?? { state: 'failed' };
  const signal = AbortSignal.timeout(WRITE_MS);
  try {
    const client = options.client ?? new OpenAI({ apiKey, adminAPIKey: null, baseURL: 'https://api.openai.com/v1',
      organization: null, project: null, webhookSecret: null, maxRetries: 0, logLevel: 'off' });
    const story = await write(place.label, client, signal);
    await finishArt(key, attempt, { bytes: Buffer.from(JSON.stringify(story), 'utf8') });
    return { state: 'ready', ...story };
  } catch (error) {
    const failure: ArtFailure = signal.aborted ? 'timeout' : error instanceof ArtError ? error.code : 'generation_failed';
    await finishArt(key, attempt, { failure }).catch(() => undefined);
    return { state: 'failed' };
  }
}

/**
 * A town on the member's own current route: only those can start a story, so
 * one member can't spend writes on places of their choosing. The town's
 * public place is all that leaves the member's sealed route.
 */
export async function readTownStory(memberId: string, query: StoryQuery, beforeWrite: BeforeProgressMutation): Promise<StoryView> {
  const db = getPrisma(), lookup = progressLookup(memberId, 'measure', [query.measure]);
  const row = await db.gameProgressMeasure.findUnique({ where: { memberId_lookup: { memberId, lookup } }, select: { stateEncrypted: true } });
  if (!row) throw gameNotFound();
  const state = await openProgress<MeasureState>({ memberId, table: 'game_progress_measure', rowId: lookup, field: 'state' }, row.stateEncrypted);
  const place = state.legs?.at(-1)?.towns[query.town]?.place;
  if (!place) throw gameNotFound();
  await db.$transaction(tx => beforeWrite(tx));
  return readPlaceStory(place, { admit: async () => (await hostedAuthRateLimitStorage(db)
    .consume(`progress-story:member:${memberId}`, { max: STORIES_A_DAY, window: 86_400 })).allowed });
}
