import * as z from "zod";

import { isStrictIsoDateTime } from "./time.js";

export const assistantAutomationEventTypeValues = [
  "parser-completed",
  "parser-failed",
  "assistant-deferred",
  "assistant-retry-ready",
  "cron-completed",
  "inbox-capture-imported",
  "device-sync-import-completed",
] as const;

function isoDateTimeString(): z.ZodType<string> {
  return z
    .string()
    .meta({ format: "date-time" })
    .refine((value) => isStrictIsoDateTime(value), "Invalid ISO date-time string.");
}

export const assistantAutomationEventTargetSchema = z
  .object({
    accountId: z.string().min(1).nullable().default(null),
    attachmentId: z.string().min(1).nullable().default(null),
    captureId: z.string().min(1).nullable().default(null),
    channel: z.string().min(1).nullable().default(null),
    jobId: z.string().min(1).nullable().default(null),
    sessionId: z.string().min(1).nullable().default(null),
  })
  .strict();

export const assistantAutomationEventCursorSchema = z
  .object({
    eventId: z.string().min(1),
    occurredAt: isoDateTimeString(),
  })
  .strict();

export const assistantAutomationEventSchema = z
  .object({
    schema: z.literal("healthybob.assistant-automation-event.v1"),
    eventId: z.string().min(1),
    type: z.enum(assistantAutomationEventTypeValues),
    occurredAt: isoDateTimeString(),
    target: assistantAutomationEventTargetSchema.default({
      accountId: null,
      attachmentId: null,
      captureId: null,
      channel: null,
      jobId: null,
      sessionId: null,
    }),
    dedupeKey: z.string().min(1).nullable().default(null),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type AssistantAutomationEventTarget = z.infer<
  typeof assistantAutomationEventTargetSchema
>;
export type AssistantAutomationEventCursor = z.infer<
  typeof assistantAutomationEventCursorSchema
>;
export type AssistantAutomationEvent = z.infer<typeof assistantAutomationEventSchema>;

export function toAssistantAutomationEventCursor(input: {
  eventId: string;
  occurredAt: string;
}): AssistantAutomationEventCursor {
  return assistantAutomationEventCursorSchema.parse({
    eventId: input.eventId,
    occurredAt: input.occurredAt,
  });
}
