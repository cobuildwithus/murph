export const HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";
export const HOSTED_ACCOUNT_DELETION_CONNECTED_APP_SETUP_IN_PROGRESS_MESSAGE =
  "Connected-app setup is still finishing. Try account deletion again after it finishes or times out.";
export const HOSTED_ACCOUNT_DELETION_CONNECTED_APP_CLEANUP_BACKLOG_MESSAGE =
  "Multiple connected-app setups are still finishing. Try account deletion again after they finish or time out.";
export const HOSTED_ACCOUNT_DATA_DELETION_SCHEMA = "murph.hosted-account-data-deletion-result.v2";
export const HOSTED_ACCOUNT_PRIVACY_REQUEST_BODY_LIMIT_BYTES = 4 * 1024;

/**
 * The one question we ask on the way out. Answering is optional and never gates
 * deletion, so both the client and `parseHostedAccountExitFeedback` treat an
 * absent, unknown, or malformed answer as "skipped" rather than an error.
 */
export const HOSTED_ACCOUNT_EXIT_REASONS = [
  { code: "too_expensive", label: "Too expensive" },
  { code: "not_useful_enough", label: "Not useful enough" },
  { code: "too_many_texts", label: "Texts too much" },
  { code: "privacy_concerns", label: "Privacy concerns" },
  { code: "setup_trouble", label: "Couldn't get it working" },
  { code: "just_testing", label: "Just testing, or I made a second account" },
] as const;

export type HostedAccountExitReasonCode =
  (typeof HOSTED_ACCOUNT_EXIT_REASONS)[number]["code"];

export const HOSTED_ACCOUNT_EXIT_NOTE_MAX_LENGTH = 500;

export function isHostedAccountExitReasonCode(
  value: unknown,
): value is HostedAccountExitReasonCode {
  return HOSTED_ACCOUNT_EXIT_REASONS.some((reason) => reason.code === value);
}
