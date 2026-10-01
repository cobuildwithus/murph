import "server-only";

import { after } from "next/server";
import { resolveConfiguredDeviceSyncProviderManifest } from "@murphai/device-syncd/config";
import { writeHostedRuntimeLogs } from "../hosted-runtime-log/write";
import type { HostedDeviceSyncCallbackProofError } from "./browser-callback-proof";

import { readHostedOperationalAlertEmailConfig } from "../hosted-onboarding/operational-alert-email-config";
import { sendHostedResendPlainTextEmail } from "../hosted-onboarding/resend-plain-text-email";

const HOSTED_DEVICE_CONNECT_FAILURE_ALERT_RECIPIENTS_ENV =
  "HOSTED_PRODUCT_FEEDBACK_DIGEST_EMAILS";

// A member retrying the same broken connect (the common shape of a real
// outage) should not fan out one email per attempt; one alert per member,
// provider, and error code per hour keeps the signal without the noise.
const HOSTED_DEVICE_CONNECT_FAILURE_ALERT_BUCKET_HOURS = 1;

// Replays and unverified browser returns are not connection-failure evidence.
// Proof rejections have their own bounded runtime diagnostics.
const HOSTED_DEVICE_CONNECT_FAILURE_ALERT_IGNORED_CODES = new Set([
  "OAUTH_STATE_REPLAYED",
  "CALLBACK_PROOF_INVALID",
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
      "Inspect callback request logs and current device_connection status. A callback failure may leave no stored connection error.",
    ].join("\n"),
    to: emailConfig.recipients,
  });

  return "sent";
}

export async function reportHostedDeviceConnectFailure(
  input: Parameters<typeof sendHostedDeviceConnectFailureAlert>[0],
): Promise<void> {
  // Only the failure's own identifiers are safe to log; keep them as explicit
  // locals so no raw payload field can reach the log call.
  const errorCode = input.errorCode;
  const provider = input.provider ?? "unknown";

  try {
    await sendHostedDeviceConnectFailureAlert(input);
  } catch {
    console.warn("Hosted device connect failure alert email failed.", {
      errorCode,
      provider,
    });
  }
}

// The category describes only the browser proof. Missing proof may mean an
// expired cookie, another browser, or a revisit; it cannot prove a failed link.
export function reportHostedDeviceCallbackRejection(input: {
  errorCode: HostedDeviceSyncCallbackProofError;
  memberId: string;
  provider: string;
}): void {
  const provider = resolveConfiguredDeviceSyncProviderManifest(input.provider)?.provider ?? "unknown";
  const at = new Date().toISOString();
  const errorCode = input.errorCode;
  console.info("Hosted device callback requires connection review.", {
    eventCode: "device-sync.callback_rejected",
    errorCode,
    provider,
  });
  const task = async () => {
    try {
      await writeHostedRuntimeLogs({
        userId: input.memberId,
        entries: [{
          at,
          component: "device-sync",
          phase: "invoke",
          eventCode: "device-sync.callback_rejected",
          errorCode,
          level: "info",
          redactedJson: { provider },
        }],
      });
    } catch {
      console.warn("Hosted device callback diagnostic write failed.", { errorCode, provider });
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}
