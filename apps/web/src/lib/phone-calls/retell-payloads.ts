export interface RetellCallAnalysisPayload {
  call_summary?: string | null;
  custom_analysis_data?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface RetellCallPayload {
  call_analysis?: RetellCallAnalysisPayload | null;
  call_id: string;
  data_storage_setting?: string | null;
  disconnection_reason?: string | null;
  end_timestamp?: number | string | null;
  metadata?: Record<string, unknown> | null;
  transcript?: string | null;
  [key: string]: unknown;
}

export interface RetellAskMurphPayload {
  args: {
    question: string;
    [key: string]: unknown;
  };
  call: RetellCallPayload;
  name?: string;
  [key: string]: unknown;
}

export interface RetellWebhookPayload {
  call: RetellCallPayload;
  event: string;
  [key: string]: unknown;
}

export const retellCallPayloadSchema = {
  parse: parseRetellCallPayload,
} as const;

export const retellAskMurphPayloadSchema = {
  parse: parseRetellAskMurphPayload,
} as const;

export const retellWebhookPayloadSchema = {
  parse: parseRetellWebhookPayload,
} as const;

export function readRetellMurphPhoneCallId(call: RetellCallPayload): string | null {
  const value = call.metadata?.murph_phone_call_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseRetellAskMurphPayload(value: unknown): RetellAskMurphPayload {
  const record = requireRecord(value, "Retell function payload");
  const args = requireRecord(record.args, "Retell function args");
  const question = requireTrimmedString(args.question, "Retell function question", 1_500);

  return {
    ...record,
    args: {
      ...args,
      question,
    },
    call: parseRetellCallPayload(record.call),
    ...(record.name === undefined
      ? {}
      : { name: readOptionalString(record.name, "Retell function name") ?? undefined }),
  };
}

function parseRetellWebhookPayload(value: unknown): RetellWebhookPayload {
  const record = requireRecord(value, "Retell webhook payload");

  return {
    ...record,
    call: parseRetellCallPayload(record.call),
    event: requireTrimmedString(record.event, "Retell webhook event", 200),
  };
}

function parseRetellCallPayload(value: unknown): RetellCallPayload {
  const record = requireRecord(value, "Retell call payload");
  const callAnalysis = readOptionalCallAnalysis(record.call_analysis);

  return {
    ...record,
    call_id: requireTrimmedString(record.call_id, "Retell call id", 200),
    ...(callAnalysis === undefined ? {} : { call_analysis: callAnalysis }),
    data_storage_setting: readOptionalString(
      record.data_storage_setting,
      "Retell data storage setting",
    ),
    disconnection_reason: readOptionalString(
      record.disconnection_reason,
      "Retell disconnection reason",
    ),
    end_timestamp: readOptionalTimestamp(record.end_timestamp),
    metadata: readOptionalRecord(record.metadata, "Retell call metadata"),
    transcript: readOptionalString(record.transcript, "Retell transcript"),
  };
}

function readOptionalCallAnalysis(value: unknown): RetellCallAnalysisPayload | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = readOptionalRecord(value, "Retell call analysis");
  if (!record) {
    return record;
  }

  return {
    ...record,
    call_summary: readOptionalString(record.call_summary, "Retell call summary"),
    custom_analysis_data: readOptionalRecord(
      record.custom_analysis_data,
      "Retell custom analysis data",
    ),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function readOptionalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requireTrimmedString(value: unknown, label: string, maxLength: number): string {
  const text = readOptionalString(value, label)?.trim();
  if (!text) {
    throw new TypeError(`${label} is required.`);
  }
  if (text.length > maxLength) {
    throw new RangeError(`${label} exceeds ${maxLength} characters.`);
  }
  return text;
}

function readOptionalString(value: unknown, label: string): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  return value;
}

function readOptionalTimestamp(value: unknown): number | string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new TypeError("Retell end timestamp must be a string or finite number.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
