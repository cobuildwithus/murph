import "server-only";

import { normalizeHabitatCityOrRegion } from "@murphai/contracts";
import { unstable_cache } from "next/cache";

import { readHostedOpenWeatherApiKey } from "@/src/lib/connected-apps/config";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const OPENWEATHER_GEOCODING_URL =
  "https://api.openweathermap.org/geo/1.0/direct";
const OPENWEATHER_CURRENT_WEATHER_URL =
  "https://api.openweathermap.org/data/2.5/weather";
const OPENWEATHER_CURRENT_AIR_QUALITY_URL =
  "https://api.openweathermap.org/data/2.5/air_pollution";
const OPENWEATHER_TIMEOUT_MS = 10_000;
const LOCATION_CACHE_SECONDS = 30 * 24 * 60 * 60;
const CONDITIONS_CACHE_SECONDS = 10 * 60;

interface GeocodedPlace {
  country: string | null;
  lat: number;
  lon: number;
  name: string;
}

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

const loadCachedGeocodedPlace = unstable_cache(
  async (location: string) => loadGeocodedPlace({
    apiKey: readHostedOpenWeatherApiKey(),
    fetchImpl: fetch,
    location,
  }),
  ["environment-openweather-geocoding-v1"],
  { revalidate: LOCATION_CACHE_SECONDS },
);

const loadCachedCurrentConditions = unstable_cache(
  async (lat: number, lon: number, cacheWindow: number) => {
    void cacheWindow;
    return loadCurrentConditions({
      apiKey: readHostedOpenWeatherApiKey(),
      fetchImpl: fetch,
      lat,
      lon,
    });
  },
  ["environment-openweather-current-conditions-v2"],
  { revalidate: CONDITIONS_CACHE_SECONDS },
);

export async function loadEnvironmentConditions(input: {
  fetchImpl?: typeof fetch;
  location: string;
  openWeatherApiKey?: string;
}): Promise<EnvironmentConditions> {
  const location = normalizeHabitatCityOrRegion(input.location);
  if (!location) {
    throw hostedOnboardingError({
      code: "ENVIRONMENT_LOCATION_INVALID",
      httpStatus: 400,
      message: "Confirm a city or approximate region for live conditions.",
    });
  }

  const injectedProvider = input.fetchImpl !== undefined
    || input.openWeatherApiKey !== undefined;
  if (
    injectedProvider
    && (input.fetchImpl === undefined || input.openWeatherApiKey === undefined)
  ) {
    throw new Error(
      "Environment conditions provider overrides require both fetch and API key.",
    );
  }

  let place: GeocodedPlace | null;
  try {
    place = input.fetchImpl && input.openWeatherApiKey !== undefined
      ? await loadGeocodedPlace({
          apiKey: input.openWeatherApiKey,
          fetchImpl: input.fetchImpl,
          location,
        })
      : await loadCachedGeocodedPlace(location);
  } catch {
    console.error("Environment conditions geocoding provider request failed.");
    throw providerFailedError();
  }
  if (!place) {
    throw hostedOnboardingError({
      code: "ENVIRONMENT_LOCATION_NOT_FOUND",
      httpStatus: 404,
      message: "Live conditions are unavailable for that city.",
    });
  }

  let conditions: Pick<EnvironmentConditions, "airQuality" | "weather">;
  try {
    conditions = input.fetchImpl && input.openWeatherApiKey !== undefined
      ? await loadCurrentConditions({
          apiKey: input.openWeatherApiKey,
          fetchImpl: input.fetchImpl,
          lat: place.lat,
          lon: place.lon,
        })
      : await loadCachedCurrentConditions(
          place.lat,
          place.lon,
          currentConditionsCacheWindow(),
        );
  } catch {
    console.error("Environment conditions weather provider request failed.");
    throw providerFailedError();
  }

  if (!conditions.weather || !conditions.airQuality) {
    console.error("Environment conditions provider response was incomplete.", {
      airQualityAvailable: conditions.airQuality !== null,
      weatherAvailable: conditions.weather !== null,
    });
  }

  return {
    ...conditions,
    locationLabel: [place.name, place.country].filter(Boolean).join(", "),
  };
}

function currentConditionsCacheWindow(): number {
  return Math.floor(Date.now() / (CONDITIONS_CACHE_SECONDS * 1_000));
}

async function loadGeocodedPlace(input: {
  apiKey: string;
  fetchImpl: typeof fetch;
  location: string;
}): Promise<GeocodedPlace | null> {
  const url = new URL(OPENWEATHER_GEOCODING_URL);
  url.searchParams.set("q", input.location);
  url.searchParams.set("limit", "1");
  url.searchParams.set("appid", input.apiKey);

  const payload = await requestOpenWeatherJson({
    fetchImpl: input.fetchImpl,
    url,
  });
  if (!Array.isArray(payload)) {
    throw new Error("OpenWeather returned an invalid geocoding response.");
  }
  if (payload.length === 0) {
    return null;
  }
  const place = readGeocodedPlace(payload);
  if (!place) {
    throw new Error("OpenWeather returned an invalid geocoding response.");
  }
  return place;
}

async function loadCurrentConditions(input: {
  apiKey: string;
  fetchImpl: typeof fetch;
  lat: number;
  lon: number;
}): Promise<Pick<EnvironmentConditions, "airQuality" | "weather">> {
  const weatherUrl = new URL(OPENWEATHER_CURRENT_WEATHER_URL);
  weatherUrl.searchParams.set("lat", String(input.lat));
  weatherUrl.searchParams.set("lon", String(input.lon));
  weatherUrl.searchParams.set("units", "metric");
  weatherUrl.searchParams.set("appid", input.apiKey);

  const airQualityUrl = new URL(OPENWEATHER_CURRENT_AIR_QUALITY_URL);
  airQualityUrl.searchParams.set("lat", String(input.lat));
  airQualityUrl.searchParams.set("lon", String(input.lon));
  airQualityUrl.searchParams.set("appid", input.apiKey);

  const [weatherResult, airQualityResult] = await Promise.all([
    requestOpenWeatherJson({ fetchImpl: input.fetchImpl, url: weatherUrl }),
    requestOpenWeatherJson({ fetchImpl: input.fetchImpl, url: airQualityUrl }),
  ]);
  return {
    airQuality: readAirQuality(airQualityResult),
    weather: readWeather(weatherResult),
  };
}

async function requestOpenWeatherJson(input: {
  fetchImpl: typeof fetch;
  url: URL;
}): Promise<unknown> {
  const response = await input.fetchImpl(input.url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(OPENWEATHER_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`OpenWeather request failed with status ${response.status}.`);
  }

  try {
    return await response.json() as unknown;
  } catch (error) {
    throw new Error("OpenWeather returned invalid JSON.", { cause: error });
  }
}

function providerFailedError() {
  return hostedOnboardingError({
    code: "ENVIRONMENT_CONDITIONS_PROVIDER_FAILED",
    httpStatus: 502,
    message: "Live conditions are unavailable right now.",
    retryable: true,
  });
}

function readGeocodedPlace(value: unknown): GeocodedPlace | null {
  const first = Array.isArray(value) ? value[0] : null;
  if (!isRecord(first)) {
    return null;
  }
  const { lat, lon, name } = first;
  if (
    typeof lat !== "number"
    || !Number.isFinite(lat)
    || typeof lon !== "number"
    || !Number.isFinite(lon)
    || typeof name !== "string"
    || name.trim().length === 0
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
    !isRecord(value)
    || !isRecord(value.main)
    || !Array.isArray(value.weather)
  ) {
    return null;
  }
  const firstCondition = value.weather[0];
  const temperatureC = value.main.temp;
  if (
    typeof temperatureC !== "number"
    || !Number.isFinite(temperatureC)
    || !isRecord(firstCondition)
    || typeof firstCondition.description !== "string"
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
    !isRecord(first)
    || !isRecord(first.main)
    || !isRecord(first.components)
  ) {
    return null;
  }
  const aqi = first.main.aqi;
  const pm25 = first.components.pm2_5;
  if (
    typeof aqi !== "number"
    || !Number.isFinite(aqi)
    || typeof pm25 !== "number"
    || !Number.isFinite(pm25)
  ) {
    return null;
  }
  return { aqi, pm25 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
