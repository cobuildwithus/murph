import { Prisma } from "@prisma/client";
import { normalizeHostedExecutionOperatorMessage } from "@murphai/hosted-execution";

import { sanitizeJsonLogString } from "../http";

import { toPrismaJson } from "./shared";

const HOSTED_RUN_SENSITIVE_STORED_JSON_KEYS = new Set([
  "apikey",
  "authorization",
  "bearertoken",
  "contactfields",
  "cookie",
  "emailbody",
  "emailmessage",
  "emailsnippet",
  "eml",
  "password",
  "privatecontact",
  "privatecontactfields",
  "rawemail",
  "rawemailbody",
  "rawemailmessage",
  "rawemailsnippet",
  "raweml",
  "secret",
  "setcookie",
  "token",
  "vaultcontent",
  "vaultexcerpt",
  "vaultsnippet",
  "vaulttext",
]);

const HOSTED_RUN_SENSITIVE_LOG_LABEL_PATTERN =
  /\b(raw[-_ ]?email(?:[-_ ]?(?:snippet|body|message))?|email[-_ ]?(?:snippet|body|message)|vault[-_ ]?(?:text|content|snippet|excerpt)|private[-_ ]?contact(?:[-_ ]?fields)?)\b\s*[:=][\s\S]*$/iu;

const HOSTED_RUN_SENSITIVE_STORED_JSON_KEY_PATTERN =
  /(?:authorization|token|secret|password|passcode|apikey|cookie|setcookie|rawemail|emailbody|emailmessage|emailsnippet|eml|privatecontact|contactfields|vaulttext|vaultcontent|vaultsnippet|vaultexcerpt)/u;

export function sanitizeHostedRunLogMessage(message: string, redacted: unknown): string {
  const candidate = typeof redacted === "string" && redacted.trim().length > 0
    ? redacted
    : message;
  const labelRedacted = redactHostedRunSensitiveLogLabels(
    redactHostedRunAuthorizationHeaderValues(candidate),
  );
  return normalizeHostedExecutionOperatorMessage(
    redactHostedRunSensitiveLogLabels(sanitizeJsonLogString(labelRedacted) ?? labelRedacted),
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
        Object.entries(value).map(([key, entry]) => [
          key,
          shouldRedactHostedRunStoredJsonField(key, entry)
            ? "<redacted-sensitive-field>"
            : sanitizeHostedRunStoredJsonValue(entry),
        ]),
      ),
    );
  }
  return null;
}

function redactHostedRunSensitiveLogLabels(value: string): string {
  return value.replace(
    HOSTED_RUN_SENSITIVE_LOG_LABEL_PATTERN,
    (_match, label: string) => `${label}=<redacted-sensitive-field>`,
  );
}

function redactHostedRunAuthorizationHeaderValues(value: string): string {
  return value.replace(
    /\b(authorization)\b\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]+\b/giu,
    (_match, label: string) => `${label}=Bearer <redacted-secret>`,
  );
}

function shouldRedactHostedRunStoredJsonField(key: string, value: unknown): boolean {
  const normalizedKey = normalizeHostedRunStoredJsonKey(key);
  return hostedRunStoredJsonValuePresent(value)
    && (
      HOSTED_RUN_SENSITIVE_STORED_JSON_KEYS.has(normalizedKey)
      || HOSTED_RUN_SENSITIVE_STORED_JSON_KEY_PATTERN.test(normalizedKey)
    );
}

function normalizeHostedRunStoredJsonKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
}

function hostedRunStoredJsonValuePresent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}
