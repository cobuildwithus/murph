import {
  getHabitatAspectDefinition,
  validateHabitatIndicatorValue,
  type HabitatIndicatorValue,
} from "@murphai/contracts";
import type { BrowserVaultCoreCapableQueryClient } from "@murphai/query/browser-replica-client";

import type { HabitatIndicatorNotes, HabitatValues } from "./home-model";

export function selectEnvironmentHabitatValues(
  client: BrowserVaultCoreCapableQueryClient,
): HabitatValues {
  const values: HabitatValues = {};

  for (const entity of client.entities.list({ families: ["habitat"] })) {
    const aspectId = entity.attributes.aspect;
    const storedIndicators = entity.attributes.indicators;
    if (typeof aspectId !== "string" || !isRecord(storedIndicators)) {
      continue;
    }

    const aspect = getHabitatAspectDefinition(aspectId);
    if (!aspect) {
      continue;
    }

    const aspectValues: Record<string, HabitatIndicatorValue> = {};
    for (const indicator of aspect.indicators) {
      const value = storedIndicators[indicator.id];
      if (
        !isHabitatIndicatorValue(value) ||
        validateHabitatIndicatorValue(indicator, value) !== null
      ) {
        continue;
      }
      aspectValues[indicator.id] = value;
    }

    if (Object.keys(aspectValues).length > 0) {
      values[aspect.id] = aspectValues;
    }
  }

  return values;
}

export function selectEnvironmentHabitatIndicatorNotes(
  client: BrowserVaultCoreCapableQueryClient,
): HabitatIndicatorNotes {
  const notes: HabitatIndicatorNotes = {};

  for (const entity of client.entities.list({ families: ["habitat"] })) {
    const aspectId = entity.attributes.aspect;
    const storedNotes = entity.attributes.indicatorNotes;
    if (typeof aspectId !== "string" || !isRecord(storedNotes)) {
      continue;
    }

    const aspect = getHabitatAspectDefinition(aspectId);
    if (!aspect) {
      continue;
    }

    const aspectNotes: Record<string, string> = {};
    for (const indicator of aspect.indicators) {
      const note = storedNotes[indicator.id];
      if (typeof note === "string" && note.trim().length > 0) {
        aspectNotes[indicator.id] = note;
      }
    }

    if (Object.keys(aspectNotes).length > 0) {
      notes[aspect.id] = aspectNotes;
    }
  }

  return notes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHabitatIndicatorValue(
  value: unknown,
): value is Exclude<HabitatIndicatorValue, null> {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}
