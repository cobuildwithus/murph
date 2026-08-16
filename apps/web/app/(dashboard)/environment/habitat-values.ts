import {
  getHabitatAspectDefinition,
  validateHabitatIndicatorValue,
  type HabitatIndicatorValue,
} from "@murphai/contracts";
import type { BrowserVaultCoreCapableQueryClient } from "@murphai/query/browser-replica-client";

import type { HabitatValues } from "./home-model";

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
