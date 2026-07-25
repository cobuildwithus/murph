/**
 * Validation and normalization for the experiment results share card.
 *
 * Run results live only in the browser vault. Private card data is sent in the
 * body of a no-store render request and must never be serialized into a URL.
 */

export type ExperimentCardDirection = "up" | "down" | "neutral";
export type ExperimentCardSentiment = "positive" | "negative" | "neutral";

export interface ExperimentCardSignal {
  label: string;
  value: string;
  unit?: string;
  delta: string;
  direction: ExperimentCardDirection;
  sentiment?: ExperimentCardSentiment;
  baseline?: string;
}

/** A compact series for the primary tracked marker, drawn as the card chart. */
export interface ExperimentCardChart {
  label: string;
  unit?: string;
  /** Count of leading `values` that belong to the baseline window. */
  baselineCount: number;
  /** Baseline values followed by active values, in day order. */
  values: number[];
  baselineAvg?: number;
}

export interface ExperimentCardData {
  title: string;
  /** One-line "how to run it yourself" recipe from the protocol facts. */
  protocol?: string;
  signals: ExperimentCardSignal[];
  chart?: ExperimentCardChart;
}

/**
 * Legacy URL codec constants retained for decoding already-open local clients.
 * New code must use `parseExperimentCardData` and POST the payload in the body.
 */
export const EXPERIMENT_CARD_PARAM = "d";
export const EXPERIMENT_CARD_VERSION = 7;

/** The card layout only has room for three metric tiles. */
export const EXPERIMENT_CARD_MAX_SIGNALS = 3;

/** Cap on chart points kept in the URL — the series is downsampled to fit. */
export const EXPERIMENT_CARD_MAX_CHART_POINTS = 40;

const DIRECTIONS: ReadonlySet<ExperimentCardDirection> = new Set([
  "up",
  "down",
  "neutral",
]);
const SENTIMENTS: ReadonlySet<ExperimentCardSentiment> = new Set([
  "positive",
  "negative",
  "neutral",
]);

export function encodeExperimentCardData(data: ExperimentCardData): string {
  return toBase64Url(JSON.stringify(normalizeCardData(data)));
}

export function decodeExperimentCardData(
  encoded: string | null | undefined,
): ExperimentCardData | null {
  if (!encoded) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(fromBase64Url(encoded));
    return parseCardData(parsed);
  } catch {
    return null;
  }
}

function normalizeCardData(data: ExperimentCardData): ExperimentCardData {
  return {
    title: data.title.trim(),
    protocol: data.protocol?.trim() || undefined,
    signals: data.signals
      .slice(0, EXPERIMENT_CARD_MAX_SIGNALS)
      .map((signal) => ({
        label: signal.label.trim(),
        value: signal.value.trim(),
        unit: signal.unit?.trim() || undefined,
        delta: signal.delta.trim(),
        direction: signal.direction,
        sentiment: signal.sentiment,
        baseline: signal.baseline?.trim() || undefined,
      })),
    chart: normalizeCardChart(data.chart),
  };
}

function normalizeCardChart(
  chart: ExperimentCardChart | undefined,
): ExperimentCardChart | undefined {
  if (!chart) {
    return undefined;
  }

  const values = chart.values
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .slice(0, EXPERIMENT_CARD_MAX_CHART_POINTS)
    .map(roundTo1);
  if (values.length < 2) {
    return undefined;
  }

  return {
    label: chart.label.trim(),
    unit: chart.unit?.trim() || undefined,
    baselineCount: clampInteger(chart.baselineCount, 0, values.length),
    values,
    baselineAvg:
      typeof chart.baselineAvg === "number" && Number.isFinite(chart.baselineAvg)
        ? roundTo1(chart.baselineAvg)
        : undefined,
  };
}

export function parseExperimentCardData(input: unknown): ExperimentCardData | null {
  return parseCardData(input);
}

function parseCardData(input: unknown): ExperimentCardData | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!title || !Array.isArray(record.signals)) {
    return null;
  }

  const signals = record.signals
    .map(parseCardSignal)
    .filter((signal): signal is ExperimentCardSignal => signal !== null)
    .slice(0, EXPERIMENT_CARD_MAX_SIGNALS);

  return {
    title,
    protocol:
      typeof record.protocol === "string"
        ? record.protocol.trim() || undefined
        : undefined,
    signals,
    chart: parseCardChart(record.chart),
  };
}

function parseCardChart(input: unknown): ExperimentCardChart | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (!label || !Array.isArray(record.values)) {
    return undefined;
  }

  const values = record.values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .slice(0, EXPERIMENT_CARD_MAX_CHART_POINTS);
  if (values.length < 2) {
    return undefined;
  }

  return {
    label,
    unit: typeof record.unit === "string" ? record.unit.trim() || undefined : undefined,
    baselineCount:
      typeof record.baselineCount === "number"
        ? clampInteger(record.baselineCount, 0, values.length)
        : 0,
    values,
    baselineAvg:
      typeof record.baselineAvg === "number" && Number.isFinite(record.baselineAvg)
        ? record.baselineAvg
        : undefined,
  };
}

function parseCardSignal(input: unknown): ExperimentCardSignal | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  const value = typeof record.value === "string" ? record.value.trim() : "";
  const delta = typeof record.delta === "string" ? record.delta.trim() : "";
  if (!label || !value) {
    return null;
  }

  const direction =
    typeof record.direction === "string" &&
    DIRECTIONS.has(record.direction as ExperimentCardDirection)
      ? (record.direction as ExperimentCardDirection)
      : "neutral";
  const sentiment =
    typeof record.sentiment === "string" &&
    SENTIMENTS.has(record.sentiment as ExperimentCardSentiment)
      ? (record.sentiment as ExperimentCardSentiment)
      : undefined;

  return {
    label,
    value,
    unit: typeof record.unit === "string" ? record.unit.trim() || undefined : undefined,
    delta,
    direction,
    sentiment,
    baseline:
      typeof record.baseline === "string"
        ? record.baseline.trim() || undefined
        : undefined,
  };
}

function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Unicode-safe base64url encode — usable in both the browser and Node. */
function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

/** Unicode-safe base64url decode — usable in both the browser and Node. */
function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}
