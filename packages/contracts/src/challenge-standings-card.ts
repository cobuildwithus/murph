import * as z from "./zod-runtime.ts";

import {
  IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH,
  IMESSAGE_APP_CARD_URL_MAX_LENGTH,
  IMESSAGE_APP_CARD_URL_PREFIX,
} from "./compact-table-card.ts";

export const challengeStandingsCardV1Bounds = {
  title: 60,
  subtitle: 120,
  entryLabel: 60,
  footer: 120,
  entries: 8,
  participants: 32,
  points: Number.MAX_SAFE_INTEGER,
} as const;

export const challengeStandingsCoverageValues = [
  "complete",
  "partial",
  "unscored",
] as const;

export type ChallengeStandingsCoverage =
  (typeof challengeStandingsCoverageValues)[number];

function singleLineText(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value === value.trim(), {
      message: "Expected text without surrounding whitespace.",
    })
    .regex(
      /^[^\u0000-\u001F\u007F\u0085\u2028\u2029\uFEFF\r\n]+$/u,
      "Expected one printable line of text.",
    );
}

const pointsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(challengeStandingsCardV1Bounds.points);
const targetPointsSchema = z
  .number()
  .int()
  .positive()
  .max(challengeStandingsCardV1Bounds.points);

export const challengeStandingsRankingObjectiveV1Schema = z
  .object({
    kind: z.literal("ranking"),
  })
  .strict();

export const challengeStandingsTargetObjectiveV1Schema = z
  .object({
    kind: z.literal("target"),
    targetPoints: targetPointsSchema,
  })
  .strict();

export const challengeStandingsObjectiveV1Schema = z.union([
  challengeStandingsRankingObjectiveV1Schema,
  challengeStandingsTargetObjectiveV1Schema,
]);

export type ChallengeStandingsObjectiveV1 = z.infer<
  typeof challengeStandingsObjectiveV1Schema
>;

export const challengeStandingsEntryV1Schema = z
  .object({
    label: singleLineText(challengeStandingsCardV1Bounds.entryLabel),
    points: pointsSchema.nullable(),
    coverage: z.enum(challengeStandingsCoverageValues),
    detail: z.null(),
  })
  .strict()
  .superRefine((entry, context) => {
    const expectsPoints = entry.coverage !== "unscored";
    if (expectsPoints !== (entry.points !== null)) {
      context.addIssue({
        code: "custom",
        message:
          "Complete and partial standings need points; unscored standings must omit them.",
        path: ["points"],
      });
    }
  });

export type ChallengeStandingsEntryV1 = z.infer<
  typeof challengeStandingsEntryV1Schema
>;

export const challengeStandingsCoverageCountsV1Schema = z
  .object({
    completeParticipants: z
      .number()
      .int()
      .nonnegative()
      .max(challengeStandingsCardV1Bounds.participants),
    partialParticipants: z
      .number()
      .int()
      .nonnegative()
      .max(challengeStandingsCardV1Bounds.participants),
    totalParticipants: z
      .number()
      .int()
      .positive()
      .max(challengeStandingsCardV1Bounds.participants),
    unscoredParticipants: z
      .number()
      .int()
      .nonnegative()
      .max(challengeStandingsCardV1Bounds.participants),
  })
  .strict()
  .superRefine((counts, context) => {
    if (
      counts.completeParticipants
        + counts.partialParticipants
        + counts.unscoredParticipants
      !== counts.totalParticipants
    ) {
      context.addIssue({
        code: "custom",
        message: "Collective coverage counts must sum to the total participants.",
        path: ["totalParticipants"],
      });
    }
  });

export type ChallengeStandingsCoverageCountsV1 = z.infer<
  typeof challengeStandingsCoverageCountsV1Schema
>;

const challengeStandingsCommonV1Schema = {
  kind: z.literal("challenge_standings"),
  version: z.literal(1),
  title: singleLineText(challengeStandingsCardV1Bounds.title),
  subtitle: singleLineText(
    challengeStandingsCardV1Bounds.subtitle,
  ).nullable(),
  footer: singleLineText(challengeStandingsCardV1Bounds.footer).nullable(),
} as const;

export const rankedChallengeStandingsResponseCardV1Schema = z
  .object({
    ...challengeStandingsCommonV1Schema,
    format: z.enum(["individual", "teams"]),
    objective: challengeStandingsObjectiveV1Schema,
    entries: z
      .array(challengeStandingsEntryV1Schema)
      .min(1)
      .max(challengeStandingsCardV1Bounds.entries),
  })
  .strict()
  .superRefine((card, context) => {
    let previousPoints: number | null = null;
    let reachedUnscored = false;

    for (const [index, entry] of card.entries.entries()) {
      if (entry.points === null) {
        reachedUnscored = true;
        continue;
      }
      if (
        reachedUnscored
        || (previousPoints !== null && entry.points > previousPoints)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Ranked challenge entries must be ordered by descending points with unscored entries last.",
          path: ["entries", index, "points"],
        });
      }
      previousPoints = entry.points;
    }
  });

export type RankedChallengeStandingsResponseCardV1 = z.infer<
  typeof rankedChallengeStandingsResponseCardV1Schema
>;

export const collectiveChallengeStandingsResponseCardV1Schema = z
  .object({
    ...challengeStandingsCommonV1Schema,
    format: z.literal("collective"),
    objective: challengeStandingsTargetObjectiveV1Schema,
    collectivePoints: pointsSchema.nullable(),
    coverage: z.enum(challengeStandingsCoverageValues),
    coverageCounts: challengeStandingsCoverageCountsV1Schema,
  })
  .strict()
  .superRefine((card, context) => {
    const expectsPoints = card.coverage !== "unscored";
    if (expectsPoints !== (card.collectivePoints !== null)) {
      context.addIssue({
        code: "custom",
        message:
          "Complete and partial collective progress needs points; unscored progress must omit them.",
        path: ["collectivePoints"],
      });
    }
    const expectedCoverage =
      card.coverageCounts.completeParticipants
        === card.coverageCounts.totalParticipants
        ? "complete"
        : card.coverageCounts.unscoredParticipants
            === card.coverageCounts.totalParticipants
          ? "unscored"
          : "partial";
    if (card.coverage !== expectedCoverage) {
      context.addIssue({
        code: "custom",
        message: "Collective coverage must match its participant counts.",
        path: ["coverage"],
      });
    }
  });

export type CollectiveChallengeStandingsResponseCardV1 = z.infer<
  typeof collectiveChallengeStandingsResponseCardV1Schema
>;

export const challengeStandingsResponseCardV1Schema = z
  .union([
    rankedChallengeStandingsResponseCardV1Schema,
    collectiveChallengeStandingsResponseCardV1Schema,
  ])
  .superRefine((card, context) => {
    const envelope = JSON.stringify({
      schemaVersion: 5,
      card,
    });
    const payloadByteLength = new TextEncoder().encode(envelope).byteLength;
    const base64PaddingLength = (3 - (payloadByteLength % 3)) % 3;
    const encodedLength =
      4 * Math.ceil(payloadByteLength / 3) - base64PaddingLength;
    if (
      IMESSAGE_APP_CARD_URL_PREFIX.length + encodedLength
      >= IMESSAGE_APP_CARD_URL_MAX_LENGTH
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The challenge standings card exceeds the inline Messages card limit.",
        path: [],
      });
    }
    if (encodedLength > IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH) {
      context.addIssue({
        code: "custom",
        message:
          "The challenge standings card exceeds the static image payload limit.",
        path: [],
      });
    }
  });

export type ChallengeStandingsResponseCardV1 = z.infer<
  typeof challengeStandingsResponseCardV1Schema
>;
