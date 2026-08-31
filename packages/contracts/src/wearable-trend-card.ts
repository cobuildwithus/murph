import * as z from "./zod-runtime.ts";

import {
  IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH,
} from "./compact-table-card.ts";
import { contractIdMaxLength, idPattern } from "./ids.ts";
import { addDaysToIsoDate, isStrictIsoDate } from "./time.ts";

export const wearableTrendCardV1Bounds = {
  days: 7,
  metrics: 5,
  savedViewId: contractIdMaxLength("hview"),
} as const;

export const wearableTrendMetricKeyValues = [
  "steps",
  "total-sleep-minutes",
  "resting-heart-rate",
  "hrv-rmssd",
  "hrv-sdnn",
] as const;

export const wearableTrendMetricKeySchema = z.enum(
  wearableTrendMetricKeyValues,
);

export type WearableTrendMetricKey = z.infer<
  typeof wearableTrendMetricKeySchema
>;

export const wearableTrendDirectionValues = [
  "higher",
  "lower",
  "steady",
  "not_enough_data",
] as const;

export const wearableTrendDirectionSchema = z.enum(
  wearableTrendDirectionValues,
);

export type WearableTrendDirection = z.infer<
  typeof wearableTrendDirectionSchema
>;

export type WearableTrendMetricDisplay = {
  compactLabel: string;
  displayName: string;
  displayUnit: "bpm" | "minutes" | "ms" | "steps";
  hrvMethod: "RMSSD" | "SDNN" | null;
  valuePrecision: 0;
};

export const wearableTrendMetricDisplayByKey = {
  "hrv-rmssd": {
    compactLabel: "HRV (RMSSD)",
    displayName: "HRV (RMSSD)",
    displayUnit: "ms",
    hrvMethod: "RMSSD",
    valuePrecision: 0,
  },
  "hrv-sdnn": {
    compactLabel: "HRV (SDNN)",
    displayName: "HRV (SDNN)",
    displayUnit: "ms",
    hrvMethod: "SDNN",
    valuePrecision: 0,
  },
  "resting-heart-rate": {
    compactLabel: "RESTING HR",
    displayName: "Resting heart rate",
    displayUnit: "bpm",
    hrvMethod: null,
    valuePrecision: 0,
  },
  "steps": {
    compactLabel: "STEPS",
    displayName: "Steps",
    displayUnit: "steps",
    hrvMethod: null,
    valuePrecision: 0,
  },
  "total-sleep-minutes": {
    compactLabel: "SLEEP",
    displayName: "Sleep",
    displayUnit: "minutes",
    hrvMethod: null,
    valuePrecision: 0,
  },
} as const satisfies Record<
  WearableTrendMetricKey,
  WearableTrendMetricDisplay
>;

export const wearableTrendDirectionLabelByValue = {
  higher: "higher",
  lower: "lower",
  not_enough_data: "unavailable",
  steady: "steady",
} as const satisfies Record<WearableTrendDirection, string>;

const savedViewRequestIdSchema = z
  .string()
  .max(wearableTrendCardV1Bounds.savedViewId)
  .regex(new RegExp(idPattern("hview")));

const wearableTrendMetricKeysRequestV1Schema = z
  .object({
    metricKeys: z
      .array(wearableTrendMetricKeySchema)
      .min(1)
      .max(wearableTrendCardV1Bounds.metrics),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.metricKeys).size !== request.metricKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Wearable trend metric keys must be unique.",
        path: ["metricKeys"],
      });
    }
  });

const wearableTrendSavedViewRequestV1Schema = z
  .object({
    savedViewId: savedViewRequestIdSchema,
  })
  .strict();

/**
 * Model-facing selection only. Values are resolved from trusted wearable data
 * after this request has been accepted.
 */
export const wearableTrendCardRequestV1Schema = z.union([
  wearableTrendMetricKeysRequestV1Schema,
  wearableTrendSavedViewRequestV1Schema,
]);

export type WearableTrendCardRequestV1 = z.infer<
  typeof wearableTrendCardRequestV1Schema
>;

const wearableTrendLocalDateSchema = z
  .string()
  .length(10)
  .refine(isStrictIsoDate, "Expected a strict YYYY-MM-DD date.");

const wearableTrendValueSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(1_000_000)
  .nullable();

export const wearableTrendMetricV1Schema = z
  .object({
    metricKey: wearableTrendMetricKeySchema,
    values: z
      .array(wearableTrendValueSchema)
      .length(wearableTrendCardV1Bounds.days),
    trend: wearableTrendDirectionSchema,
  })
  .strict()
  .superRefine((metric, context) => {
    const observed = metric.values.filter(
      (value): value is number => value !== null,
    );
    const maximum = wearableTrendMaximumValueByKey[metric.metricKey];
    for (const [index, value] of metric.values.entries()) {
      if (value !== null && value > maximum) {
        context.addIssue({
          code: "custom",
          message: "Wearable trend value exceeds the metric limit.",
          path: ["values", index],
        });
      }
    }
    if (metric.metricKey === "steps") {
      for (const [index, value] of metric.values.entries()) {
        if (value !== null && !Number.isInteger(value)) {
          context.addIssue({
            code: "custom",
            message: "Step counts must be whole numbers.",
            path: ["values", index],
          });
        }
      }
    }
    if (
      observed.length < 3
      && metric.trend !== "not_enough_data"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Fewer than three observed days cannot support a comparison trend.",
        path: ["trend"],
      });
    }
  });

export type WearableTrendMetricV1 = z.infer<
  typeof wearableTrendMetricV1Schema
>;

const wearableTrendResponseCardV1BaseSchema = z
  .object({
    kind: z.literal("wearable_trend"),
    version: z.literal(1),
    localDates: z
      .array(wearableTrendLocalDateSchema)
      .length(wearableTrendCardV1Bounds.days),
    metrics: z
      .array(wearableTrendMetricV1Schema)
      .min(1)
      .max(wearableTrendCardV1Bounds.metrics),
  })
  .strict();

export const wearableTrendResponseCardV1Schema =
  wearableTrendResponseCardV1BaseSchema.superRefine((card, context) => {
    for (let index = 1; index < card.localDates.length; index += 1) {
      const previousDate = card.localDates[index - 1];
      const currentDate = card.localDates[index];
      if (
        previousDate !== undefined
        && currentDate !== undefined
        && isStrictIsoDate(previousDate)
        && isStrictIsoDate(currentDate)
        && currentDate !== addDaysToIsoDate(previousDate, 1)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Wearable trend dates must be seven consecutive calendar days in ascending order.",
          path: ["localDates", index],
        });
      }
    }

    const metricKeys = card.metrics.map((metric) => metric.metricKey);
    if (new Set(metricKeys).size !== metricKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Wearable trend metric rows must be unique.",
        path: ["metrics"],
      });
    }

    if (encodedPayloadLength({ schemaVersion: 7, card })
      > IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH) {
      context.addIssue({
        code: "custom",
        message:
          "The wearable trend card exceeds the static image payload limit.",
        path: [],
      });
    }
  });

export type WearableTrendResponseCardV1 = z.infer<
  typeof wearableTrendResponseCardV1Schema
>;

export const wearableTrendAppCardEnvelopeV7Schema = z
  .object({
    schemaVersion: z.literal(7),
    card: wearableTrendResponseCardV1Schema,
  })
  .strict();

export type WearableTrendAppCardEnvelopeV7 = z.infer<
  typeof wearableTrendAppCardEnvelopeV7Schema
>;

export function buildWearableTrendAppCardEnvelopeV7(
  card: WearableTrendResponseCardV1,
): WearableTrendAppCardEnvelopeV7 {
  return wearableTrendAppCardEnvelopeV7Schema.parse({
    schemaVersion: 7,
    card,
  });
}

export function averageWearableTrendValues(
  values: readonly (number | null)[],
): number | null {
  const observed = values.filter(
    (value): value is number => value !== null,
  );
  return observed.length === 0
    ? null
    : observed.reduce((total, value) => total + value, 0) / observed.length;
}

export function formatWearableTrendMetricValue(
  metricKey: WearableTrendMetricKey,
  value: number | null,
): string {
  if (value === null) {
    return "—";
  }
  switch (metricKey) {
    case "steps":
      return formatCompactSteps(value);
    case "total-sleep-minutes":
      return formatSleepMinutes(value);
    case "resting-heart-rate":
    case "hrv-rmssd":
    case "hrv-sdnn":
      return String(Math.round(value));
  }
}

export function formatWearableTrendMetricAverage(
  metricKey: WearableTrendMetricKey,
  values: readonly (number | null)[],
): string {
  const average = averageWearableTrendValues(values);
  if (average === null) {
    return "—";
  }
  const formatted = formatWearableTrendMetricValue(metricKey, average);
  switch (metricKey) {
    case "steps":
    case "total-sleep-minutes":
      return formatted;
    case "resting-heart-rate":
      return `${formatted} bpm`;
    case "hrv-rmssd":
    case "hrv-sdnn":
      return `${formatted} ms`;
  }
}

export function formatWearableTrendDateRange(
  localDates: readonly string[],
): string {
  const first = parseDisplayDate(localDates[0]);
  const last = parseDisplayDate(localDates[localDates.length - 1]);
  if (first === null || last === null) {
    throw new RangeError("Expected at least one valid wearable trend date.");
  }
  if (first.year !== last.year) {
    return `${first.month} ${first.day}, ${first.year}–${last.month} ${last.day}, ${last.year}`;
  }
  return first.month === last.month
    ? `${first.month} ${first.day}–${last.day}`
    : `${first.month} ${first.day}–${last.month} ${last.day}`;
}

export function formatWearableTrendWeekdayLabels(
  localDates: readonly string[],
): string[] {
  return localDates.map((localDate) => {
    if (!isStrictIsoDate(localDate)) {
      throw new RangeError(`Invalid wearable trend date: ${localDate}`);
    }
    const [year, month, day] = localDate.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    return wearableTrendWeekdays[date.getUTCDay()] ?? "";
  });
}

export function formatWearableTrendDirection(
  direction: WearableTrendDirection,
): string {
  return wearableTrendDirectionLabelByValue[direction];
}

export function renderWearableTrendSparkline(
  values: readonly (number | null)[],
): string {
  const observed = values.filter(
    (value): value is number => value !== null,
  );
  if (observed.length === 0) {
    return values.map(() => "·").join("");
  }
  const minimum = Math.min(...observed);
  const maximum = Math.max(...observed);
  if (minimum === maximum) {
    return values.map((value) => value === null ? "·" : "▄").join("");
  }
  return values.map((value) => {
    if (value === null) {
      return "·";
    }
    const level = Math.round(
      ((value - minimum) / (maximum - minimum))
        * (wearableTrendSparkLevels.length - 1),
    );
    return wearableTrendSparkLevels[level] ?? "▄";
  }).join("");
}

const wearableTrendMaximumValueByKey = {
  "hrv-rmssd": 10_000,
  "hrv-sdnn": 10_000,
  "resting-heart-rate": 300,
  "steps": 1_000_000,
  "total-sleep-minutes": 1_440,
} as const satisfies Record<WearableTrendMetricKey, number>;

const wearableTrendMonths = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const wearableTrendWeekdays = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

const wearableTrendSparkLevels = [
  "▁",
  "▂",
  "▃",
  "▄",
  "▅",
  "▆",
  "▇",
  "█",
] as const;

function encodedPayloadLength(value: unknown): number {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const padding = (3 - (bytes % 3)) % 3;
  return 4 * Math.ceil(bytes / 3) - padding;
}

function formatCompactSteps(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 1_000) {
    return String(rounded);
  }
  const thousands = Math.round(value / 100) / 10;
  return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands}k`;
}

function formatSleepMinutes(value: number): string {
  const minutes = Math.round(value);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) {
    return `${remainder}m`;
  }
  return remainder === 0
    ? `${hours}h`
    : `${hours}h${remainder.toString().padStart(2, "0")}m`;
}

function parseDisplayDate(value: string | undefined): {
  day: number;
  month: string;
  year: number;
} | null {
  if (value === undefined || !isStrictIsoDate(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const monthLabel = wearableTrendMonths[month - 1];
  return monthLabel === undefined ? null : { day, month: monthLabel, year };
}
