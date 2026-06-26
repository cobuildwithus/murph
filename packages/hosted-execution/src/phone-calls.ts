import { z } from "zod";

const hostedPhoneCallE164PhoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/u);

const hostedPhoneCallBriefFactKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u);

export const hostedPhoneCallBriefSchema = z
  .object({
    allowTransferToUser: z.boolean().default(false),
    goal: z.string().trim().min(1).max(1_000),
    instructions: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
    shareableFacts: z
      .record(
        hostedPhoneCallBriefFactKeySchema,
        z.string().trim().min(1).max(500),
      )
      .default({}),
    successCriteria: z.string().trim().min(1).max(1_000),
    timeZone: z.string().trim().min(1).max(100),
    to: z
      .object({
        label: z.string().trim().min(1).max(200).optional(),
        phoneNumber: hostedPhoneCallE164PhoneNumberSchema,
      })
      .strict(),
  })
  .strict();

export const hostedPhoneCallStartRequestSchema = z
  .object({
    brief: hostedPhoneCallBriefSchema,
    requestKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const hostedPhoneCallStartResponseSchema = z
  .object({
    phoneCallId: z.string().trim().min(1).max(200),
    status: z.enum(["starting", "calling", "failed"]),
  })
  .strict();

export const hostedPhoneCallAdviceSchema = z
  .object({
    answer: z.string().trim().min(1).max(1_500),
    directive: z.enum(["continue", "transfer_to_user", "end_call"]),
  })
  .strict();

export const hostedPhoneCallResultSchema = z
  .object({
    followUp: z.string().trim().max(1_000).optional(),
    outcome: z.enum(["completed", "not_completed", "needs_user"]),
    summary: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const HOSTED_PHONE_CALLS_PATH = "/api/internal/phone-calls" as const;

export type HostedPhoneCallBrief = z.infer<typeof hostedPhoneCallBriefSchema>;
export type HostedPhoneCallStartRequest = z.infer<
  typeof hostedPhoneCallStartRequestSchema
>;
export type HostedPhoneCallStartResponse = z.infer<
  typeof hostedPhoneCallStartResponseSchema
>;
export type HostedPhoneCallAdvice = z.infer<typeof hostedPhoneCallAdviceSchema>;
export type HostedPhoneCallResult = z.infer<typeof hostedPhoneCallResultSchema>;

export function parseHostedPhoneCallBrief(value: unknown): HostedPhoneCallBrief {
  return hostedPhoneCallBriefSchema.parse(value);
}

export function parseHostedPhoneCallStartRequest(
  value: unknown,
): HostedPhoneCallStartRequest {
  return hostedPhoneCallStartRequestSchema.parse(value);
}

export function parseHostedPhoneCallStartResponse(
  value: unknown,
): HostedPhoneCallStartResponse {
  return hostedPhoneCallStartResponseSchema.parse(value);
}
