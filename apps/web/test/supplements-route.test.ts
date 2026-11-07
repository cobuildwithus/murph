import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupplementById: vi.fn(),
  getSupplementByUpc: vi.fn(),
  searchSupplements: vi.fn(),
}));

vi.mock("@/src/lib/supplements", () => ({
  getSupplementById: mocks.getSupplementById,
  getSupplementByUpc: mocks.getSupplementByUpc,
  searchSupplements: mocks.searchSupplements,
}));

type SupplementsRouteModule = typeof import("../app/api/supplements/route");

let supplementsRoute: SupplementsRouteModule;

// Shared parsing, limits, deduplication, and concurrency are covered through the
// same production handler in foods-route.test.ts. Keep supplement wiring, lookup
// policy, authorization, and error-code coverage here.
describe("supplements API route", () => {
  beforeAll(async () => {
    supplementsRoute = await import("../app/api/supplements/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MURPH_DATA_API_KEY = "test-data-api-key";
  });

  it("fails closed when the bearer token is missing", async () => {
    const response = await supplementsRoute.GET(
      new Request("https://web.example.test/api/supplements?q=creatine"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mocks.searchSupplements).not.toHaveBeenCalled();
  });

  it("fails closed when the route key is not configured", async () => {
    delete process.env.MURPH_DATA_API_KEY;

    const response = await supplementsRoute.GET(
      new Request("https://web.example.test/api/supplements?q=creatine", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "supplements_api_unconfigured",
    });
  });

  it("searches labels with bounded limits", async () => {
    mocks.searchSupplements.mockResolvedValue([
      {
        id: "82118",
        dataOrigin: "dsld",
        dataOriginId: "82118",
        name: "Creatine Monohydrate",
        brand: "Example Brand",
        upc: "123456789012",
        offMarket: false,
        label: {
          ingredients: ["Creatine Monohydrate"],
          supplementFacts: {
            servingSize: "1 scoop",
          },
        },
      },
    ]);

    const response = await supplementsRoute.GET(
      new Request(
        "https://web.example.test/api/supplements?q=creatine&limit=99&includeOffMarket=true",
        {
          headers: {
            authorization: "Bearer test-data-api-key",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.searchSupplements).toHaveBeenCalledWith({
      q: "creatine",
      limit: 50,
      includeOffMarket: true,
    });
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: "82118",
          dataOrigin: "dsld",
          dataOriginId: "82118",
          name: "Creatine Monohydrate",
          brand: "Example Brand",
          upc: "123456789012",
          offMarket: false,
          label: {
            ingredients: ["Creatine Monohydrate"],
            supplementFacts: {
              servingSize: "1 scoop",
            },
          },
        },
      ],
    });
  });

  it("fetches a label by DSLD id before search parameters", async () => {
    mocks.getSupplementById.mockResolvedValue({
      id: "82118",
      dataOrigin: "dsld",
      dataOriginId: "82118",
      name: "Creatine Monohydrate",
      brand: null,
      upc: null,
      offMarket: false,
      label: { id: 82118 },
    });

    const response = await supplementsRoute.GET(
      new Request("https://web.example.test/api/supplements?id=82118&q=ignored&includeOffMarket=true", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getSupplementById).toHaveBeenCalledWith({
      id: "82118",
      includeOffMarket: true,
    });
    expect(mocks.searchSupplements).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      item: {
        id: "82118",
        dataOrigin: "dsld",
        dataOriginId: "82118",
        name: "Creatine Monohydrate",
        brand: null,
        upc: null,
        offMarket: false,
        label: { id: 82118 },
      },
    });
  });

  it("fetches a label by UPC and returns not_found for misses", async () => {
    mocks.getSupplementByUpc.mockResolvedValue(null);

    const response = await supplementsRoute.GET(
      new Request("https://web.example.test/api/supplements?upc=123-456", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.getSupplementByUpc).toHaveBeenCalledWith({
      upc: "123-456",
      includeOffMarket: false,
    });
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("resolves exact UPCs from GET q before text search", async () => {
    const upcItem = {
      id: "supplement-upc",
      dataOrigin: "dsld",
      dataOriginId: "supplement-upc",
      name: "UPC Supplement",
      brand: null,
      upc: "123456789012",
      offMarket: false,
      label: {},
    };
    mocks.getSupplementById.mockResolvedValue(null);
    mocks.getSupplementByUpc.mockResolvedValue(upcItem);

    const response = await supplementsRoute.GET(
      new Request("https://web.example.test/api/supplements?q=123456789012", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getSupplementById).toHaveBeenCalledWith({
      id: "123456789012",
      includeOffMarket: false,
    });
    expect(mocks.getSupplementByUpc).toHaveBeenCalledWith({
      upc: "123456789012",
      includeOffMarket: false,
    });
    expect(mocks.searchSupplements).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      items: [upcItem],
    });
  });

  it("falls back to text search for non-GTIN numeric GET q misses", async () => {
    const searchItem = {
      id: "supplement-search",
      dataOrigin: "dsld",
      dataOriginId: "supplement-search",
      name: "Formula 365",
      brand: null,
      upc: null,
      offMarket: false,
      label: {},
    };
    mocks.getSupplementById.mockResolvedValue(null);
    mocks.searchSupplements.mockResolvedValue([searchItem]);

    const response = await supplementsRoute.GET(
      new Request("https://web.example.test/api/supplements?q=365", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getSupplementById).toHaveBeenCalledWith({
      id: "365",
      includeOffMarket: false,
    });
    expect(mocks.searchSupplements).toHaveBeenCalledWith({
      q: "365",
      limit: 1,
      includeOffMarket: false,
    });
    await expect(response.json()).resolves.toEqual({
      items: [searchItem],
    });
  });

  it("falls back to text search for GTIN-shaped GET q misses", async () => {
    const searchItem = {
      id: "supplement-search-gtin",
      dataOrigin: "dsld",
      dataOriginId: "supplement-search-gtin",
      name: "UPC Shaped Search Supplement",
      brand: null,
      upc: null,
      offMarket: false,
      label: {},
    };
    mocks.getSupplementById.mockResolvedValue(null);
    mocks.getSupplementByUpc.mockResolvedValue(null);
    mocks.searchSupplements.mockResolvedValue([searchItem]);

    const response = await supplementsRoute.GET(
      new Request("https://web.example.test/api/supplements?q=123456789012", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getSupplementById).toHaveBeenCalledWith({
      id: "123456789012",
      includeOffMarket: false,
    });
    expect(mocks.getSupplementByUpc).toHaveBeenCalledWith({
      upc: "123456789012",
      includeOffMarket: false,
    });
    expect(mocks.searchSupplements).toHaveBeenCalledWith({
      q: "123456789012",
      limit: 1,
      includeOffMarket: false,
    });
    await expect(response.json()).resolves.toEqual({
      items: [searchItem],
    });
  });

  it("returns a safe failure payload when the query layer throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.searchSupplements.mockRejectedValue(new Error("database unavailable"));

    const response = await supplementsRoute.GET(
      new Request("https://web.example.test/api/supplements?q=creatine", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "supplements_api_failed",
    });
    expect(consoleError).toHaveBeenCalledWith("supplements_api_failed", {
      durationMs: expect.any(Number),
      errorCode: "supplements_api_failed",
      errorType: "Error",
      genericOnly: false,
      includeOffMarket: false,
      limit: 1,
      method: "GET",
      nutritionOnly: false,
      operation: "search",
      queryLength: 8,
    });
  });

  it("returns an unconfigured error when contaminant schema is missing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("product contaminant schema is missing");
    error.name = "ProductContaminantSchemaMissingError";
    mocks.searchSupplements.mockRejectedValue(error);

    const response = await supplementsRoute.GET(
      new Request("https://web.example.test/api/supplements?q=creatine", {
        headers: {
          authorization: ["Bearer", "test-data-api-key"].join(" "),
        },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "supplements_api_unconfigured",
    });
    expect(consoleError).toHaveBeenCalledWith("supplements_api_unconfigured", {
      errorName: "ProductContaminantSchemaMissingError",
    });
  });

  it("batch searches labels with one authorized POST", async () => {
    mocks.searchSupplements.mockImplementation(async (input: { q: string }) => [
      {
        id: input.q === "creatine" ? "82118" : "dailymed:magnesium",
        dataOrigin: input.q === "creatine" ? "dsld" : "dailymed",
        dataOriginId: input.q === "creatine" ? "82118" : "magnesium",
        name: input.q === "creatine" ? "Creatine Monohydrate" : "Magnesium Glycinate",
        brand: null,
        upc: null,
        offMarket: false,
        label: {
          ingredients: [
            input.q === "creatine" ? "Creatine Monohydrate" : "Magnesium Glycinate",
          ],
          supplementFacts: {
            servingSize: input.q === "creatine" ? "1 scoop" : "2 capsules",
          },
        },
      },
    ]);

    const response = await supplementsRoute.POST(
      new Request("https://web.example.test/api/supplements", {
        body: JSON.stringify({
          queries: [" creatine ", "magnesium"],
          limit: 99,
          includeOffMarket: true,
        }),
        headers: {
          authorization: "Bearer test-data-api-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.searchSupplements).toHaveBeenCalledTimes(2);
    expect(mocks.searchSupplements).toHaveBeenNthCalledWith(1, {
      q: "creatine",
      limit: 50,
      includeOffMarket: true,
    });
    expect(mocks.searchSupplements).toHaveBeenNthCalledWith(2, {
      q: "magnesium",
      limit: 50,
      includeOffMarket: true,
    });
    await expect(response.json()).resolves.toEqual({
      includeOffMarket: true,
      limit: 50,
      results: [
        {
          query: "creatine",
          items: [
            {
              id: "82118",
              dataOrigin: "dsld",
              dataOriginId: "82118",
              name: "Creatine Monohydrate",
              brand: null,
              upc: null,
              offMarket: false,
              label: {
                ingredients: ["Creatine Monohydrate"],
                supplementFacts: {
                  servingSize: "1 scoop",
                },
              },
            },
          ],
        },
        {
          query: "magnesium",
          items: [
            {
              id: "dailymed:magnesium",
              dataOrigin: "dailymed",
              dataOriginId: "magnesium",
              name: "Magnesium Glycinate",
              brand: null,
              upc: null,
              offMarket: false,
              label: {
                ingredients: ["Magnesium Glycinate"],
                supplementFacts: {
                  servingSize: "2 capsules",
                },
              },
            },
          ],
        },
      ],
    });
  });

  it("batch lookup resolves exact ids and UPCs before text search", async () => {
    const exactItem = {
      id: "dsld:123",
      dataOrigin: "dsld",
      dataOriginId: "123",
      name: "Exact Supplement",
      brand: "Example Brand",
      upc: null,
      offMarket: false,
      label: {
        dsldId: "123",
      },
    };
    const upcItem = {
      id: "supplement-upc",
      dataOrigin: "dsld",
      dataOriginId: "supplement-upc",
      name: "UPC Supplement",
      brand: null,
      upc: "123456789012",
      offMarket: false,
      label: {},
    };
    const searchItem = {
      id: "supplement-search",
      dataOrigin: "dsld",
      dataOriginId: "supplement-search",
      name: "Search Supplement",
      brand: null,
      upc: null,
      offMarket: false,
      label: {},
    };
    mocks.getSupplementById.mockImplementation(
      async (input: { id: string }) =>
        input.id === "dsld:123" ? exactItem : null,
    );
    mocks.getSupplementByUpc.mockImplementation(
      async (input: { upc: string }) =>
        input.upc === "123456789012" ? upcItem : null,
    );
    mocks.searchSupplements.mockResolvedValue([searchItem]);

    const response = await supplementsRoute.POST(
      new Request("https://web.example.test/api/supplements", {
        body: JSON.stringify({
          queries: [
            " dsld:123 ",
            "123456789012",
            "000000000000",
            "creatine",
          ],
        }),
        headers: {
          authorization: "Bearer test-data-api-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getSupplementById).toHaveBeenCalledWith({
      id: "dsld:123",
      includeOffMarket: false,
    });
    expect(mocks.getSupplementById).toHaveBeenCalledWith({
      id: "123456789012",
      includeOffMarket: false,
    });
    expect(mocks.getSupplementByUpc).toHaveBeenCalledWith({
      upc: "123456789012",
      includeOffMarket: false,
    });
    expect(mocks.getSupplementById).toHaveBeenCalledWith({
      id: "000000000000",
      includeOffMarket: false,
    });
    expect(mocks.getSupplementByUpc).toHaveBeenCalledWith({
      upc: "000000000000",
      includeOffMarket: false,
    });
    expect(mocks.searchSupplements).toHaveBeenCalledTimes(2);
    expect(mocks.searchSupplements).toHaveBeenCalledWith({
      q: "000000000000",
      limit: 1,
      includeOffMarket: false,
    });
    expect(mocks.searchSupplements).toHaveBeenCalledWith({
      q: "creatine",
      limit: 1,
      includeOffMarket: false,
    });
    await expect(response.json()).resolves.toEqual({
      includeOffMarket: false,
      limit: 1,
      results: [
        {
          query: "dsld:123",
          items: [exactItem],
        },
        {
          query: "123456789012",
          items: [upcItem],
        },
        {
          query: "000000000000",
          items: [searchItem],
        },
        {
          query: "creatine",
          items: [searchItem],
        },
      ],
    });
  });

  it("fails closed when POST authorization is missing", async () => {
    const response = await supplementsRoute.POST(
      new Request("https://web.example.test/api/supplements", {
        body: JSON.stringify({
          queries: ["creatine"],
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mocks.searchSupplements).not.toHaveBeenCalled();
  });

  it("returns a safe failure payload when a batch query throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.searchSupplements.mockRejectedValue(new Error("database unavailable"));

    const response = await supplementsRoute.POST(
      new Request("https://web.example.test/api/supplements", {
        body: JSON.stringify({
          queries: ["creatine"],
        }),
        headers: {
          authorization: "Bearer test-data-api-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "supplements_api_failed",
    });
    expect(consoleError).toHaveBeenCalledWith("supplements_api_failed", {
      batchConcurrency: 3,
      durationMs: expect.any(Number),
      errorCode: "supplements_api_failed",
      errorType: "Error",
      genericOnly: false,
      includeOffMarket: false,
      limit: 1,
      maxQueryLength: 8,
      method: "POST",
      nutritionOnly: false,
      operation: "batch_search",
      queryCount: 1,
      uniqueQueryCount: 1,
    });
  });
});
