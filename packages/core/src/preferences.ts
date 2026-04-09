import {
  preferencesDocumentRelativePath,
  preferencesDocumentSchema,
  preferencesDocumentSchemaVersion,
  type PreferencesDocument,
  type WorkoutUnitPreferences,
} from "@murphai/contracts";

import {
  pathExists,
  readJsonFile,
} from "./fs.ts";
import { runCanonicalWrite } from "./operations/write-batch.ts";
import { resolveVaultPath } from "./path-safety.ts";
import { isPlainRecord } from "./types.ts";

export type {
  PreferencesDocument,
  WorkoutUnitPreferences,
} from "@murphai/contracts";

export interface PreferencesDocumentSnapshot extends Omit<PreferencesDocument, "updatedAt"> {
  exists: boolean;
  sourcePath: string;
  updatedAt: string | null;
}

export function resolvePreferencesDocumentPath(vaultRoot: string): string {
  return resolveVaultPath(vaultRoot, preferencesDocumentRelativePath).absolutePath;
}

function normalizePreferencesDocumentForRead(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }

  const workoutUnitPreferences = value.workoutUnitPreferences;
  if (!isPlainRecord(workoutUnitPreferences) || !("distance" in workoutUnitPreferences)) {
    return value;
  }

  const { distance: _removedDistance, ...normalizedWorkoutUnitPreferences } = workoutUnitPreferences;
  return {
    ...value,
    workoutUnitPreferences: normalizedWorkoutUnitPreferences,
  };
}

export async function readPreferencesDocument(
  vaultRoot: string,
): Promise<PreferencesDocumentSnapshot> {
  const resolved = resolveVaultPath(vaultRoot, preferencesDocumentRelativePath);

  if (!(await pathExists(resolved.absolutePath))) {
    return {
      exists: false,
      schemaVersion: preferencesDocumentSchemaVersion,
      sourcePath: resolved.relativePath,
      updatedAt: null,
      workoutUnitPreferences: {},
    };
  }

  const document = preferencesDocumentSchema.parse(
    normalizePreferencesDocumentForRead(
      await readJsonFile(vaultRoot, resolved.relativePath),
    ),
  );

  return {
    ...document,
    exists: true,
    sourcePath: resolved.relativePath,
    updatedAt: document.updatedAt,
  };
}

export async function updateWorkoutUnitPreferences(input: {
  vaultRoot: string;
  preferences: WorkoutUnitPreferences;
  updatedAt?: string;
}): Promise<{
  created: boolean;
  document: PreferencesDocumentSnapshot;
}> {
  const current = await readPreferencesDocument(input.vaultRoot);
  const nextPreferences = {
    ...current.workoutUnitPreferences,
    ...input.preferences,
  };
  const hasChanges =
    JSON.stringify(current.workoutUnitPreferences) !== JSON.stringify(nextPreferences);

  if (!hasChanges) {
    return {
      created: false,
      document: current,
    };
  }

  const document: PreferencesDocument = {
    schemaVersion: preferencesDocumentSchemaVersion,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    workoutUnitPreferences: nextPreferences,
  };

  await runCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: "preferences_update",
    summary: "Update canonical workout unit preferences",
    occurredAt: document.updatedAt,
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(
        preferencesDocumentRelativePath,
        `${JSON.stringify(document, null, 2)}\n`,
        { overwrite: true },
      );

      return null;
    },
  });

  return {
    created: !current.exists,
    document: await readPreferencesDocument(input.vaultRoot),
  };
}
