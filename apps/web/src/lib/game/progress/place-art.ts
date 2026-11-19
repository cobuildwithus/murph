import 'server-only';
import { after } from 'next/server';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../../prisma';

/**
 * Shared place art: a poster per public place and a painting per route map,
 * each made once and reused by everyone. Rows hold no member and no route
 * text; posters are keyed by a public place id, maps by a geometry hash.
 */
export type ArtKind = 'poster' | 'map' | 'story';
export type ArtFailure = 'generation_failed' | 'timeout' | 'refused' | 'drifted';
export class ArtError extends Error {
  constructor(readonly code: ArtFailure) { super('Place art could not be made.'); }
}
/** Null: show what you have (absent, failed, over budget or exhausted). */
export type ArtState = { state: 'ready'; path: string } | { state: 'making'; startedAt: string; expiresAt: string; typicalSeconds: number } | null;

export const ART_DEADLINE_MS = 240_000;
const DAILY_ATTEMPTS = 150;
export const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 3_600_000;
// Timed loaders only: readiness always comes from a later read. A little over
// production's times (Nov 19: posters 5 to 7 s, maps 11 to 12 s), so the count
// lands near the end and the app reads again just after.
const TYPICAL_SECONDS: Record<ArtKind, number> = { poster: 8, map: 14, story: 3 };

export const artPath = (key: string) => `/api/game/v1/progress/art/${encodeURIComponent(key)}`;
type Row = { key: string; status: string; startedAt: Date };

export async function readArtRows(keys: readonly string[]): Promise<Map<string, Row>> {
  if (!keys.length) return new Map();
  const rows = await getPrisma().gamePlaceArt.findMany({ where: { key: { in: [...new Set(keys)] } }, select: { key: true, status: true, startedAt: true } });
  return new Map(rows.map(row => [row.key, row]));
}

export function artState(row: Row | undefined, kind: ArtKind, now = Date.now()): ArtState {
  if (row?.status === 'ready') return { state: 'ready', path: artPath(row.key) };
  const expiresAt = row && row.startedAt.getTime() + ART_DEADLINE_MS;
  if (row?.status !== 'making' || !expiresAt || expiresAt <= now) return null;
  return { state: 'making', startedAt: row.startedAt.toISOString(), expiresAt: new Date(expiresAt).toISOString(), typicalSeconds: TYPICAL_SECONDS[kind] };
}

class OverBudget extends Error {}

/** How a kind of art is claimed: its deadline, how long a failure waits, and whether it counts against the day's image allowance. */
export interface ClaimRules { deadlineMs: number; retryAfterMs: number; budgeted: boolean }
const IMAGE_RULES: ClaimRules = { deadlineMs: ART_DEADLINE_MS, retryAfterMs: RETRY_AFTER_MS, budgeted: true };

/**
 * One attempt for one key, inside the UTC day's allowance, in one transaction.
 * Returns the attempt number that must finish it, or null when someone else
 * holds it, it is ready, it has used its attempts, or today's allowance is spent.
 */
export async function claimArt(key: string, kind: ArtKind, now = new Date(), rules: ClaimRules = IMAGE_RULES): Promise<number | null> {
  const stale = new Date(now.getTime() - rules.deadlineMs), retry = new Date(now.getTime() - rules.retryAfterMs);
  try {
    return await getPrisma().$transaction(async tx => {
      const claimed = await tx.$queryRaw<{ attempts: number }[]>(Prisma.sql`
        INSERT INTO game_place_art (key, kind, status, attempts, started_at) VALUES (${key}, ${kind}, 'making', 1, ${now})
        ON CONFLICT (key) DO UPDATE SET status = 'making', attempts = game_place_art.attempts + 1, started_at = ${now}, failure_code = NULL
        WHERE game_place_art.attempts < ${MAX_ATTEMPTS} AND (
          (game_place_art.status = 'making' AND game_place_art.started_at < ${stale})
          OR (game_place_art.status = 'failed' AND game_place_art.started_at < ${retry}))
        RETURNING attempts`);
      if (!claimed.length) return null;
      if (!rules.budgeted) return claimed[0]!.attempts;
      const allowed = await tx.$queryRaw<unknown[]>(Prisma.sql`
        INSERT INTO game_place_art_budget (day, attempts) VALUES (${now.toISOString().slice(0, 10)}::date, 1)
        ON CONFLICT (day) DO UPDATE SET attempts = game_place_art_budget.attempts + 1
        WHERE game_place_art_budget.attempts < ${DAILY_ATTEMPTS}
        RETURNING attempts`);
      if (!allowed.length) throw new OverBudget();
      return claimed[0]!.attempts;
    });
  } catch (error) {
    if (error instanceof OverBudget) return null;
    throw error;
  }
}

/** Only the attempt that claimed the row may finish it; ready bytes never change. */
export async function finishArt(key: string, attempt: number, result: { bytes: Buffer } | { failure: ArtFailure }): Promise<boolean> {
  const done = 'bytes' in result
    ? await getPrisma().gamePlaceArt.updateMany({ where: { key, attempts: attempt, status: 'making' },
      data: { status: 'ready', bytes: new Uint8Array(result.bytes), readyAt: new Date() } })
    : await getPrisma().gamePlaceArt.updateMany({ where: { key, attempts: attempt, status: 'making' },
      data: { status: 'failed', failureCode: result.failure } });
  return done.count === 1;
}

export async function readArtBytes(key: string): Promise<Buffer | null> {
  const row = await getPrisma().gamePlaceArt.findFirst({ where: { key, status: 'ready' }, select: { bytes: true } });
  return row?.bytes ? Buffer.from(row.bytes) : null;
}

export interface ArtJob { key: string; kind: ArtKind; make: (signal: AbortSignal) => Promise<Buffer> }

/**
 * Claims up to `limit` missing pieces and makes them after the response, each
 * under one absolute deadline through every provider call. Optional work: a
 * failure leaves the reader's fallback and never fails the page.
 */
export async function ensureArt(jobs: readonly ArtJob[], rows: ReadonlyMap<string, Row>, limit = 2): Promise<Map<string, Row>> {
  const started = new Map<string, Row>();
  const now = Date.now();
  const wanted = jobs.filter(job => {
    const row = rows.get(job.key);
    return !row || (row.status === 'making' && row.startedAt.getTime() + ART_DEADLINE_MS <= now)
      || (row.status === 'failed' && row.startedAt.getTime() + RETRY_AFTER_MS <= now);
  }).slice(0, limit);
  for (const job of wanted) {
    const startedAt = new Date();
    const attempt = await claimArt(job.key, job.kind, startedAt).catch(() => null);
    if (attempt === null) continue;
    started.set(job.key, { key: job.key, status: 'making', startedAt });
    after(async () => {
      const signal = AbortSignal.timeout(ART_DEADLINE_MS);
      try {
        await finishArt(job.key, attempt, { bytes: await job.make(signal) });
      } catch (error) {
        const failure = signal.aborted ? 'timeout' : error instanceof ArtError ? error.code : 'generation_failed';
        await finishArt(job.key, attempt, { failure }).catch(() => undefined);
      }
    });
  }
  return started;
}
