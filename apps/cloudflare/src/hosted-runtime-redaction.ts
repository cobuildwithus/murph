export function redactHostedRuntimeDiagnosticText(value: string): string {
  return value
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
      /\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PRIVATE_JWK|PRIVATE_KEY|PASSWORD)[A-Z0-9_]*)=([^\s'"]+)/giu,
      "$1=<redacted>",
    )
    .replace(
      /\b((?:HOSTED_ASSISTANT_)?(?:BASE_URL|PROVIDER|MODEL)|base_url|env_key|model_provider|wire_api)\s*[:=]\s*(?:"[^"]+"|'[^']+'|\S+)/giu,
      "$1=<redacted>",
    );
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
      redactHostedRuntimeDiagnosticValue(entry, depth + 1),
    ]),
  );
}
