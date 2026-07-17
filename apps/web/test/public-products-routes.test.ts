import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

const mocks = vi.hoisted(() => ({
  getPublicProductDetail: vi.fn(),
  searchPublicProducts: vi.fn(),
}));

vi.mock("@/src/lib/public-products/service", () => mocks);

type SearchRoute = typeof import("../app/api/public/v1/products/search/route");
type DetailRoute = typeof import("../app/api/public/v1/products/[productRef]/route");
type OpenApiRoute = typeof import("../app/api/public/v1/openapi.json/route");

let searchRoute: SearchRoute;
let detailRoute: DetailRoute;
let openApiRoute: OpenApiRoute;

describe("public product API routes", () => {
  beforeAll(async () => {
    searchRoute = await import("../app/api/public/v1/products/search/route");
    detailRoute = await import("../app/api/public/v1/products/[productRef]/route");
    openApiRoute = await import("../app/api/public/v1/openapi.json/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchPublicProducts.mockResolvedValue({
      schema: "murph.public-products.v1",
      results: { supplements: [], foods: [] },
    });
    mocks.getPublicProductDetail.mockResolvedValue(null);
  });

  it("parses a POST body, applies bounded defaults, and never echoes the query", async () => {
    const response = await searchRoute.POST(new Request(
      "https://example.test/api/public/v1/products/search",
      {
        body: JSON.stringify({ query: "  example product  " }),
        headers: { "content-type": "application/json; charset=utf-8" },
        method: "POST",
      },
    ));

    expect(mocks.searchPublicProducts).toHaveBeenCalledWith({
      query: "example product",
      kinds: ["supplement", "food"],
      limitPerKind: 6,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.text()).not.toContain("example product");
  });

  it.each([
    {
      name: "missing media type",
      request: () => new Request("https://example.test/api/public/v1/products/search", {
        body: JSON.stringify({ query: "example product" }),
        method: "POST",
      }),
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    },
    {
      name: "malformed JSON",
      request: () => new Request("https://example.test/api/public/v1/products/search", {
        body: "{",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      code: "INVALID_JSON",
      status: 400,
    },
    {
      name: "non-object JSON",
      request: () => new Request("https://example.test/api/public/v1/products/search", {
        body: JSON.stringify(["private value"]),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      code: "INVALID_REQUEST",
      status: 400,
    },
    {
      name: "invalid request fields",
      request: () => new Request("https://example.test/api/public/v1/products/search", {
        body: JSON.stringify({ query: "x", extra: "private value" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      code: "INVALID_REQUEST",
      status: 400,
    },
    {
      name: "oversized declared body",
      request: () => new Request("https://example.test/api/public/v1/products/search", {
        body: JSON.stringify({ query: "example product" }),
        headers: {
          "content-length": "4097",
          "content-type": "application/json",
        },
        method: "POST",
      }),
      code: "REQUEST_BODY_TOO_LARGE",
      status: 413,
    },
  ])("returns a stable error for $name", async ({ request, code, status }) => {
    const response = await searchRoute.POST(request());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      error: {
        code,
        message: expect.any(String),
        retryable: false,
      },
    });
    expect(mocks.searchPublicProducts).not.toHaveBeenCalled();
  });

  it("does not misclassify an unexpected service type error as client input", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.searchPublicProducts.mockRejectedValueOnce(
      new TypeError("private implementation detail"),
    );

    const response = await searchRoute.POST(new Request(
      "https://example.test/api/public/v1/products/search",
      {
        body: JSON.stringify({ query: "example product" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
        retryable: false,
      },
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      "private implementation detail",
    );
  });

  it("returns a quiet 404 for an unavailable opaque product ref", async () => {
    const response = await detailRoute.GET(
      new Request("https://example.test/api/public/v1/products/missing"),
      { params: Promise.resolve({ productRef: "missing" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRODUCT_NOT_FOUND",
        message: "Product not found.",
        retryable: false,
      },
    });
  });

  it("serves validated detail JSON with shared-cache bounds", async () => {
    mocks.getPublicProductDetail.mockResolvedValue(publicProductDetail());

    const response = await detailRoute.GET(
      new Request("https://example.test/api/public/v1/products/supplement_ZHNsZDox"),
      { params: { productRef: "supplement_ZHNsZDox" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
    );
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      schema: "murph.public-products.v1",
      product: { name: "Example supplement" },
    });
  });

  it("serves the same OpenAPI document with long-lived shared caching", async () => {
    const response = await openApiRoute.GET();
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    );
    expect(document).toMatchObject({ openapi: "3.1.0" });
  });
});

function publicProductDetail() {
  return {
    productRef: "supplement_ZHNsZDox",
    kind: "supplement",
    name: "Example supplement",
    brand: "Example brand",
    upc: "12345678",
    marketStatus: "active",
    serving: null,
    ingredients: {
      structure: "unavailable",
      statement: null,
      otherStatement: null,
      active: [],
      other: [],
    },
    nutrition: { basis: "unavailable", rows: [] },
    productTests: {
      status: "no_known_product_tests",
      total: 0,
      returned: 0,
      truncated: false,
      observations: [],
      alerts: [],
    },
    source: {
      key: "dsld",
      name: "Dietary Supplement Label Database",
      recordId: "1",
      url: null,
      releaseDate: null,
      lastSeenAt: null,
      importedAt: null,
    },
    unknowns: [
      {
        code: "NO_LINKED_PRODUCT_TESTS",
        title: "No linked product tests",
        description: "This is an evidence gap, not a safety finding.",
      },
    ],
  } as const;
}
