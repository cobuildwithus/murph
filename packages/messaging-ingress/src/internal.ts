const USER_PATH_PATTERNS = [
  /^\/Users\/[^/]+/u,
  /^\/home\/[^/]+/u,
  /^[A-Za-z]:\\Users\\[^\\]+/u,
];
const REDACTED_PATH = "<REDACTED_PATH>";
const REDACTED_SECRET = "<REDACTED_SECRET>";
const SENSITIVE_EXACT_RAW_KEYS = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "apitoken",
  "auth",
  "authtoken",
  "authorization",
  "bearertoken",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "csrftoken",
  "idtoken",
  "oauthtoken",
  "password",
  "passwd",
  "privatekey",
  "refreshtoken",
  "secret",
  "session",
  "sessionid",
  "sessiontoken",
  "setcookie",
  "token",
]);
const SENSITIVE_COLLAPSED_SUBSTRINGS = [
  "authorization",
  "setcookie",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "sessionid",
  "apikey",
  "privatekey",
  "clientsecret",
  "oauthtoken",
  "idtoken",
] as const;
const SENSITIVE_TOKENIZED_PART_KEYS = [
  "authorization",
  "cookie",
  "secret",
  "session",
  "credential",
  "credentials",
  "password",
  "passwd",
] as const;

type SensitivePartCombinationRule = {
  required: readonly string[];
  anyOf: readonly string[];
  allowOnlyRequired?: boolean;
};

const SENSITIVE_PART_COMBINATION_RULES: readonly SensitivePartCombinationRule[] = [
  {
    required: ["token"],
    anyOf: ["access", "refresh", "api", "auth", "oauth", "session", "id", "bearer", "csrf"],
    allowOnlyRequired: true,
  },
  {
    required: ["key"],
    anyOf: ["api", "private", "client"],
  },
] as const;

const SENSITIVE_STRING_PATTERNS = [
  /^\s*(bearer|basic|digest)\s+\S+/iu,
  /\b(authorization|cookie|set-cookie|access_token|refresh_token|api[_-]?key|session(?:[_-]?(?:id|token))?|secret)\b\s*[:=]\s*\S+/iu,
] as const;

export function toIsoTimestamp(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new TypeError(`Invalid ISO timestamp: ${String(value)}`);
  }

  return date.toISOString();
}

export function normalizeTextValue(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}

export function sanitizeRawMetadata(value: unknown): unknown {
  return sanitizeRawMetadataValue(value);
}

function sanitizeRawMetadataValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Uint8Array) {
    return `<${value.byteLength} bytes>`;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => {
      const sanitizedEntry = sanitizeRawMetadataValue(entry);
      return sanitizedEntry === undefined ? null : sanitizedEntry;
    });
  }

  if (value && typeof value === "object") {
    const sanitizedEntries: Array<[string, unknown]> = [];

    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveRawKey(key)) {
        sanitizedEntries.push([key, REDACTED_SECRET]);
        continue;
      }

      const sanitizedEntry = sanitizeRawMetadataValue(entry);
      if (sanitizedEntry !== undefined) {
        sanitizedEntries.push([key, sanitizedEntry]);
      }
    }

    return Object.fromEntries(sanitizedEntries);
  }

  if (typeof value === "string") {
    if (looksSensitiveStringValue(value)) {
      return REDACTED_SECRET;
    }

    return USER_PATH_PATTERNS.some((pattern) => pattern.test(value))
      ? REDACTED_PATH
      : value;
  }

  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }

  return value;
}

export function compactRecord(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function isSensitiveRawKey(key: string): boolean {
  const collapsed = collapseRawKey(key);

  if (!collapsed) {
    return false;
  }

  if (SENSITIVE_EXACT_RAW_KEYS.has(collapsed)) {
    return true;
  }

  if (SENSITIVE_COLLAPSED_SUBSTRINGS.some((pattern) => collapsed.includes(pattern))) {
    return true;
  }

  const parts = tokenizeRawKeyParts(key);
  const partSet = new Set(parts);

  if (SENSITIVE_TOKENIZED_PART_KEYS.some((part) => partSet.has(part))) {
    return true;
  }

  return SENSITIVE_PART_COMBINATION_RULES.some((rule) =>
    matchesSensitivePartCombinationRule(parts, partSet, rule),
  );
}

function looksSensitiveStringValue(value: string): boolean {
  return SENSITIVE_STRING_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function collapseRawKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function tokenizeRawKeyParts(key: string): string[] {
  return key
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((part) => part.length > 0);
}

function matchesSensitivePartCombinationRule(
  parts: ReadonlyArray<string>,
  partSet: ReadonlySet<string>,
  rule: SensitivePartCombinationRule,
): boolean {
  if (!rule.required.every((part) => partSet.has(part))) {
    return false;
  }

  if (!rule.anyOf.some((part) => partSet.has(part))) {
    return false;
  }

  if (rule.allowOnlyRequired === true) {
    const allowedParts = new Set([...rule.required, ...rule.anyOf]);
    return parts.every((part) => allowedParts.has(part));
  }

  return true;
}
