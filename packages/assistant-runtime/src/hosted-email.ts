export const hostedEmailSendTargetKindValues = ["explicit", "group", "thread"] as const;

export type HostedEmailSendTargetKind = (typeof hostedEmailSendTargetKindValues)[number];

export interface HostedEmailSendRequest {
  html?: string | null;
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
  subject?: string | null;
  target: string;
  targetKind: HostedEmailSendTargetKind;
}

export interface HostedEmailDeliverySummary {
  failedCount: number;
  sentCount: number;
  skippedCount: number;
  status: "failed" | "partial_failure" | "sent";
}

export interface HostedEmailSendResult {
  delivery?: HostedEmailDeliverySummary | null;
  target: string;
}

export function parseHostedEmailSendRequest(value: unknown): HostedEmailSendRequest {
  const record = requireHostedEmailSendRequestObject(value, "Hosted email send request");

  return {
    html: readOptionalHostedEmailSendRequestString(
      record.html ?? null,
      "Hosted email send request html",
    ),
    idempotencyKey: readOptionalHostedEmailSendRequestString(
      record.idempotencyKey ?? null,
      "Hosted email send request idempotencyKey",
    ),
    message: requireHostedEmailSendRequestString(
      record.message,
      "Hosted email send request message",
    ),
    replyToMessageId: readOptionalHostedEmailSendRequestString(
      record.replyToMessageId ?? null,
      "Hosted email send request replyToMessageId",
    ),
    subject: readOptionalHostedEmailSendRequestString(
      record.subject ?? null,
      "Hosted email send request subject",
    ),
    target: requireHostedEmailSendRequestString(
      record.target,
      "Hosted email send request target",
    ),
    targetKind: requireHostedEmailSendTargetKind(
      record.targetKind,
      "Hosted email send request targetKind",
    ),
  };
}

function requireHostedEmailSendRequestObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireHostedEmailSendRequestString(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  return value;
}

function readOptionalHostedEmailSendRequestString(
  value: unknown,
  label: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = requireHostedEmailSendRequestString(value, label).trim();
  return normalized.length > 0 ? normalized : null;
}

function requireHostedEmailSendTargetKind(
  value: unknown,
  label: string,
): HostedEmailSendTargetKind {
  const targetKind = requireHostedEmailSendRequestString(value, label);

  if (hostedEmailSendTargetKindValues.includes(targetKind as HostedEmailSendTargetKind)) {
    return targetKind as HostedEmailSendTargetKind;
  }

  throw new TypeError(`${label} must be explicit, group, or thread.`);
}
