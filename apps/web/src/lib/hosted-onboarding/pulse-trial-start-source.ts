export const HOSTED_PULSE_TRIAL_START_SOURCES = [
  "web_onboarding",
  "companion_onboarding",
  "linq_instant_start",
] as const;

export type HostedPulseTrialStartSource =
  (typeof HOSTED_PULSE_TRIAL_START_SOURCES)[number];

export function parseHostedPulseTrialStartSource(
  value: string | null | undefined,
): HostedPulseTrialStartSource | null {
  return HOSTED_PULSE_TRIAL_START_SOURCES.find((source) => source === value)
    ?? null;
}
