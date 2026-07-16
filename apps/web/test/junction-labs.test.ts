import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { HostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { executeJunctionLabsTool } from "../src/lib/labs/junction";

const FIXTURE_API_KEY = "junction_fixture_key_without_legacy_prefix";
const FIXED_NOW = new Date("2026-07-16T15:30:00.000Z");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Junction labs provider boundary", () => {
  it("searches the fixed US origin, locally filters kind, and preserves catalog price text", async () => {
    const expectedResults = Array.from({ length: 45 }, (_, index) => ({
      name: `Included marker ${index + 1}`,
      slug: `included-marker-${index + 1}`,
    }));
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = toUrl(input);

      expect(url.origin).toBe("https://api.us.junction.com");
      expect(url.pathname).toBe("/v3/lab_tests/markers");
      expect(url.searchParams.get("name")).toBe("heart health");
      expect(url.searchParams.get("a_la_carte_enabled")).toBe("true");
      expect(url.searchParams.get("include_pricing")).toBe("true");
      expect(url.searchParams.get("page")).toBe("2");
      expect(url.searchParams.get("size")).toBe("50");
      expect(new Headers(init?.headers).get("x-vital-api-key")).toBe(FIXTURE_API_KEY);
      expect(init).toMatchObject({
        cache: "no-store",
        method: "GET",
        redirect: "error",
      });

      return jsonResponse({
        data: [
          junctionMarker({
            expected_results: expectedResults,
            price: "219.9900",
            type: "panel",
          }),
          junctionMarker({
            name: "Duplicate provider row",
            type: "panel",
          }),
          junctionMarker({
            lab_id: 8,
            name: "Single marker",
            provider_id: "single-marker-code",
            type: "biomarker",
          }),
          junctionMarker({
            is_orderable: false,
            lab_id: 9,
            name: "Inactive panel",
            provider_id: "inactive-code",
            type: "panel",
          }),
        ],
        page: 2,
        pages: 7,
        total: 123,
      });
    });

    const result = await executeJunctionLabsTool({
      action: "search",
      kind: "panel",
      limit: 4,
      page: 2,
      query: "heart health",
    }, dependencies(fetchImpl));

    expect(result).toMatchObject({
      action: "search",
      checkedAt: FIXED_NOW.toISOString(),
      orderableThroughMurph: false,
      orderingStatus: "discovery_only",
      provider: { page: 2, pages: null, total: null },
      source: "junction",
    });
    if (result.action !== "search") {
      throw new Error("Expected a labs search result.");
    }
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      catalogPrice: {
        amount: "219.9900",
        currency: "USD",
        source: "junction_catalog",
      },
      includedMarkerCount: 45,
      junctionOrderable: true,
      kind: "panel",
      name: "Fixture health panel",
    });
    expect(result.items[0]?.includedMarkers).toHaveLength(40);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps a genuine empty search distinct from all-malformed provider drift", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        markers: [],
        page: 1,
        pages: 0,
        total: 0,
      }))
      .mockResolvedValueOnce(jsonResponse({
        markers: [
          junctionMarker({ is_orderable: false }),
          { name: "Provider row missing required identity" },
        ],
        page: 1,
        pages: 1,
        total: 2,
      }));

    const empty = await executeJunctionLabsTool({
      action: "search",
      query: "no matches",
    }, dependencies(fetchImpl));
    expect(empty).toMatchObject({ action: "search", items: [] });

    const driftError = await captureHostedError(executeJunctionLabsTool({
      action: "search",
      query: "changed provider shape",
    }, dependencies(fetchImpl)));
    expect(driftError).toMatchObject({
      code: "LABS_TEMPORARILY_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("resolves show from the complete marker catalog with an exact lab and provider match", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = toUrl(input);
      expect(url.origin).toBe("https://api.us.junction.com");
      expect(url.pathname).toBe("/v3/lab_tests/markers");
      expect(url.searchParams.get("lab_id")).toBe("7");
      expect(url.searchParams.get("name")).toBe("code/alpha");
      expect(url.searchParams.get("size")).toBe("20");
      return jsonResponse({
        data: [
          junctionMarker({
            lab_id: 8,
            provider_id: "code/alpha",
          }),
          junctionMarker({
            expected_results: [
              { name: "Included result", slug: "included-result" },
            ],
            provider_id: "code/alpha",
          }),
        ],
      });
    });

    const result = await executeJunctionLabsTool({
      action: "show",
      labId: 7,
      providerId: "code/alpha",
    }, dependencies(fetchImpl));

    expect(result.action).toBe("show");
    if (result.action !== "show") {
      throw new Error("Expected a labs show result.");
    }
    expect(result.offering.includedMarkers).toEqual([
      { name: "Included result", slug: "included-result" },
    ]);
    expect(result.offering.includedMarkerCount).toBe(1);
    expect(result.offering.offeringId).toBe("7:code/alpha");
  });

  it("returns not found when the bounded show lookup has no exact identity match", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      data: [junctionMarker({ lab_id: 8, provider_id: "different-code" })],
    }));

    const error = await captureHostedError(executeJunctionLabsTool({
      action: "show",
      labId: 7,
      providerId: "code/alpha",
    }, dependencies(fetchImpl)));

    expect(error).toMatchObject({
      code: "LABS_OFFERING_NOT_FOUND",
      httpStatus: 404,
      retryable: false,
    });
  });

  it("fails closed for a malformed exact show row but keeps explicit disablement as not found", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        data: [junctionMarker({
          name: null,
          provider_id: "code/alpha",
        })],
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [junctionMarker({
          a_la_carte_enabled: false,
          provider_id: "code/alpha",
        })],
      }));

    const malformed = await captureHostedError(executeJunctionLabsTool({
      action: "show",
      labId: 7,
      providerId: "code/alpha",
    }, dependencies(fetchImpl)));
    expect(malformed).toMatchObject({
      code: "LABS_TEMPORARILY_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });

    const disabled = await captureHostedError(executeJunctionLabsTool({
      action: "show",
      labId: 7,
      providerId: "code/alpha",
    }, dependencies(fetchImpl)));
    expect(disabled).toMatchObject({
      code: "LABS_OFFERING_NOT_FOUND",
      httpStatus: 404,
      retryable: false,
    });
  });

  it("fans out to at most four eligible labs with concurrency at most three, then dedupes and sorts", async () => {
    const pscCalls: number[] = [];
    let inFlight = 0;
    let maximumInFlight = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = toUrl(input);

      if (url.pathname.endsWith("/area/info")) {
        expect(url.searchParams.get("zip_code")).toBe("10001");
        expect(url.searchParams.get("radius")).toBe("20");
        return jsonResponse({
          central_labs: Object.fromEntries([1, 2, 3, 4, 5].map((labId) => [
            `lab-${labId}`,
            {
              lab_id: labId,
              patient_service_centers: { within_radius: 2 },
            },
          ])),
          phlebotomy: { is_served: false },
        });
      }

      const labId = Number(url.searchParams.get("lab_id"));
      pscCalls.push(labId);
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;

      const common = pscLocation({
        distance: String(6 - labId),
        metadata: {
          city: "Example City",
          first_line: `${labId} Sample Avenue`,
          name: `Collection site ${labId}`,
          phone_number: null,
          second_line: null,
          state: "NY",
          zip_code: "10001",
        },
        site_code: `site-${labId}`,
      });

      return jsonResponse({
        lab_id: labId,
        patient_service_centers: labId === 1
          ? [common, { ...common, distance: "9" }]
          : [common],
        slug: `lab-${labId}`,
      });
    });

    const result = await executeJunctionLabsTool({
      action: "locations",
      limit: 3,
      radiusMiles: 20,
      zipCode: "10001",
    }, dependencies(fetchImpl));

    expect(result.action).toBe("locations");
    if (result.action !== "locations") {
      throw new Error("Expected a labs locations result.");
    }
    expect(pscCalls.sort((left, right) => left - right)).toEqual([1, 2, 3, 4]);
    expect(maximumInFlight).toBe(3);
    expect(result.status).toBe("available");
    expect(result.locations.map((location) => location.labId)).toEqual([4, 3, 2]);
    expect(result.locations).toHaveLength(3);
  });

  it("returns a clean not-served result without PSC calls when the area has no coverage", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      central_labs: {},
      phlebotomy: { is_served: false },
    }));

    const result = await executeJunctionLabsTool({
      action: "locations",
      zipCode: "10001",
    }, dependencies(fetchImpl));

    expect(result).toMatchObject({
      action: "locations",
      homeCollectionAvailable: false,
      locations: [],
      status: "not_served",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      central_labs: {},
    },
    {
      central_labs: {},
      phlebotomy: { is_served: "yes" },
    },
    {
      central_labs: {
        labcorp: {
          lab_id: 7,
          patient_service_centers: { within_radius: "1" },
        },
      },
      phlebotomy: { is_served: false },
    },
  ])("fails closed when a negative area result depends on malformed provider data", async (area) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(area));

    const error = await captureHostedError(executeJunctionLabsTool({
      action: "locations",
      zipCode: "10001",
    }, dependencies(fetchImpl)));

    expect(error).toMatchObject({
      code: "LABS_TEMPORARILY_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed for an all-malformed PSC result but preserves a valid mixed result", async () => {
    const area = {
      central_labs: {
        labcorp: {
          lab_id: 7,
          patient_service_centers: { within_radius: 1 },
        },
      },
      phlebotomy: { is_served: false },
    };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(area))
      .mockResolvedValueOnce(jsonResponse({
        lab_id: 7,
        patient_service_centers: [{ metadata: {} }],
        slug: "labcorp",
      }))
      .mockResolvedValueOnce(jsonResponse(area))
      .mockResolvedValueOnce(jsonResponse({
        lab_id: 7,
        patient_service_centers: [
          { metadata: {} },
          pscLocation(),
        ],
        slug: "labcorp",
      }));

    const malformed = await captureHostedError(executeJunctionLabsTool({
      action: "locations",
      zipCode: "10001",
    }, dependencies(fetchImpl)));
    expect(malformed).toMatchObject({
      code: "LABS_TEMPORARILY_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });

    const mixed = await executeJunctionLabsTool({
      action: "locations",
      zipCode: "10001",
    }, dependencies(fetchImpl));
    expect(mixed).toMatchObject({
      action: "locations",
      homeCollectionAvailable: false,
      status: "available",
    });
    if (mixed.action !== "locations") {
      throw new Error("Expected a labs locations result.");
    }
    expect(mixed.locations).toHaveLength(1);
  });

  it.each([429, 500])("keeps a provider %i failure generic and secret-safe", async (status) => {
    const privateProviderText = "private-provider-body-with-sensitive-context";
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(privateProviderText, {
      status,
    }));

    const error = await captureHostedError(executeJunctionLabsTool({
      action: "search",
      query: "lipids",
    }, dependencies(fetchImpl)));

    expect(error).toMatchObject({
      cause: undefined,
      code: "LABS_TEMPORARILY_UNAVAILABLE",
      details: undefined,
      httpStatus: 503,
      retryable: true,
    });
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(privateProviderText);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed and oversized provider responses without exposing their content", async () => {
    const privateProviderText = "private-malformed-provider-payload";
    const malformedFetch = vi.fn<typeof fetch>(async () => new Response(privateProviderText, {
      headers: { "content-type": "application/json" },
      status: 200,
    }));
    const malformedError = await captureHostedError(executeJunctionLabsTool({
      action: "search",
      query: "thyroid",
    }, dependencies(malformedFetch)));
    expect(malformedError.code).toBe("LABS_TEMPORARILY_UNAVAILABLE");
    expect(`${malformedError.message} ${JSON.stringify(malformedError)}`)
      .not.toContain(privateProviderText);

    const oversizedFetch = vi.fn<typeof fetch>(async () => new Response("discarded", {
      headers: { "content-length": String(1_024 * 1_024 + 1) },
      status: 200,
    }));
    const oversizedError = await captureHostedError(executeJunctionLabsTool({
      action: "search",
      query: "thyroid",
    }, dependencies(oversizedFetch)));
    expect(oversizedError.code).toBe("LABS_TEMPORARILY_UNAVAILABLE");
  });

  it("enforces the response byte cap when content length is underreported", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      "x".repeat(1_024 * 1_024 + 1),
      {
        headers: {
          "content-length": "1",
          "content-type": "application/json",
        },
        status: 200,
      },
    ));

    const error = await captureHostedError(executeJunctionLabsTool({
      action: "search",
      query: "thyroid",
    }, dependencies(fetchImpl)));

    expect(error).toMatchObject({
      code: "LABS_TEMPORARILY_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the timeout active while a response body is still streaming", async () => {
    let providerSignal: AbortSignal | null = null;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      providerSignal = init?.signal ?? null;
      return pendingJsonResponse(providerSignal);
    });

    const error = await captureHostedError(executeJunctionLabsTool({
      action: "search",
      query: "metabolic",
    }, {
      ...dependencies(fetchImpl),
      timeoutMs: 5,
    }));

    expect(error.code).toBe("LABS_TEMPORARILY_UNAVAILABLE");
    expectAbortedSignal(providerSignal);
  });

  it("propagates caller abort while a response body is still streaming", async () => {
    const caller = new AbortController();
    let providerSignal: AbortSignal | null = null;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      providerSignal = init?.signal ?? null;
      return pendingJsonResponse(providerSignal);
    });
    const pending = executeJunctionLabsTool({
      action: "search",
      query: "metabolic",
    }, {
      ...dependencies(fetchImpl),
      signal: caller.signal,
      timeoutMs: 1_000,
    });

    caller.abort();
    const error = await captureHostedError(pending);

    expect(error.code).toBe("LABS_TEMPORARILY_UNAVAILABLE");
    expectAbortedSignal(providerSignal);
  });

  it("rejects blank, padded, and oversized API key values before provider egress", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    for (const apiKey of ["", " padded-key ", "x".repeat(513)]) {
      const error = await captureHostedError(executeJunctionLabsTool({
        action: "search",
        query: "vitamin",
      }, {
        env: { JUNCTION_API_KEY: apiKey },
        fetchImpl,
      }));
      expect(error).toMatchObject({
        code: "LABS_TEMPORARILY_UNAVAILABLE",
        httpStatus: 503,
        retryable: false,
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function dependencies(fetchImpl: typeof fetch) {
  return {
    env: { JUNCTION_API_KEY: FIXTURE_API_KEY },
    fetchImpl,
    now: () => FIXED_NOW,
  };
}

function junctionMarker(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    a_la_carte_enabled: true,
    common_tat_days: 3,
    description: "A fixture catalog description.",
    expected_results: [],
    is_orderable: true,
    lab_id: 7,
    name: "Fixture health panel",
    price: "49.50",
    provider_id: "fixture-panel-code",
    slug: "fixture-health-panel",
    type: "panel",
    unit: null,
    worst_case_tat_days: 7,
    ...overrides,
  };
}

function pscLocation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    capabilities: ["appointment_scheduling"],
    distance: "1.5",
    location: { lat: 40.75, lng: -73.99 },
    metadata: {
      city: "Example City",
      first_line: "1 Sample Avenue",
      name: "Fixture collection site",
      phone_number: null,
      second_line: null,
      state: "NY",
      zip_code: "10001",
    },
    site_code: "fixture-site",
    ...overrides,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function pendingJsonResponse(signal: AbortSignal | null): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const abort = () => controller.error(new DOMException("Aborted", "AbortError"));
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      controller.enqueue(new TextEncoder().encode("{"));
    },
  }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function toUrl(input: string | URL | Request): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
}

async function captureHostedError(promise: Promise<unknown>): Promise<HostedOnboardingError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HostedOnboardingError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected a hosted domain error.");
}

function expectAbortedSignal(signal: AbortSignal | null): void {
  if (signal === null) {
    throw new Error("Expected the provider request signal to be captured.");
  }
  expect(signal.aborted).toBe(true);
}
