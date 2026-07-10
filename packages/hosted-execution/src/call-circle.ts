import { isValidIanaTimeZone } from "@murphai/contracts";
import { z } from "zod";

import { HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX } from "./runtime-control.ts";

const hostedCallCircleMailboxItemIdSchema = z.string().trim().min(1).max(200);
const hostedCallCircleLocalTimeSchema = z
  .string()
  .trim()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const hostedCallCircleIsoDateTimeSchema = z.string().trim().datetime({ offset: true });
const hostedCallCircleTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isValidIanaTimeZone, "Call Circle timeZone must be a valid IANA time zone.");
const hostedCallCircleMemberIdSchema = z.string().trim().min(1).max(200);

export const hostedCallCircleCadenceSchema = z.enum([
  "weekly",
  "biweekly",
  "monthly",
]);

export const hostedCallCircleMemberCadenceSchema = z
  .object({
    cadence: z.enum(["weekly", "biweekly", "monthly", "never"]),
    memberId: hostedCallCircleMemberIdSchema,
  })
  .strict();

export const hostedCallCircleMemberCadenceUpdateSchema = z
  .object({
    cadence: z.enum(["weekly", "biweekly", "monthly", "never", "default"]),
    memberId: hostedCallCircleMemberIdSchema,
  })
  .strict();

export const hostedCallCircleAvailabilityWindowSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6)
      .describe("Day of week: 0 = Sunday through 6 = Saturday."),
    endLocalTime: hostedCallCircleLocalTimeSchema,
    startLocalTime: hostedCallCircleLocalTimeSchema,
  })
  .strict()
  .refine(
    (window) => window.startLocalTime < window.endLocalTime,
    "Call Circle availability windows must start before they end.",
  );

export const hostedCallCirclePreferencesSchema = z
  .object({
    cadence: hostedCallCircleCadenceSchema.default("weekly"),
    memberCadences: z
      .array(hostedCallCircleMemberCadenceSchema)
      .max(HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX)
      .default([]),
    timeZone: hostedCallCircleTimeZoneSchema,
    windows: z.array(hostedCallCircleAvailabilityWindowSchema).max(28).default([]),
  })
  .strict()
  .refine(
    (preferences) => hasUniqueMemberIds(preferences.memberCadences),
    "Call Circle member cadence preferences must name each member at most once.",
  );

const hostedCallCirclePreferencesPatchFields = {
  cadence: hostedCallCircleCadenceSchema.optional(),
  memberCadenceUpdates: z
    .array(hostedCallCircleMemberCadenceUpdateSchema)
    .max(HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX)
    .optional(),
  timeZone: hostedCallCircleTimeZoneSchema.optional(),
  windows: z.array(hostedCallCircleAvailabilityWindowSchema).max(28).optional(),
} as const;

export const hostedCallCirclePreferencesPatchSchema = z
  .object(hostedCallCirclePreferencesPatchFields)
  .strict()
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    "Call Circle preference updates must change at least one setting.",
  )
  .refine(
    (patch) => hasUniqueMemberIds(patch.memberCadenceUpdates ?? []),
    "Call Circle member cadence updates must name each member at most once.",
  );

export const hostedCallCircleCounterWindowSchema = z
  .object({
    endAt: hostedCallCircleIsoDateTimeSchema,
    startAt: hostedCallCircleIsoDateTimeSchema,
  })
  .strict()
  .refine(
    (window) => Date.parse(window.startAt) < Date.parse(window.endAt),
    "Call Circle counter windows must start before they end.",
  );

export const hostedCallCircleRespondRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...hostedCallCirclePreferencesPatchFields,
      kind: z.literal("preferences"),
    })
    .strict()
    .refine(
      ({ kind: _kind, ...patch }) =>
        Object.values(patch).some((value) => value !== undefined),
      "Call Circle preference updates must change at least one setting.",
    )
    .refine(
      (request) => hasUniqueMemberIds(request.memberCadenceUpdates ?? []),
      "Call Circle member cadence updates must name each member at most once.",
    ),
  z
    .object({
      kind: z.literal("confirm"),
    })
    .strict(),
  z
    .object({
      counterWindow: hostedCallCircleCounterWindowSchema,
      kind: z.literal("counter"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("decline"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pause"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("resume"),
    })
    .strict(),
]);

export const hostedCallCircleRespondResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok") }).strict(),
  z.object({ status: z.literal("ignored") }).strict(),
  z
    .object({
      status: z.literal("unavailable"),
      unavailableReason: z.string().trim().min(1).max(500),
    })
    .strict(),
]);

export const hostedCallCircleRespondContextSchema = z
  .object({
    inboundMailboxItemIds: z.array(hostedCallCircleMailboxItemIdSchema).max(20).optional(),
  })
  .strict();

export const hostedCallCircleRespondControlRequestSchema = z
  .object({
    context: hostedCallCircleRespondContextSchema.optional(),
    request: hostedCallCircleRespondRequestSchema,
  })
  .strict();

export const HOSTED_CALL_CIRCLE_RESPOND_PATH =
  "/api/internal/call-circle/respond" as const;

export type HostedCallCircleAvailabilityWindow = z.infer<
  typeof hostedCallCircleAvailabilityWindowSchema
>;
export type HostedCallCirclePreferences = z.infer<
  typeof hostedCallCirclePreferencesSchema
>;
export type HostedCallCircleCadence = z.infer<
  typeof hostedCallCircleCadenceSchema
>;
export type HostedCallCircleMemberCadence = z.infer<
  typeof hostedCallCircleMemberCadenceSchema
>;
export type HostedCallCirclePreferencesPatch = z.infer<
  typeof hostedCallCirclePreferencesPatchSchema
>;
export type HostedCallCircleRespondRequest = z.infer<
  typeof hostedCallCircleRespondRequestSchema
>;
export type HostedCallCircleRespondContext = z.infer<
  typeof hostedCallCircleRespondContextSchema
>;
export type HostedCallCircleRespondResponse = z.infer<
  typeof hostedCallCircleRespondResponseSchema
>;

export function isHostedCallCircleTimeZone(value: string): boolean {
  return isValidIanaTimeZone(value);
}

function hasUniqueMemberIds(
  entries: readonly { memberId: string }[],
): boolean {
  return new Set(entries.map((entry) => entry.memberId)).size === entries.length;
}
