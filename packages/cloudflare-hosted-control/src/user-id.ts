import { ContractValidationError } from "@murphai/contracts/validation-error";
export function requireCloudflareHostedControlUserId(
  value: string,
  label = "Cloudflare hosted control userId",
): string {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    throw new ContractValidationError(`${label} must not be blank.`);
  }

  return normalized;
}
