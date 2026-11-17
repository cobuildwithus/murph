import { ContractValidationError } from "@murphai/contracts/validation-error";
import { parseInput, RequestInputError, RequestBodyTooLargeError } from "@murphai/hosted-execution/request-input";
export class InvalidJsonInputError extends RequestInputError {}

export function parseJsonInput(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) throw new InvalidJsonInputError(error.message, { cause: error });
    throw error;
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status,
  });
}

export function jsonError(error: string, status: number): Response {
  return json({ error }, status);
}

export function methodNotAllowed(): Response {
  return jsonError("Method not allowed.", 405);
}

export function notFound(): Response {
  return jsonError("Not found", 404);
}

export function unauthorized(): Response {
  return jsonError("Unauthorized", 401);
}

export interface JsonBodyReadOptions {
  limitBytes?: number;
}

export async function readJsonObject(
  request: Request,
  options: JsonBodyReadOptions = {},
): Promise<Record<string, unknown>> {
  return parseInput(parseJsonInput(await readRequestBodyText(request, options)), requireJsonObject);
}

export async function readOptionalJsonObject(
  request: Request,
  options: JsonBodyReadOptions = {},
): Promise<Record<string, unknown>> {
  const payload = await readRequestBodyText(request, options);

  if (!payload.trim()) {
    return {};
  }

  return parseInput(parseJsonInput(payload), requireJsonObject);
}

export async function readRequestBodyText(
  request: Request,
  options: JsonBodyReadOptions,
): Promise<string> {
  return new TextDecoder().decode(await readRequestBodyBytes(request, options));
}

export async function readRequestBodyBytes(
  request: Request,
  options: JsonBodyReadOptions,
): Promise<Uint8Array> {
  if (options.limitBytes === undefined) {
    return new Uint8Array(await request.arrayBuffer());
  }

  const declaredContentLength = request.headers.get("content-length");
  if (declaredContentLength) {
    const parsedContentLength = Number.parseInt(declaredContentLength, 10);
    if (Number.isFinite(parsedContentLength) && parsedContentLength > options.limitBytes) {
      throw new RequestBodyTooLargeError(options.limitBytes);
    }
  }

  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > options.limitBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(options.limitBytes);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

export function requireJsonObject(parsed: unknown): Record<string, unknown> {
  if (!isJsonObject(parsed)) {
    throw new ContractValidationError("Request body must be a JSON object.");
  }

  return parsed;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
