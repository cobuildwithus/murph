import { after } from "next/server";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";
import { readRawBodyBuffer } from "@/src/lib/http";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  logHostedOnboardingDiagnostic,
  startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix,
} from "@/src/lib/hosted-onboarding/logging";

const HOSTED_LINQ_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const routeStartedAtMs = Date.now();
  const signature = request.headers.get("x-webhook-signature");
  const timestamp = request.headers.get("x-webhook-timestamp");
  const routeTiming = startHostedOnboardingTiming("hosted-onboarding.route.linq-webhook", {
    signalAbortedAtStart: request.signal.aborted,
    signaturePresent: Boolean(signature),
    timestampPresent: Boolean(timestamp),
  });

  try {
    const bodyTiming = startHostedOnboardingTiming(
      "hosted-onboarding.route.linq-webhook.read-body",
      {
        signalAbortedAtStart: request.signal.aborted,
      },
    );
    const rawBody = await readHostedLinqWebhookRawBody(request);
    const rawBodyBytes = new TextEncoder().encode(rawBody).byteLength;
    finishHostedOnboardingTiming(bodyTiming, "completed", {
      rawBodyBytes,
      signalAbortedAfterRead: request.signal.aborted,
    });

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody,
      scheduleAfterResponse: scheduleAfterResponseOrFireAndForget,
      signature,
      timestamp,
    });

    logHostedOnboardingDiagnostic(
      "hosted-onboarding.route.linq-webhook.ingress",
      {
        ...buildHostedLinqWebhookIngressDiagnostic({
          rawBody,
          rawBodyBytes,
          routeStartedAtMs,
          timestamp,
        }),
        duplicate: Boolean(response.duplicate),
        responseReason: response.reason ?? null,
        signalAbortedBeforeDiagnostic: request.signal.aborted,
      },
    );

    finishHostedOnboardingTiming(routeTiming, "completed", {
      duplicate: Boolean(response.duplicate),
      rawBodyBytes,
      reason: response.reason ?? null,
      signalAbortedBeforeReturn: request.signal.aborted,
    });

    return jsonOk(response, 202);
  } catch (error) {
    finishHostedOnboardingTiming(routeTiming, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      signalAbortedBeforeReturn: request.signal.aborted,
    });
    throw error;
  }
});

function scheduleAfterResponseOrFireAndForget(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

async function readHostedLinqWebhookRawBody(request: Request): Promise<string> {
  try {
    return (await readRawBodyBuffer(request, {
      limitBytes: HOSTED_LINQ_WEBHOOK_MAX_BODY_BYTES,
    })).toString("utf8");
  } catch (error) {
    if (error instanceof RangeError) {
      throw hostedOnboardingError({
        code: "LINQ_WEBHOOK_BODY_TOO_LARGE",
        httpStatus: 413,
        message: "Linq webhook body is too large.",
      });
    }

    throw error;
  }
}

function buildHostedLinqWebhookIngressDiagnostic(input: {
  rawBody: string;
  rawBodyBytes: number;
  routeStartedAtMs: number;
  timestamp: string | null;
}): Record<string, boolean | number | string | null | undefined> {
  const payload = parseJsonObject(input.rawBody);
  const data = parseRecord(payload?.data);
  const eventType = readString(payload?.event_type);
  const eventCreatedAtText = readString(payload?.created_at);
  const eventCreatedAtMs = parseIsoTimestampMs(eventCreatedAtText);
  const webhookTimestampMs = parseLinqWebhookTimestampHeaderMs(input.timestamp);
  const messageTimestamp = resolveMessageTimestampForDiagnostic({
    data,
    eventCreatedAtMs,
    eventType,
  });

  return {
    diagnosticSchemaVersion: 1,
    eventCreatedAtParsed: eventCreatedAtMs !== null,
    eventCreatedAtPresent: eventCreatedAtText !== null,
    eventCreatedMinusMessageTimestampMs: diffMs(eventCreatedAtMs, messageTimestamp.ms),
    eventIdSuffix: toHostedOnboardingLogIdSuffix(readString(payload?.event_id)),
    eventType,
    messageTimestampParsed: messageTimestamp.ms !== null,
    messageTimestampSource: messageTimestamp.source,
    payloadParsed: payload !== null,
    rawBodyBytes: input.rawBodyBytes,
    routeStartMinusEventCreatedAtMs: diffMs(input.routeStartedAtMs, eventCreatedAtMs),
    routeStartMinusMessageTimestampMs: diffMs(input.routeStartedAtMs, messageTimestamp.ms),
    routeStartMinusWebhookTimestampMs: diffMs(input.routeStartedAtMs, webhookTimestampMs),
    traceIdSuffix: toHostedOnboardingLogIdSuffix(readString(payload?.trace_id)),
    webhookTimestampMinusMessageTimestampMs: diffMs(webhookTimestampMs, messageTimestamp.ms),
    webhookTimestampParsed: webhookTimestampMs !== null,
    webhookTimestampPresent: input.timestamp !== null,
  };
}

function resolveMessageTimestampForDiagnostic(input: {
  data: Record<string, unknown> | null;
  eventCreatedAtMs: number | null;
  eventType: string | null;
}): {
  ms: number | null;
  source: "created_at" | "received_at" | "sent_at" | null;
} {
  if (input.eventType !== "message.received" || !input.data) {
    return {
      ms: null,
      source: null,
    };
  }

  const receivedAtMs = parseIsoTimestampMs(readString(input.data.received_at));
  if (receivedAtMs !== null) {
    return {
      ms: receivedAtMs,
      source: "received_at",
    };
  }

  const sentAtMs = parseIsoTimestampMs(readString(input.data.sent_at));
  if (sentAtMs !== null) {
    return {
      ms: sentAtMs,
      source: "sent_at",
    };
  }

  return {
    ms: input.eventCreatedAtMs,
    source: input.eventCreatedAtMs === null ? null : "created_at",
  };
}

function parseJsonObject(rawBody: string): Record<string, unknown> | null {
  try {
    return parseRecord(JSON.parse(rawBody));
  } catch {
    return null;
  }
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function parseIsoTimestampMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function parseLinqWebhookTimestampHeaderMs(value: string | null): number | null {
  const normalized = readString(value);
  if (!normalized || !/^-?\d+$/u.test(normalized)) {
    return null;
  }

  const timestampSeconds = Number.parseInt(normalized, 10);
  return Number.isFinite(timestampSeconds) ? timestampSeconds * 1000 : null;
}

function diffMs(laterMs: number | null, earlierMs: number | null): number | null {
  if (laterMs === null || earlierMs === null) {
    return null;
  }

  return Math.round(laterMs - earlierMs);
}
