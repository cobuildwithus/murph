import { extractIsoDatePrefix } from "@murphai/contracts";

import type { CanonicalEntity } from "../canonical-entities.ts";
import {
  normalizeLowercaseString,
  normalizeNullableString,
} from "./shared.ts";
import type { WearableExternalRef } from "./types.ts";

export function readWearableExternalRef(value: unknown): WearableExternalRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const system = normalizeLowercaseString(record.system);
  const resourceType = normalizeLowercaseString(record.resourceType);
  const resourceId = normalizeNullableString(record.resourceId);
  const version = normalizeNullableString(record.version);
  const facet = normalizeNullableString(record.facet);

  if (!system && !resourceType && !resourceId && !version && !facet) {
    return null;
  }

  return {
    system,
    resourceType,
    resourceId,
    version,
    facet,
  };
}

export function deriveWearableObservationEffectiveDate(
  entity: CanonicalEntity,
  externalRef: WearableExternalRef | null = readWearableExternalRef(entity.attributes.externalRef),
  options: {
    preferDayKey?: boolean;
  } = {},
): string | null {
  return deriveWearableDate(entity, externalRef, {
    preferDayKey: options.preferDayKey ?? !shouldIgnoreCoreDefaultSleepDayKey(entity, externalRef),
    preferSleepEndAt: true,
  });
}

export function inferWearableObservationGrain(entity: CanonicalEntity): string | null {
  if (normalizeNullableString(entity.attributes.source) !== "device") {
    return null;
  }

  const externalRef = readWearableExternalRef(entity.attributes.externalRef);
  const system = normalizeLowercaseString(externalRef?.system);
  const resourceType = normalizeLowercaseString(externalRef?.resourceType)?.replace(/_/gu, "-") ?? null;
  if (!system || !resourceType) {
    return null;
  }

  if (resourceType.startsWith("daily-") || resourceType.includes("-daily-")) {
    return "summary";
  }

  if ((system === "oura" || system === "whoop") && [
    "body-measurement",
    "cycle",
    "recovery",
    "sleep",
  ].includes(resourceType)) {
    return "summary";
  }

  return null;
}

export function deriveWearableDate(
  entity: CanonicalEntity,
  externalRef: WearableExternalRef | null,
  options: {
    preferDayKey?: boolean;
    preferSleepEndAt: boolean;
  },
): string | null {
  const dayKey = normalizeNullableString(entity.attributes.dayKey);
  if (dayKey && options.preferDayKey !== false) {
    return dayKey;
  }

  const resourceType = normalizeLowercaseString(externalRef?.resourceType);
  const startAt = normalizeNullableString(entity.attributes.startAt);
  const endAt = normalizeNullableString(entity.attributes.endAt);
  const recordedAt = normalizeNullableString(entity.attributes.recordedAt) ?? entity.occurredAt ?? null;
  const candidates = options.preferSleepEndAt || resourceType?.includes("sleep")
    ? [endAt, recordedAt, entity.occurredAt, startAt, entity.date]
    : [entity.date, recordedAt, entity.occurredAt, endAt, startAt];

  for (const candidate of candidates) {
    const date = extractIsoDatePrefix(candidate);
    if (date) {
      return date;
    }
  }

  return null;
}

function shouldIgnoreCoreDefaultSleepDayKey(
  entity: CanonicalEntity,
  externalRef: WearableExternalRef | null,
): boolean {
  if (normalizeNullableString(entity.attributes.observationGrain)) {
    return false;
  }
  const system = normalizeLowercaseString(externalRef?.system);
  const resourceType = normalizeLowercaseString(externalRef?.resourceType)?.replace(/_/gu, "-") ?? null;
  if ((system !== "oura" && system !== "whoop") || !resourceType?.includes("sleep")) {
    return false;
  }
  const dayKey = normalizeNullableString(entity.attributes.dayKey);
  const occurredDate = extractIsoDatePrefix(entity.occurredAt);
  if (!dayKey || !occurredDate || dayKey !== occurredDate) {
    return false;
  }
  const effectiveDateWithoutDayKey = extractIsoDatePrefix(normalizeNullableString(entity.attributes.endAt));
  return Boolean(
    effectiveDateWithoutDayKey
      && effectiveDateWithoutDayKey !== dayKey
      && isNearbyLaterDate(dayKey, effectiveDateWithoutDayKey),
  );
}

function isNearbyLaterDate(startDate: string, candidateDate: string): boolean {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const candidate = Date.parse(`${candidateDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(candidate)) {
    return false;
  }
  const deltaDays = Math.round((candidate - start) / (24 * 60 * 60 * 1000));
  return deltaDays > 0 && deltaDays <= 2;
}
