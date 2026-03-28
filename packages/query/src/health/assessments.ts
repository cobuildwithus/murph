import {
  matchesLookup,
} from "./shared.ts";
import { readAssessmentEntitiesStrict } from "./entity-slices.ts";
import {
  compareAssessments,
  selectAssessmentRecords,
  toAssessmentRecord,
  type AssessmentListOptions,
  type AssessmentQueryRecord,
} from "./projections.ts";

export type { AssessmentListOptions, AssessmentQueryRecord } from "./projections.ts";
export { compareAssessments, toAssessmentRecord } from "./projections.ts";

export async function listAssessments(
  vaultRoot: string,
  options: AssessmentListOptions = {},
): Promise<AssessmentQueryRecord[]> {
  return selectAssessmentRecords(await readAssessmentEntitiesStrict(vaultRoot), options);
}

export async function readAssessment(
  vaultRoot: string,
  assessmentId: string,
): Promise<AssessmentQueryRecord | null> {
  const records = await listAssessments(vaultRoot);
  return records.find((record) => record.id === assessmentId) ?? null;
}

export async function showAssessment(
  vaultRoot: string,
  lookup: string,
): Promise<AssessmentQueryRecord | null> {
  const records = await listAssessments(vaultRoot);
  return records.find((record) => matchesLookup(lookup, record.id, record.title)) ?? null;
}
