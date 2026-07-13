import { z } from "zod";

export const COMPANION_HRV_RMSSD_SCHEMA = "murph.companion.hrv-rmssd.v1";
export const COMPANION_HRV_RMSSD_RESOURCE = "companion_hrv_rmssd";
export const COMPANION_HRV_RMSSD_METHOD_VERSION = "rmssd-pulse-interval-v1";

const COMPANION_CAPTURE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MINIMUM_PHYSIOLOGICAL_INTERVAL_MS = 300;
const MAXIMUM_CAPTURE_INTERVAL_OVERHANG = 5;

const companionHrvRmssdObservationSchema = z
  .object({
    schema: z.literal(COMPANION_HRV_RMSSD_SCHEMA),
    captureId: z.string().regex(COMPANION_CAPTURE_ID_PATTERN),
    observedAt: z.iso.datetime({ offset: true }),
    durationMs: z.literal(60_000),
    rmssdMs: z.number().finite().positive().max(1_000),
    intervalCount: z.number().int().min(20).max(1_005),
    acceptedIntervalCount: z.number().int().min(20).max(1_005),
    successivePairCount: z.number().int().min(19).max(1_004),
    quality: z.enum(["good", "limited"]),
    methodVersion: z.literal(COMPANION_HRV_RMSSD_METHOD_VERSION),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.acceptedIntervalCount > value.intervalCount) {
      context.addIssue({
        code: "custom",
        message: "acceptedIntervalCount cannot exceed intervalCount.",
        path: ["acceptedIntervalCount"],
      });
    }

    if (value.successivePairCount >= value.acceptedIntervalCount) {
      context.addIssue({
        code: "custom",
        message: "successivePairCount must be smaller than acceptedIntervalCount.",
        path: ["successivePairCount"],
      });
    }

    const maximumPlausibleIntervalCount =
      Math.ceil(value.durationMs / MINIMUM_PHYSIOLOGICAL_INTERVAL_MS)
      + MAXIMUM_CAPTURE_INTERVAL_OVERHANG;
    if (value.intervalCount > maximumPlausibleIntervalCount) {
      context.addIssue({
        code: "custom",
        message: "intervalCount is not plausible for durationMs.",
        path: ["intervalCount"],
      });
    }

    // Accepted intervals retain their original positions. With R rejected
    // positions there can be at most R+1 accepted runs, so this is the exact
    // minimum number of adjacent accepted pairs for the reported counts.
    const minimumPlausiblePairCount = Math.max(
      19,
      (2 * value.acceptedIntervalCount) - value.intervalCount - 1,
    );
    if (value.successivePairCount < minimumPlausiblePairCount) {
      context.addIssue({
        code: "custom",
        message: "successivePairCount is not plausible for the interval counts.",
        path: ["successivePairCount"],
      });
    }

    const acceptanceRatio = value.acceptedIntervalCount / value.intervalCount;
    const pairRatio = value.successivePairCount / Math.max(1, value.intervalCount - 1);
    const expectedQuality = acceptanceRatio >= 0.9 && pairRatio >= 0.8
      ? "good"
      : "limited";
    if (value.quality !== expectedQuality) {
      context.addIssue({
        code: "custom",
        message: "quality does not match the reported interval counts.",
        path: ["quality"],
      });
    }
  });

export type CompanionHrvRmssdObservation = z.infer<
  typeof companionHrvRmssdObservationSchema
>;

export function parseCompanionHrvRmssdObservation(
  value: unknown,
): CompanionHrvRmssdObservation {
  return companionHrvRmssdObservationSchema.parse(value);
}

export function serializeCompanionHrvRmssdObservation(
  value: CompanionHrvRmssdObservation,
): string {
  const serialized = JSON.stringify(parseCompanionHrvRmssdObservation(value));

  if (new TextEncoder().encode(serialized).byteLength > 512) {
    throw new TypeError("Companion HRV observation exceeded the hosted job payload limit.");
  }

  return serialized;
}

export function parseSerializedCompanionHrvRmssdObservation(
  value: unknown,
): CompanionHrvRmssdObservation {
  if (typeof value !== "string") {
    throw new TypeError("Companion HRV observation payload must be a JSON string.");
  }

  return parseCompanionHrvRmssdObservation(JSON.parse(value));
}
