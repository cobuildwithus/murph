import { VAULT_LAYOUT } from "@murphai/contracts";

import {
  compareCanonicalEntities,
  type CanonicalEntity,
} from "../canonical-entities.ts";
import { projectAssessmentEntity } from "./projectors/assessment.ts";
import {
  readJsonlRecordOutcomes,
  readJsonlRecords,
  type JsonlRecordOutcome,
  type ParseFailure,
} from "./loaders.ts";

export interface EntityCollection {
  entities: CanonicalEntity[];
  failures: ParseFailure[];
}

export async function readAssessmentEntitiesStrict(
  vaultRoot: string,
  options: { signal?: AbortSignal } = {},
): Promise<CanonicalEntity[]> {
  return readJsonlEntitiesStrict(
    vaultRoot,
    VAULT_LAYOUT.assessmentLedgerDirectory,
    projectAssessmentEntity,
    options,
  );
}

export async function readJsonlEntitiesStrict(
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
  options: { signal?: AbortSignal } = {},
): Promise<CanonicalEntity[]> {
  return (await readJsonlRecords(vaultRoot, relativeRoot, options))
    .map((entry) => project(entry.value, entry.relativePath))
    .filter((entity): entity is CanonicalEntity => entity !== null)
    .sort(compareCanonicalEntities);
}

export async function readJsonlEntitiesTolerant(
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
  options: { signal?: AbortSignal } = {},
): Promise<EntityCollection> {
  return projectJsonlOutcomes(
    await readJsonlRecordOutcomes(vaultRoot, relativeRoot, options),
    project,
  );
}

function projectJsonlOutcomes(
  outcomes: JsonlRecordOutcome[],
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): EntityCollection {
  const entities: CanonicalEntity[] = [];
  const failures: ParseFailure[] = [];

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failures.push(outcome);
      continue;
    }

    const entity = project(outcome.value, outcome.relativePath);
    if (entity) {
      entities.push(entity);
    }
  }

  return {
    entities: entities.sort(compareCanonicalEntities),
    failures,
  };
}
