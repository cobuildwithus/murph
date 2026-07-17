import { z } from "zod";

export const HOSTED_PLAN_USAGE_ACCESS_KINDS = [
  "family_sponsored",
  "paid",
  "trial",
] as const;

export const HOSTED_PLAN_USAGE_PLAN_NAMES = [
  "Edge",
  "Family",
  "Pulse",
  "Pulse Trial",
] as const;

export const HOSTED_PLAN_USAGE_UNAVAILABLE_REASONS = [
  "group_not_supported",
  "hosted_access_inactive",
  "trial_conversion_pending",
] as const;

export const HOSTED_ADD_USAGE_SETTINGS_URL =
  "/settings?addUsage=true#subscription" as const;

const hostedPlanUsageGeneratedAtSchema = z.string().datetime({ offset: true });

const hostedPlanUsageActionLabelSchema = z.string().trim().min(1).max(80);

const hostedPlanUsageRecommendedActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.enum(["start_pulse", "upgrade_edge"]),
      label: hostedPlanUsageActionLabelSchema,
      url: z.string().url(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("add_usage"),
      label: hostedPlanUsageActionLabelSchema,
      url: z.literal(HOSTED_ADD_USAGE_SETTINGS_URL),
    })
    .strict(),
]);

const hostedPlanUsageSubscriptionActionQuoteSchema = z
  .object({
    action: z.enum(["start_pulse_now", "upgrade_edge"]),
    label: z.string().trim().min(1).max(80),
  })
  .strict();

const hostedPlanUsageForecastSchema = z
  .object({
    estimatedDaysRemaining: z.number().int().positive(),
    estimatedExhaustionAt: z.string().datetime({ offset: true }),
  })
  .strict();

const hostedPlanUsageAvailableSchema = z
  .object({
    accessKind: z.enum(HOSTED_PLAN_USAGE_ACCESS_KINDS),
    forecast: hostedPlanUsageForecastSchema.nullable(),
    generatedAt: hostedPlanUsageGeneratedAtSchema,
    periodEnd: z.string().datetime({ offset: true }),
    periodKind: z.enum(["monthly", "trial"]),
    periodStart: z.string().datetime({ offset: true }),
    planCode: z.enum(["launch_edge_monthly", "launch_monthly"]),
    planName: z.enum(HOSTED_PLAN_USAGE_PLAN_NAMES),
    recommendedAction: hostedPlanUsageRecommendedActionSchema.nullable(),
    subscriptionActionQuote:
      hostedPlanUsageSubscriptionActionQuoteSchema.nullable().optional(),
    remainingPercent: z.number().int().min(0).max(100),
    status: z.enum(["active", "exhausted"]),
    usedPercent: z.number().int().min(0).max(100),
  })
  .strict();

const hostedPlanUsageUnavailableSchema = z
  .object({
    generatedAt: hostedPlanUsageGeneratedAtSchema,
    reason: z.enum(HOSTED_PLAN_USAGE_UNAVAILABLE_REASONS),
    recommendedAction: hostedPlanUsageRecommendedActionSchema.nullable(),
    subscriptionActionQuote:
      hostedPlanUsageSubscriptionActionQuoteSchema.nullable().optional(),
    status: z.literal("unavailable"),
  })
  .strict();

export const hostedPlanUsageStatusSchema = z.union([
  hostedPlanUsageAvailableSchema,
  hostedPlanUsageUnavailableSchema,
]);

export const hostedPlanUsageToolRequestSchema = z
  .object({
    includeSubscriptionActionQuote: z.literal(true).optional(),
  })
  .strict();

export type HostedPlanUsageStatus = z.infer<typeof hostedPlanUsageStatusSchema>;
export type HostedPlanUsageAvailableStatus = z.infer<
  typeof hostedPlanUsageAvailableSchema
>;
export type HostedPlanUsageRecommendedAction = z.infer<
  typeof hostedPlanUsageRecommendedActionSchema
>;
export type HostedPlanUsageSubscriptionActionQuote = z.infer<
  typeof hostedPlanUsageSubscriptionActionQuoteSchema
>;
export type HostedPlanUsageToolRequest = z.infer<
  typeof hostedPlanUsageToolRequestSchema
>;

export function parseHostedPlanUsageStatus(value: unknown): HostedPlanUsageStatus {
  return hostedPlanUsageStatusSchema.parse(value);
}

export function parseHostedPlanUsageToolRequest(
  value: unknown,
): HostedPlanUsageToolRequest {
  return hostedPlanUsageToolRequestSchema.parse(value);
}
