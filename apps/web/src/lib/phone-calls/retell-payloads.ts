export interface RetellCallAnalysisPayload {
  call_summary?: string | null;
  custom_analysis_data?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface RetellCallCostPayload {
  combined_cost: number;
}

export interface RetellCallPayload {
  call_analysis?: RetellCallAnalysisPayload | null;
  call_cost?: RetellCallCostPayload | null;
  call_id: string;
  data_storage_setting?: string | null;
  disconnection_reason?: string | null;
  duration_ms?: number | null;
  end_timestamp?: number | string | null;
  metadata?: Record<string, unknown> | null;
  transcript?: string | null;
  transfer_end_timestamp?: number | string | null;
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

const USD_MICROS_PER_CENT = 10_000;
const MAX_RETELL_COMBINED_COST_CENTS = Number.MAX_SAFE_INTEGER / USD_MICROS_PER_CENT;

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

export function hasRetellBasicAttributesOnlyStorage(call: RetellCallPayload): boolean {
  return call.data_storage_setting?.trim().toLowerCase() === "basic_attributes_only";
}

export function readRetellCallEndAt(call: RetellCallPayload): Date | null {
  return readRetellTimestamp(call.end_timestamp);
}

export function readRetellTransferEndAt(call: RetellCallPayload): Date | null {
  return readRetellTimestamp(call.transfer_end_timestamp);
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
  const callCost = readOptionalCallCost(record.call_cost);

  return {
    ...record,
    call_id: requireTrimmedString(record.call_id, "Retell call id", 200),
    ...(callAnalysis === undefined ? {} : { call_analysis: callAnalysis }),
    ...(callCost === undefined ? {} : { call_cost: callCost }),
    data_storage_setting: readOptionalString(
      record.data_storage_setting,
      "Retell data storage setting",
    ),
    disconnection_reason: readOptionalString(
      record.disconnection_reason,
      "Retell disconnection reason",
    ),
    duration_ms: readOptionalNonNegativeInteger(record.duration_ms),
    end_timestamp: readOptionalTimestamp(record.end_timestamp),
    metadata: readOptionalRecord(record.metadata, "Retell call metadata"),
    transcript: readOptionalString(record.transcript, "Retell transcript"),
    transfer_end_timestamp: readOptionalTimestamp(record.transfer_end_timestamp),
  };
}

function readOptionalCallCost(value: unknown): RetellCallCostPayload | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (!isRecord(value)) {
    return null;
  }
  const combinedCost = readNonNegativeFiniteNumber(value.combined_cost);
  if (combinedCost === null) {
    return null;
  }
  if (combinedCost > MAX_RETELL_COMBINED_COST_CENTS) {
    return null;
  }
  return {
    combined_cost: combinedCost,
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

function readOptionalNonNegativeInteger(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function readNonNegativeFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function readRetellTimestamp(value: number | string | null | undefined): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return validRetellDate(value < 1_000_000_000_000 ? value * 1_000 : value);
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const text = value.trim();
  if (/^\d+$/u.test(text)) {
    const numeric = Number.parseInt(text, 10);
    return validRetellDate(numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric);
  }

  return validRetellDate(text);
}

function validRetellDate(value: number | string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
