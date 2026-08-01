import "server-only";

import { readHostedOperationalAlertEmailConfig } from "../hosted-onboarding/operational-alert-email-config";
import { sendHostedResendPlainTextEmail } from "../hosted-onboarding/resend-plain-text-email";

const HOSTED_DEVICE_CONNECT_FAILURE_ALERT_RECIPIENTS_ENV =
  "HOSTED_PRODUCT_FEEDBACK_DIGEST_EMAILS";

// A member retrying the same broken connect (the common shape of a real
// outage) should not fan out one email per attempt; one alert per member,
// provider, and error code per hour keeps the signal without the noise.
const HOSTED_DEVICE_CONNECT_FAILURE_ALERT_BUCKET_HOURS = 1;

// Replayed callbacks redirect the member home without a failure; they are the
// one callback error that does not represent a member stuck at a wall.
const HOSTED_DEVICE_CONNECT_FAILURE_ALERT_IGNORED_CODES = new Set([
  "OAUTH_STATE_REPLAYED",
]);

export type HostedDeviceConnectFailureAlertOutcome =
  | "ignored_code"
  | "not_configured"
  | "sent";

export async function sendHostedDeviceConnectFailureAlert(input: {
  connectSourceId?: string | null;
  env?: Readonly<Record<string, string | undefined>>;
  errorCode: string;
  httpStatus?: number | null;
  memberId?: string | null;
  now?: Date;
  provider: string | null;
  sendEmail?: typeof sendHostedResendPlainTextEmail;
  signal?: AbortSignal;
}): Promise<HostedDeviceConnectFailureAlertOutcome> {
  if (HOSTED_DEVICE_CONNECT_FAILURE_ALERT_IGNORED_CODES.has(input.errorCode)) {
    return "ignored_code";
  }

  const emailConfig = readHostedOperationalAlertEmailConfig(
    input.env ?? process.env,
    HOSTED_DEVICE_CONNECT_FAILURE_ALERT_RECIPIENTS_ENV,
  );
  if (!emailConfig) {
    return "not_configured";
  }

  const now = input.now ?? new Date();
  const hourBucket = now.toISOString().slice(
    0,
    13 - (HOSTED_DEVICE_CONNECT_FAILURE_ALERT_BUCKET_HOURS - 1),
  );
  const provider = input.provider ?? "unknown";
  const surface = input.connectSourceId ?? provider;

  await (input.sendEmail ?? sendHostedResendPlainTextEmail)({
    config: emailConfig.resend,
    idempotencyKey: [
      "hosted-device-connect-failure",
      provider,
      input.connectSourceId ?? "",
      input.memberId ?? "",
      input.errorCode,
      hourBucket,
    ].join("/"),
    ...(input.signal ? { signal: input.signal } : {}),
    subject: `Murph device connection failed — ${surface}: ${input.errorCode}`,
    text: [
      "A member's device connection failed.",
      "",
      `at: ${now.toISOString()}`,
      `member: ${input.memberId ?? "unknown"}`,
      `provider: ${provider}`,
      `connect source: ${input.connectSourceId ?? "unknown"}`,
      `error code: ${input.errorCode}`,
      `http status: ${input.httpStatus ?? "unknown"}`,
      "",
      "Inspect device_connection (status, setup_phase, last_error_message) for this member to see the stored failure.",
    ].join("\n"),
    to: emailConfig.recipients,
  });

  return "sent";
}

export async function reportHostedDeviceConnectFailure(
  input: Parameters<typeof sendHostedDeviceConnectFailureAlert>[0],
): Promise<void> {
  try {
    await sendHostedDeviceConnectFailureAlert(input);
  } catch {
    console.warn("Hosted device connect failure alert email failed.", {
      errorCode: input.errorCode,
      provider: input.provider,
    });
  }
}
