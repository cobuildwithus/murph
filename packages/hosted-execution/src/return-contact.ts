import { ContractValidationError } from "@murphai/contracts/validation-error";
export const HOSTED_RETURN_CONTACT_KINDS = [
  "text",
  "telegram",
  "email",
] as const;

export type HostedReturnContactKind =
  (typeof HOSTED_RETURN_CONTACT_KINDS)[number];

export function isHostedReturnContactKind(
  value: unknown,
): value is HostedReturnContactKind {
  return (
    typeof value === "string"
    && (HOSTED_RETURN_CONTACT_KINDS as readonly string[]).includes(value)
  );
}

export function parseHostedReturnContactKind(
  value: unknown,
  label = "Hosted returnContactKind",
): HostedReturnContactKind | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (isHostedReturnContactKind(value)) {
    return value;
  }
  throw new ContractValidationError(`${label} must be null or one of text, telegram, email.`);
}
