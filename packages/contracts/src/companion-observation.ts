import * as z from "./zod-runtime.ts";

export const COMPANION_HRV_RMSSD_SCHEMA =
  "murph.companion.overnight-prv-rmssd.v1";
export const COMPANION_HRV_RMSSD_RESOURCE = "companion_hrv_rmssd";
export const COMPANION_HRV_RMSSD_METHOD_VERSION =
  "prv-rmssd-5m-mean-scheduled-0000-0800-local-v1";

const COMPANION_ADMISSION_ID_PATTERN = /^[a-f0-9]{64}$/u;
const MINIMUM_COMPLETED_WINDOWS = 84;
const MINIMUM_ACCEPTED_WINDOWS = 48;
const MAXIMUM_COMPLETED_WINDOWS = 108;
const MAXIMUM_SERIALIZED_BYTES = 512;

const companionHrvRmssdObservationSchema = z
  .object({
    schema: z.literal(COMPANION_HRV_RMSSD_SCHEMA),
    methodVersion: z.literal(COMPANION_HRV_RMSSD_METHOD_VERSION),
    nightDate: z.iso.date(),
    rmssdMs: z.number().finite().positive().max(1_000),
    completedWindowCount: z.number().int()
      .min(MINIMUM_COMPLETED_WINDOWS)
      .max(MAXIMUM_COMPLETED_WINDOWS),
    acceptedWindowCount: z.number().int().min(MINIMUM_ACCEPTED_WINDOWS),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.acceptedWindowCount > value.completedWindowCount) {
      context.addIssue({
        code: "custom",
        message: "acceptedWindowCount cannot exceed completedWindowCount.",
        path: ["acceptedWindowCount"],
      });
    }

    if (value.acceptedWindowCount * 2 < value.completedWindowCount) {
      context.addIssue({
        code: "custom",
        message: "At least half of completed windows must be accepted.",
        path: ["acceptedWindowCount"],
      });
    }
  });

export type CompanionHrvRmssdObservation = z.infer<
  typeof companionHrvRmssdObservationSchema
>;

export type CompanionHrvRmssdAdmissionId = string;

export function parseCompanionHrvRmssdAdmissionId(
  value: unknown,
): CompanionHrvRmssdAdmissionId {
  if (typeof value !== "string" || !COMPANION_ADMISSION_ID_PATTERN.test(value)) {
    throw new TypeError("Companion HRV admission identity must be a lowercase SHA-256 digest.");
  }

  return value;
}

export function parseCompanionHrvRmssdObservation(
  value: unknown,
): CompanionHrvRmssdObservation {
  const observation = companionHrvRmssdObservationSchema.parse(value);
  assertCompanionHrvRmssdObservationSize(observation);
  return observation;
}

export function serializeCompanionHrvRmssdObservation(
  value: CompanionHrvRmssdObservation,
): string {
  return JSON.stringify(parseCompanionHrvRmssdObservation(value));
}

export function parseSerializedCompanionHrvRmssdObservation(
  value: unknown,
): CompanionHrvRmssdObservation {
  if (typeof value !== "string") {
    throw new TypeError("Companion HRV observation payload must be a JSON string.");
  }
  assertCompanionHrvRmssdSerializedSize(value);
  return parseCompanionHrvRmssdObservation(JSON.parse(value));
}

function assertCompanionHrvRmssdObservationSize(
  value: CompanionHrvRmssdObservation,
): void {
  assertCompanionHrvRmssdSerializedSize(JSON.stringify(value));
}

function assertCompanionHrvRmssdSerializedSize(value: string): void {
  if (new TextEncoder().encode(value).byteLength > MAXIMUM_SERIALIZED_BYTES) {
    throw new TypeError("Companion HRV observation exceeded the hosted job payload limit.");
  }
}
