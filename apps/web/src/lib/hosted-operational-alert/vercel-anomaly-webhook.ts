import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  readHostedOperationalAlertEmailConfig,
} from "../hosted-onboarding/operational-alert-email-config";
import {
  HostedResendPlainTextEmailError,
  sendHostedResendPlainTextEmail,
} from "../hosted-onboarding/resend-plain-text-email";
import { isRecord, normalizeNullableString } from "../primitives";

const HOSTED_VERCEL_ALERT_WEBHOOK_SECRET_ENV =
  "HOSTED_WEB_VERCEL_ALERT_WEBHOOK_SECRET";
const HOSTED_VERCEL_ALERT_SUBJECT = "Vercel anomaly detected";
const HOSTED_VERCEL_ALERT_IDEMPOTENCY_SCOPE = "murph/vercel-alert";
const HOSTED_VERCEL_ALERT_MAX_GROUP_SIZE = 20;

export type HostedVercelAnomalyWebhookSend =
  typeof sendHostedResendPlainTextEmail;

export type HostedVercelAnomalyWebhookResult =
  | {
    alertCount: number;
    ok: true;
    outcome: "sent";
  }
  | {
    ok: true;
    outcome: "ignored_event";
  };

interface HostedVercelTriggeredAlertEvent {
  alerts: HostedVercelTriggeredAlert[];
  createdAt: string;
  eventId: string;
  observabilityUrl: string | null;
  projectSlug: string;
  startedAt: string;
  totalAlertCount: number;
}

interface HostedVercelTriggeredAlert {
  average: number;
  count: number;
  metric: string;
  startedAt: string;
  stddev: number;
  title: string;
  type: string;
  unit: string;
  zscore: number;
  zscoreThreshold: number;
}

export async function handleHostedVercelAnomalyWebhook(input: {
  env?: Readonly<Record<string, string | undefined>>;
  rawBody: string;
  sendEmail?: HostedVercelAnomalyWebhookSend;
  signal?: AbortSignal;
  signature: string | null;
}): Promise<HostedVercelAnomalyWebhookResult> {
  const env = input.env ?? process.env;
  const webhookSecret = normalizeNullableString(
    env[HOSTED_VERCEL_ALERT_WEBHOOK_SECRET_ENV],
  );
  if (!webhookSecret) {
    throw hostedOnboardingError({
      code: "HOSTED_VERCEL_ALERT_WEBHOOK_NOT_CONFIGURED",
      httpStatus: 503,
      message: "Vercel alert webhook is not configured.",
      retryable: true,
    });
  }
  if (!verifyHostedVercelWebhookSignature({
    rawBody: input.rawBody,
    secret: webhookSecret,
    signature: input.signature,
  })) {
    throw hostedOnboardingError({
      code: "HOSTED_VERCEL_ALERT_WEBHOOK_UNAUTHORIZED",
      httpStatus: 401,
      message: "Vercel alert webhook signature is invalid.",
    });
  }

  const payload = parseJsonRecord(input.rawBody);
  const eventType = readRequiredLine(payload.type, {
    label: "event type",
    maxLength: 80,
  });
  if (eventType !== "alerts.triggered") {
    return {
      ok: true,
      outcome: "ignored_event",
    };
  }

  const event = parseHostedVercelTriggeredAlertEvent(payload);
  const emailConfig = readHostedOperationalAlertEmailConfig(env);
  if (!emailConfig) {
    throw hostedOnboardingError({
      code: "HOSTED_VERCEL_ALERT_EMAIL_NOT_CONFIGURED",
      httpStatus: 503,
      message: "Vercel alert email is not configured.",
      retryable: true,
    });
  }

  const sendEmail = input.sendEmail ?? sendHostedResendPlainTextEmail;
  try {
    await sendEmail({
      config: emailConfig.resend,
      idempotencyKey: buildHostedVercelAlertIdempotencyKey(event.eventId),
      signal: input.signal,
      subject: HOSTED_VERCEL_ALERT_SUBJECT,
      text: buildHostedVercelAlertEmail(event),
      to: emailConfig.recipients,
    });
  } catch (error) {
    if (error instanceof HostedResendPlainTextEmailError) {
      throw hostedOnboardingError({
        code: "HOSTED_VERCEL_ALERT_EMAIL_SEND_FAILED",
        details: {
          code: error.code,
          statusCode: error.providerStatus,
        },
        httpStatus: 502,
        message: "Vercel alert email send failed.",
        retryable: true,
      });
    }
    throw error;
  }

  return {
    alertCount: event.totalAlertCount,
    ok: true,
    outcome: "sent",
  };
}

function verifyHostedVercelWebhookSignature(input: {
  rawBody: string;
  secret: string;
  signature: string | null;
}): boolean {
  const signature = normalizeNullableString(input.signature)?.toLowerCase();
  if (!signature || !/^[a-f0-9]{40}$/u.test(signature)) {
    return false;
  }

  const expected = Buffer.from(
    createHmac("sha1", input.secret).update(input.rawBody).digest("hex"),
    "ascii",
  );
  const actual = Buffer.from(signature, "ascii");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseHostedVercelTriggeredAlertEvent(
  value: Record<string, unknown>,
): HostedVercelTriggeredAlertEvent {
  const payload = readRequiredRecord(value.payload, "event payload");
  const alertsValue = payload.alerts;
  if (!Array.isArray(alertsValue) || alertsValue.length === 0) {
    throw invalidHostedVercelAlertPayload("Vercel alert group is invalid.");
  }

  const eventId = readRequiredLine(value.id, {
    label: "event id",
    maxLength: 200,
  });
  const projectSlug = readRequiredToken(payload.projectSlug, {
    label: "project slug",
    maxLength: 120,
  });
  const visibleAlerts = alertsValue
    .slice(0, HOSTED_VERCEL_ALERT_MAX_GROUP_SIZE)
    .map(parseHostedVercelTriggeredAlert);

  return {
    alerts: visibleAlerts,
    createdAt: readTimestamp(value.createdAt, "event creation time"),
    eventId,
    observabilityUrl: readVercelObservabilityUrl(payload.links),
    projectSlug,
    startedAt: readTimestamp(payload.startedAt, "group start time"),
    totalAlertCount: alertsValue.length,
  };
}

function parseHostedVercelTriggeredAlert(
  value: unknown,
): HostedVercelTriggeredAlert {
  const alert = readRequiredRecord(value, "alert");
  readRequiredLine(alert.alertId, {
    label: "alert id",
    maxLength: 200,
  });

  return {
    average: readFiniteNumber(alert.average, "alert average"),
    count: readNonNegativeFiniteNumber(alert.count, "alert count"),
    metric: readRequiredToken(alert.metric, {
      label: "alert metric",
      maxLength: 120,
    }),
    startedAt: readTimestamp(alert.startedAt, "alert start time"),
    stddev: readNonNegativeFiniteNumber(alert.stddev, "alert standard deviation"),
    title: readRequiredLine(alert.title, {
      label: "alert title",
      maxLength: 240,
    }),
    type: readRequiredToken(alert.type, {
      label: "alert type",
      maxLength: 120,
    }),
    unit: readRequiredToken(alert.unit, {
      label: "alert unit",
      maxLength: 80,
    }),
    zscore: readFiniteNumber(alert.zscore, "alert z-score"),
    zscoreThreshold: readFiniteNumber(
      alert.zscoreThreshold,
      "alert z-score threshold",
    ),
  };
}

function buildHostedVercelAlertEmail(
  event: HostedVercelTriggeredAlertEvent,
): string {
  const alertSections = event.alerts.map((alert, index) => [
    `${index + 1}. ${alert.title}`,
    `Type: ${alert.type} | Metric: ${alert.metric}`,
    [
      `Observed: ${formatAlertNumber(alert.count)} ${alert.unit}`,
      `Baseline: ${formatAlertNumber(alert.average)} ${alert.unit}`,
      `Standard deviation: ${formatAlertNumber(alert.stddev)} ${alert.unit}`,
    ].join(" | "),
    [
      `Z-score: ${formatAlertNumber(alert.zscore)}`,
      `Trigger threshold: ${formatAlertNumber(alert.zscoreThreshold)}`,
    ].join(" | "),
    `Started: ${alert.startedAt}`,
  ].join("\n"));
  const omittedAlertCount = event.totalAlertCount - event.alerts.length;

  return [
    "Vercel reported an anomalous production signal.",
    "",
    `Project: ${event.projectSlug}`,
    `Group started: ${event.startedAt}`,
    `Detected: ${event.createdAt}`,
    `Alert count: ${event.totalAlertCount}`,
    "",
    ...(event.observabilityUrl
      ? [`Open in Vercel: ${event.observabilityUrl}`, ""]
      : []),
    ...alertSections.flatMap((section) => [section, ""]),
    ...(omittedAlertCount > 0
      ? [`Additional grouped alerts omitted: ${omittedAlertCount}`, ""]
      : []),
    "This email contains Vercel aggregate alert metrics only; it does not include request or member data.",
  ].join("\n");
}

function buildHostedVercelAlertIdempotencyKey(eventId: string): string {
  const eventDigest = createHash("sha256").update(eventId).digest("hex");
  return `${HOSTED_VERCEL_ALERT_IDEMPOTENCY_SCOPE}/${eventDigest}`;
}

function parseJsonRecord(rawBody: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw invalidHostedVercelAlertPayload("Vercel alert payload is invalid JSON.");
  }
  return readRequiredRecord(value, "event");
}

function readRequiredRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidHostedVercelAlertPayload(`Vercel alert ${label} is invalid.`);
  }
  return value;
}

function readRequiredLine(
  value: unknown,
  input: { label: string; maxLength: number },
): string {
  if (typeof value !== "string") {
    throw invalidHostedVercelAlertPayload(
      `Vercel alert ${input.label} is invalid.`,
    );
  }
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized || normalized.length > input.maxLength) {
    throw invalidHostedVercelAlertPayload(
      `Vercel alert ${input.label} is invalid.`,
    );
  }
  return normalized;
}

function readRequiredToken(
  value: unknown,
  input: { label: string; maxLength: number },
): string {
  const token = readRequiredLine(value, input);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/ -]*$/u.test(token)) {
    throw invalidHostedVercelAlertPayload(
      `Vercel alert ${input.label} is invalid.`,
    );
  }
  return token;
}

function readTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw invalidHostedVercelAlertPayload(`Vercel alert ${label} is invalid.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw invalidHostedVercelAlertPayload(`Vercel alert ${label} is invalid.`);
  }
  return date.toISOString();
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidHostedVercelAlertPayload(`Vercel ${label} is invalid.`);
  }
  return value;
}

function readNonNegativeFiniteNumber(value: unknown, label: string): number {
  const number = readFiniteNumber(value, label);
  if (number < 0) {
    throw invalidHostedVercelAlertPayload(`Vercel ${label} is invalid.`);
  }
  return number;
}

function readVercelObservabilityUrl(value: unknown): string | null {
  if (!isRecord(value) || typeof value.observability !== "string") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value.observability);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || (url.hostname !== "vercel.com" && !url.hostname.endsWith(".vercel.com"))
  ) {
    return null;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function formatAlertNumber(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.01) {
    return Number(value.toPrecision(3)).toString();
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function invalidHostedVercelAlertPayload(message: string) {
  return hostedOnboardingError({
    code: "HOSTED_VERCEL_ALERT_WEBHOOK_PAYLOAD_INVALID",
    httpStatus: 400,
    message,
  });
}
