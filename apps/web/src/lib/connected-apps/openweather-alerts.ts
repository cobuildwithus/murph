import "server-only";

import {
  serializeHostedConnectedAppsResult,
} from "@murphai/hosted-execution/connected-apps";

const OPENWEATHER_ONE_CALL_ALERTS_URL =
  "https://api.openweathermap.org/data/3.0/onecall";
const OPENWEATHER_ALERTS_TIMEOUT_MS = 10_000;
const OPENWEATHER_ALERTS_RESPONSE_LIMIT_BYTES = 256 * 1024;
const OPENWEATHER_ALERTS_LIMIT = 16;

export const HOSTED_OPENWEATHER_NATIONAL_ALERTS_TOOL_SLUG =
  "MURPH_OPENWEATHER_GET_NATIONAL_ALERTS";

export class OpenWeatherAlertsRequestError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  readonly type: string;

  constructor(input: {
    cause?: unknown;
    message: string;
    retryable: boolean;
    status?: number | null;
    type: string;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "OpenWeatherAlertsRequestError";
    this.retryable = input.retryable;
    this.status = input.status ?? null;
    this.type = input.type;
  }
}

export async function executeOpenWeatherNationalAlerts(input: {
  apiKey: string;
  arguments: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<{
  alerts: Array<{
    description: string;
    end: number;
    event: string;
    senderName: string;
    start: number;
    tags: string[];
  }>;
}> {
  const coordinates = readCoordinates(input.arguments);
  const url = new URL(OPENWEATHER_ONE_CALL_ALERTS_URL);
  url.searchParams.set("lat", String(coordinates.lat));
  url.searchParams.set("lon", String(coordinates.lon));
  url.searchParams.set("exclude", "current,minutely,hourly,daily");
  url.searchParams.set("appid", input.apiKey);

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(OPENWEATHER_ALERTS_TIMEOUT_MS),
    });
  } catch {
    throw new OpenWeatherAlertsRequestError({
      message: "OpenWeather alerts are temporarily unavailable.",
      retryable: true,
      type: "openweather_transport_error",
    });
  }

  if (!response.ok) {
    throw new OpenWeatherAlertsRequestError({
      message: `OpenWeather alerts request failed with status ${response.status}.`,
      retryable: response.status === 429 || response.status >= 500,
      status: response.status,
      type: "openweather_http_error",
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedResponseText(response));
  } catch (error) {
    if (error instanceof OpenWeatherAlertsRequestError) {
      throw error;
    }
    throw new OpenWeatherAlertsRequestError({
      cause: error,
      message: "OpenWeather returned an invalid alerts response.",
      retryable: true,
      status: response.status,
      type: "openweather_invalid_json",
    });
  }

  const record = asRecord(payload);
  if (!record || (record.alerts !== undefined && !Array.isArray(record.alerts))) {
    throw new OpenWeatherAlertsRequestError({
      message: "OpenWeather returned an invalid alerts response.",
      retryable: true,
      status: response.status,
      type: "openweather_invalid_response",
    });
  }

  const alerts: Array<{
    description: string;
    end: number;
    event: string;
    senderName: string;
    start: number;
    tags: string[];
  }> = [];
  for (const value of (record.alerts ?? []).slice(0, OPENWEATHER_ALERTS_LIMIT)) {
    const alert = readAlert(value)[0];
    if (!alert) continue;
    if (serializeHostedConnectedAppsResult({ alerts: [...alerts, alert] }) === null) {
      break;
    }
    alerts.push(alert);
  }
  return { alerts };
}

function readCoordinates(value: Record<string, unknown>): {
  lat: number;
  lon: number;
} {
  if (
    Object.keys(value).some((key) => key !== "lat" && key !== "lon")
    || typeof value.lat !== "number"
    || !Number.isFinite(value.lat)
    || value.lat < -90
    || value.lat > 90
    || typeof value.lon !== "number"
    || !Number.isFinite(value.lon)
    || value.lon < -180
    || value.lon > 180
  ) {
    throw new OpenWeatherAlertsRequestError({
      message: "OpenWeather alerts require valid latitude and longitude.",
      retryable: false,
      status: 400,
      type: "openweather_invalid_arguments",
    });
  }
  return { lat: value.lat, lon: value.lon };
}

function readAlert(value: unknown): Array<{
  description: string;
  end: number;
  event: string;
  senderName: string;
  start: number;
  tags: string[];
}> {
  const record = asRecord(value);
  const description = readText(record?.description, 8_000);
  const event = readText(record?.event, 240);
  const senderName = readText(record?.sender_name, 240);
  const start = record?.start;
  const end = record?.end;
  if (
    !description
    || !event
    || !senderName
    || typeof start !== "number"
    || !Number.isFinite(start)
    || typeof end !== "number"
    || !Number.isFinite(end)
  ) {
    return [];
  }
  const tags = Array.isArray(record?.tags)
    ? record.tags
      .slice(0, 16)
      .flatMap((tag) => {
        const text = readText(tag, 120);
        return text ? [text] : [];
      })
    : [];
  return [{ description, end, event, senderName, start, tags }];
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength
    && Number.parseInt(contentLength, 10) > OPENWEATHER_ALERTS_RESPONSE_LIMIT_BYTES
  ) {
    throw responseTooLargeError(response.status);
  }
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > OPENWEATHER_ALERTS_RESPONSE_LIMIT_BYTES) {
      throw responseTooLargeError(response.status);
    }
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > OPENWEATHER_ALERTS_RESPONSE_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw responseTooLargeError(response.status);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function responseTooLargeError(status: number): OpenWeatherAlertsRequestError {
  return new OpenWeatherAlertsRequestError({
    message: "OpenWeather returned too many alerts.",
    retryable: false,
    status,
    type: "openweather_response_too_large",
  });
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
