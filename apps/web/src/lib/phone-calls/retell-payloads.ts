interface RetellCallAnalysisPayload {
  custom_analysis_data?: RetellCustomAnalysisPayload | null;
}

interface RetellCustomAnalysisPayload {
  follow_up?: unknown;
  outcome?: unknown;
  result?: unknown;
}

interface RetellCallMetadataPayload {
  murph_phone_call_id?: string | null;
}

export interface RetellCallPayload {
  call_analysis?: RetellCallAnalysisPayload | null;
  call_id: string;
  data_storage_setting?: string | null;
  disconnection_reason?: string | null;
  end_timestamp?: number | string | null;
  metadata?: RetellCallMetadataPayload | null;
}

interface RetellAskMurphPayload {
  args: {
    question: string;
  };
  call: RetellCallPayload;
}

interface RetellWebhookPayload {
  call: RetellCallPayload;
  event: string;
}

export type RetellTransferWebhookEvent =
  | "transfer_bridged"
  | "transfer_cancelled";

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

function parseRetellAskMurphPayload(value: unknown): RetellAskMurphPayload {
  const record = requireRecord(value, "Retell function payload");
  const args = requireRecord(record.args, "Retell function args");
  const question = requireTrimmedString(args.question, "Retell function question", 1_500);

  return {
    args: { question },
    call: parseRetellCallPayload(record.call),
  };
}

function parseRetellWebhookPayload(value: unknown): RetellWebhookPayload {
  const record = requireRecord(value, "Retell webhook payload");

  return {
    call: parseRetellCallPayload(record.call),
    event: requireTrimmedString(record.event, "Retell webhook event", 200),
  };
}

function parseRetellCallPayload(value: unknown): RetellCallPayload {
  const record = requireRecord(value, "Retell call payload");
  const callAnalysis = readOptionalCallAnalysis(record.call_analysis);
  const dataStorageSetting = readOptionalString(
    record.data_storage_setting,
    "Retell data storage setting",
  );
  const disconnectionReason = readOptionalString(
    record.disconnection_reason,
    "Retell disconnection reason",
  );
  const endTimestamp = readOptionalTimestamp(record.end_timestamp);
  const metadata = readOptionalCallMetadata(record.metadata);

  return {
    call_id: requireTrimmedString(record.call_id, "Retell call id", 200),
    ...(callAnalysis === undefined ? {} : { call_analysis: callAnalysis }),
    ...(dataStorageSetting === undefined
      ? {}
      : { data_storage_setting: dataStorageSetting }),
    ...(disconnectionReason === undefined
      ? {}
      : { disconnection_reason: disconnectionReason }),
    ...(endTimestamp === undefined ? {} : { end_timestamp: endTimestamp }),
    ...(metadata === undefined ? {} : { metadata }),
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

  const customAnalysisData = readOptionalCustomAnalysisData(
    record.custom_analysis_data,
  );
  return {
    ...(customAnalysisData === undefined
      ? {}
      : { custom_analysis_data: customAnalysisData }),
  };
}

function readOptionalCustomAnalysisData(
  value: unknown,
): RetellCustomAnalysisPayload | null | undefined {
  const record = readOptionalRecord(value, "Retell custom analysis data");
  if (!record) return record;

  return {
    ...(record.follow_up === undefined ? {} : { follow_up: record.follow_up }),
    ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
    ...(record.result === undefined ? {} : { result: record.result }),
  };
}

function readOptionalCallMetadata(
  value: unknown,
): RetellCallMetadataPayload | null | undefined {
  const record = readOptionalRecord(value, "Retell call metadata");
  if (!record) return record;

  const murphPhoneCallId = readOptionalString(
    record.murph_phone_call_id,
    "Retell Murph phone call id",
  );
  return murphPhoneCallId === undefined
    ? {}
    : { murph_phone_call_id: murphPhoneCallId };
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
