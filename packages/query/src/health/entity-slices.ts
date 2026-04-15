import { VAULT_LAYOUT } from "@murphai/contracts";

import {
  compareCanonicalEntities,
  type CanonicalEntity,
} from "../canonical-entities.ts";
import { projectAssessmentEntity } from "./projectors/assessment.ts";
import {
  readJsonlRecordOutcomes,
  readJsonlRecordOutcomesSync,
  readJsonlRecords,
  readJsonlRecordsSync,
  type JsonlRecordOutcome,
  type ParseFailure,
} from "./loaders.ts";

export interface EntityCollection {
  entities: CanonicalEntity[];
  failures: ParseFailure[];
}

export async function readAssessmentEntitiesStrict(
  vaultRoot: string,
): Promise<CanonicalEntity[]> {
  return readJsonlEntitiesStrict(vaultRoot, VAULT_LAYOUT.assessmentLedgerDirectory, projectAssessmentEntity);
}

export async function readJsonlEntitiesStrict(
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): Promise<CanonicalEntity[]> {
  return (await readJsonlRecords(vaultRoot, relativeRoot))
    .map((entry) => project(entry.value, entry.relativePath))
    .filter((entity): entity is CanonicalEntity => entity !== null)
    .sort(compareCanonicalEntities);
}

export function readJsonlEntitiesStrictSync(
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): CanonicalEntity[] {
  return readJsonlRecordsSync(vaultRoot, relativeRoot)
    .map((entry) => project(entry.value, entry.relativePath))
    .filter((entity): entity is CanonicalEntity => entity !== null)
    .sort(compareCanonicalEntities);
}

export async function readJsonlEntitiesTolerant(
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): Promise<EntityCollection> {
  return projectJsonlOutcomes(
    await readJsonlRecordOutcomes(vaultRoot, relativeRoot),
    project,
  );
}

export function readJsonlEntitiesTolerantSync(
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): EntityCollection {
  return projectJsonlOutcomes(readJsonlRecordOutcomesSync(vaultRoot, relativeRoot), project);
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
