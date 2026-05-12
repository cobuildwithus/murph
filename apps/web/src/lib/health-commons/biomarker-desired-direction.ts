import {
  HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS,
  type HealthCommonsBiomarkerDesiredDirection,
} from "@murphai/contracts";
import biomarkerIndex from "@murphai/health-commons/generated/web/browse/biomarkers.json";

let biomarkerDesiredDirectionByKey: Map<
  string,
  HealthCommonsBiomarkerDesiredDirection
> | null = null;

export function resolveBiomarkerDesiredDirection(
  biomarkerKey: string,
): HealthCommonsBiomarkerDesiredDirection | null {
  if (biomarkerDesiredDirectionByKey === null) {
    const map = new Map<string, HealthCommonsBiomarkerDesiredDirection>();
    for (const entry of biomarkerIndex.biomarkers) {
      if (isHealthCommonsBiomarkerDesiredDirection(entry.desiredDirection)) {
        map.set(entry.key, entry.desiredDirection);
      }
    }
    biomarkerDesiredDirectionByKey = map;
  }
  return biomarkerDesiredDirectionByKey.get(biomarkerKey) ?? null;
}

function isHealthCommonsBiomarkerDesiredDirection(
  value: unknown,
): value is HealthCommonsBiomarkerDesiredDirection {
  return typeof value === "string" && (HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS as readonly string[]).includes(value);
}
