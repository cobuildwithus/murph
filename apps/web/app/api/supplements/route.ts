import { timingSafeEqual } from "node:crypto";

import {
  getSupplementById,
  getSupplementByUpc,
  searchSupplements,
} from "@/src/lib/supplements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_API_KEY_ENV = "MURPH_DATA_API_KEY";

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

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? 20);

  if (!Number.isFinite(parsed)) {
    return 20;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), 50);
}

export async function GET(request: Request): Promise<Response> {
  let unauthorized: Response | null;

  try {
    unauthorized = requireApiKey(request);
  } catch {
    return json({ error: "supplements_api_unconfigured" }, { status: 500 });
  }

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
      const item = await getSupplementById(id);

      if (!item) {
        return json({ error: "not_found" }, { status: 404 });
      }

      return json({ item });
    }

    if (upc) {
      const item = await getSupplementByUpc(upc);

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
    console.error("supplements_api_failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return json({ error: "supplements_api_failed" }, { status: 500 });
  }
}
