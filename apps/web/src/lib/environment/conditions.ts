import "server-only";

import { executeHostedConnectedAppsRequest } from "@/src/lib/connected-apps/service";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

export interface EnvironmentConditions {
  airQuality: {
    aqi: number;
    pm25: number;
  } | null;
  locationLabel: string;
  weather: {
    description: string;
    temperatureC: number;
  } | null;
}

type ExecuteConnectedApps = typeof executeHostedConnectedAppsRequest;

export async function loadEnvironmentConditions(input: {
  executeConnectedApps?: ExecuteConnectedApps;
  location: string;
  memberId: string;
}): Promise<EnvironmentConditions> {
  const executeConnectedApps =
    input.executeConnectedApps ?? executeHostedConnectedAppsRequest;
  const geocoding = await executeConnectedApps({
    memberId: input.memberId,
    request: {
      input: {
        arguments: { limit: 1, q: input.location },
        toolSlug: "OPENWEATHER_API_GET_GEOCODING_DIRECT",
      },
      operation: "execute",
    },
  });
  const place = readGeocodedPlace(geocoding);
  if (!place) {
    throw hostedOnboardingError({
      code: "ENVIRONMENT_LOCATION_NOT_FOUND",
      httpStatus: 404,
      message: "Live conditions are unavailable for that city.",
    });
  }

  const [weatherResult, airQualityResult] = await Promise.all([
    executeConnectedApps({
      memberId: input.memberId,
      request: {
        input: {
          arguments: { lat: place.lat, lon: place.lon, units: "metric" },
          toolSlug: "OPENWEATHER_API_GET_CURRENT_WEATHER",
        },
        operation: "execute",
      },
    }),
    executeConnectedApps({
      memberId: input.memberId,
      request: {
        input: {
          arguments: { lat: place.lat, lon: place.lon },
          toolSlug: "OPENWEATHER_API_GET_AIR_POLLUTION_CURRENT",
        },
        operation: "execute",
      },
    }),
  ]);

  return {
    airQuality: readAirQuality(airQualityResult),
    locationLabel: [place.name, place.country].filter(Boolean).join(", "),
    weather: readWeather(weatherResult),
  };
}

function readGeocodedPlace(value: unknown): {
  country: string | null;
  lat: number;
  lon: number;
  name: string;
} | null {
  const first = Array.isArray(value) ? value[0] : null;
  if (!isRecord(first)) {
    return null;
  }
  const { lat, lon, name } = first;
  if (
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    typeof lon !== "number" ||
    !Number.isFinite(lon) ||
    typeof name !== "string" ||
    name.trim().length === 0
  ) {
    return null;
  }
  return {
    country: typeof first.country === "string" ? first.country : null,
    lat,
    lon,
    name: name.trim(),
  };
}

function readWeather(value: unknown): EnvironmentConditions["weather"] {
  if (
    !isRecord(value) ||
    !isRecord(value.main) ||
    !Array.isArray(value.weather)
  ) {
    return null;
  }
  const firstCondition = value.weather[0];
  const temperatureC = value.main.temp;
  if (
    typeof temperatureC !== "number" ||
    !Number.isFinite(temperatureC) ||
    !isRecord(firstCondition) ||
    typeof firstCondition.description !== "string"
  ) {
    return null;
  }
  return {
    description: firstCondition.description.trim(),
    temperatureC,
  };
}

function readAirQuality(value: unknown): EnvironmentConditions["airQuality"] {
  if (!isRecord(value) || !Array.isArray(value.list)) {
    return null;
  }
  const first = value.list[0];
  if (
    !isRecord(first) ||
    !isRecord(first.main) ||
    !isRecord(first.components)
  ) {
    return null;
  }
  const aqi = first.main.aqi;
  const pm25 = first.components.pm2_5;
  if (
    typeof aqi !== "number" ||
    !Number.isFinite(aqi) ||
    typeof pm25 !== "number" ||
    !Number.isFinite(pm25)
  ) {
    return null;
  }
  return { aqi, pm25 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
