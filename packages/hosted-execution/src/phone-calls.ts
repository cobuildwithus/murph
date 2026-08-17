import * as z from "@murphai/contracts/zod-runtime";
import type {
  HostedExecutionAcceptedGroupMessageParticipant,
  HostedExecutionTelegramExternalThreadRouteAuthority,
} from "./contracts.ts";

// Starting a call can perform one bounded control-root unwrap before the
// provider's own 15-second deadline. The web service owns the complete
// operation deadline; the Cloudflare transport leaves five seconds for the
// response to cross the control-plane boundary.
export const HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS = 40_000;
export const HOSTED_PHONE_CALL_START_TRANSPORT_TIMEOUT_MS = 45_000;
export const HOSTED_PHONE_CALL_INBOUND_MAILBOX_ITEM_IDS_MAX = 32;
export const HOSTED_SCHEDULED_PHONE_CALL_REQUEST_KEY_PREFIX =
  "phone_call_scheduled_";
export const HOSTED_PHONE_CALL_RESULT_NOTIFICATION_CHANNELS = [
  "telegram",
] as const;
export const HOSTED_PHONE_CALL_RESULT_DELIVERY_KEY_PREFIX =
  "phone-call-result:";
export const HOSTED_PHONE_CALL_RESULT_DELIVERY_OUTCOME_STATUSES = [
  "sending",
  "sent",
  "failed",
  "failed_ambiguous",
] as const;

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

export const hostedPhoneCallResultNotificationChannelSchema = z.enum(
  HOSTED_PHONE_CALL_RESULT_NOTIFICATION_CHANNELS,
);

export const hostedPhoneCallResultDeliveryOutcomeStatusSchema = z.enum(
  HOSTED_PHONE_CALL_RESULT_DELIVERY_OUTCOME_STATUSES,
);

const hostedPhoneCallResultDeliveryKeySchema = z
  .object({
    generation: z.number().int().positive(),
    phoneCallId: z.string().trim().min(1).max(200),
  })
  .strict();

const hostedPhoneCallResultDeliveryRouteAuthoritySchema: z.ZodType<
  HostedExecutionTelegramExternalThreadRouteAuthority
> = z
  .object({
    accountLookupKey: z.string().trim().min(1).nullable().optional(),
    channel: z.literal("telegram"),
    containerMemberId: z.string().trim().min(1).max(200),
    threadId: z.string().trim().min(1).max(512),
  })
  .strict();

export const hostedPhoneCallResultDeliveryOutcomeRequestSchema = z.union([
  hostedPhoneCallResultDeliveryKeySchema.extend({
    routeAuthority: hostedPhoneCallResultDeliveryRouteAuthoritySchema,
    status: z.literal("sending"),
  }).strict(),
  hostedPhoneCallResultDeliveryKeySchema.extend({
    deliveryErrorCode: z.string().trim().min(1).max(200).nullable().optional(),
    status: z.enum(["sent", "failed", "failed_ambiguous"]),
  }).strict(),
]);

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
    // Direct calls complete asynchronously after the initiating turn is gone.
    // Persist only the bounded source channel so Web can resolve the current
    // authorized destination on that same surface. Group calls omit this and
    // continue to use their durable thread-container route authority.
    resultNotificationChannel:
      hostedPhoneCallResultNotificationChannelSchema.optional(),
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
    completionPolicy: z.enum(["transfer_follow_up_required"]).optional(),
    followUp: z.string().trim().max(1_000).optional(),
    outcome: z.enum(["completed", "not_completed", "needs_user"]),
    summary: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const HOSTED_PHONE_CALLS_PATH = "/api/internal/phone-calls" as const;

export type HostedPhoneCallBrief = z.infer<typeof hostedPhoneCallBriefSchema>;
export type HostedPhoneCallGroupRequester =
  HostedExecutionAcceptedGroupMessageParticipant;
export type HostedPhoneCallResultNotificationChannel = z.infer<
  typeof hostedPhoneCallResultNotificationChannelSchema
>;
export type HostedPhoneCallResultDeliveryOutcomeRequest = z.infer<
  typeof hostedPhoneCallResultDeliveryOutcomeRequestSchema
>;
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

export function parseHostedPhoneCallResultNotificationChannel(
  value: unknown,
): HostedPhoneCallResultNotificationChannel | null {
  return value === null || value === undefined
    ? null
    : hostedPhoneCallResultNotificationChannelSchema.parse(value);
}

export function buildHostedPhoneCallResultDeliveryKey(input: {
  generation: number;
  phoneCallId: string;
}): string {
  const generation = z.number().int().positive().parse(input.generation);
  const phoneCallId = z.string().trim().min(1).max(200).parse(input.phoneCallId);
  return `${HOSTED_PHONE_CALL_RESULT_DELIVERY_KEY_PREFIX}${phoneCallId}:generation:${generation}`;
}

export function parseHostedPhoneCallResultDeliveryKey(
  value: string | null | undefined,
): { generation: number; phoneCallId: string } | null {
  const normalized = value?.trim() ?? "";
  if (!normalized.startsWith(HOSTED_PHONE_CALL_RESULT_DELIVERY_KEY_PREFIX)) {
    return null;
  }
  const suffix = normalized.slice(
    HOSTED_PHONE_CALL_RESULT_DELIVERY_KEY_PREFIX.length,
  );
  const marker = ":generation:";
  const markerIndex = suffix.lastIndexOf(marker);
  if (markerIndex <= 0) {
    return null;
  }
  const phoneCallId = suffix.slice(0, markerIndex);
  const generationText = suffix.slice(markerIndex + marker.length);
  if (!/^\d+$/u.test(generationText)) {
    return null;
  }
  const parsed = hostedPhoneCallResultDeliveryKeySchema.safeParse({
    generation: Number(generationText),
    phoneCallId,
  });
  return parsed.success
    ? {
        generation: parsed.data.generation,
        phoneCallId: parsed.data.phoneCallId,
      }
    : null;
}

export function parseHostedPhoneCallResultDeliveryOutcomeRequest(
  value: unknown,
): HostedPhoneCallResultDeliveryOutcomeRequest {
  return hostedPhoneCallResultDeliveryOutcomeRequestSchema.parse(value);
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
