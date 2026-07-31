import assert from "node:assert/strict";

import { test } from "vitest";

import { loadEnvironmentConditions } from "@/src/lib/environment/conditions";

test("environment conditions resolve a city before loading weather and air quality", async () => {
  const toolCalls: Array<{ arguments: unknown; toolSlug: string }> = [];

  const result = await loadEnvironmentConditions({
    executeConnectedApps: async ({ request }) => {
      assert.equal(request.operation, "execute");
      const { arguments: argumentsValue, toolSlug } = request.input;
      toolCalls.push({ arguments: argumentsValue, toolSlug });
      if (toolSlug === "OPENWEATHER_API_GET_GEOCODING_DIRECT") {
        return [
          {
            country: "PT",
            lat: 38.7223,
            lon: -9.1393,
            name: "Lisbon",
          },
        ];
      }
      if (toolSlug === "OPENWEATHER_API_GET_CURRENT_WEATHER") {
        return {
          main: { temp: 24.4 },
          weather: [{ description: "clear sky" }],
        };
      }
      if (toolSlug === "OPENWEATHER_API_GET_AIR_POLLUTION_CURRENT") {
        return {
          list: [{ components: { pm2_5: 7.6 }, main: { aqi: 1 } }],
        };
      }
      throw new Error(`Unexpected tool ${toolSlug}`);
    },
    location: "Lisbon",
    memberId: "hbm_member",
  });

  assert.deepEqual(result, {
    airQuality: { aqi: 1, pm25: 7.6 },
    locationLabel: "Lisbon, PT",
    weather: { description: "clear sky", temperatureC: 24.4 },
  });
  assert.deepEqual(toolCalls, [
    {
      arguments: { limit: 1, q: "Lisbon" },
      toolSlug: "OPENWEATHER_API_GET_GEOCODING_DIRECT",
    },
    {
      arguments: { lat: 38.7223, lon: -9.1393, units: "metric" },
      toolSlug: "OPENWEATHER_API_GET_CURRENT_WEATHER",
    },
    {
      arguments: { lat: 38.7223, lon: -9.1393 },
      toolSlug: "OPENWEATHER_API_GET_AIR_POLLUTION_CURRENT",
    },
  ]);
});

test("environment conditions fail closed when a city cannot be resolved", async () => {
  const error = await loadEnvironmentConditions({
    executeConnectedApps: async () => [],
    location: "unknown place",
    memberId: "hbm_member",
  }).catch((value: unknown) => value);

  assert.match(String(error), /Live conditions are unavailable/);
});

test("environment conditions reject a precise address before provider egress", async () => {
  let providerCalls = 0;
  const error = await loadEnvironmentConditions({
    executeConnectedApps: async () => {
      providerCalls += 1;
      return [];
    },
    location: "123 Main Street, apartment 4, Warsaw 00-001",
    memberId: "hbm_member",
  }).catch((value: unknown) => value);

  assert.equal(providerCalls, 0);
  assert.match(String(error), /Confirm a city or approximate region/);
});

test("environment conditions omit malformed provider sections", async () => {
  const result = await loadEnvironmentConditions({
    executeConnectedApps: async ({ request }) => {
      assert.equal(request.operation, "execute");
      if (request.input.toolSlug === "OPENWEATHER_API_GET_GEOCODING_DIRECT") {
        return [{ lat: 52.23, lon: 21.01, name: "Warsaw" }];
      }
      return { provider: "unexpected" };
    },
    location: "Warsaw",
    memberId: "hbm_member",
  });

  assert.deepEqual(result, {
    airQuality: null,
    locationLabel: "Warsaw",
    weather: null,
  });
});
