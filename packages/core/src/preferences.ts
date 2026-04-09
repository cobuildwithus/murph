import {
  createEmptyPreferencesDocument,
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

export async function readPreferencesDocument(
  vaultRoot: string,
): Promise<PreferencesDocumentSnapshot> {
  const resolved = resolveVaultPath(vaultRoot, preferencesDocumentRelativePath);

  if (!(await pathExists(resolved.absolutePath))) {
    const document = createEmptyPreferencesDocument();
    return {
      ...document,
      exists: false,
      sourcePath: resolved.relativePath,
      updatedAt: null,
    };
  }

  const document = preferencesDocumentSchema.parse(
    await readJsonFile(vaultRoot, resolved.relativePath),
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
