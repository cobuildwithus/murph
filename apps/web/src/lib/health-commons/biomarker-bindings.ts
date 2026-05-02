import type { HealthCommonsBiomarkerPrivateMetricBinding } from "@murphai/contracts";

export function isMetricBinding(
  binding: HealthCommonsBiomarkerPrivateMetricBinding,
): binding is HealthCommonsBiomarkerPrivateMetricBinding & {
  source: "metric";
  metricKey: string;
} {
  return binding.source === "metric" && typeof binding.metricKey === "string";
}
