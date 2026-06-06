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

  it("uses one search result by default", async () => {
    mocks.searchSupplements.mockResolvedValue([]);

    const response = await supplementsRoute.GET(
      new Request("https://web.example.test/api/supplements?q=creatine", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.searchSupplements).toHaveBeenCalledWith({
      q: "creatine",
      limit: 1,
      includeOffMarket: false,
    });
    await expect(response.json()).resolves.toEqual({ items: [] });
  });

  it("returns an empty search without touching the database when q is blank", async () => {
    const response = await supplementsRoute.GET(
      new Request("https://web.example.test/api/supplements?q=%20", {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [] });
    expect(mocks.searchSupplements).not.toHaveBeenCalled();
  });

  it("rejects oversized GET search strings before querying", async () => {
    const response = await supplementsRoute.GET(
      new Request(`https://web.example.test/api/supplements?q=${"a".repeat(257)}`, {
        headers: {
          authorization: "Bearer test-data-api-key",
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_query" });
    expect(mocks.searchSupplements).not.toHaveBeenCalled();
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
      errorName: "Error",
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

  it("uses one match per batch query by default", async () => {
    mocks.searchSupplements.mockResolvedValue([]);

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

    expect(response.status).toBe(200);
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
          query: "creatine",
          items: [],
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

  it("rejects malformed POST JSON", async () => {
    const response = await supplementsRoute.POST(
      new Request("https://web.example.test/api/supplements", {
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
    expect(mocks.searchSupplements).not.toHaveBeenCalled();
  });

  it("rejects empty or oversized POST query batches", async () => {
    const emptyResponse = await supplementsRoute.POST(
      new Request("https://web.example.test/api/supplements", {
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

    const oversizedResponse = await supplementsRoute.POST(
      new Request("https://web.example.test/api/supplements", {
        body: JSON.stringify({
          queries: Array.from({ length: 11 }, (_, index) => `query ${index}`),
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
    expect(mocks.searchSupplements).not.toHaveBeenCalled();
  });

  it("rejects oversized POST query strings and request bodies", async () => {
    const longQueryResponse = await supplementsRoute.POST(
      new Request("https://web.example.test/api/supplements", {
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

    const largeBodyResponse = await supplementsRoute.POST(
      new Request("https://web.example.test/api/supplements", {
        body: JSON.stringify({
          queries: ["a".repeat(9 * 1024)],
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
      errorName: "Error",
    });
  });
});
