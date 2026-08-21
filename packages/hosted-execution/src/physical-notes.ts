import { createHash } from "node:crypto";

import * as z from "@murphai/contracts/zod-runtime";

export const HOSTED_PHYSICAL_NOTES_PATH = "/api/internal/physical-notes" as const;
export const HOSTED_PHYSICAL_NOTE_RECOVERY_PATH =
  "/api/internal/physical-notes/recovery" as const;
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

export const hostedPhysicalNoteRecoveryRequestSchema = z
  .object({
    originAssistantInputId: z.string().regex(/^ain_[0-9a-f]{32}$/u),
    targetKind: z.enum(["recovery", "send"]).nullable().optional(),
    targetOriginAssistantInputId: z
      .string()
      .regex(/^ain_[0-9a-f]{32}$/u)
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasTargetKind = value.targetKind !== undefined
      && value.targetKind !== null;
    const hasTargetOrigin = value.targetOriginAssistantInputId !== undefined
      && value.targetOriginAssistantInputId !== null;
    if (hasTargetKind !== hasTargetOrigin) {
      context.addIssue({
        code: "custom",
        message:
          "targetKind and targetOriginAssistantInputId must be supplied together.",
        path: hasTargetKind ? ["targetOriginAssistantInputId"] : ["targetKind"],
      });
    }
  });

export const hostedPhysicalNoteRecoveryResponseSchema = z
  .object({
    remainingUnresolved: z.boolean().nullable(),
    retryAfter: z.string().datetime({ offset: true }).nullable(),
    settledUsageCostUsdMicros: z.string().regex(/^\d+$/u).nullable(),
    status: z.enum([
      "accepted",
      "clear",
      "pending",
      "permission_denied",
      "unavailable",
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status !== "accepted"
      && value.settledUsageCostUsdMicros !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Only accepted recovery can report settled usage.",
        path: ["settledUsageCostUsdMicros"],
      });
    }
  });

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
export type HostedPhysicalNoteRecoveryRequest = z.infer<
  typeof hostedPhysicalNoteRecoveryRequestSchema
>;
export type HostedPhysicalNoteRecoveryResponse = z.infer<
  typeof hostedPhysicalNoteRecoveryResponseSchema
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

export function parseHostedPhysicalNoteRecoveryRequest(
  value: unknown,
): HostedPhysicalNoteRecoveryRequest {
  return hostedPhysicalNoteRecoveryRequestSchema.parse(value);
}

export function parseHostedPhysicalNoteRecoveryResponse(
  value: unknown,
): HostedPhysicalNoteRecoveryResponse {
  return hostedPhysicalNoteRecoveryResponseSchema.parse(value);
}

export function createHostedPhysicalNoteRequestKey(input: {
  originAssistantInputId: string;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      originAssistantInputId: input.originAssistantInputId,
      schema: "murph.send-physical-note.request-key.v2",
    }))
    .digest("hex");
  return `physical_note_${digest}`;
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
