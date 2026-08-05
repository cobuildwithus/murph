import { describe, expect, it, vi } from "vitest";

import {
  executeOpenWeatherNationalAlerts,
} from "@/src/lib/connected-apps/openweather-alerts";

describe("OpenWeather national alerts", () => {
  it("requests only official alerts for the supplied coordinates", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      expect(parsed.origin).toBe("https://api.openweathermap.org");
      expect(parsed.pathname).toBe("/data/3.0/onecall");
      expect(parsed.searchParams.get("lat")).toBe("52.2297");
      expect(parsed.searchParams.get("lon")).toBe("21.0122");
      expect(parsed.searchParams.get("exclude")).toBe(
        "current,minutely,hourly,daily",
      );
      expect(parsed.searchParams.get("appid")).toBe("test-api-key");
      expect(init).toMatchObject({
        cache: "no-store",
        method: "GET",
        redirect: "error",
      });
      return jsonResponse({
        alerts: [
          {
            description: "  Extreme heat warning for the region.  ",
            end: 1_786_032_000,
            event: "Extreme heat",
            sender_name: "National weather service",
            start: 1_785_945_600,
            tags: ["Extreme temperature"],
          },
          { event: "Incomplete provider record" },
        ],
      });
    });

    await expect(executeOpenWeatherNationalAlerts({
      apiKey: "test-api-key",
      arguments: { lat: 52.2297, lon: 21.0122 },
      fetchImpl,
    })).resolves.toEqual({
      alerts: [{
        description: "Extreme heat warning for the region.",
        end: 1_786_032_000,
        event: "Extreme heat",
        senderName: "National weather service",
        start: 1_785_945_600,
        tags: ["Extreme temperature"],
      }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when the provider has no alerts", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => jsonResponse({ lat: 0, lon: 0 }));

    await expect(executeOpenWeatherNationalAlerts({
      apiKey: "test-api-key",
      arguments: { lat: 0, lon: 0 },
      fetchImpl,
    })).resolves.toEqual({ alerts: [] });
  });

  it("rejects unsupported arguments before contacting the provider", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => jsonResponse({ alerts: [] }));

    await expect(executeOpenWeatherNationalAlerts({
      apiKey: "test-api-key",
      arguments: { lat: 52.2297, lon: 21.0122, units: "metric" },
      fetchImpl,
    })).rejects.toMatchObject({
      retryable: false,
      status: 400,
      type: "openweather_invalid_arguments",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects provider responses above the fixed size limit", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => new Response("{}", {
      headers: { "content-length": String(256 * 1024 + 1) },
      status: 200,
    }));

    await expect(executeOpenWeatherNationalAlerts({
      apiKey: "test-api-key",
      arguments: { lat: 52.2297, lon: 21.0122 },
      fetchImpl,
    })).rejects.toMatchObject({
      retryable: false,
      type: "openweather_response_too_large",
    });
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}
