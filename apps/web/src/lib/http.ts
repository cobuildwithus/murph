import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import { isRecord } from "./device-sync/shared";

export function jsonOk(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, { status });
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json()) as unknown;

  if (!isRecord(body)) {
    throw new TypeError("Request body must be a JSON object.");
  }

  return body;
}

export async function readOptionalJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  const body = JSON.parse(text) as unknown;

  if (!isRecord(body)) {
    throw new TypeError("Request body must be a JSON object.");
  }

  return body;
}

export async function readRawBodyBuffer(request: Request): Promise<Buffer> {
  return Buffer.from(await request.arrayBuffer());
}

export async function resolveRouteParams<TParams extends Record<string, string>>(
  params: Promise<TParams> | TParams,
): Promise<TParams> {
  return Promise.resolve(params);
}
