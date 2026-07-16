import { z } from "zod";

export const HOSTED_RUNTIME_SUBSCRIPTION_ACTIONS = [
  "continue_pulse",
  "start_pulse_now",
  "upgrade_edge",
] as const;

const hostedRuntimeSubscriptionActionSchema = z.enum(
  HOSTED_RUNTIME_SUBSCRIPTION_ACTIONS,
);

const hostedRuntimeSubscriptionAssistantInputIdSchema = z
  .string()
  .regex(/^ain_[0-9a-f]{32}$/u);

const hostedRuntimeSubscriptionAmountSchema = z
  .number()
  .int()
  .positive();

const hostedRuntimePulsePlanTermsSchema = z
  .object({
    code: z.literal("launch_monthly"),
    displayName: z.literal("Pulse"),
    interval: z.literal("month"),
    recurringAmountUsdCents: hostedRuntimeSubscriptionAmountSchema,
  })
  .strict();

const hostedRuntimeEdgePlanTermsSchema = z
  .object({
    code: z.literal("launch_edge_monthly"),
    displayName: z.literal("Edge"),
    interval: z.literal("month"),
    recurringAmountUsdCents: hostedRuntimeSubscriptionAmountSchema,
  })
  .strict();

const hostedRuntimePulseResponseBase = {
  action: z.enum(["continue_pulse", "start_pulse_now"]),
  plan: hostedRuntimePulsePlanTermsSchema,
} as const;

const hostedRuntimeEdgeResponseBase = {
  action: z.literal("upgrade_edge"),
  plan: hostedRuntimeEdgePlanTermsSchema,
} as const;

const hostedRuntimeNonPaymentResponseStatusSchema = z.enum([
  "completed",
  "no_action_required",
  "pending",
]);

const hostedRuntimeHttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Expected an HTTPS payment URL.",
  });

export const hostedRuntimeSubscriptionToolRequestSchema = z
  .object({
    action: hostedRuntimeSubscriptionActionSchema,
  })
  .strict();

export const hostedRuntimeSubscriptionControlRequestSchema = z
  .object({
    action: hostedRuntimeSubscriptionActionSchema,
    assistantInputId: hostedRuntimeSubscriptionAssistantInputIdSchema,
  })
  .strict();

export const hostedRuntimeSubscriptionToolResponseSchema = z.union([
  z.object({
    ...hostedRuntimePulseResponseBase,
    status: hostedRuntimeNonPaymentResponseStatusSchema,
  }).strict(),
  z.object({
    ...hostedRuntimePulseResponseBase,
    paymentUrl: hostedRuntimeHttpsUrlSchema,
    status: z.literal("payment_required"),
  }).strict(),
  z.object({
    ...hostedRuntimeEdgeResponseBase,
    status: hostedRuntimeNonPaymentResponseStatusSchema,
  }).strict(),
  z.object({
    ...hostedRuntimeEdgeResponseBase,
    paymentUrl: hostedRuntimeHttpsUrlSchema,
    status: z.literal("payment_required"),
  }).strict(),
]);

export type HostedRuntimeSubscriptionAction = z.infer<
  typeof hostedRuntimeSubscriptionActionSchema
>;
export type HostedRuntimeSubscriptionToolRequest = z.infer<
  typeof hostedRuntimeSubscriptionToolRequestSchema
>;
export type HostedRuntimeSubscriptionControlRequest = z.infer<
  typeof hostedRuntimeSubscriptionControlRequestSchema
>;
export type HostedRuntimeSubscriptionToolResponse = z.infer<
  typeof hostedRuntimeSubscriptionToolResponseSchema
>;

export function parseHostedRuntimeSubscriptionToolRequest(
  value: unknown,
): HostedRuntimeSubscriptionToolRequest {
  return hostedRuntimeSubscriptionToolRequestSchema.parse(value);
}

export function parseHostedSubscriptionControlRequest(
  value: unknown,
): HostedRuntimeSubscriptionControlRequest {
  return hostedRuntimeSubscriptionControlRequestSchema.parse(value);
}

export function parseHostedRuntimeSubscriptionToolResponse(
  value: unknown,
): HostedRuntimeSubscriptionToolResponse {
  return hostedRuntimeSubscriptionToolResponseSchema.parse(value);
}
