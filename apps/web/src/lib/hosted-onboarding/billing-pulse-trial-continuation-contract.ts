export const HOSTED_START_PAID_PULSE_RETURN_PARAM = "startPulse";
export const HOSTED_START_PAID_PULSE_RETURN_VALUE = "complete";

export const HOSTED_PULSE_TRIAL_CONTINUATION_PATH =
  "/api/settings/billing/pulse-trial-continuation";
export const HOSTED_PULSE_TRIAL_CONTINUATION_ACTION_HEADER =
  "x-murph-pulse-continuation-action";
export const HOSTED_PULSE_TRIAL_CONTINUATION_ACTION_PARAM = "action";
export const HOSTED_PULSE_TRIAL_CONTINUATION_EXPIRES_PARAM = "expires";
export const HOSTED_PULSE_TRIAL_CONTINUATION_SIGNATURE_PARAM = "signature";

export type HostedPulseTrialContinuationAction =
  | "continue_pulse"
  | "start_pulse_now";
