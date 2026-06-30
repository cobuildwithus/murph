export interface ComputerHandoffViewportSize {
  width: number;
  height: number;
}

export interface ComputerHandoffViewportObservation
  extends ComputerHandoffViewportSize {
  observedAt: Date;
}

export interface ComputerBrowserViewport extends ComputerHandoffViewportSize {
  refresh_rate: 25 | 60;
}

const MIN_HANDOFF_VIEWPORT_DIMENSION = 320;
const MAX_HANDOFF_VIEWPORT_WIDTH = 1920;
const MAX_HANDOFF_VIEWPORT_HEIGHT = 1200;
const VIEWPORT_GRANULARITY_PX = 4;
const MATERIAL_VIEWPORT_DELTA_PX = 16;
const MOBILE_VIEWPORT_WIDTH_MAX = 1024;
const MAX_HANDOFF_VIEWPORT_OBSERVED_AT_FUTURE_MS = 5_000;

export function normalizeComputerHandoffViewportSize(
  input: unknown,
): ComputerHandoffViewportSize | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  const width = normalizeComputerHandoffViewportDimension(
    candidate.width,
    MIN_HANDOFF_VIEWPORT_DIMENSION,
    MAX_HANDOFF_VIEWPORT_WIDTH,
  );
  const height = normalizeComputerHandoffViewportDimension(
    candidate.height,
    MIN_HANDOFF_VIEWPORT_DIMENSION,
    MAX_HANDOFF_VIEWPORT_HEIGHT,
  );

  return width && height ? { height, width } : null;
}

export function normalizeComputerHandoffViewportObservation(
  input: unknown,
  options: { now?: Date } = {},
): ComputerHandoffViewportObservation | null {
  const size = normalizeComputerHandoffViewportSize(input);
  if (!size || !input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const observedAt = normalizeComputerHandoffViewportObservedAt(
    (input as Record<string, unknown>).observedAt,
    options.now ?? new Date(),
  );
  return observedAt ? { ...size, observedAt } : null;
}

export function toComputerBrowserViewport(
  size: ComputerHandoffViewportSize,
): ComputerBrowserViewport {
  return {
    ...size,
    refresh_rate: size.width <= MOBILE_VIEWPORT_WIDTH_MAX ? 60 : 25,
  };
}

export function isMateriallyDifferentComputerHandoffViewportSize(
  left: ComputerHandoffViewportSize | null,
  right: ComputerHandoffViewportSize | null,
): boolean {
  if (!left || !right) {
    return true;
  }

  return (
    Math.abs(left.width - right.width) >= MATERIAL_VIEWPORT_DELTA_PX
    || Math.abs(left.height - right.height) >= MATERIAL_VIEWPORT_DELTA_PX
  );
}

function normalizeComputerHandoffViewportDimension(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const rounded =
    Math.round(value / VIEWPORT_GRANULARITY_PX) * VIEWPORT_GRANULARITY_PX;
  return Math.min(Math.max(rounded, min), max);
}

function normalizeComputerHandoffViewportObservedAt(
  value: unknown,
  now: Date,
): Date {
  const timestamp = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Date.parse(value)
      : Number.NaN;

  if (
    !Number.isFinite(timestamp)
    || timestamp <= 0
    || timestamp > now.getTime() + MAX_HANDOFF_VIEWPORT_OBSERVED_AT_FUTURE_MS
  ) {
    return now;
  }

  return new Date(timestamp);
}
