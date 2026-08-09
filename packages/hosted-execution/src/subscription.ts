import * as z from "@murphai/contracts/zod-runtime";

export const HOSTED_RUNTIME_SUBSCRIPTION_ACTIONS = [
  "change_plan",
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

export const HOSTED_RUNTIME_DIRECT_BILLING_PLAN_CODES = [
  "launch_group_monthly",
  "launch_monthly",
  "launch_edge_monthly",
  "launch_max_monthly",
] as const;

const hostedRuntimeDirectBillingPlanCodeSchema = z.enum(
  HOSTED_RUNTIME_DIRECT_BILLING_PLAN_CODES,
);

const hostedRuntimeSubscriptionQuoteIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024);

const hostedRuntimeGroupPlanTermsSchema = z
  .object({
    code: z.literal("launch_group_monthly"),
    displayName: z.literal("Group"),
    interval: z.literal("month"),
    recurringAmountUsdCents: hostedRuntimeSubscriptionAmountSchema,
  })
  .strict();

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

const hostedRuntimeMaxPlanTermsSchema = z
  .object({
    code: z.literal("launch_max_monthly"),
    displayName: z.literal("Max"),
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
  "scheduled",
]);

const hostedRuntimeHttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Expected an HTTPS payment URL.",
  });

const hostedRuntimeDirectPlanTermsSchema = z.union([
  hostedRuntimeGroupPlanTermsSchema,
  hostedRuntimePulsePlanTermsSchema,
  hostedRuntimeEdgePlanTermsSchema,
  hostedRuntimeMaxPlanTermsSchema,
]);

export const hostedRuntimeSubscriptionToolRequestSchema = z
  .union([
    z.object({
      action: z.literal("change_plan"),
      quoteId: hostedRuntimeSubscriptionQuoteIdSchema,
      targetPlanCode: hostedRuntimeDirectBillingPlanCodeSchema,
    }).strict(),
    z.object({
      action: z.enum([
        "continue_pulse",
        "start_pulse_now",
        "upgrade_edge",
      ]),
    }).strict(),
  ]);

export const hostedRuntimeSubscriptionControlRequestSchema = z
  .union([
    z.object({
      action: z.literal("change_plan"),
      assistantInputId: hostedRuntimeSubscriptionAssistantInputIdSchema,
      quoteId: hostedRuntimeSubscriptionQuoteIdSchema,
      targetPlanCode: hostedRuntimeDirectBillingPlanCodeSchema,
    }).strict(),
    z.object({
      action: z.enum([
        "continue_pulse",
        "start_pulse_now",
        "upgrade_edge",
      ]),
      assistantInputId: hostedRuntimeSubscriptionAssistantInputIdSchema,
    }).strict(),
  ]);

export const hostedRuntimeSubscriptionToolResponseSchema = z.union([
  z.object({
    action: z.literal("change_plan"),
    effectiveAt: z.string().datetime({ offset: true }).optional(),
    plan: hostedRuntimeDirectPlanTermsSchema,
    status: hostedRuntimeNonPaymentResponseStatusSchema,
  }).strict(),
  z.object({
    action: z.literal("change_plan"),
    paymentUrl: hostedRuntimeHttpsUrlSchema,
    plan: hostedRuntimeDirectPlanTermsSchema,
    status: z.literal("payment_required"),
  }).strict(),
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
export type HostedRuntimeDirectBillingPlanCode = z.infer<
  typeof hostedRuntimeDirectBillingPlanCodeSchema
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
