import type {
  HealthCommonsBiomarkerMetricDomain,
  HealthCommonsBiomarkerPrivateMetricBinding,
} from "@murphai/contracts";

export function isBrowserVaultMetricBinding(
  binding: HealthCommonsBiomarkerPrivateMetricBinding,
): binding is HealthCommonsBiomarkerPrivateMetricBinding & {
  domain: HealthCommonsBiomarkerMetricDomain;
  metric: string;
  source: "browser_vault_metric";
} {
  return binding.source === "browser_vault_metric"
    && typeof binding.domain === "string"
    && typeof binding.metric === "string";
}
