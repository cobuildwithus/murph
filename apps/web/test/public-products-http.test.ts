import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { InvalidJsonObjectBodyError } from "../src/lib/http";

vi.mock("next/server", () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      const headers = new Headers(init?.headers);
      headers.set("content-type", "application/json");
      return new MockNextResponse(JSON.stringify(body), { ...init, headers });
    }
  }
  return { NextResponse: MockNextResponse };
});

type PublicProductsHttpModule = typeof import("../src/lib/public-products/http");

let http: PublicProductsHttpModule;

describe("public product HTTP boundary", () => {
  beforeAll(async () => {
    http = await import("../src/lib/public-products/http");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts JSON with an optional charset and rejects every other media type", () => {
    expect(() => http.requirePublicProductJsonContentType(new Request("https://example.test", {
      headers: { "content-type": "application/json; charset=utf-8" },
    }))).not.toThrow();

    for (const contentType of [undefined, "text/plain", "application/problem+json"]) {
      const headers = contentType ? { "content-type": contentType } : undefined;
      expect(() => http.requirePublicProductJsonContentType(new Request(
        "https://example.test",
        { headers },
      ))).toThrow(http.PublicProductsHttpError);
    }
  });

  it("returns the stable error envelope for expected parsing failures", async () => {
    const cases: Array<{
      error: Error;
      code: string;
      status: number;
    }> = [
      { error: new SyntaxError("private query text"), code: "INVALID_JSON", status: 400 },
      {
        error: new RangeError("Request body exceeded 4096 bytes."),
        code: "REQUEST_BODY_TOO_LARGE",
        status: 413,
      },
      {
        error: new InvalidJsonObjectBodyError(),
        code: "INVALID_REQUEST",
        status: 400,
      },
    ];

    for (const testCase of cases) {
      const handler = http.withPublicProductsJsonError(async () => {
        throw testCase.error;
      });
      const response = await handler();

      expect(response.status).toBe(testCase.status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      await expect(response.json()).resolves.toEqual({
        error: {
          code: testCase.code,
          message: expect.any(String),
          retryable: false,
        },
      });
    }
  });

  it("maps unexpected type errors to a fixed 500 boundary", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = http.withPublicProductsJsonError(async () => {
      throw new TypeError("private implementation detail");
    });

    const response = await handler();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
        retryable: false,
      },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Public product API request failed.",
      expect.objectContaining({ boundary: "public-products" }),
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      "private implementation detail",
    );
  });

  it("maps availability errors to retryable 503 without logging source text", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = http.withPublicProductsJsonError(async (_request: Request) => {
      throw new http.PublicProductDataUnavailableError();
    });

    const response = await handler(new Request("https://example.test/api/public/v1/products/search", {
      body: JSON.stringify({ query: "private query text" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LABELS_UNAVAILABLE",
        message: "Product labels are unavailable right now.",
        retryable: true,
      },
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("private query text");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("MURPH_LABELS_DB_URL");
  });

  it("uses bounded cache policies on successful responses", () => {
    const detail = http.publicProductsJsonOk(
      { ok: true },
      { cacheControl: http.PUBLIC_PRODUCT_DETAIL_CACHE_CONTROL },
    );
    const openapi = http.publicProductsJsonOk(
      { openapi: "3.1.0" },
      { cacheControl: http.PUBLIC_PRODUCT_OPENAPI_CACHE_CONTROL },
    );

    expect(detail.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
    );
    expect(openapi.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    );
    expect(detail.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
