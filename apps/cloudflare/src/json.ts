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

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  return requireJsonObject(await request.json());
}

export async function readOptionalJsonObject(request: Request): Promise<Record<string, unknown>> {
  const payload = await request.text();

  if (!payload.trim()) {
    return {};
  }

  return requireJsonObject(JSON.parse(payload));
}

export function requireJsonObject(parsed: unknown): Record<string, unknown> {
  if (!isJsonObject(parsed)) {
    throw new TypeError("Request body must be a JSON object.");
  }

  return parsed;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
