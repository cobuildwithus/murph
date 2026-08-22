import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

const cacheConfigurations = vi.hoisted((): Array<{
  keyParts: string[];
  revalidate: number;
}> => []);

vi.mock("next/cache", () => ({
  unstable_cache: <Arguments extends unknown[], Result>(
    callback: (...arguments_: Arguments) => Promise<Result>,
    keyParts: string[],
    options: { revalidate: number },
  ) => {
    const entries = new Map<string, Result>();
    cacheConfigurations.push({
      keyParts,
      revalidate: options.revalidate,
    });
    return async (...arguments_: Arguments): Promise<Result> => {
      const key = JSON.stringify(arguments_);
      const cached = entries.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const result = await callback(...arguments_);
      entries.set(key, result);
      return result;
    };
  },
}));

import { loadEnvironmentConditions } from "@/src/lib/environment/conditions";

const TEST_API_KEY = "openweather-test-key";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("environment conditions use direct OpenWeather APIs", async () => {
  const calls: URL[] = [];
  const result = await loadEnvironmentConditions({
    fetchImpl: createOpenWeatherFetch(calls),
    location: "Lisbon",
    openWeatherApiKey: TEST_API_KEY,
  });

  assert.deepEqual(result, {
    airQuality: { aqi: 1, pm25: 7.6 },
    locationLabel: "Lisbon, PT",
    weather: { description: "clear sky", temperatureC: 24.4 },
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((url) => url.pathname),
    [
      "/geo/1.0/direct",
      "/data/2.5/weather",
      "/data/2.5/air_pollution",
    ],
  );
  assert.deepEqual(
    Object.fromEntries(calls[0]!.searchParams),
    { appid: TEST_API_KEY, limit: "1", q: "Lisbon" },
  );
  for (const url of calls.slice(1)) {
    assert.equal(url.searchParams.get("lat"), "38.7223");
    assert.equal(url.searchParams.get("lon"), "-9.1393");
    assert.equal(url.searchParams.get("appid"), TEST_API_KEY);
  }
  assert.equal(calls[1]!.searchParams.get("units"), "metric");
});

test("environment conditions configure 30-day location and 10-minute conditions caches", () => {
  assert.deepEqual(cacheConfigurations, [
    {
      keyParts: ["environment-openweather-geocoding-v1"],
      revalidate: 30 * 24 * 60 * 60,
    },
    {
      keyParts: ["environment-openweather-current-conditions-v1"],
      revalidate: 10 * 60,
    },
  ]);
});

test("environment conditions reuse cached production results for the same city", async () => {
  const calls: URL[] = [];
  vi.stubEnv("OPENWEATHER_API_KEY", TEST_API_KEY);
  vi.stubGlobal("fetch", createOpenWeatherFetch(calls));

  const first = await loadEnvironmentConditions({ location: "Lisbon" });
  const second = await loadEnvironmentConditions({ location: "Lisbon" });

  assert.deepEqual(second, first);
  assert.equal(calls.length, 3);
});

test("environment conditions request weather and air quality concurrently", async () => {
  let currentRequestsStarted = 0;
  let releaseCurrentRequests: (() => void) | null = null;
  const currentRequestsReady = new Promise<void>((resolve) => {
    releaseCurrentRequests = resolve;
  });
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/geo/1.0/direct") {
      return Response.json([
        { country: "PL", lat: 50, lon: 19, name: "Test city" },
      ]);
    }
    currentRequestsStarted += 1;
    if (currentRequestsStarted === 2) {
      releaseCurrentRequests?.();
    }
    await currentRequestsReady;
    return url.pathname === "/data/2.5/weather"
      ? Response.json({
          main: { temp: 20 },
          weather: [{ description: "clear" }],
        })
      : Response.json({
          list: [{ components: { pm2_5: 5 }, main: { aqi: 1 } }],
        });
  };

  await loadEnvironmentConditions({
    fetchImpl,
    location: "Test city",
    openWeatherApiKey: TEST_API_KEY,
  });
  assert.equal(currentRequestsStarted, 2);
});

test("environment conditions fail closed when a city cannot be resolved", async () => {
  const error = await loadEnvironmentConditions({
    fetchImpl: async () => Response.json([]),
    location: "unknown place",
    openWeatherApiKey: TEST_API_KEY,
  }).catch((value: unknown) => value);

  assert.match(String(error), /Live conditions are unavailable for that city/);
});

test("environment conditions reject a precise address before provider egress", async () => {
  let providerCalls = 0;
  const error = await loadEnvironmentConditions({
    fetchImpl: async () => {
      providerCalls += 1;
      return Response.json([]);
    },
    location: "123 Main Street, apartment 4, Warsaw 00-001",
    openWeatherApiKey: TEST_API_KEY,
  }).catch((value: unknown) => value);

  assert.equal(providerCalls, 0);
  assert.match(String(error), /Confirm a city or approximate region/);
});

test("environment conditions omit malformed current provider sections", async () => {
  const result = await loadEnvironmentConditions({
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      return url.pathname === "/geo/1.0/direct"
        ? Response.json([{ lat: 52.23, lon: 21.01, name: "Warsaw" }])
        : Response.json({ provider: "unexpected" });
    },
    location: "Warsaw",
    openWeatherApiKey: TEST_API_KEY,
  });

  assert.deepEqual(result, {
    airQuality: null,
    locationLabel: "Warsaw",
    weather: null,
  });
});

test("environment conditions convert OpenWeather failures to a retryable provider error", async () => {
  const error = await loadEnvironmentConditions({
    fetchImpl: async () => Response.json(
      { message: "unauthorized" },
      { status: 401 },
    ),
    location: "Warsaw",
    openWeatherApiKey: TEST_API_KEY,
  }).catch((value: unknown) => value);

  assert.match(String(error), /Live conditions are unavailable right now/);
  assert.doesNotMatch(String(error), new RegExp(TEST_API_KEY));
});

function createOpenWeatherFetch(calls: URL[]): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    switch (url.pathname) {
      case "/geo/1.0/direct":
        return Response.json([
          {
            country: "PT",
            lat: 38.7223,
            lon: -9.1393,
            name: "Lisbon",
          },
        ]);
      case "/data/2.5/weather":
        return Response.json({
          main: { temp: 24.4 },
          weather: [{ description: "clear sky" }],
        });
      case "/data/2.5/air_pollution":
        return Response.json({
          list: [{ components: { pm2_5: 7.6 }, main: { aqi: 1 } }],
        });
      default:
        throw new Error(`Unexpected OpenWeather path ${url.pathname}`);
    }
  };
}
