import { isValidIanaTimeZone } from "@murphai/contracts";
import { z } from "zod";

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
    timeZone: hostedCallCircleTimeZoneSchema,
    windows: z.array(hostedCallCircleAvailabilityWindowSchema).max(28).default([]),
  })
  .strict();

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
      kind: z.literal("preferences"),
      timeZone: hostedCallCircleTimeZoneSchema,
      windows: z.array(hostedCallCircleAvailabilityWindowSchema).max(28),
    })
    .strict(),
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
