import { stripUndefined } from "../shared.js";

import type {
  DeviceEventPayload,
  DeviceExternalRefPayload,
  DeviceRawArtifactPayload,
  DeviceSamplePayload,
  DeviceSampleValuePayload,
} from "../core-port.js";

export interface ObservationEventOptions {
  metric: string;
  value: unknown;
  unit: string;
  occurredAt?: string;
  recordedAt?: string;
  title: string;
  note?: string;
  rawArtifactRoles?: string[];
  externalRef: DeviceExternalRefPayload;
}

export interface SampleOptions {
  stream: string;
  value: unknown;
  unit: string;
  recordedAt?: string;
  externalRef: DeviceExternalRefPayload;
}

export function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  return undefined;
}

export function trimToLength(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function createRawArtifact(
  role: string,
  fileName: string,
  content: unknown,
): DeviceRawArtifactPayload | null {
  if (content === undefined || content === null) {
    return null;
  }

  if (Array.isArray(content) && content.length === 0) {
    return null;
  }

  if (
    !Array.isArray(content) &&
    typeof content === "object" &&
    Object.keys(content as Record<string, unknown>).length === 0
  ) {
    return null;
  }

  return {
    role,
    fileName,
    mediaType: "application/json",
    content,
  };
}

export function pushRawArtifact(
  rawArtifacts: DeviceRawArtifactPayload[],
  artifact: DeviceRawArtifactPayload | null,
): void {
  if (!artifact) {
    return;
  }

  rawArtifacts.push(artifact);
}

export function pushObservationEvent(
  events: DeviceEventPayload[],
  options: ObservationEventOptions,
): void {
  const numeric = finiteNumber(options.value);
  const occurredAt = options.occurredAt ?? options.recordedAt;

  if (numeric === undefined || !occurredAt) {
    return;
  }

  events.push(
    stripUndefined({
      kind: "observation",
      occurredAt,
      recordedAt: options.recordedAt,
      source: "device",
      title: trimToLength(options.title, 160),
      note: options.note ? trimToLength(options.note, 4000) : undefined,
      rawArtifactRoles: options.rawArtifactRoles,
      externalRef: options.externalRef,
      fields: {
        metric: options.metric,
        value: numeric,
        unit: options.unit,
      },
    }),
  );
}

export function pushSample(
  samples: DeviceSamplePayload[],
  options: SampleOptions,
): void {
  const numeric = finiteNumber(options.value);

  if (numeric === undefined || !options.recordedAt) {
    return;
  }

  const sample: DeviceSampleValuePayload = {
    recordedAt: options.recordedAt,
    value: numeric,
  };

  samples.push(
    stripUndefined({
      stream: options.stream,
      recordedAt: options.recordedAt,
      source: "device",
      quality: "normalized",
      unit: options.unit,
      externalRef: options.externalRef,
      sample,
    }),
  );
}
