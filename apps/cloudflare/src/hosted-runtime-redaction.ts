export function redactHostedRuntimeDiagnosticText(value: string): string {
  return value
    .replace(
      /\busers\/[^/\s)"'<>]+\/workspace-snapshots\/[^\s)"'<>]+/gu,
      "users/<redacted>/workspace-snapshots/<redacted>",
    )
    .replace(/\bhsn_[A-Za-z0-9_:-]+\b/gu, "<redacted-hosted-namespace>")
    .replace(/\bmember_[A-Za-z0-9_:-]+\b/gu, "<redacted-user-id>")
    .replace(/\bsnapshot_[A-Za-z0-9_:-]+\b/gu, "<redacted-snapshot-id>")
    .replace(/\b(?:root_key|wrapped_data_key)[A-Za-z0-9_:-]*\b/gu, "<redacted-key-id>")
    .replace(
      /file:\/\/\/(?:Users|home|root|tmp|var|private\/var)\/[^\s)"']+/gu,
      "file://<redacted-path>",
    )
    .replace(
      /(?:\/Users|\/home|\/root|\/tmp|\/var|\/private\/var)\/[^\s)"']+/gu,
      "<redacted-path>",
    )
    .replace(/[A-Za-z]:\\[^\s)"']+/gu, "<redacted-path>")
    .replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu,
      "<redacted-email>",
    )
    .replace(/\+\d{8,15}\b/gu, "<redacted-phone>")
    .replace(
      /\b(authorization)\b\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/giu,
      "$1=Bearer <redacted>",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer <redacted>")
    .replace(
      /\b(X-Amz-(?:Credential|Signature|Security-Token)=)[^&\s"'<>]+/giu,
      "$1<redacted>",
    )
    .replace(
      /(?<![-A-Za-z0-9_])\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PRIVATE_JWK|PRIVATE_KEY|PASSWORD)[A-Z0-9_]*)=([^\s'"]+)/giu,
      "$1=<redacted>",
    )
    .replace(
      /(?<![-A-Za-z0-9_])(["']?)([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PRIVATE_JWK|PRIVATE_KEY|PASSWORD)[A-Z0-9_]*)(\1\s*:\s*)(?:"[^"]*"|'[^']+'|[^\s,}\]]+)/giu,
      "$1$2$3<redacted>",
    )
    .replace(
      /\b((?:HOSTED_ASSISTANT_)?(?:BASE_URL|PROVIDER|MODEL)|base_url|env_key|model_provider|wire_api)\s*[:=]\s*(?:"[^"]+"|'[^']+'|\S+)/giu,
      "$1=<redacted>",
    );
}

export function readHostedRuntimeSafeErrorText(error: unknown): string | null {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current) && messages.length < 4) {
    seen.add(current);
    const message = readHostedRuntimeErrorMessage(current);
    if (message && !messages.includes(message)) {
      messages.push(message);
    }
    current = typeof current === "object" && "cause" in current
      ? (current as { cause?: unknown }).cause
      : null;
  }

  return messages.length > 0 ? messages.join(" | ") : null;
}

function readHostedRuntimeErrorMessage(error: unknown): string | null {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : null;
  if (!raw?.trim()) {
    return null;
  }

  const redacted = redactHostedRuntimeDiagnosticText(
    raw.replace(/\bhttps?:\/\/[^\s)"'<>]+/giu, "<redacted-url>"),
  )
    .trim();
  return redacted ? redacted.slice(0, 1_000) : null;
}

export function redactHostedRuntimeDiagnosticDetails(
  details: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!details) {
    return null;
  }

  const redacted = redactHostedRuntimeDiagnosticValue(details, 0);
  return redacted && typeof redacted === "object" && !Array.isArray(redacted)
    ? redacted as Record<string, unknown>
    : null;
}

function redactHostedRuntimeDiagnosticValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return redactHostedRuntimeDiagnosticText(value);
  }

  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "number"
  ) {
    return value;
  }

  if (depth >= 4) {
    return "[redacted]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactHostedRuntimeDiagnosticValue(entry, depth + 1));
  }

  if (typeof value !== "object") {
    return null;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      isSecretLikeHostedRuntimeDiagnosticKey(key)
        ? "[redacted]"
        : redactHostedRuntimeDiagnosticValue(entry, depth + 1),
    ]),
  );
}

function isSecretLikeHostedRuntimeDiagnosticKey(key: string): boolean {
  return /(?:API_KEY|TOKEN|SECRET|PRIVATE_JWK|PRIVATE_KEY|PASSWORD)/iu.test(key);
}
