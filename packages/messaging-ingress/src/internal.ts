const LOCAL_UNIX_PATH_ROOTS = [
  "Users",
  "Volumes",
  "dev",
  "etc",
  "home",
  "media",
  "mnt",
  "opt",
  "private",
  "root",
  "srv",
  "tmp",
  "usr",
  "var",
] as const;
const LOCAL_UNIX_PATH_SUBSTRING_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9+.-])((?:\\/(?:${LOCAL_UNIX_PATH_ROOTS.join("|")}))(?:\\/[^\\r\\n"'<>|]*)?)`,
  "gu",
);
const LOCAL_WINDOWS_PATH_SUBSTRING_PATTERN =
  /(^|[^A-Za-z0-9+.-])([A-Za-z]:\\(?:[^\r\n"'<>|]*))/gu;
const PLACEHOLDER_HOME_UNIX_PATH_SUBSTRING_PATTERN =
  /(^|[^A-Za-z0-9+.-])(<HOME_DIR>\/(?:[^\r\n"'<>|]*))/gu;
const PLACEHOLDER_HOME_WINDOWS_PATH_SUBSTRING_PATTERN =
  /(^|[^A-Za-z0-9+.-])(<HOME_DIR>\\(?:[^\r\n"'<>|]*))/gu;
const LOCAL_PATH_TRAILING_PUNCTUATION_PATTERN = /[.,;:!?)}\]]+$/u;
const NON_PATH_TAIL_LEAD_WORDS = new Set([
  "after",
  "and",
  "as",
  "at",
  "before",
  "because",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "since",
  "then",
  "to",
  "via",
  "while",
  "with",
]);
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

const ISO_TIMESTAMP_ZONE_SUFFIX = /(?:[Zz]|[+-]\d{2}:?\d{2})$/u;

export function toIsoTimestamp(value: Date | string | number): string {
  if (typeof value === "string" && !ISO_TIMESTAMP_ZONE_SUFFIX.test(value)) {
    throw new TypeError(`Invalid ISO timestamp: ${value} (missing time zone)`);
  }

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

    return sanitizeLocalPathSubstrings(value);
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

function sanitizeLocalPathSubstrings(value: string): string {
  return redactMatchedLocalPaths(
    redactMatchedLocalPaths(
      redactMatchedLocalPaths(
        redactMatchedLocalPaths(
          value,
          PLACEHOLDER_HOME_UNIX_PATH_SUBSTRING_PATTERN,
          "/",
        ),
        LOCAL_UNIX_PATH_SUBSTRING_PATTERN,
        "/",
      ),
      PLACEHOLDER_HOME_WINDOWS_PATH_SUBSTRING_PATTERN,
      "\\",
    ),
    LOCAL_WINDOWS_PATH_SUBSTRING_PATTERN,
    "\\",
  );
}

function redactMatchedLocalPaths(value: string, pattern: RegExp, separator: "/" | "\\"): string {
  let redacted = value;

  while (true) {
    pattern.lastIndex = 0;
    const next = redacted.replace(pattern, (_match, prefix: string, candidate: string) => {
      const { path, suffix } = splitLocalPathCandidate(candidate, separator);
      return path ? `${prefix}${REDACTED_PATH}${suffix}` : `${prefix}${candidate}`;
    });

    if (next === redacted) {
      return redacted;
    }

    redacted = next;
  }
}

function splitLocalPathCandidate(
  candidate: string,
  separator: "/" | "\\",
): { path: string; suffix: string } {
  const punctuationMatch = candidate.match(LOCAL_PATH_TRAILING_PUNCTUATION_PATTERN);
  const trailingPunctuation = punctuationMatch ? punctuationMatch[0] : "";
  const coreCandidate = trailingPunctuation
    ? candidate.slice(0, -trailingPunctuation.length)
    : candidate;
  let path = coreCandidate;
  let suffix = trailingPunctuation;
  let searchIndex = 0;

  while (true) {
    const spaceIndex = path.indexOf(" ", searchIndex);

    if (spaceIndex === -1) {
      return { path, suffix };
    }

    const remainder = path.slice(spaceIndex + 1);
    if (!remainder.includes(separator) && shouldSplitLocalPathRemainder(remainder)) {
      return {
        path: path.slice(0, spaceIndex),
        suffix: `${path.slice(spaceIndex)}${suffix}`,
      };
    }

    searchIndex = spaceIndex + 1;
  }
}

function shouldSplitLocalPathRemainder(remainder: string): boolean {
  const trimmed = remainder.trimStart();

  if (!trimmed) {
    return false;
  }

  const firstWord = trimmed.split(/\s+/u, 1)[0]?.toLowerCase() ?? "";
  if (NON_PATH_TAIL_LEAD_WORDS.has(firstWord)) {
    return true;
  }

  if (/[._()[\]-]/u.test(trimmed) || /[A-Z0-9]/u.test(trimmed)) {
    return false;
  }

  return trimmed.split(/\s+/u).filter(Boolean).length > 1;
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
