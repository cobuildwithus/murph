import { Prisma } from "@prisma/client";
import { normalizeHostedExecutionOperatorMessage } from "@murphai/hosted-execution";

import { sanitizeJsonLogString } from "../http";

import { toPrismaJson } from "./shared";

export function sanitizeHostedRunLogMessage(message: string, redacted: unknown): string {
  const candidate = typeof redacted === "string" && redacted.trim().length > 0
    ? redacted
    : message;
  return normalizeHostedExecutionOperatorMessage(
    sanitizeJsonLogString(candidate) ?? candidate,
  );
}

export function sanitizeHostedRunStoredJsonValue(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return sanitizeHostedRunLogMessage(value, null);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return toPrismaJson(value.map((entry) => sanitizeHostedRunStoredJsonValue(entry)));
  }
  if (typeof value === "object") {
    return toPrismaJson(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, sanitizeHostedRunStoredJsonValue(entry)]),
      ),
    );
  }
  return null;
}
