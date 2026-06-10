import * as z from "zod";

import { ID_PREFIXES } from "./constants.ts";
import { idPattern } from "./ids.ts";
import { isStrictIsoDate } from "./time.ts";

/**
 * Shared contract for the in-progress experiment "progress card" image.
 *
 * Experiment run data never reaches the web server, so the card route renders
 * a compact snapshot encoded into the URL path itself. The vault CLI builds
 * and encodes the snapshot; the web route decodes and draws it. The payload
 * rides in a path segment ending in `.png` so the resulting URL passes the
 * assistant response-media rules (HTTPS, no query string, image extension).
 *
 * Decode treats input as untrusted: the route is public, so anything that
 * fails the schema is rejected rather than partially rendered.
 */

/** Bump when the payload shape or card layout changes; old URLs 404 cleanly. */
export const EXPERIMENT_PROGRESS_CARD_VERSION = 1;

export const EXPERIMENT_PROGRESS_CARD_MAX_WEEKS = 6;
export const EXPERIMENT_PROGRESS_CARD_MAX_MOVERS = 2;
export const EXPERIMENT_PROGRESS_CARD_MAX_CONFOUNDERS = 4;
/** Hard cap on the encoded path segment so URLs stay deliverable everywhere. */
export const EXPERIMENT_PROGRESS_CARD_MAX_ENCODED_LENGTH = 2048;

/**
 * One character per scheduled day, oldest week first:
 * B baseline · C completed · P partial · M missed · N no evidence yet ·
 * S scheduled (future) · O outside the run window (calendar padding).
 */
export const EXPERIMENT_PROGRESS_CARD_DAY_CODES = {
  baseline: "B",
  completed: "C",
  partial: "P",
  missed: "M",
  noEvidence: "N",
  scheduled: "S",
  outOfWindow: "O",
} as const;

export type ExperimentProgressCardDayCode =
  (typeof EXPERIMENT_PROGRESS_CARD_DAY_CODES)[keyof typeof EXPERIMENT_PROGRESS_CARD_DAY_CODES];

const isoDateSchema = z
  .string()
  .refine(isStrictIsoDate, "Expected a strict YYYY-MM-DD date.");

const cardWeekSchema = z
  .object({
    /** ISO date of the week's first cell; day labels derive from it. */
    start: isoDateSchema,
    /** One day code per cell, in day order. */
    cells: z.string().regex(/^[BCPMNSO]{1,7}$/u),
  })
  .strict();

const cardMoverSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    /**
     * The headline: pre-formatted percent-change magnitude vs baseline, e.g.
     * "20%". Unsigned — `direction` drives the arrow that shows up vs down.
     */
    changePct: z.string().trim().min(1).max(8),
    /** Current total, e.g. "1h 50m" or "58.2". */
    value: z.string().trim().min(1).max(16),
    unit: z.string().trim().min(1).max(12).nullable().default(null),
    /** Pre-formatted signed raw change incl. unit, e.g. "+18 min" or "−1.2 bpm". */
    delta: z.string().trim().min(1).max(20),
    /** Sign of the change, used for the directional glyph. */
    direction: z.enum(["up", "down", "neutral"]),
    /** Whether the change is good ("positive"), bad ("negative"), or neutral. */
    sentiment: z.enum(["positive", "negative", "neutral"]),
  })
  .strict();

const cardConfounderSchema = z
  .object({
    date: isoDateSchema,
    label: z.string().trim().min(1).max(60),
  })
  .strict();

export const experimentProgressCardSchema = z
  .object({
    v: z.literal(EXPERIMENT_PROGRESS_CARD_VERSION),
    title: z.string().trim().min(1).max(80),
    /** The "as of" date the snapshot was built for; marks today on the grid. */
    asOf: isoDateSchema,
    phase: z
      .object({
        day: z.number().int().min(1),
        totalDays: z.number().int().min(1).nullable().default(null),
      })
      .strict(),
    sessions: z
      .object({
        logged: z.number().int().min(0),
        target: z.number().int().min(1).nullable().default(null),
      })
      .strict(),
    weeks: z.array(cardWeekSchema).min(1).max(EXPERIMENT_PROGRESS_CARD_MAX_WEEKS),
    movers: z.array(cardMoverSchema).max(EXPERIMENT_PROGRESS_CARD_MAX_MOVERS).default([]),
    confounders: z
      .array(cardConfounderSchema)
      .max(EXPERIMENT_PROGRESS_CARD_MAX_CONFOUNDERS)
      .default([]),
  })
  .strict();

export type ExperimentProgressCardData = z.infer<typeof experimentProgressCardSchema>;
export type ExperimentProgressCardWeek = ExperimentProgressCardData["weeks"][number];
export type ExperimentProgressCardMover = ExperimentProgressCardData["movers"][number];
export type ExperimentProgressCardConfounder =
  ExperimentProgressCardData["confounders"][number];

/** Encode a validated snapshot into a URL-safe path segment (no `.png`). */
export function encodeExperimentProgressCard(data: ExperimentProgressCardData): string {
  const encoded = toBase64Url(JSON.stringify(experimentProgressCardSchema.parse(data)));
  if (encoded.length > EXPERIMENT_PROGRESS_CARD_MAX_ENCODED_LENGTH) {
    throw new Error(
      `Encoded experiment progress card exceeds ${EXPERIMENT_PROGRESS_CARD_MAX_ENCODED_LENGTH} characters; trim weeks or labels.`,
    );
  }
  return encoded;
}

/** Decode an untrusted path segment; returns null on any mismatch. */
export function decodeExperimentProgressCard(
  segment: string | null | undefined,
): ExperimentProgressCardData | null {
  if (!segment || segment.length > EXPERIMENT_PROGRESS_CARD_MAX_ENCODED_LENGTH) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(segment));
    const result = experimentProgressCardSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const experimentIdSchema = z
  .string()
  .regex(new RegExp(idPattern(ID_PREFIXES.experiment), "u"));

/**
 * Build the app-relative card path. Prefix with the product base URL to get a
 * URL that passes assistant response-media validation as-is.
 */
export function buildExperimentProgressCardPath(
  experimentId: string,
  data: ExperimentProgressCardData,
): string {
  const id = experimentIdSchema.parse(experimentId);
  return `/experiments/${id}/progress-card/${encodeExperimentProgressCard(data)}.png`;
}

/** Unicode-safe base64url encode — usable in both the browser and Node. */
function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/** Unicode-safe base64url decode — usable in both the browser and Node. */
function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}
