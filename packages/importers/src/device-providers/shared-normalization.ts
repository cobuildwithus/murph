import { normalizeTimestamp, stripUndefined } from "../shared.js";

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

export interface PlainObject {
  [key: string]: unknown;
}

export interface DeletionObservationOptions {
  provider: string;
  providerDisplayName: string;
  deletion: unknown;
  resourceType: string;
  resourceId: string;
  occurredAt: string;
  sourceEventType?: string;
  makeExternalRef: (
    resourceType: string,
    resourceId: string,
    version?: string,
    facet?: string,
  ) => DeviceExternalRefPayload;
}

export function asPlainObject(value: unknown): PlainObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as PlainObject;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stringId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return undefined;
}

export function slugify(value: unknown, fallback: string): string {
  const candidate = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return candidate || fallback;
}

export function toIso(value: unknown): string | undefined {
  return normalizeTimestamp(value, "timestamp");
}

export function minutesBetween(startAt: string | undefined, endAt: string | undefined): number | undefined {
  if (!startAt || !endAt) {
    return undefined;
  }

  const durationMs = Date.parse(endAt) - Date.parse(startAt);

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return undefined;
  }

  return Math.max(1, Math.round(durationMs / 60000));
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

export function pushDeletionObservation(
  events: DeviceEventPayload[],
  rawArtifacts: DeviceRawArtifactPayload[],
  options: DeletionObservationOptions,
): void {
  const deletionRole = `deletion:${options.resourceType}:${options.resourceId}`;

  pushRawArtifact(
    rawArtifacts,
    createRawArtifact(
      deletionRole,
      `deletion-${options.resourceType}-${options.resourceId}.json`,
      options.deletion,
    ),
  );

  events.push(
    stripUndefined({
      kind: "observation",
      occurredAt: options.occurredAt,
      recordedAt: options.occurredAt,
      source: "device",
      title: trimToLength(`${options.providerDisplayName} ${options.resourceType} deleted`, 160),
      note: options.sourceEventType
        ? trimToLength(`Webhook event: ${options.sourceEventType}`, 4000)
        : undefined,
      rawArtifactRoles: [deletionRole],
      externalRef: options.makeExternalRef(
        options.resourceType,
        options.resourceId,
        options.occurredAt,
        "deleted",
      ),
      fields: stripUndefined({
        metric: "external-resource-deleted",
        value: 1,
        unit: "boolean",
        provider: options.provider,
        resourceType: options.resourceType,
        deleted: true,
        sourceEventType: options.sourceEventType,
      }),
    }),
  );
}
