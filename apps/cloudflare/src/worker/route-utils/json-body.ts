import { parseInput, RequestInputError } from "@murphai/hosted-execution/request-input";
import { readRequestBodyText, requireJsonObject, type JsonBodyReadOptions } from "../../json.ts";
import { ContractValidationError } from "@murphai/contracts/validation-error";
export const INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES = 4 * 1024;
export const DIRECT_R2_PRESIGNED_PUT_TEST_BODY_LIMIT_BYTES = 16 * 1024;
export const DEPLOY_CONTAINER_SMOKE_BODY_LIMIT_BYTES = 4 * 1024;

export function parseJsonValue(value: string): unknown {
  return JSON.parse(value);
}

export function parseJsonInput(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) throw new RequestInputError(error.message, { cause: error });
    throw error;
  }
}

export function requireJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractValidationError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

export function normalizeNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

export async function readOptionalJsonInput(
  request: Request,
  options: JsonBodyReadOptions = {},
): Promise<Record<string, unknown>> {
  const payload = await readRequestBodyText(request, options);
  return parseInput(payload.trim() ? JSON.parse(payload) : {}, requireJsonObject);
}
