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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("environment conditions use direct OpenWeather APIs", async () => {
  const calls: Array<{ init?: RequestInit; url: URL }> = [];
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
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
    calls.map(({ url }) => url.pathname),
    [
      "/geo/1.0/direct",
      "/data/2.5/weather",
      "/data/2.5/air_pollution",
    ],
  );
  assert.deepEqual(
    calls.map(({ url }) => url.origin),
    Array.from({ length: 3 }, () => "https://api.openweathermap.org"),
  );
  assert.deepEqual(
    Object.fromEntries(calls[0]!.url.searchParams),
    { appid: TEST_API_KEY, limit: "1", q: "Lisbon" },
  );
  for (const { init } of calls) {
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(init?.headers, { accept: "application/json" });
    assert.ok(init?.signal instanceof AbortSignal);
  }
  for (const { url } of calls.slice(1)) {
    assert.equal(url.searchParams.get("lat"), "38.7223");
    assert.equal(url.searchParams.get("lon"), "-9.1393");
    assert.equal(url.searchParams.get("appid"), TEST_API_KEY);
  }
  assert.equal(calls[1]!.url.searchParams.get("units"), "metric");
  assert.deepEqual(timeoutSpy.mock.calls, [[10_000], [10_000], [10_000]]);
});

test("environment conditions configure 30-day location and 10-minute conditions caches", () => {
  assert.deepEqual(cacheConfigurations, [
    {
      keyParts: ["environment-openweather-geocoding-v1"],
      revalidate: 30 * 24 * 60 * 60,
    },
    {
      keyParts: ["environment-openweather-current-conditions-v2"],
      revalidate: 10 * 60,
    },
  ]);
});

test("environment conditions reuse cached production results for the same city", async () => {
  const calls: Array<{ init?: RequestInit; url: URL }> = [];
  vi.stubEnv("OPENWEATHER_API_KEY", TEST_API_KEY);
  vi.stubGlobal("fetch", createOpenWeatherFetch(calls));

  const first = await loadEnvironmentConditions({ location: "Lisbon" });
  const second = await loadEnvironmentConditions({ location: "Lisbon" });

  assert.deepEqual(second, first);
  assert.equal(calls.length, 3);
});

test("environment conditions partition production caches by normalized city", async () => {
  const calls: URL[] = [];
  vi.stubEnv("OPENWEATHER_API_KEY", TEST_API_KEY);
  vi.stubGlobal("fetch", createCityAwareOpenWeatherFetch(calls));

  const porto = await loadEnvironmentConditions({ location: "Porto" });
  const warsaw = await loadEnvironmentConditions({ location: "Warsaw" });
  const portoAgain = await loadEnvironmentConditions({ location: "Porto" });

  assert.deepEqual(portoAgain, porto);
  assert.notDeepEqual(warsaw, porto);
  assert.equal(
    calls.filter((url) => url.pathname === "/geo/1.0/direct").length,
    2,
  );
  assert.equal(
    calls.filter((url) => url.pathname !== "/geo/1.0/direct").length,
    4,
  );
});

test("environment conditions await fresh provider data after ten minutes", async () => {
  let now = Date.UTC(2026, 7, 22, 10, 0, 0);
  let currentRequestCount = 0;
  let releaseRefresh: () => void = () => undefined;
  let markRefreshStarted: () => void = () => undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });
  const refreshReleased = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubEnv("OPENWEATHER_API_KEY", TEST_API_KEY);
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.pathname === "/geo/1.0/direct") {
      return Response.json([
        { country: "PL", lat: 50.01, lon: 19.91, name: "Freshville" },
      ]);
    }
    currentRequestCount += 1;
    const refreshing = currentRequestCount > 2;
    if (refreshing) {
      if (currentRequestCount === 4) {
        markRefreshStarted();
      }
      await refreshReleased;
    }
    return url.pathname === "/data/2.5/weather"
      ? Response.json({
          main: { temp: refreshing ? 22 : 12 },
          weather: [{ description: refreshing ? "clear" : "rain" }],
        })
      : Response.json({
          list: [{
            components: { pm2_5: refreshing ? 4 : 14 },
            main: { aqi: refreshing ? 1 : 3 },
          }],
        });
  });

  const first = await loadEnvironmentConditions({ location: "Freshville" });
  now += (10 * 60 * 1_000) + 1;
  let refreshSettled = false;
  const refresh = loadEnvironmentConditions({ location: "Freshville" })
    .finally(() => {
      refreshSettled = true;
    });
  await refreshStarted;
  await Promise.resolve();

  assert.equal(refreshSettled, false);
  releaseRefresh();
  const refreshed = await refresh;
  const reused = await loadEnvironmentConditions({ location: "Freshville" });

  assert.equal(first.weather?.temperatureC, 12);
  assert.equal(refreshed.weather?.temperatureC, 22);
  assert.deepEqual(reused, refreshed);
  assert.equal(currentRequestCount, 4);
});

test("environment conditions fail closed when an expired refresh fails", async () => {
  let now = Date.UTC(2026, 7, 22, 11, 0, 0);
  let currentRequestCount = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubEnv("OPENWEATHER_API_KEY", TEST_API_KEY);
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.pathname === "/geo/1.0/direct") {
      return Response.json([
        { country: "PL", lat: 50.02, lon: 19.92, name: "Failureville" },
      ]);
    }
    currentRequestCount += 1;
    if (currentRequestCount > 2) {
      return Response.json({ message: "unavailable" }, { status: 503 });
    }
    return url.pathname === "/data/2.5/weather"
      ? Response.json({
          main: { temp: 15 },
          weather: [{ description: "cloudy" }],
        })
      : Response.json({
          list: [{ components: { pm2_5: 9 }, main: { aqi: 2 } }],
        });
  });

  await loadEnvironmentConditions({ location: "Failureville" });
  now += (10 * 60 * 1_000) + 1;
  const error = await loadEnvironmentConditions({ location: "Failureville" })
    .catch((value: unknown) => value);

  assert.match(String(error), /Live conditions are unavailable right now/);
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

function createOpenWeatherFetch(
  calls: Array<{ init?: RequestInit; url: URL }>,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    calls.push({ init, url });
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

function createCityAwareOpenWeatherFetch(calls: URL[]): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname === "/geo/1.0/direct") {
      const location = url.searchParams.get("q");
      return location === "Porto"
        ? Response.json([
            { country: "PT", lat: 41.15, lon: -8.61, name: "Porto" },
          ])
        : Response.json([
            { country: "PL", lat: 52.23, lon: 21.01, name: "Warsaw" },
          ]);
    }
    const lat = Number(url.searchParams.get("lat"));
    return url.pathname === "/data/2.5/weather"
      ? Response.json({
          main: { temp: lat },
          weather: [{ description: "clear" }],
        })
      : Response.json({
          list: [{ components: { pm2_5: lat }, main: { aqi: 1 } }],
        });
  };
}
