import {
  isHostedRuntimeIdShapedDiagnosticToken,
  sanitizeHostedRuntimeDiagnosticText,
} from "../hosted-runtime.ts";
import { normalizeString } from "../shared.ts";

type ProviderDiagnosticValue = boolean | number | string | null | undefined;

export type ProviderApiRequestMethod = "DELETE" | "GET" | "POST" | "PUT";

export interface ProviderErrorBodyDiagnostics {
  responseErrorCode: string | null;
  responseErrorDescription: string | null;
  responseErrorDescriptionFieldPresent: boolean;
  responseErrorFieldPresent: boolean;
  responseShapeKind: string;
}

const PROVIDER_ERROR_CODE_FIELDS = Object.freeze([
  "error",
  "error_code",
  "errorCode",
  "code",
  "type",
] as const);

const PROVIDER_ERROR_DESCRIPTION_FIELDS = Object.freeze([
  "error_description",
  "errorDescription",
  "message",
  "detail",
  "msg",
  "reason",
  "title",
] as const);

export function buildProviderRequestDiagnostics(input: {
  method: ProviderApiRequestMethod;
  endpointKind: string;
  authKind?: string;
  authPlacement?: string;
  credentialPresent?: boolean;
  contentType?: string;
  bodyKind?: string;
  bodyFieldNames?: readonly string[];
  queryParameterNames?: readonly string[];
}): Record<string, ProviderDiagnosticValue> {
  const bodyFieldNames = normalizeDiagnosticNameList(input.bodyFieldNames ?? []);
  const queryParameterNames = normalizeDiagnosticNameList(input.queryParameterNames ?? []);

  return {
    requestAuthKind: input.authKind ?? "none",
    requestAuthPlacement: input.authPlacement ?? "none",
    requestBodyFieldCount: bodyFieldNames.length,
    requestBodyFieldNames: formatProviderDiagnosticTokenList(bodyFieldNames),
    requestBodyKind: input.bodyKind ?? "none",
    requestContentType: input.contentType ?? "none",
    requestCredentialPresent: input.credentialPresent ?? false,
    requestEndpointKind: input.endpointKind,
    requestMethod: input.method,
    requestQueryParameterCount: queryParameterNames.length,
    requestQueryParameterNames: formatProviderDiagnosticTokenList(queryParameterNames),
  };
}

export function buildProviderResponseDiagnostics(
  diagnostics: ProviderErrorBodyDiagnostics,
): Record<string, ProviderDiagnosticValue> {
  return {
    ...(diagnostics.responseErrorCode ? { responseErrorCode: diagnostics.responseErrorCode } : {}),
    ...(diagnostics.responseErrorDescription
      ? { responseErrorDescription: diagnostics.responseErrorDescription }
      : {}),
    responseErrorDescriptionFieldPresent: diagnostics.responseErrorDescriptionFieldPresent,
    responseErrorFieldPresent: diagnostics.responseErrorFieldPresent,
    responseShapeKind: diagnostics.responseShapeKind,
  };
}

export function inspectProviderErrorBody(body: string): ProviderErrorBodyDiagnostics {
  const trimmed = body.trim();
  if (!trimmed) {
    return {
      responseErrorCode: null,
      responseErrorDescription: null,
      responseErrorDescriptionFieldPresent: false,
      responseErrorFieldPresent: false,
      responseShapeKind: "empty",
    };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return inspectProviderErrorEntries(parsed, "json_array");
    }

    if (!parsed || typeof parsed !== "object") {
      return {
        responseErrorCode: null,
        responseErrorDescription: null,
        responseErrorDescriptionFieldPresent: false,
        responseErrorFieldPresent: false,
        responseShapeKind: classifyProviderJsonShape(parsed),
      };
    }

    return inspectProviderErrorObject(parsed as Record<string, unknown>);
  } catch {
    return {
      responseErrorCode: null,
      responseErrorDescription: sanitizeProviderDiagnosticReasonText(trimmed),
      responseErrorDescriptionFieldPresent: false,
      responseErrorFieldPresent: false,
      responseShapeKind: "non_json",
    };
  }
}

export function formatProviderDiagnosticTokenList(values: readonly string[]): string | null {
  const formatted = normalizeDiagnosticNameList(values).join(".");

  return /^[A-Za-z0-9_.:-]{1,128}$/u.test(formatted) ? formatted : null;
}

function inspectProviderErrorObject(record: Record<string, unknown>): ProviderErrorBodyDiagnostics {
  const code =
    readFirstSafeProviderErrorCode(record, PROVIDER_ERROR_CODE_FIELDS)
    ?? readNestedErrorsCode(record.errors)
    ?? readNestedErrorsCode(record.detail);
  const description =
    readFirstSafeProviderErrorDescription(record, PROVIDER_ERROR_DESCRIPTION_FIELDS)
    ?? readNestedErrorsDescription(record.errors)
    ?? readNestedErrorsDescription(record.detail);

  return {
    responseErrorCode: code,
    responseErrorDescription: description,
    responseErrorDescriptionFieldPresent:
      hasAnyOwnProperty(record, PROVIDER_ERROR_DESCRIPTION_FIELDS)
      || hasNestedErrorsDescription(record.errors)
      || hasNestedErrorsDescription(record.detail),
    responseErrorFieldPresent:
      hasAnyOwnProperty(record, PROVIDER_ERROR_CODE_FIELDS)
      || hasNestedErrorsCode(record.errors)
      || hasNestedErrorsCode(record.detail),
    responseShapeKind: "json_object",
  };
}

function inspectProviderErrorEntries(
  entries: readonly unknown[],
  responseShapeKind: string,
): ProviderErrorBodyDiagnostics {
  return {
    responseErrorCode: readNestedErrorsCode(entries),
    responseErrorDescription: readNestedErrorsDescription(entries),
    responseErrorDescriptionFieldPresent: hasNestedErrorsDescription(entries),
    responseErrorFieldPresent: hasNestedErrorsCode(entries),
    responseShapeKind,
  };
}

function readFirstSafeProviderErrorCode(
  record: Record<string, unknown>,
  fields: readonly string[],
): string | null {
  for (const field of fields) {
    const value = record[field];
    const normalized = typeof value === "string" ? normalizeString(value)?.toLowerCase() : null;
    if (
      normalized
      && /^[A-Za-z0-9_.:-]{1,128}$/u.test(normalized)
      && !isHostedRuntimeIdShapedDiagnosticToken(normalized)
    ) {
      return normalized;
    }
  }

  return null;
}

function readFirstSafeProviderErrorDescription(
  record: Record<string, unknown>,
  fields: readonly string[],
): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string") {
      const sanitized = sanitizeProviderDiagnosticReasonText(value);
      if (sanitized) {
        return sanitized;
      }
    }
  }

  return null;
}

// Nested error containers arrive as an array of entries or a single object
// depending on the provider. Only object entries are trusted to carry typed
// error fields; primitive arrays are treated as raw structured payloads and
// yield no description.
function readNestedErrorEntries(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value !== null && typeof value === "object" ? [value] : [];
}

function readNestedErrorsCode(value: unknown): string | null {
  for (const entry of readNestedErrorEntries(value)) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const code = readFirstSafeProviderErrorCode(
        entry as Record<string, unknown>,
        PROVIDER_ERROR_CODE_FIELDS,
      );
      if (code) {
        return code;
      }
    }
  }

  return null;
}

function readNestedErrorsDescription(value: unknown): string | null {
  for (const entry of readNestedErrorEntries(value)) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const sanitized = readFirstSafeProviderErrorDescription(
        entry as Record<string, unknown>,
        PROVIDER_ERROR_DESCRIPTION_FIELDS,
      );
      if (sanitized) {
        return sanitized;
      }
    }
  }

  return null;
}

function hasNestedErrorsCode(value: unknown): boolean {
  return readNestedErrorEntries(value).some((entry) =>
    entry
    && typeof entry === "object"
    && !Array.isArray(entry)
    && hasAnyOwnProperty(entry as Record<string, unknown>, PROVIDER_ERROR_CODE_FIELDS));
}

function hasNestedErrorsDescription(value: unknown): boolean {
  return readNestedErrorEntries(value).some((entry) =>
    entry
    && typeof entry === "object"
    && !Array.isArray(entry)
    && hasAnyOwnProperty(entry as Record<string, unknown>, PROVIDER_ERROR_DESCRIPTION_FIELDS));
}

function sanitizeProviderDiagnosticReasonText(value: string): string | null {
  if (/^\s*</u.test(value)) {
    return null;
  }

  return sanitizeHostedRuntimeDiagnosticText(value);
}

function hasAnyOwnProperty(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.some((field) => Object.prototype.hasOwnProperty.call(record, field));
}

function classifyProviderJsonShape(value: unknown): string {
  if (value === null) {
    return "json_null";
  }

  if (Array.isArray(value)) {
    return "json_array";
  }

  return `json_${typeof value}`;
}

function normalizeDiagnosticNameList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => normalizeString(value)).filter((value): value is string => Boolean(value)))]
    .sort();
}
