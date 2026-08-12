import * as z from "@murphai/contracts/zod-runtime";

export const HOSTED_PHYSICAL_NOTES_PATH = "/api/internal/physical-notes" as const;
export const HOSTED_PHYSICAL_NOTE_SEND_TRANSPORT_TIMEOUT_MS = 45_000;

export const hostedPhysicalNoteRecipientSchema = z
  .object({
    addressLine1: z.string().trim().min(1).max(64),
    addressLine2: z.string().trim().min(1).max(64).optional(),
    city: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(40),
    postalCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/u),
    state: z.string().trim().regex(/^[A-Z]{2}$/u),
  })
  .strict();

export const hostedPhysicalNoteArtworkSchema = z
  .object({
    expiresAt: z.string().datetime({ offset: true }),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    url: z.string().url().max(4_096).regex(/^https:\/\//u),
  })
  .strict();

export const hostedPhysicalNoteFailureReasonSchema = z.enum([
  "recipient_address",
  "artwork",
  "service_unavailable",
  "request_invalid",
  "prior_note_unresolved",
  "prior_note_accepted",
  "unknown",
]);

export const hostedPhysicalNoteSendRequestSchema = z
  .object({
    artwork: hostedPhysicalNoteArtworkSchema,
    originAssistantInputId: z.string().regex(/^ain_[0-9a-f]{32}$/u),
    recipient: hostedPhysicalNoteRecipientSchema,
    requestKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const hostedPhysicalNoteSendResponseSchema = z
  .object({
    complimentary: z.boolean(),
    costUsdMicros: z.string().regex(/^\d+$/u),
    failureReason: hostedPhysicalNoteFailureReasonSchema.nullable().optional(),
    physicalNoteId: z.string().trim().min(1).max(200).nullable(),
    status: z.enum([
      "accepted",
      "failed",
      "insufficient_usage",
      "pending",
      "permission_denied",
      "unavailable",
    ]),
  })
  .strict();

export type HostedPhysicalNoteRecipient = z.infer<
  typeof hostedPhysicalNoteRecipientSchema
>;
export type HostedPhysicalNoteArtwork = z.infer<
  typeof hostedPhysicalNoteArtworkSchema
>;
export type HostedPhysicalNoteFailureReason = z.infer<
  typeof hostedPhysicalNoteFailureReasonSchema
>;
export type HostedPhysicalNoteSendRequest = z.infer<
  typeof hostedPhysicalNoteSendRequestSchema
>;
export type HostedPhysicalNoteSendResponse = z.infer<
  typeof hostedPhysicalNoteSendResponseSchema
>;

export function parseHostedPhysicalNoteSendRequest(
  value: unknown,
): HostedPhysicalNoteSendRequest {
  return hostedPhysicalNoteSendRequestSchema.parse(value);
}

export function parseHostedPhysicalNoteSendResponse(
  value: unknown,
): HostedPhysicalNoteSendResponse {
  return hostedPhysicalNoteSendResponseSchema.parse(value);
}

export function normalizeHostedPhysicalNoteRecipient(
  value: HostedPhysicalNoteRecipient,
): HostedPhysicalNoteRecipient {
  return hostedPhysicalNoteRecipientSchema.parse({
    ...value,
    state: value.state.trim().toUpperCase(),
  });
}

export function stableHostedPhysicalNoteRecipientJson(
  recipient: HostedPhysicalNoteRecipient,
): string {
  const normalized = normalizeHostedPhysicalNoteRecipient(recipient);
  return JSON.stringify({
    addressLine1: normalized.addressLine1,
    addressLine2: normalized.addressLine2 ?? null,
    city: normalized.city,
    name: normalized.name,
    postalCode: normalized.postalCode,
    state: normalized.state,
  });
}
