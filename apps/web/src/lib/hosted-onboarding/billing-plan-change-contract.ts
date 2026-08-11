export const HOSTED_BILLING_PLAN_CHANGE_RETURN_PARAM = "planUpdate";

export const HOSTED_BILLING_PLAN_CHANGE_CANCELED_RETURN_VALUE = "canceled";

export type HostedBillingPlanChangeReturnValue =
  | "launch_monthly"
  | "launch_edge_monthly"
  | "launch_max_monthly"
  | typeof HOSTED_BILLING_PLAN_CHANGE_CANCELED_RETURN_VALUE;

export function parseHostedBillingPlanChangeReturnValue(
  value: unknown,
): HostedBillingPlanChangeReturnValue | null {
  switch (value) {
    case "launch_monthly":
    case "launch_edge_monthly":
    case "launch_max_monthly":
    case HOSTED_BILLING_PLAN_CHANGE_CANCELED_RETURN_VALUE:
      return value;
    default:
      return null;
  }
}
