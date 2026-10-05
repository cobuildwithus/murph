import * as z from "@murphai/contracts/zod-runtime";

export const WEARABLE_SESSION_TTL_MS = 20_000;
export const WEARABLE_COMMAND_TTL_MS = 15_000;
// Wake delivery spans a push, an app launch, and a Bluetooth write.
export const WEARABLE_WAKE_COMMAND_TTL_MS = 30_000;
export const wearableKindSchema = z.enum(["whoop", "garmin"]);
export const wearableOperationSchema = z.enum(["buzz", "stop"]);
export const wearableHapticActionSchema = z.object({
  action: z.literal("haptic"),
  wearable: wearableKindSchema,
  operation: z.enum(["status", "buzz", "stop"]),
}).strict();
export type WearableHapticAction = z.infer<typeof wearableHapticActionSchema>;
export const wearableHapticAuthoritySchema = z.union([
  z.object({ kind: z.literal("accepted_input"), assistantInputId: z.string().regex(/^ain_[a-f0-9]{32}$/u) }).strict(),
  z.object({ kind: z.literal("automation_occurrence"), automationId: z.string().min(1).max(191), occurrenceAt: z.string().datetime() }).strict(),
]);
export type WearableHapticAuthority = z.infer<typeof wearableHapticAuthoritySchema>;
export const wearableHapticRequestSchema = z.object({
  request: wearableHapticActionSchema,
  authority: wearableHapticAuthoritySchema,
  includeAvailability: z.literal(true).optional(),
}).strict();
export type WearableHapticRequest = z.infer<typeof wearableHapticRequestSchema>;
export const wearableUnavailableReasonSchema = z.enum(["app_unreachable", "device_disconnected", "busy"]);
export const wearableHapticResponseSchema = z.object({
  action: z.literal("haptic"),
  wearable: wearableKindSchema,
  operation: z.enum(["status", "buzz", "stop"]),
  unavailableReason: wearableUnavailableReasonSchema.optional(),
  status: z.enum(["ready", "unavailable", "queued", "claimed", "acknowledged", "unknown", "expired", "cancelled"]),
}).strict();
export type WearableHapticResponse = z.infer<typeof wearableHapticResponseSchema>;

const session = { wearable: wearableKindSchema, sessionId: z.string().uuid() };
// Wake-capable apps name their installation and the band link it holds. A
// link id is stable while iOS restores the same band and changes with the band.
const link = { wearable: wearableKindSchema, installationId: z.string().uuid(), linkId: z.string().uuid() };
const outcome = { commandId: z.string().regex(/^[a-f0-9]{64}$/u), status: z.enum(["acknowledged", "unknown"]) };
export const wearableCompanionRequestSchema = z.discriminatedUnion("action", [
  // Legacy foreground polling (released 1.1.21 apps).
  z.object({ action: z.literal("connect"), ...session }).strict(),
  z.object({ action: z.literal("poll"), ...session }).strict(),
  z.object({ action: z.literal("disconnect"), ...session }).strict(),
  z.object({ action: z.literal("receipt"), ...session, ...outcome }).strict(),
  // Wake-capable delivery.
  z.object({ action: z.literal("link"), ...link }).strict(),
  z.object({ action: z.literal("unlink"), ...link }).strict(),
  z.object({ action: z.literal("claim"), ...link }).strict(),
  z.object({ action: z.literal("settle"), ...link, ...outcome }).strict(),
]);
export type WearableCompanionRequest = z.infer<typeof wearableCompanionRequestSchema>;
export const wearableCompanionResponseSchema = z.object({
  active: z.boolean(),
  commands: z.array(z.object({
    id: z.string().regex(/^[a-f0-9]{64}$/u),
    operation: wearableOperationSchema,
    expiresAt: z.string().datetime(),
  }).strict()).max(2),
}).strict();
export type WearableCompanionResponse = z.infer<typeof wearableCompanionResponseSchema>;
