import {
  HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
} from "@murphai/hosted-execution/contracts";

const HOSTED_GROUP_TARGET_UNSAFE_LABEL_PATTERN =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu;

export function sanitizeHostedGroupTargetDisplayLabel(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .normalize("NFC")
    .replace(HOSTED_GROUP_TARGET_UNSAFE_LABEL_PATTERN, "")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized || null;
}

export function normalizeHostedGroupTargetSelector(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = sanitizeHostedGroupTargetDisplayLabel(value);
  if (!normalized) {
    throw new TypeError("Hosted assistant ask group label must not be blank.");
  }
  if (
    [...normalized].length
    > HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS
  ) {
    throw new TypeError("Hosted assistant ask group label is too long.");
  }
  return normalized.toLocaleLowerCase("und");
}

export function normalizeHostedPersistedGroupTargetSelector(
  value: string | null | undefined,
): string | null {
  const normalized = sanitizeHostedGroupTargetDisplayLabel(value);
  return normalized ? normalized.toLocaleLowerCase("und") : null;
}
