import { z } from "zod";

const hostedCallCircleMemberIdSchema = z.string().trim().min(1).max(200);
const hostedCallCircleGroupIdSchema = z.string().trim().min(1).max(200);
const hostedCallCircleMatchIdSchema = z.string().trim().min(1).max(200);
const hostedCallCircleMailboxItemIdSchema = z.string().trim().min(1).max(200);
const hostedCallCircleLocalTimeSchema = z
  .string()
  .trim()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const hostedCallCircleIsoDateTimeSchema = z.string().trim().datetime({ offset: true });

export const hostedCallCircleAvailabilityWindowSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
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
    excludeMemberIds: z.array(hostedCallCircleMemberIdSchema).max(100).default([]),
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

export const hostedCallCircleRespondRequestSchema = z
  .object({
    counterWindow: hostedCallCircleCounterWindowSchema.optional(),
    excludeMemberIds: z.array(hostedCallCircleMemberIdSchema).max(100).optional(),
    groupId: hostedCallCircleGroupIdSchema.optional(),
    kind: z.enum(["preferences", "confirm", "counter", "decline", "pause", "resume"]),
    matchId: hostedCallCircleMatchIdSchema.optional(),
    side: z.enum(["A", "B"]).optional(),
    windows: z.array(hostedCallCircleAvailabilityWindowSchema).max(28).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.kind === "preferences" && request.windows === undefined) {
      context.addIssue({
        code: "custom",
        message: "Call Circle preferences require availability windows.",
        path: ["windows"],
      });
    }
    if (request.kind === "counter" && request.counterWindow === undefined) {
      context.addIssue({
        code: "custom",
        message: "Call Circle counter responses require a counter window.",
        path: ["counterWindow"],
      });
    }
  });

export const hostedCallCircleRespondResponseSchema = z
  .object({
    status: z.enum(["ok", "ignored", "unavailable"]),
    unavailableReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const hostedCallCircleRespondContextSchema = z
  .object({
    inboundMailboxItemIds: z.array(hostedCallCircleMailboxItemIdSchema).max(20).optional(),
  })
  .strict();

export const hostedCallCircleRespondControlRequestSchema = z.union([
  hostedCallCircleRespondRequestSchema,
  z
    .object({
      context: hostedCallCircleRespondContextSchema.optional(),
      request: hostedCallCircleRespondRequestSchema,
    })
    .strict(),
]);

export const HOSTED_CALL_CIRCLE_RESPOND_PATH =
  "/api/internal/call-circle/respond" as const;

export type HostedCallCircleAvailabilityWindow = z.infer<
  typeof hostedCallCircleAvailabilityWindowSchema
>;
export type HostedCallCirclePreferences = z.infer<
  typeof hostedCallCirclePreferencesSchema
>;
export type HostedCallCircleCounterWindow = z.infer<
  typeof hostedCallCircleCounterWindowSchema
>;
export type HostedCallCircleRespondRequest = z.infer<
  typeof hostedCallCircleRespondRequestSchema
>;
export type HostedCallCircleRespondContext = z.infer<
  typeof hostedCallCircleRespondContextSchema
>;
export type HostedCallCircleRespondControlRequest = z.infer<
  typeof hostedCallCircleRespondControlRequestSchema
>;
export type HostedCallCircleRespondResponse = z.infer<
  typeof hostedCallCircleRespondResponseSchema
>;

export function parseHostedCallCircleRespondRequest(
  value: unknown,
): HostedCallCircleRespondRequest {
  return hostedCallCircleRespondRequestSchema.parse(value);
}

export function parseHostedCallCircleRespondControlRequest(
  value: unknown,
): HostedCallCircleRespondControlRequest {
  return hostedCallCircleRespondControlRequestSchema.parse(value);
}

export function parseHostedCallCircleRespondResponse(
  value: unknown,
): HostedCallCircleRespondResponse {
  return hostedCallCircleRespondResponseSchema.parse(value);
}
