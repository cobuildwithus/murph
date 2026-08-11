import * as z from "@murphai/contracts/zod-runtime";

export const HOSTED_PLAN_USAGE_ACCESS_KINDS = [
  "family_sponsored",
  "paid",
  "starter",
] as const;

export const HOSTED_PLAN_USAGE_PLAN_NAMES = [
  "Edge",
  "Group",
  "Family",
  "Max",
  "Pulse",
  "Starter",
] as const;

// Member-facing name for the internal launch_group_monthly billing SKU.
// The hosted wire contract retains "Group" for rolling-deploy compatibility.
export const HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME = "Core" as const;

export const HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES = [
  "launch_group_monthly",
  "launch_monthly",
  "launch_edge_monthly",
  "launch_max_monthly",
] as const;

export const HOSTED_PLAN_USAGE_UNAVAILABLE_REASONS = [
  "group_not_supported",
  "hosted_access_inactive",
] as const;

export const HOSTED_ADD_USAGE_SETTINGS_URL =
  "/settings?addUsage=true#subscription" as const;

const hostedPlanUsageGeneratedAtSchema = z.string().datetime({ offset: true });

const hostedPlanUsageActionLabelSchema = z.string().trim().min(1).max(80);

const hostedPlanUsageRecommendedActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("change_plan"),
      label: hostedPlanUsageActionLabelSchema,
      targetPlanCode: z.enum([
        ...HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES,
      ]),
      url: z.string().url(),
    })
    .strict(),
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
    action: z.literal("change_plan"),
    expiresAt: z.string().datetime({ offset: true }),
    label: z.string().trim().min(1).max(80),
    monthlyPriceUsdCents: z.number().int().positive(),
    quoteId: z.string().trim().min(1).max(1_024),
    targetPlanCode: z.enum([
      ...HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES,
    ]),
    timing: z.enum(["immediate", "now", "period_end"]),
  })
  .strict();

const hostedPlanUsageAvailablePlanSchema = z
  .object({
    code: z.enum([
      ...HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES,
    ]),
    displayName: z.enum(["Group", "Pulse", "Edge", "Max"]),
    monthlyPriceUsdCents: z.number().int().positive(),
    selectable: z.literal(true),
  })
  .strict();

const hostedPlanUsageScheduledPlanSchema = z
  .object({
    code: z.enum([
      ...HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES,
    ]),
    displayName: z.enum(["Group", "Pulse", "Edge", "Max"]),
    effectiveAt: z.string().datetime({ offset: true }).nullable(),
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
    availablePlans: z.array(hostedPlanUsageAvailablePlanSchema).optional(),
    forecast: hostedPlanUsageForecastSchema.nullable(),
    generatedAt: hostedPlanUsageGeneratedAtSchema,
    periodEnd: z.string().datetime({ offset: true }),
    periodKind: z.enum(["lifetime", "monthly"]),
    periodStart: z.string().datetime({ offset: true }),
    planCode: z.enum([
      ...HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES,
    ]),
    planName: z.enum(HOSTED_PLAN_USAGE_PLAN_NAMES),
    recommendedPlanCode: z.enum([
      ...HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES,
    ]).optional(),
    recommendedAction: hostedPlanUsageRecommendedActionSchema.nullable(),
    scheduledPlan: hostedPlanUsageScheduledPlanSchema.optional(),
    subscriptionActionQuote:
      hostedPlanUsageSubscriptionActionQuoteSchema.nullable().optional(),
    remainingPercent: z.number().int().min(0).max(100),
    status: z.enum(["active", "exhausted"]),
    usedPercent: z.number().int().min(0).max(100),
  })
  .strict();

const hostedPlanUsageUnavailableSchema = z
  .object({
    availablePlans: z.array(hostedPlanUsageAvailablePlanSchema).optional(),
    generatedAt: hostedPlanUsageGeneratedAtSchema,
    reason: z.enum(HOSTED_PLAN_USAGE_UNAVAILABLE_REASONS),
    recommendedPlanCode: z.enum([
      ...HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES,
    ]).optional(),
    recommendedAction: hostedPlanUsageRecommendedActionSchema.nullable(),
    scheduledPlan: hostedPlanUsageScheduledPlanSchema.optional(),
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
    subscriptionActionTargetPlanCode: z.enum([
      ...HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES,
    ]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.subscriptionActionTargetPlanCode === undefined
      || value.includeSubscriptionActionQuote === true,
    {
      message:
        "subscriptionActionTargetPlanCode requires includeSubscriptionActionQuote.",
    },
  );

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
