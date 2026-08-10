import * as z from "./zod-runtime.ts";

import { ID_PREFIXES, MURPH_PRODUCT_ORIGIN } from "./constants.ts";
import { contractIdMaxLength, idPattern } from "./ids.ts";
import { isStrictIsoDateTime } from "./time.ts";
import {
  buildWorkoutSessionAppCardEnvelopeV4,
  workoutSessionDetailV1Schema,
} from "./workout-session-card.ts";

export const compactTableCardV1Bounds = {
  title: 60,
  subtitle: 120,
  rowHeader: 24,
  columnHeader: 24,
  rowLabel: 60,
  cellValue: 32,
  footer: 120,
  columns: 4,
  rows: 8,
} as const;

export const IMESSAGE_APP_CARD_URL_PREFIX =
  `${MURPH_PRODUCT_ORIGIN}/#murph-card=`;
export const IMESSAGE_APP_CARD_URL_MAX_LENGTH = 2_048;
const EVENT_ID_PATTERN = new RegExp(idPattern(ID_PREFIXES.event), "u");

function singleLineText(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value === value.trim(), {
      message: "Expected text without surrounding whitespace.",
    })
    .regex(
      /^[^\u0000-\u001F\u007F\u2028\u2029\r\n]+$/u,
      "Expected one printable line of text.",
    );
}

const canonicalSnapshotInstantSchema = z
  .string()
  .length(24)
  .refine(
    (value) =>
      isStrictIsoDateTime(value) &&
      new Date(value).toISOString() === value,
    {
      message:
        "Expected a canonical UTC ISO instant such as 2026-08-04T21:30:00.000Z.",
    },
  );

export const compactTableTrackingSourceV1Schema = z
  .object({
    kind: z.literal("workout"),
    entityId: z
      .string()
      .max(contractIdMaxLength(ID_PREFIXES.event))
      .regex(
        EVENT_ID_PATTERN,
        "Expected a canonical workout event id in evt_<ULID> form.",
      ),
    snapshotAt: canonicalSnapshotInstantSchema,
  })
  .strict();

export type CompactTableTrackingSourceV1 = z.infer<
  typeof compactTableTrackingSourceV1Schema
>;

export const compactTableRowV1Schema = z
  .object({
    label: singleLineText(compactTableCardV1Bounds.rowLabel),
    values: z
      .array(singleLineText(compactTableCardV1Bounds.cellValue))
      .min(1)
      .max(compactTableCardV1Bounds.columns),
  })
  .strict();

export type CompactTableRowV1 = z.infer<typeof compactTableRowV1Schema>;

function encodedAppCardUrlLength(envelope: unknown): number {
  const payloadByteLength = new TextEncoder().encode(
    JSON.stringify(envelope),
  ).byteLength;
  const base64PaddingLength = (3 - (payloadByteLength % 3)) % 3;
  const encodedLength =
    4 * Math.ceil(payloadByteLength / 3) - base64PaddingLength;
  return IMESSAGE_APP_CARD_URL_PREFIX.length + encodedLength;
}

const compactTableResponseCardHeaderV1Shape = {
  kind: z.literal("compact_table"),
  version: z.literal(1),
  title: singleLineText(compactTableCardV1Bounds.title),
  subtitle: singleLineText(compactTableCardV1Bounds.subtitle).nullable(),
} as const;

const compactTableGenericResponseCardV1Schema = z
  .object({
    ...compactTableResponseCardHeaderV1Shape,
    rowHeader: singleLineText(compactTableCardV1Bounds.rowHeader),
    columns: z
      .array(singleLineText(compactTableCardV1Bounds.columnHeader))
      .min(1)
      .max(compactTableCardV1Bounds.columns),
    rows: z
      .array(compactTableRowV1Schema)
      .min(1)
      .max(compactTableCardV1Bounds.rows),
    footer: singleLineText(compactTableCardV1Bounds.footer).nullable(),
    tracking: compactTableTrackingSourceV1Schema.nullable(),
  })
  .strict()
  .superRefine((card, context) => {
    const expectedValueCount = card.columns.length;
    for (const [index, row] of card.rows.entries()) {
      if (row.values.length !== expectedValueCount) {
        context.addIssue({
          code: "custom",
          message: "Each table row must contain one value for every column.",
          path: ["rows", index, "values"],
        });
      }
    }

    const { tracking: _tracking, ...presentationCard } = card;
    const envelope = {
      schemaVersion: 3,
      card: presentationCard,
    };

    if (
      encodedAppCardUrlLength(envelope) >=
      IMESSAGE_APP_CARD_URL_MAX_LENGTH
    ) {
      context.addIssue({
        code: "custom",
        message: "The compact table exceeds the inline Messages card limit.",
        path: [],
      });
    }
  });

const compactTableWorkoutResponseCardV1Schema = z
  .object({
    ...compactTableResponseCardHeaderV1Shape,
    footer: singleLineText(compactTableCardV1Bounds.footer).nullable(),
    tracking: compactTableTrackingSourceV1Schema,
    workout: workoutSessionDetailV1Schema,
  })
  .strict()
  .superRefine((card, context) => {
    const envelope = buildWorkoutSessionAppCardEnvelopeV4({
      title: card.title,
      subtitle: card.subtitle,
      footer: card.footer,
      workout: card.workout,
    });
    if (
      encodedAppCardUrlLength(envelope) >=
      IMESSAGE_APP_CARD_URL_MAX_LENGTH
    ) {
      context.addIssue({
        code: "custom",
        message: "The workout session exceeds the inline Messages card limit.",
        path: [],
      });
    }
  });

export const compactTableResponseCardV1Schema = z.union([
  compactTableGenericResponseCardV1Schema,
  compactTableWorkoutResponseCardV1Schema,
]);

export type CompactTableGenericResponseCardV1 = z.infer<
  typeof compactTableGenericResponseCardV1Schema
>;

export type CompactTableWorkoutResponseCardV1 = z.infer<
  typeof compactTableWorkoutResponseCardV1Schema
>;

export type CompactTableResponseCardV1 = z.infer<
  typeof compactTableResponseCardV1Schema
>;
