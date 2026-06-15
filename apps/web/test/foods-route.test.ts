import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFoodById: vi.fn(),
  getFoodByUpc: vi.fn(),
  searchFoods: vi.fn(),
}));

vi.mock("@/src/lib/foods", () => ({
  getFoodById: mocks.getFoodById,
  getFoodByUpc: mocks.getFoodByUpc,
  searchFoods: mocks.searchFoods,
}));

type FoodsRouteModule = typeof import("../app/api/foods/route");

let foodsRoute: FoodsRouteModule;

async function waitForStartedSearches(
  releases: Array<() => void>,
  expectedCount: number,
): Promise<void> {
  const startedAt = Date.now();

  while (releases.length < expectedCount) {
    if (Date.now() - startedAt > 1_000) {
      throw new Error(`timed out waiting for ${expectedCount} active searches`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  expect(releases).toHaveLength(expectedCount);
}

describe("foods API route", () => {
  beforeAll(async () => {
    foodsRoute = await import("../app/api/foods/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MURPH_DATA_API_KEY = "test-data-api-key";
  });

  it("fails closed when the bearer token is missing", async () => {
    const response = await foodsRoute.GET(
      new Request("https://web.example.test/api/foods?q=yogurt"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mocks.searchFoods).not.toHaveBeenCalled();
  });

  it("fails closed when the route key is not configured", async () => {
    delete process.env.MURPH_DATA_API_KEY;

    const response = await foodsRoute.GET(
      new Request("https://web.example.test/api/foods?q=yogurt", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "foods_api_unconfigured",
    });
  });

  it("searches labels with bounded limits", async () => {
    mocks.searchFoods.mockResolvedValue([
      {
        id: "fdc:123",
        dataOrigin: "usda_branded",
        dataOriginId: "123",
        name: "Greek Yogurt",
        brand: "Example Dairy",
        upc: "123456789012",
        offMarket: false,
        label: {
          servingSize: 170,
          servingSizeUnit: "g",
          nutrients: [
            {
              name: "Protein",
              value: 10,
              unit: "g",
            },
          ],
        },
      },
    ]);

    const response = await foodsRoute.GET(
      new Request(
        "https://web.example.test/api/foods?q=yogurt&limit=99&includeOffMarket=true",
        {
          headers: {
            authorization: "Bearer test-data-api-key",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.searchFoods).toHaveBeenCalledWith({
      q: "yogurt",
      limit: 50,
      includeOffMarket: true,
    });
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: "fdc:123",
          dataOrigin: "usda_branded",
          dataOriginId: "123",
          name: "Greek Yogurt",
          brand: "Example Dairy",
          upc: "123456789012",
          offMarket: false,
          label: {
            servingSize: 170,
            servingSizeUnit: "g",
            nutrients: [
              {
                name: "Protein",
                value: 10,
                unit: "g",
              },
            ],
          },
        },
      ],
    });
  });

  it("uses one search result by default", async () => {
    mocks.searchFoods.mockResolvedValue([]);

    const response = await foodsRoute.GET(
      new Request("https://web.example.test/api/foods?q=yogurt", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.searchFoods).toHaveBeenCalledWith({
      q: "yogurt",
      limit: 1,
      includeOffMarket: false,
    });
    await expect(response.json()).resolves.toEqual({ items: [] });
  });

  it("returns an empty search without touching the database when q is blank", async () => {
    const response = await foodsRoute.GET(
      new Request("https://web.example.test/api/foods?q=%20", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [] });
    expect(mocks.searchFoods).not.toHaveBeenCalled();
  });

  it("rejects oversized GET search strings before querying", async () => {
    const response = await foodsRoute.GET(
      new Request(`https://web.example.test/api/foods?q=${"a".repeat(257)}`, {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_query" });
    expect(mocks.searchFoods).not.toHaveBeenCalled();
  });

  it("fetches a label by FDC id before search parameters", async () => {
    mocks.getFoodById.mockResolvedValue({
      id: "fdc:123",
      dataOrigin: "usda_foundation",
      dataOriginId: "123",
      name: "Banana",
      brand: null,
      upc: null,
      offMarket: false,
      label: { id: 123 },
    });

    const response = await foodsRoute.GET(
      new Request("https://web.example.test/api/foods?id=fdc:123&q=ignored&includeOffMarket=true", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getFoodById).toHaveBeenCalledWith({
      id: "fdc:123",
      includeOffMarket: true,
    });
    expect(mocks.searchFoods).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      item: {
        id: "fdc:123",
        dataOrigin: "usda_foundation",
        dataOriginId: "123",
        name: "Banana",
        brand: null,
        upc: null,
        offMarket: false,
        label: { id: 123 },
      },
    });
  });

  it("fetches a label by UPC and returns not_found for misses", async () => {
    mocks.getFoodByUpc.mockResolvedValue(null);

    const response = await foodsRoute.GET(
      new Request("https://web.example.test/api/foods?upc=123-456", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.getFoodByUpc).toHaveBeenCalledWith({
      upc: "123-456",
      includeOffMarket: false,
    });
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("returns a safe failure payload when the query layer throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.searchFoods.mockRejectedValue(new Error("database unavailable"));

    const response = await foodsRoute.GET(
      new Request("https://web.example.test/api/foods?q=yogurt", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "foods_api_failed",
    });
    expect(consoleError).toHaveBeenCalledWith("foods_api_failed", {
      errorName: "Error",
    });
  });

  it("returns an unconfigured error when contaminant schema is missing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("product contaminant schema is missing");
    error.name = "ProductContaminantSchemaMissingError";
    mocks.searchFoods.mockRejectedValue(error);

    const response = await foodsRoute.GET(
      new Request("https://web.example.test/api/foods?q=yogurt", {
        headers: {
          authorization: ["Bearer", "test-data-api-key"].join(" "),
        },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "foods_api_unconfigured",
    });
    expect(consoleError).toHaveBeenCalledWith("foods_api_unconfigured", {
      errorName: "ProductContaminantSchemaMissingError",
    });
  });

  it("batch searches labels with one authorized POST", async () => {
    mocks.searchFoods.mockImplementation(async (input: { q: string }) => [
      {
        id: input.q === "yogurt" ? "fdc:123" : "fdc:456",
        dataOrigin: input.q === "yogurt" ? "usda_branded" : "usda_foundation",
        dataOriginId: input.q === "yogurt" ? "123" : "456",
        name: input.q === "yogurt" ? "Greek Yogurt" : "Banana",
        brand: input.q === "yogurt" ? "Example Dairy" : null,
        upc: input.q === "yogurt" ? "123456789012" : null,
        offMarket: false,
        label: {
          nutrients: [
            {
              name: input.q === "yogurt" ? "Protein" : "Potassium",
              value: input.q === "yogurt" ? 10 : 358,
              unit: input.q === "yogurt" ? "g" : "mg",
            },
          ],
        },
      },
    ]);

    const response = await foodsRoute.POST(
      new Request("https://web.example.test/api/foods", {
        body: JSON.stringify({
          queries: [" yogurt ", "banana"],
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
    expect(mocks.searchFoods).toHaveBeenCalledTimes(2);
    expect(mocks.searchFoods).toHaveBeenNthCalledWith(1, {
      q: "yogurt",
      limit: 50,
      includeOffMarket: true,
    });
    expect(mocks.searchFoods).toHaveBeenNthCalledWith(2, {
      q: "banana",
      limit: 50,
      includeOffMarket: true,
    });
    await expect(response.json()).resolves.toEqual({
      includeOffMarket: true,
      limit: 50,
      results: [
        {
          query: "yogurt",
          items: [
            {
              id: "fdc:123",
              dataOrigin: "usda_branded",
              dataOriginId: "123",
              name: "Greek Yogurt",
              brand: "Example Dairy",
              upc: "123456789012",
              offMarket: false,
              label: {
                nutrients: [
                  {
                    name: "Protein",
                    value: 10,
                    unit: "g",
                  },
                ],
              },
            },
          ],
        },
        {
          query: "banana",
          items: [
            {
              id: "fdc:456",
              dataOrigin: "usda_foundation",
              dataOriginId: "456",
              name: "Banana",
              brand: null,
              upc: null,
              offMarket: false,
              label: {
                nutrients: [
                  {
                    name: "Potassium",
                    value: 358,
                    unit: "mg",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it("uses one match per batch query by default", async () => {
    mocks.searchFoods.mockResolvedValue([]);

    const response = await foodsRoute.POST(
      new Request("https://web.example.test/api/foods", {
        body: JSON.stringify({
          queries: ["yogurt"],
        }),
        headers: {
          authorization: "Bearer test-data-api-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.searchFoods).toHaveBeenCalledWith({
      q: "yogurt",
      limit: 1,
      includeOffMarket: false,
    });
    await expect(response.json()).resolves.toEqual({
      includeOffMarket: false,
      limit: 1,
      results: [
        {
          query: "yogurt",
          items: [],
        },
      ],
    });
  });

  it("dedupes trimmed batch queries and maps duplicate results back", async () => {
    const itemForQuery = (query: string) => ({
      id: `fdc:${query}`,
      dataOrigin: "usda_branded",
      dataOriginId: query,
      name: query,
      brand: null,
      upc: null,
      offMarket: false,
      label: {
        query,
      },
    });

    mocks.searchFoods.mockImplementation(async (input: { q: string }) => [
      itemForQuery(input.q),
    ]);

    const response = await foodsRoute.POST(
      new Request("https://web.example.test/api/foods", {
        body: JSON.stringify({
          queries: [" yogurt ", "banana", "yogurt", " banana "],
          limit: 2,
        }),
        headers: {
          authorization: "Bearer test-data-api-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.searchFoods).toHaveBeenCalledTimes(2);
    expect(mocks.searchFoods).toHaveBeenNthCalledWith(1, {
      q: "yogurt",
      limit: 2,
      includeOffMarket: false,
    });
    expect(mocks.searchFoods).toHaveBeenNthCalledWith(2, {
      q: "banana",
      limit: 2,
      includeOffMarket: false,
    });
    await expect(response.json()).resolves.toEqual({
      includeOffMarket: false,
      limit: 2,
      results: [
        {
          query: "yogurt",
          items: [itemForQuery("yogurt")],
        },
        {
          query: "banana",
          items: [itemForQuery("banana")],
        },
        {
          query: "yogurt",
          items: [itemForQuery("yogurt")],
        },
        {
          query: "banana",
          items: [itemForQuery("banana")],
        },
      ],
    });
  });

  it("bounds concurrent batch searches", async () => {
    const releases: Array<() => void> = [];
    let activeSearches = 0;
    let maxActiveSearches = 0;

    mocks.searchFoods.mockImplementation(async (input: { q: string }) => {
      activeSearches += 1;
      maxActiveSearches = Math.max(maxActiveSearches, activeSearches);

      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      releases.push(release);

      await released;
      activeSearches -= 1;

      return [
        {
          id: `fdc:${input.q}`,
          dataOrigin: "usda_branded",
          dataOriginId: input.q,
          name: input.q,
          brand: null,
          upc: null,
          offMarket: false,
          label: {},
        },
      ];
    });

    const responsePromise = foodsRoute.POST(
      new Request("https://web.example.test/api/foods", {
        body: JSON.stringify({
          queries: Array.from({ length: 7 }, (_, index) => `query ${index}`),
        }),
        headers: {
          authorization: "Bearer test-data-api-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    try {
      for (const expectedCount of [3, 3, 1]) {
        await waitForStartedSearches(releases, expectedCount);
        expect(maxActiveSearches).toBe(3);

        for (const release of releases.splice(0)) {
          release();
        }
      }

      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect(maxActiveSearches).toBe(3);
      expect(mocks.searchFoods).toHaveBeenCalledTimes(7);
    } finally {
      for (const release of releases.splice(0)) {
        release();
      }

      await responsePromise.catch(() => undefined);
    }
  });

  it("accepts max-sized POST batches and bodies over the old cap", async () => {
    mocks.searchFoods.mockResolvedValue([]);

    const queries = Array.from(
      { length: 50 },
      (_, index) => `query ${index} ${"a".repeat(170)}`,
    );
    const body = JSON.stringify({ queries });

    expect(Buffer.byteLength(body)).toBeGreaterThan(8 * 1024);
    expect(Buffer.byteLength(body)).toBeLessThan(32 * 1024);

    const response = await foodsRoute.POST(
      new Request("https://web.example.test/api/foods", {
        body,
        headers: {
          authorization: "Bearer test-data-api-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.searchFoods).toHaveBeenCalledTimes(50);

    const payload = await response.json();
    expect(payload).toMatchObject({
      includeOffMarket: false,
      limit: 1,
    });
    expect(payload.results).toHaveLength(50);
    expect(payload.results[0]).toEqual({
      query: queries[0],
      items: [],
    });
  });

  it("fails closed when POST authorization is missing", async () => {
    const response = await foodsRoute.POST(
      new Request("https://web.example.test/api/foods", {
        body: JSON.stringify({
          queries: ["yogurt"],
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mocks.searchFoods).not.toHaveBeenCalled();
  });

  it("rejects malformed POST JSON", async () => {
    const response = await foodsRoute.POST(
      new Request("https://web.example.test/api/foods", {
        body: "{",
        headers: {
          authorization: "Bearer test-data-api-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_json" });
    expect(mocks.searchFoods).not.toHaveBeenCalled();
  });

  it("rejects empty or oversized POST query batches", async () => {
    const emptyResponse = await foodsRoute.POST(
      new Request("https://web.example.test/api/foods", {
        body: JSON.stringify({
          queries: [" "],
        }),
        headers: {
          authorization: "Bearer test-data-api-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(emptyResponse.status).toBe(400);
    await expect(emptyResponse.json()).resolves.toEqual({ error: "invalid_queries" });

    const oversizedResponse = await foodsRoute.POST(
      new Request("https://web.example.test/api/foods", {
        body: JSON.stringify({
          queries: Array.from({ length: 51 }, (_, index) => `query ${index}`),
        }),
        headers: {
          authorization: "Bearer test-data-api-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(oversizedResponse.status).toBe(400);
    await expect(oversizedResponse.json()).resolves.toEqual({ error: "invalid_queries" });
    expect(mocks.searchFoods).not.toHaveBeenCalled();
  });

  it("rejects oversized POST query strings and request bodies", async () => {
    const longQueryResponse = await foodsRoute.POST(
      new Request("https://web.example.test/api/foods", {
        body: JSON.stringify({
          queries: ["a".repeat(257)],
        }),
        headers: {
          authorization: "Bearer test-data-api-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(longQueryResponse.status).toBe(400);
    await expect(longQueryResponse.json()).resolves.toEqual({ error: "invalid_queries" });

    const largeBodyResponse = await foodsRoute.POST(
      new Request("https://web.example.test/api/foods", {
        body: JSON.stringify({
          queries: ["a".repeat(33 * 1024)],
        }),
        headers: {
          authorization: "Bearer test-data-api-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(largeBodyResponse.status).toBe(413);
    await expect(largeBodyResponse.json()).resolves.toEqual({ error: "payload_too_large" });
    expect(mocks.searchFoods).not.toHaveBeenCalled();
  });

  it("returns a safe failure payload when a batch query throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.searchFoods.mockRejectedValue(new Error("database unavailable"));

    const response = await foodsRoute.POST(
      new Request("https://web.example.test/api/foods", {
        body: JSON.stringify({
          queries: ["yogurt"],
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
      error: "foods_api_failed",
    });
    expect(consoleError).toHaveBeenCalledWith("foods_api_failed", {
      errorName: "Error",
    });
  });
});
