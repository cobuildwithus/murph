import * as z from "@murphai/contracts/zod-runtime";
import type {
  HostedExecutionAcceptedGroupMessageParticipant,
} from "./contracts.ts";

// Starting a call can perform one bounded control-root unwrap before the
// provider's own 15-second deadline. The web service owns the complete
// operation deadline; the Cloudflare transport leaves five seconds for the
// response to cross the control-plane boundary.
export const HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS = 40_000;
export const HOSTED_PHONE_CALL_START_TRANSPORT_TIMEOUT_MS = 45_000;
export const HOSTED_PHONE_CALL_STATUS_MAX_ITEMS = 3;
export const HOSTED_PHONE_CALL_INBOUND_MAILBOX_ITEM_IDS_MAX = 32;
export const HOSTED_SCHEDULED_PHONE_CALL_REQUEST_KEY_PREFIX =
  "phone_call_scheduled_";

// Murph must never dial emergency or crisis dispatch: it is an unattended
// caller that cannot hold a line, give a location, or stay reachable, so an
// automated emergency call consumes a dispatcher and can displace a real one.
//
// This constraint needs no dedicated policy owner. Every emergency and crisis
// short code worldwide is two or three digits, and the E.164 shape below
// requires eight to fifteen, so no such code can reach call admission or the
// provider. The guarantee is pinned by explicit regression tests over this
// schema rather than by production machinery, so widening the format in future
// fails those tests instead of silently permitting an emergency dial.
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
    callerName: z.string().trim().min(1).max(120).optional(),
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
    groupRequester: z
      .object({
        assistantInputId: z.string().regex(/^ain_[0-9a-f]{32}$/u),
        senderHandle: z.string().trim().min(1).max(512),
        source: z.enum(["linq", "telegram"]),
      })
      .strict()
      .optional(),
    // Legacy runner compatibility during the group-requester rollout. The Web
    // control plane accepts this only as a fallback when groupRequester is
    // absent, and still reloads every signed mailbox wake before authorizing.
    inboundMailboxItemIds: z
      .array(z.string().trim().min(1).max(200))
      .min(1)
      .max(HOSTED_PHONE_CALL_INBOUND_MAILBOX_ITEM_IDS_MAX)
      .optional(),
    originSessionId: z.string().trim().min(1).max(200),
    requestKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const hostedPhoneCallStartResponseSchema = z
  .object({
    phoneCallId: z.string().trim().min(1).max(200),
    status: z.enum(["starting", "calling", "failed"]),
  })
  .strict();

export const hostedPhoneCallResultSchema = z
  .object({
    followUp: z.string().trim().max(1_000).optional(),
    outcome: z.enum(["completed", "not_completed", "needs_user"]),
    summary: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const hostedPhoneCallStatusRequestSchema = z
  .object({
    phoneCallId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const hostedPhoneCallStatusItemSchema = z
  .object({
    analyzedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    phoneCallId: z.string().trim().min(1).max(200),
    result: hostedPhoneCallResultSchema.nullable(),
    status: z.enum([
      "starting",
      "calling",
      "ended",
      "completed",
      "needs_user",
      "failed",
    ]),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const hostedPhoneCallStatusResponseSchema = z
  .object({
    calls: z.array(hostedPhoneCallStatusItemSchema).max(
      HOSTED_PHONE_CALL_STATUS_MAX_ITEMS,
    ),
  })
  .strict();

export const hostedPhoneCallStopRequestSchema = z
  .object({
    phoneCallId: z.string().trim().min(1).max(200),
  })
  .strict();

export const hostedPhoneCallStopResponseSchema = z
  .object({
    phoneCallId: z.string().trim().min(1).max(200),
    state: z.enum([
      "stopped",
      "already_terminal",
      "start_pending",
      "not_found",
    ]),
    status: z.enum([
      "starting",
      "calling",
      "ended",
      "completed",
      "needs_user",
      "failed",
    ]).nullable(),
  })
  .strict();

export const hostedPhoneCallAdviceSchema = z
  .object({
    answer: z.string().trim().min(1).max(1_500),
    directive: z.enum(["continue", "transfer_to_user", "end_call"]),
  })
  .strict();

export const HOSTED_PHONE_CALLS_PATH = "/api/internal/phone-calls" as const;
export const HOSTED_PHONE_CALL_STATUS_PATH =
  "/api/internal/phone-calls/status" as const;
export const HOSTED_PHONE_CALL_STOP_PATH =
  "/api/internal/phone-calls/stop" as const;

export type HostedPhoneCallBrief = z.infer<typeof hostedPhoneCallBriefSchema>;
export type HostedPhoneCallGroupRequester =
  HostedExecutionAcceptedGroupMessageParticipant;
export type HostedPhoneCallStartRequest = z.infer<
  typeof hostedPhoneCallStartRequestSchema
>;
export type HostedPhoneCallStartResponse = z.infer<
  typeof hostedPhoneCallStartResponseSchema
>;
export type HostedPhoneCallStatusRequest = z.infer<
  typeof hostedPhoneCallStatusRequestSchema
>;
export type HostedPhoneCallStatusItem = z.infer<
  typeof hostedPhoneCallStatusItemSchema
>;
export type HostedPhoneCallStatusResponse = z.infer<
  typeof hostedPhoneCallStatusResponseSchema
>;
export type HostedPhoneCallStopRequest = z.infer<
  typeof hostedPhoneCallStopRequestSchema
>;
export type HostedPhoneCallStopResponse = z.infer<
  typeof hostedPhoneCallStopResponseSchema
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

export function isHostedScheduledPhoneCallRequestKey(
  value: string,
): boolean {
  return value.startsWith(HOSTED_SCHEDULED_PHONE_CALL_REQUEST_KEY_PREFIX)
    && /^[a-f0-9]{64}$/u.test(
      value.slice(HOSTED_SCHEDULED_PHONE_CALL_REQUEST_KEY_PREFIX.length),
    );
}
