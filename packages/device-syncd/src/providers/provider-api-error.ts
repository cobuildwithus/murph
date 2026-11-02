import { deviceSyncError, type DeviceSyncErrorOptions } from "../errors.ts";
import { sanitizeHostedRuntimeDiagnosticText } from "../hosted-runtime.ts";
import { buildProviderResponseDiagnostics, inspectProviderErrorBody } from "./provider-diagnostics.ts";

type ProviderApiErrorDiagnosticValue = boolean | number | string | null | undefined;

export function buildProviderApiError(
  code: string,
  message: string,
  response: Response,
  _body: string,
  options: {
    retryable?: boolean;
    accountStatus?: DeviceSyncErrorOptions["accountStatus"];
    diagnostics?: Record<string, ProviderApiErrorDiagnosticValue>;
    httpStatus?: number;
  } = {},
) {
  const retryable = options.retryable ?? (response.status === 429 || response.status >= 500);
  const accountStatus = options.accountStatus ?? null;
  const responseDiagnostics = buildProviderResponseDiagnostics(inspectProviderErrorBody(_body));

  return deviceSyncError({
    code,
    message,
    retryable,
    httpStatus: options.httpStatus ?? response.status,
    accountStatus,
    details: sanitizeProviderApiErrorDiagnostics({
      status: response.status,
      httpStatusText: response.statusText,
      retryable,
      accountStatus,
      ...responseDiagnostics,
      ...options.diagnostics,
    }),
  });
}

function sanitizeProviderApiErrorDiagnostics(
  input: Record<string, ProviderApiErrorDiagnosticValue>,
): Record<string, boolean | number | string | null> {
  const output: Record<string, boolean | number | string | null> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,80}$/u.test(key) || value === undefined) {
      continue;
    }

    if (typeof value === "string") {
      const token = value.trim();
      if (/^[A-Za-z0-9_.:-]{1,128}$/u.test(token)) {
        output[key] = token;
      } else if (isProviderApiErrorReasonKey(key)) {
        const reason = sanitizeProviderApiErrorReasonText(token);
        if (reason) {
          output[key] = reason;
        }
      }
      continue;
    }

    if (typeof value === "number") {
      if (Number.isFinite(value)) {
        output[key] = value;
      }
      continue;
    }

    output[key] = value;
  }

  return output;
}

function isProviderApiErrorReasonKey(key: string): boolean {
  return key.endsWith("Description") || key.endsWith("Reason") || key.endsWith("StatusText");
}

function sanitizeProviderApiErrorReasonText(value: string): string | null {
  return sanitizeHostedRuntimeDiagnosticText(value);
}

