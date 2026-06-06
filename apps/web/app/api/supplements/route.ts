import { timingSafeEqual } from "node:crypto";

import {
  getSupplementById,
  getSupplementByUpc,
  searchSupplements,
} from "@/src/lib/supplements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_API_KEY_ENV = "MURPH_DATA_API_KEY";
const DEFAULT_SUPPLEMENTS_LIMIT = 1;
const MAX_SUPPLEMENTS_LIMIT = 50;
const MAX_BATCH_QUERIES = 10;
const MAX_BATCH_QUERY_LENGTH = 256;
const MAX_BATCH_BODY_BYTES = 8 * 1024;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");

  return Response.json(data, {
    ...init,
    headers,
  });
}

function getBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return "";
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function requireApiKey(request: Request): Response | null {
  const expected = process.env[DATA_API_KEY_ENV]?.trim();

  if (!expected) {
    throw new Error(`${DATA_API_KEY_ENV} is required`);
  }

  const received = getBearerToken(request);

  if (!received || !safeEqual(received, expected)) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

function authorizeRequest(request: Request): Response | null {
  try {
    return requireApiKey(request);
  } catch {
    return json({ error: "supplements_api_unconfigured" }, { status: 500 });
  }
}

function supplementsApiFailed(error: unknown): Response {
  console.error("supplements_api_failed", {
    errorName: error instanceof Error ? error.name : typeof error,
  });
  return json({ error: "supplements_api_failed" }, { status: 500 });
}

function parseLimit(value: string | number | null | undefined): number {
  const parsed = Number(value ?? DEFAULT_SUPPLEMENTS_LIMIT);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_SUPPLEMENTS_LIMIT;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), MAX_SUPPLEMENTS_LIMIT);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBatchQueries(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BATCH_QUERIES) {
    return null;
  }

  const queries: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }

    const query = item.trim();
    if (!query || query.length > MAX_BATCH_QUERY_LENGTH) {
      return null;
    }

    queries.push(query);
  }

  return queries;
}

async function readBatchRequestText(request: Request): Promise<string | null> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_BATCH_BODY_BYTES) {
      return null;
    }
  }

  if (!request.body) {
    return "";
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

      totalBytes += value.byteLength;
      if (totalBytes > MAX_BATCH_BODY_BYTES) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
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

  return new TextDecoder().decode(bytes);
}

export async function GET(request: Request): Promise<Response> {
  const unauthorized = authorizeRequest(request);

  if (unauthorized) {
    return unauthorized;
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id")?.trim();
  const upc = params.get("upc")?.trim();
  const q = params.get("q")?.trim();
  const limit = parseLimit(params.get("limit"));
  const includeOffMarket = params.get("includeOffMarket") === "true";

  try {
    if (id) {
      const item = await getSupplementById({
        id,
        includeOffMarket,
      });

      if (!item) {
        return json({ error: "not_found" }, { status: 404 });
      }

      return json({ item });
    }

    if (upc) {
      const item = await getSupplementByUpc({
        upc,
        includeOffMarket,
      });

      if (!item) {
        return json({ error: "not_found" }, { status: 404 });
      }

      return json({ item });
    }

    if (!q) {
      return json({ items: [] });
    }

    const items = await searchSupplements({
      includeOffMarket,
      limit,
      q,
    });

    return json({ items });
  } catch (error) {
    return supplementsApiFailed(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = authorizeRequest(request);

  if (unauthorized) {
    return unauthorized;
  }

  const bodyText = await readBatchRequestText(request);
  if (bodyText === null) {
    return json({ error: "payload_too_large" }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isRecord(payload)) {
    return json({ error: "invalid_queries" }, { status: 400 });
  }

  const queries = parseBatchQueries(payload.queries);
  if (!queries) {
    return json({ error: "invalid_queries" }, { status: 400 });
  }

  const limit = parseLimit(
    typeof payload.limit === "string" || typeof payload.limit === "number"
      ? payload.limit
      : null,
  );
  const includeOffMarket = payload.includeOffMarket === true;

  try {
    const results = await Promise.all(
      queries.map(async (q) => ({
        query: q,
        items: await searchSupplements({
          includeOffMarket,
          limit,
          q,
        }),
      })),
    );

    return json({
      includeOffMarket,
      limit,
      results,
    });
  } catch (error) {
    return supplementsApiFailed(error);
  }
}
