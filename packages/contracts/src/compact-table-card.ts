import * as z from "./zod-runtime.ts";

import { ID_PREFIXES, MURPH_PRODUCT_ORIGIN } from "./constants.ts";
import { contractIdMaxLength, idPattern } from "./ids.ts";
import { isStrictIsoDateTime } from "./time.ts";
import {
  buildWorkoutSessionAppCardEnvelopeV4,
  buildWorkoutSessionAppCardEnvelopeV6,
  parseWorkoutSessionAppCardEnvelopeV4,
  workoutSessionDetailV1Schema,
  workoutSessionEditorProjectionV1Schema,
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
export const IMESSAGE_APP_CARD_IMAGE_PATH_PREFIX =
  "/imessage/card/v1/";
export const IMESSAGE_APP_CARD_IMAGE_PATH_SUFFIX = ".png";
export const IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH =
  IMESSAGE_APP_CARD_URL_MAX_LENGTH
  - `${MURPH_PRODUCT_ORIGIN}${IMESSAGE_APP_CARD_IMAGE_PATH_PREFIX}${
    IMESSAGE_APP_CARD_IMAGE_PATH_SUFFIX
  }`.length
  - 1;
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

function encodedAppCardPayloadLength(envelope: unknown): number {
  const payloadByteLength = new TextEncoder().encode(
    JSON.stringify(envelope),
  ).byteLength;
  const base64PaddingLength = (3 - (payloadByteLength % 3)) % 3;
  return 4 * Math.ceil(payloadByteLength / 3) - base64PaddingLength;
}

function addEncodedLengthIssues(
  envelope: unknown,
  context: z.RefinementCtx,
  subject: string,
  targets: { image: boolean; inline: boolean } = {
    image: true,
    inline: true,
  },
): void {
  const encodedLength = encodedAppCardPayloadLength(envelope);
  if (
    targets.inline
    &&
    IMESSAGE_APP_CARD_URL_PREFIX.length + encodedLength >=
    IMESSAGE_APP_CARD_URL_MAX_LENGTH
  ) {
    context.addIssue({
      code: "custom",
      message: `The ${subject} exceeds the inline Messages card limit.`,
      params: { murphExpectedShape: "within_response_card_payload_limit" },
      path: [],
    });
  }
  if (
    targets.image
    && encodedLength > IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH
  ) {
    context.addIssue({
      code: "custom",
      message: `The ${subject} exceeds the static image payload limit.`,
      params: { murphExpectedShape: "within_response_card_payload_limit" },
      path: [],
    });
  }
}

const compactTableResponseCardHeaderV1Shape = {
  kind: z.literal("compact_table"),
  version: z.literal(1),
  title: singleLineText(compactTableCardV1Bounds.title),
  subtitle: singleLineText(compactTableCardV1Bounds.subtitle).nullable(),
} as const;

export const compactTableGenericResponseCardV1Schema = z
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
          params: { murphExpectedShape: "same_count_as_card.columns" },
          path: ["rows", index, "values"],
        });
      }
    }

    const { tracking: _tracking, ...presentationCard } = card;
    const envelope = {
      schemaVersion: 3,
      card: presentationCard,
    };

    addEncodedLengthIssues(envelope, context, "compact table");
  });

export const compactTableWorkoutSemanticResponseCardV1Schema = z
  .object({
    ...compactTableResponseCardHeaderV1Shape,
    footer: singleLineText(compactTableCardV1Bounds.footer).nullable(),
    tracking: compactTableTrackingSourceV1Schema,
    workout: workoutSessionDetailV1Schema,
  })
  .strict();

export const compactTableWorkoutResponseCardAuthoringV1Schema =
  compactTableWorkoutSemanticResponseCardV1Schema.superRefine((card, context) => {
    const envelope = buildWorkoutSessionAppCardEnvelopeV4({
      title: card.title,
      subtitle: card.subtitle,
      footer: card.footer,
      workout: card.workout,
    });
    addEncodedLengthIssues(envelope, context, "workout session");
  });

const compactTableWorkoutResponseCardV1Schema = z
  .object({
    ...compactTableResponseCardHeaderV1Shape,
    editor: workoutSessionEditorProjectionV1Schema.optional(),
    footer: singleLineText(compactTableCardV1Bounds.footer).nullable(),
    tracking: compactTableTrackingSourceV1Schema,
    workout: workoutSessionDetailV1Schema,
  })
  .strict()
  .superRefine((card, context) => {
    const presentationEnvelope = buildWorkoutSessionAppCardEnvelopeV4({
      title: card.title,
      subtitle: card.subtitle,
      footer: card.footer,
      workout: card.workout,
    });
    addEncodedLengthIssues(
      presentationEnvelope,
      context,
      "workout session",
      { image: true, inline: card.editor === undefined },
    );
    if (card.editor === undefined) {
      return;
    }
    try {
      addEncodedLengthIssues(
        buildWorkoutSessionAppCardEnvelopeV6({
          editor: card.editor,
          title: card.title,
          subtitle: card.subtitle,
          footer: card.footer,
          workout: card.workout,
        }),
        context,
        "workout editor",
        { image: false, inline: true },
      );
    } catch {
      context.addIssue({
        code: "custom",
        message: "The workout editor projection does not match the card.",
        path: ["editor"],
      });
    }
  });

export const compactTableResponseCardAuthoringV1Schema = z.union([
  compactTableGenericResponseCardV1Schema,
  compactTableWorkoutResponseCardAuthoringV1Schema,
]);

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

export type CompactTablePresentationCardV1 =
  | Omit<CompactTableGenericResponseCardV1, "tracking">
  | Omit<CompactTableWorkoutResponseCardV1, "tracking">;

/**
 * Parses the authority-free V3 or V4 envelope used by both the offline native
 * reader and the stateless image renderer.
 */
export function parseCompactTableAppCardEnvelope(
  value: unknown,
): CompactTablePresentationCardV1 | null {
  if (!isExactAppCardEnvelope(value)) {
    return null;
  }

  if (value.schemaVersion === 3) {
    if (
      typeof value.card !== "object"
      || value.card === null
      || Array.isArray(value.card)
      || Object.hasOwn(value.card, "tracking")
    ) {
      return null;
    }
    const parsed = compactTableGenericResponseCardV1Schema.safeParse({
      ...value.card,
      tracking: null,
    });
    if (!parsed.success) {
      return null;
    }
    const { tracking: _tracking, ...presentation } = parsed.data;
    return presentation;
  }

  if (value.schemaVersion === 4 || value.schemaVersion === 6) {
    const parsed = parseWorkoutSessionAppCardEnvelopeV4(value);
    return parsed === null
      ? null
      : {
          kind: "compact_table",
          version: 1,
          ...parsed,
        };
  }

  return null;
}

function isExactAppCardEnvelope(
  value: unknown,
): value is { schemaVersion: unknown; card: unknown } {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, "schemaVersion")
    && Object.hasOwn(value, "card");
}
