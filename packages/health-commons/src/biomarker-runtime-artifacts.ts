import type { HealthCommonsBiomarkerDesiredDirection } from "@murphai/contracts";

import type { HealthCommonsWebBiomarkerIndex } from "./web-artifacts.ts";

export const HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS_SCHEMA_VERSION =
  "murph.commons.biomarker-desired-directions.v1" as const;

export interface HealthCommonsBiomarkerDesiredDirectionEntry {
  desiredDirection: HealthCommonsBiomarkerDesiredDirection;
  key: string;
}

export interface HealthCommonsBiomarkerDesiredDirectionsArtifact {
  biomarkers: HealthCommonsBiomarkerDesiredDirectionEntry[];
  catalogHash: string;
  schemaVersion: typeof HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS_SCHEMA_VERSION;
}

export function buildHealthCommonsBiomarkerDesiredDirectionsArtifact(
  biomarkerIndex: {
    biomarkers: ReadonlyArray<
      Pick<
        HealthCommonsWebBiomarkerIndex["biomarkers"][number],
        "desiredDirection" | "key"
      >
    >;
    catalogHash: string;
  },
): HealthCommonsBiomarkerDesiredDirectionsArtifact {
  return {
    biomarkers: biomarkerIndex.biomarkers
      .flatMap((biomarker) =>
        biomarker.desiredDirection === null
          ? []
          : [{
              desiredDirection: biomarker.desiredDirection,
              key: biomarker.key,
            }]
      )
      .sort((left, right) => left.key.localeCompare(right.key)),
    catalogHash: biomarkerIndex.catalogHash,
    schemaVersion: HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS_SCHEMA_VERSION,
  };
}
