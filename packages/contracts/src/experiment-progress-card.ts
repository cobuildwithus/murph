import * as z from "./zod-runtime.ts";

import { isStrictIsoDate } from "./time.ts";

/**
 * Shared data contract for a private experiment progress-card image.
 *
 * The snapshot is rendered to PNG inside the vault-owning runtime. It must
 * never be encoded into a URL or used as a public response-media descriptor.
 */
export const EXPERIMENT_PROGRESS_CARD_VERSION = 2;

export const EXPERIMENT_PROGRESS_CARD_MAX_WEEKS = 6;
export const EXPERIMENT_PROGRESS_CARD_MAX_MOVERS = 2;
export const EXPERIMENT_PROGRESS_CARD_MAX_CONFOUNDERS = 4;

export const EXPERIMENT_PROGRESS_CARD_DAY_CODES = {
  baseline: "B",
  completed: "C",
  assumed: "A",
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
    start: isoDateSchema,
    cells: z.string().regex(/^[ABCPMNSO]{1,7}$/u),
  })
  .strict();

const cardMoverSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    changePct: z.string().trim().min(1).max(8),
    value: z.string().trim().min(1).max(16),
    unit: z.string().trim().min(1).max(12).nullable().default(null),
    delta: z.string().trim().min(1).max(20),
    direction: z.enum(["up", "down", "neutral"]),
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
        assumed: z.number().int().min(0).optional(),
        target: z.number().int().min(1).nullable().default(null),
      })
      .strict(),
    weeks: z.array(cardWeekSchema).min(1).max(EXPERIMENT_PROGRESS_CARD_MAX_WEEKS),
    moverSentimentContext: z
      .literal("direction_unavailable")
      .nullable()
      .default(null),
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
