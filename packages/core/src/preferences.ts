import {
  isWearablePreferenceProvider,
  legacyPreferencesDocumentSchemaVersion,
  normalizeWearablePreferenceProviders,
  preferencesDocumentRelativePath,
  preferencesDocumentSchema,
  preferencesDocumentSchemaVersion,
  type PreferencesDocument,
  type WearablePreferences,
  type WorkoutUnitPreferences,
} from "@murphai/contracts";

import {
  pathExists,
  readJsonFile,
} from "./fs.ts";
import {
  canonicalPathResource,
  runCanonicalWrite,
  withCanonicalResourceLocks,
} from "./operations/index.ts";
import { resolveVaultPath } from "./path-safety.ts";
import { isPlainRecord } from "./types.ts";

export type {
  PreferencesDocument,
  WearablePreferences,
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

  if (value.schemaVersion !== legacyPreferencesDocumentSchemaVersion) {
    return value;
  }

  const normalizedWorkoutUnitPreferences = normalizeWorkoutUnitPreferencesForRead(
    value.workoutUnitPreferences,
  );
  const wearablePreferences = normalizeWearablePreferencesForRead(
    value.wearablePreferences,
  );

  return {
    ...value,
    schemaVersion: preferencesDocumentSchemaVersion,
    workoutUnitPreferences: normalizedWorkoutUnitPreferences,
    wearablePreferences,
  };
}

function normalizeWorkoutUnitPreferencesForRead(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }

  if (!("distance" in value)) {
    return value;
  }

  const { distance: _removedDistance, ...normalizedWorkoutUnitPreferences } = value;
  return normalizedWorkoutUnitPreferences;
}

function normalizeWearablePreferencesForRead(value: unknown): WearablePreferences {
  if (!isPlainRecord(value) || !Array.isArray(value.desiredProviders)) {
    return { desiredProviders: [] };
  }

  const desiredProviders = normalizeWearablePreferenceProviders(
    value.desiredProviders.filter(isWearablePreferenceProvider),
  );

  return { desiredProviders };
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
      wearablePreferences: {
        desiredProviders: [],
      },
    };
  }

  const parsedDocument = preferencesDocumentSchema.parse(
    normalizePreferencesDocumentForRead(
      await readJsonFile(vaultRoot, resolved.relativePath),
    ),
  );
  const document: PreferencesDocument = {
    ...parsedDocument,
    wearablePreferences: normalizeWearablePreferencesForRead(
      parsedDocument.wearablePreferences,
    ),
  };

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
  return await withLockedPreferencesDocument(input.vaultRoot, async () => {
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
      wearablePreferences: current.wearablePreferences,
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
  });
}

export async function updateWearablePreferences(input: {
  vaultRoot: string;
  preferences: WearablePreferences;
  updatedAt?: string;
}): Promise<{
  created: boolean;
  updated: boolean;
  document: PreferencesDocumentSnapshot;
}> {
  return await withLockedPreferencesDocument(input.vaultRoot, async () => {
    const current = await readPreferencesDocument(input.vaultRoot);
    const nextPreferences = normalizeWearablePreferencesForRead(input.preferences);
    const hasChanges =
      JSON.stringify(current.wearablePreferences) !== JSON.stringify(nextPreferences);

    if (!hasChanges && current.exists) {
      return {
        created: false,
        updated: false,
        document: current,
      };
    }

    const document: PreferencesDocument = {
      schemaVersion: preferencesDocumentSchemaVersion,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
      workoutUnitPreferences: current.workoutUnitPreferences,
      wearablePreferences: nextPreferences,
    };

    await runCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: "preferences_update",
      summary: "Update canonical wearable preferences",
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
      updated: true,
      document: await readPreferencesDocument(input.vaultRoot),
    };
  });
}

async function withLockedPreferencesDocument<TResult>(
  vaultRoot: string,
  run: () => Promise<TResult>,
): Promise<TResult> {
  return await withCanonicalResourceLocks({
    vaultRoot,
    resources: [canonicalPathResource(preferencesDocumentRelativePath)],
    run,
  });
}
