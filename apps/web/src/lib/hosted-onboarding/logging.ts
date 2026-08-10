import { sanitizeHostedOnboardingLogString } from "./http";

const HOSTED_ONBOARDING_TIMING_LABEL_MAX_LENGTH = 80;
const HOSTED_ONBOARDING_TIMING_STEP_MAX_LENGTH = 120;

export type HostedOnboardingStructuredLogValue = boolean | number | string | null | undefined;
export type HostedOnboardingStructuredLogDetails = Record<string, HostedOnboardingStructuredLogValue>;
export type HostedOnboardingTimingDetails = HostedOnboardingStructuredLogDetails;

export interface HostedOnboardingTimingHandle {
  readonly baseDetails: HostedOnboardingTimingDetails;
  readonly startedAtMs: number;
  readonly step: string;
}

export function startHostedOnboardingTiming(
  step: string,
  baseDetails: HostedOnboardingTimingDetails = {},
): HostedOnboardingTimingHandle {
  return {
    baseDetails,
    startedAtMs: Date.now(),
    step,
  };
}

export function finishHostedOnboardingTiming(
  handle: HostedOnboardingTimingHandle,
  outcome: string,
  details: HostedOnboardingTimingDetails = {},
): void {
  logHostedOnboardingTiming({
    details: {
      ...handle.baseDetails,
      ...details,
    },
    outcome,
    startedAtMs: handle.startedAtMs,
    step: handle.step,
  });
}

export function logHostedOnboardingDiagnostic(
  name: string,
  details: HostedOnboardingStructuredLogDetails = {},
): void {
  const diagnostic =
    sanitizeHostedOnboardingTimingLabel(
      name,
      HOSTED_ONBOARDING_TIMING_LABEL_MAX_LENGTH,
    ) ?? "unknown";
  console.info(`Hosted onboarding diagnostic: ${diagnostic}.`, {
    diagnostic,
    ...sanitizeHostedOnboardingStructuredLogDetails(details),
  });
}

export function logHostedOnboardingWarning(
  name: string,
  details: HostedOnboardingStructuredLogDetails = {},
): void {
  const warning =
    sanitizeHostedOnboardingTimingLabel(
      name,
      HOSTED_ONBOARDING_TIMING_LABEL_MAX_LENGTH,
    ) ?? "unknown";
  console.warn(`Hosted onboarding warning: ${warning}.`, {
    warning,
    ...sanitizeHostedOnboardingStructuredLogDetails(details),
  });
}

export function deriveHostedOnboardingTimingErrorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name;
  }

  if (typeof error === "string") {
    return "StringError";
  }

  return "UnknownError";
}

export function toHostedOnboardingLogIdSuffix(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(-6);
}

function logHostedOnboardingTiming(input: {
  details?: HostedOnboardingTimingDetails;
  outcome: string;
  startedAtMs: number;
  step: string;
}): void {
  console.info("Hosted onboarding timing.", {
    elapsedMs: Math.max(0, Date.now() - input.startedAtMs),
    outcome:
      sanitizeHostedOnboardingTimingLabel(
        input.outcome,
        HOSTED_ONBOARDING_TIMING_LABEL_MAX_LENGTH,
      ) ?? "unknown",
    step:
      sanitizeHostedOnboardingTimingLabel(
        input.step,
        HOSTED_ONBOARDING_TIMING_STEP_MAX_LENGTH,
      ) ?? "unknown",
    ...sanitizeHostedOnboardingStructuredLogDetails(input.details),
  });
}

export function sanitizeHostedOnboardingStructuredLogDetails(
  details: HostedOnboardingStructuredLogDetails | undefined,
): Record<string, boolean | number | string> {
  if (!details) {
    return {};
  }

  const sanitizedEntries = Object.entries(details).flatMap(([key, value]) => {
    const sanitizedValue = sanitizeHostedOnboardingTimingDetailValue(value);
    return sanitizedValue === null ? [] : [[key, sanitizedValue] as const];
  });

  return Object.fromEntries(sanitizedEntries);
}

function sanitizeHostedOnboardingTimingDetailValue(
  value: HostedOnboardingStructuredLogValue,
): boolean | number | string | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  return sanitizeHostedOnboardingTimingLabel(
    value,
    HOSTED_ONBOARDING_TIMING_LABEL_MAX_LENGTH,
  );
}

function sanitizeHostedOnboardingTimingLabel(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  return sanitizeHostedOnboardingLogString(value, maxLength);
}
