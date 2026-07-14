export class ClinicalResponseBodyLimitError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Clinical provider response exceeded ${limitBytes} bytes.`);
    this.name = "ClinicalResponseBodyLimitError";
  }
}

/** Reads at most limitBytes and cancels the provider stream before retaining an
 * over-limit body. Content-Length is only an early rejection hint; the stream
 * remains authoritative when the header is missing or underreported. */
export async function readClinicalResponseBytes(
  response: Response,
  limitBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 1) {
    throw new RangeError("Clinical response byte limit must be a positive safe integer.");
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength
    && /^\d+$/u.test(declaredLength)
    && BigInt(declaredLength) > BigInt(limitBytes)
  ) {
    await cancelResponseBody(response);
    throw new ClinicalResponseBodyLimitError(limitBytes);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (totalBytes + chunk.value.byteLength > limitBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the deterministic limit error if provider cancellation fails.
        }
        throw new ClinicalResponseBodyLimitError(limitBytes);
      }
      chunks.push(chunk.value);
      totalBytes += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The size violation remains authoritative even if cancellation races EOF.
  }
}
