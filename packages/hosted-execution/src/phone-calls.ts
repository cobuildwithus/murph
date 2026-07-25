import { z } from "zod";

// Starting a call can perform one bounded control-root unwrap before the
// provider's own 15-second deadline. The web service owns the complete
// operation deadline; the Cloudflare transport leaves five seconds for the
// response to cross the control-plane boundary.
export const HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS = 40_000;
export const HOSTED_PHONE_CALL_START_TRANSPORT_TIMEOUT_MS = 45_000;
export const HOSTED_PHONE_CALL_INBOUND_MAILBOX_ITEM_IDS_MAX = 32;

// Murph must never dial emergency or crisis dispatch. This is a hard product
// safety rule, not a heuristic: Murph is an unattended caller that cannot hold
// a line, give a location, or stay reachable, so an automated emergency call
// consumes a dispatcher and can displace a real one. The list is intentionally
// hardcoded rather than configured so no runtime state can unblock it.
//
// Entries are national emergency short codes, not E.164 numbers: the universal
// GSM codes (112/911/999/000/08), the major national police, fire, ambulance,
// and gas-leak codes, and the US/Canada 988 suicide-and-crisis line. Dialing a
// crisis line on someone's behalf is never the right automated action either.
export const HOSTED_PHONE_CALL_BLOCKED_EMERGENCY_NUMBERS: ReadonlySet<string> =
  new Set([
    // Universal / GSM
    "08", "000", "112", "911", "999",
    // Europe
    "15", "17", "18", "113", "115", "117", "118", "144", "155",
    // Americas
    "988", "190", "191", "192", "193",
    // Asia-Pacific
    "100", "101", "102", "103", "104", "106", "108", "110", "119", "120",
    "111", "122", "123", "125", "133", "995", "996", "997", "998", "999",
    // Africa / Middle East
    "114", "116", "121", "124", "127", "191", "193", "199",
  ]);

export const HOSTED_PHONE_CALL_EMERGENCY_NUMBER_BLOCKED_MESSAGE =
  "Murph cannot call emergency or crisis numbers.";

// Accepts any user- or model-supplied dial string, including pre-E.164 forms,
// because this gate must run before format validation. A number that fails the
// E.164 shape is exactly the shape a bare emergency short code takes, so
// checking after the regex would make this rule unreachable.
export function isHostedPhoneCallEmergencyNumber(value: string): boolean {
  const digits = value.replace(/\D/gu, "");
  if (digits.length === 0) {
    return false;
  }
  if (HOSTED_PHONE_CALL_BLOCKED_EMERGENCY_NUMBERS.has(digits)) {
    return true;
  }

  // Also reject a country-code-prefixed emergency code such as +1 911 or
  // +44 999. Only a full-remainder match counts, so an ordinary subscriber
  // number can never be caught by this branch: a real national number is far
  // longer than the two- and three-digit codes above.
  for (let prefixLength = 1; prefixLength <= 3; prefixLength += 1) {
    if (digits.length <= prefixLength) {
      break;
    }
    if (
      HOSTED_PHONE_CALL_BLOCKED_EMERGENCY_NUMBERS.has(
        digits.slice(prefixLength),
      )
    ) {
      return true;
    }
  }

  return false;
}

// The regex stays first so `z.toJSONSchema` still emits `pattern` for the
// model-facing tool schema. It already rejects a bare short code by length, so
// the emergency refinement is the rule that survives any future loosening of
// the format, and `assertHostedPhoneCallDialable` is the unconditional gate at
// the egress boundary.
const hostedPhoneCallE164PhoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/u)
  .refine(
    (value) => !isHostedPhoneCallEmergencyNumber(value),
    { error: HOSTED_PHONE_CALL_EMERGENCY_NUMBER_BLOCKED_MESSAGE },
  );

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
