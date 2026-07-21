import {
  assistantPersonaIdSchema,
  assistantPersonalityScoreSchema,
  assistantPersonalitySettingIds,
  assistantPreferenceCausalSeqSchema,
  assistantPreferenceMutationStateDocumentSchema,
  assistantPreferenceMutationStateRelativePath,
  assistantPreferenceMutationStateSchema,
  assistantPreferenceMutationStateSchemaVersion,
  assistantPreferencesSchema,
  assistantTonePreferenceSchema,
  assistantVoiceOptionIdSchema,
  isAssistantPersonalitySettingId,
  isWearablePreferenceProvider,
  normalizeStoredAssistantPersonaId,
  normalizeWearablePreferenceProviders,
  preferencesDocumentRelativePath,
  preferencesDocumentSchema,
  preferencesDocumentSchemaVersion,
  type AssistantPersonaId,
  type AssistantPersonalityPreferences,
  type AssistantPersonalityScores,
  type AssistantPersonalitySettingId,
  type AssistantPreferenceFieldId,
  type AssistantPreferenceMutationState,
  type AssistantPreferenceMutationStateDocument,
  type AssistantPreferences,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
  type PreferencesDocument,
  type WearablePreferences,
  type WorkoutUnitPreferences,
} from "@murphai/contracts";

import {
  pathExists,
  readJsonFile,
} from "./fs.ts";
import {
  canonicalPathResourceForVault,
  withCanonicalResourceLocks,
} from "./operations/index.ts";
import { resolveVaultPath } from "./path-safety.ts";
import { commitAuditedCanonicalWrite } from "./audited-write.ts";
import { isPlainRecord } from "./types.ts";

export type {
  AssistantPersonaId,
  AssistantPersonalityPreferences,
  AssistantPersonalityScores,
  AssistantPersonalitySettingId,
  AssistantPreferences,
  AssistantTonePreference,
  AssistantVoiceOptionId,
  PreferencesDocument,
  WearablePreferences,
  WorkoutUnitPreferences,
} from "@murphai/contracts";

export type AssistantPersonalityPreferencesUpdate = {
  [TSetting in AssistantPersonalitySettingId]?: AssistantPersonalityScores[TSetting] | null;
};

export interface AssistantPreferencesUpdate {
  persona?: AssistantPersonaId;
  tone?: AssistantTonePreference;
  voice?: AssistantVoiceOptionId;
  personality?: AssistantPersonalityPreferencesUpdate;
}

export interface PreferencesDocumentSnapshot extends Omit<PreferencesDocument, "updatedAt"> {
  exists: boolean;
  sourcePath: string;
  updatedAt: string | null;
}

export function resolvePreferencesDocumentPath(vaultRoot: string): string {
  return resolveVaultPath(vaultRoot, preferencesDocumentRelativePath).absolutePath;
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

function normalizePreferencesDocumentForRead(value: unknown): unknown {
  if (!isPlainRecord(value) || !isPlainRecord(value.assistant)) {
    return value;
  }

  const persona = normalizeStoredAssistantPersonaId(value.assistant.persona);
  if (persona === null || persona === value.assistant.persona) {
    return value;
  }

  return {
    ...value,
    assistant: {
      ...value.assistant,
      persona,
    },
  };
}

function normalizeAssistantPreferencesForRead(value: unknown): AssistantPreferences | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const parsedPreferences = assistantPreferencesSchema.parse(value);
  return Object.keys(parsedPreferences).length > 0 ? parsedPreferences : undefined;
}

function normalizeAssistantPreferencesForWrite(
  preferences: AssistantPreferencesUpdate,
): AssistantPreferencesUpdate {
  if (!isPlainRecord(preferences)) {
    throw new TypeError("Assistant preferences must be an object.");
  }
  for (const key of Object.keys(preferences)) {
    if (
      key !== "persona"
      && key !== "tone"
      && key !== "voice"
      && key !== "personality"
    ) {
      throw new TypeError(`Unknown assistant preference: ${key}.`);
    }
  }

  const nextPreferences: AssistantPreferencesUpdate = {};

  if (preferences.persona !== undefined) {
    nextPreferences.persona = assistantPersonaIdSchema.parse(preferences.persona);
  }
  if (preferences.tone !== undefined) {
    nextPreferences.tone = assistantTonePreferenceSchema.parse(preferences.tone);
  }
  if (preferences.voice !== undefined) {
    nextPreferences.voice = assistantVoiceOptionIdSchema.parse(preferences.voice);
  }
  if (preferences.personality !== undefined) {
    if (!isPlainRecord(preferences.personality)) {
      throw new TypeError("Assistant personality preferences must be an object.");
    }

    const personality: AssistantPersonalityPreferencesUpdate = {};
    for (const key of Object.keys(preferences.personality)) {
      if (!isAssistantPersonalitySettingId(key)) {
        throw new TypeError(`Unknown assistant personality preference: ${key}.`);
      }
    }
    for (const settingId of assistantPersonalitySettingIds) {
      const value = preferences.personality[settingId];
      if (value !== undefined) {
        personality[settingId] =
          value === null ? null : assistantPersonalityScoreSchema.parse(value);
      }
    }
    nextPreferences.personality = personality;
  }

  return nextPreferences;
}

function mergeAssistantPreferences(
  current: AssistantPreferences | undefined,
  preferences: AssistantPreferencesUpdate,
): AssistantPreferences | undefined {
  const nextPreferences: AssistantPreferences = {
    ...(current ?? {}),
  };

  if (preferences.persona !== undefined) {
    nextPreferences.persona = preferences.persona;
  }
  if (preferences.tone !== undefined) {
    nextPreferences.tone = preferences.tone;
  }
  if (preferences.voice !== undefined) {
    nextPreferences.voice = preferences.voice;
  }
  if (preferences.personality !== undefined) {
    const nextPersonality: AssistantPersonalityPreferences = {
      ...(current?.personality ?? {}),
    };

    for (const settingId of assistantPersonalitySettingIds) {
      const value = preferences.personality[settingId];
      if (value === null) {
        delete nextPersonality[settingId];
      } else if (value !== undefined) {
        nextPersonality[settingId] = value;
      }
    }

    if (Object.keys(nextPersonality).length > 0) {
      nextPreferences.personality = nextPersonality;
    } else {
      delete nextPreferences.personality;
    }
  }

  return Object.keys(nextPreferences).length > 0
    ? assistantPreferencesSchema.parse(nextPreferences)
    : undefined;
}

function resolveAssistantPreferenceFieldIds(
  preferences: AssistantPreferencesUpdate,
): AssistantPreferenceFieldId[] {
  const fields: AssistantPreferenceFieldId[] = [];
  if (preferences.persona !== undefined) {
    fields.push("persona");
  }
  if (preferences.tone !== undefined) {
    fields.push("tone");
  }
  if (preferences.voice !== undefined) {
    fields.push("voice");
  }
  for (const settingId of assistantPersonalitySettingIds) {
    if (preferences.personality?.[settingId] !== undefined) {
      fields.push(settingId);
    }
  }
  return fields;
}

async function readAssistantPreferenceMutationState(
  vaultRoot: string,
): Promise<AssistantPreferenceMutationStateDocument & { exists: boolean }> {
  const resolved = resolveVaultPath(
    vaultRoot,
    assistantPreferenceMutationStateRelativePath,
  );
  if (!(await pathExists(resolved.absolutePath))) {
    return {
      exists: false,
      schemaVersion: assistantPreferenceMutationStateSchemaVersion,
      applied: {},
    };
  }

  return {
    exists: true,
    ...assistantPreferenceMutationStateDocumentSchema.parse(
      await readJsonFile(vaultRoot, resolved.relativePath),
    ),
  };
}

function filterAssistantPreferencesByFields(
  preferences: AssistantPreferencesUpdate,
  fields: readonly AssistantPreferenceFieldId[],
): AssistantPreferencesUpdate {
  const allowed = new Set<AssistantPreferenceFieldId>(fields);
  const personality: AssistantPersonalityPreferencesUpdate = {};
  for (const settingId of assistantPersonalitySettingIds) {
    if (allowed.has(settingId) && preferences.personality?.[settingId] !== undefined) {
      personality[settingId] = preferences.personality[settingId];
    }
  }
  return {
    ...(allowed.has("persona") && preferences.persona !== undefined
      ? { persona: preferences.persona }
      : {}),
    ...(allowed.has("tone") && preferences.tone !== undefined
      ? { tone: preferences.tone }
      : {}),
    ...(allowed.has("voice") && preferences.voice !== undefined
      ? { voice: preferences.voice }
      : {}),
    ...(Object.keys(personality).length > 0 ? { personality } : {}),
  };
}

function buildPreferencesDocument(input: {
  assistant?: AssistantPreferences;
  updatedAt: string;
  wearablePreferences: WearablePreferences;
  workoutUnitPreferences: WorkoutUnitPreferences;
}): PreferencesDocument {
  const document: PreferencesDocument = {
    schemaVersion: preferencesDocumentSchemaVersion,
    updatedAt: input.updatedAt,
    ...(input.assistant ? { assistant: input.assistant } : {}),
    workoutUnitPreferences: input.workoutUnitPreferences,
    wearablePreferences: input.wearablePreferences,
  };

  return preferencesDocumentSchema.parse(document);
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
  const assistantPreferences = normalizeAssistantPreferencesForRead(parsedDocument.assistant);
  const document = buildPreferencesDocument({
    ...(assistantPreferences ? { assistant: assistantPreferences } : {}),
    updatedAt: parsedDocument.updatedAt,
    workoutUnitPreferences: parsedDocument.workoutUnitPreferences,
    wearablePreferences: normalizeWearablePreferencesForRead(
      parsedDocument.wearablePreferences,
    ),
  });

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

    const validatedDocument = buildPreferencesDocument({
      ...(current.assistant ? { assistant: current.assistant } : {}),
      updatedAt: input.updatedAt ?? new Date().toISOString(),
      workoutUnitPreferences: nextPreferences,
      wearablePreferences: current.wearablePreferences,
    });

    await commitAuditedCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: "preferences_update",
      summary: "Update canonical workout unit preferences",
      occurredAt: validatedDocument.updatedAt,
      audit: {
        action: "preferences_update",
        commandName: "core.updateWorkoutUnitPreferences",
        summary: "Updated canonical workout unit preferences.",
      },
      mutate: async ({ batch }) => {
        await batch.stageTextWrite(
          preferencesDocumentRelativePath,
          `${JSON.stringify(validatedDocument, null, 2)}\n`,
          { overwrite: true },
        );

        return {
          result: null,
          changes: [
            {
              path: preferencesDocumentRelativePath,
              op: current.exists ? "update" : "create",
            },
          ],
        };
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

    const validatedDocument = buildPreferencesDocument({
      ...(current.assistant ? { assistant: current.assistant } : {}),
      updatedAt: input.updatedAt ?? new Date().toISOString(),
      workoutUnitPreferences: current.workoutUnitPreferences,
      wearablePreferences: nextPreferences,
    });

    await commitAuditedCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: "preferences_update",
      summary: "Update canonical wearable preferences",
      occurredAt: validatedDocument.updatedAt,
      audit: {
        action: "preferences_update",
        commandName: "core.updateWearablePreferences",
        summary: "Updated canonical wearable preferences.",
      },
      mutate: async ({ batch }) => {
        await batch.stageTextWrite(
          preferencesDocumentRelativePath,
          `${JSON.stringify(validatedDocument, null, 2)}\n`,
          { overwrite: true },
        );

        return {
          result: null,
          changes: [
            {
              path: preferencesDocumentRelativePath,
              op: current.exists ? "update" : "create",
            },
          ],
        };
      },
    });

    return {
      created: !current.exists,
      updated: true,
      document: await readPreferencesDocument(input.vaultRoot),
    };
  });
}

export async function updateAssistantPreferences(input: {
  causalOrigin?: "event" | "turn";
  causalSeq?: string;
  vaultRoot: string;
  preferences: AssistantPreferencesUpdate;
  updatedAt?: string;
}): Promise<{
  created: boolean;
  updated: boolean;
  document: PreferencesDocumentSnapshot;
}> {
  return await withLockedPreferencesDocument(input.vaultRoot, async () => {
    const requestedPreferences = normalizeAssistantPreferencesForWrite(input.preferences);
    const requestedFields = resolveAssistantPreferenceFieldIds(requestedPreferences);
    if (requestedFields.length === 0) {
      throw new TypeError("At least one assistant preference is required.");
    }

    const current = await readPreferencesDocument(input.vaultRoot);
    const stateDocument = await readAssistantPreferenceMutationState(input.vaultRoot);
    const state = assistantPreferenceMutationStateSchema.parse({
      applied: stateDocument.applied,
    });
    const causalSeq = input.causalSeq === undefined
      ? null
      : assistantPreferenceCausalSeqSchema.parse(input.causalSeq);
    let nextState: AssistantPreferenceMutationState;
    let applicableFields: AssistantPreferenceFieldId[];
    if (causalSeq !== null) {
      const causalOrder = BigInt(causalSeq);
      applicableFields = requestedFields.filter((field) => {
        const appliedCausalSeq = state.applied[field];
        return appliedCausalSeq === undefined
          || causalOrder > BigInt(appliedCausalSeq)
          || (
            input.causalOrigin === "turn"
            && causalSeq !== "0"
            && causalOrder === BigInt(appliedCausalSeq)
          );
      });
      nextState = assistantPreferenceMutationStateSchema.parse({
        applied: {
          ...state.applied,
          ...Object.fromEntries(
            applicableFields.map((field) => [field, causalSeq]),
          ),
        },
      });
    } else {
      applicableFields = requestedFields;
      nextState = assistantPreferenceMutationStateSchema.parse({
        applied: Object.fromEntries(
          Object.entries(state.applied).filter(([field]) =>
            !requestedFields.includes(field as AssistantPreferenceFieldId)
          ),
        ),
      });
    }
    const applicablePreferences = filterAssistantPreferencesByFields(
      requestedPreferences,
      applicableFields,
    );
    const nextPreferences = mergeAssistantPreferences(
      current.assistant,
      applicablePreferences,
    );
    const hasChanges =
      JSON.stringify(current.assistant ?? {}) !== JSON.stringify(nextPreferences ?? {});
    const hasMutationStateChanges =
      JSON.stringify(state) !== JSON.stringify(nextState);

    if (!hasChanges && !hasMutationStateChanges) {
      return {
        created: false,
        updated: false,
        document: current,
      };
    }

    const operationAt = input.updatedAt ?? new Date().toISOString();
    const validatedDocument = buildPreferencesDocument({
      ...(nextPreferences ? { assistant: nextPreferences } : {}),
      updatedAt: hasChanges ? operationAt : (current.updatedAt ?? operationAt),
      workoutUnitPreferences: current.workoutUnitPreferences,
      wearablePreferences: current.wearablePreferences,
    });

    await commitAuditedCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: "preferences_update",
      summary: "Update canonical assistant preferences",
      occurredAt: operationAt,
      audit: {
        action: "preferences_update",
        commandName: "core.updateAssistantPreferences",
        summary: "Updated canonical assistant preferences.",
      },
      mutate: async ({ batch }) => {
        await batch.stageTextWrite(
          preferencesDocumentRelativePath,
          `${JSON.stringify(validatedDocument, null, 2)}\n`,
          { overwrite: true },
        );
        if (hasMutationStateChanges) {
          const validatedState = assistantPreferenceMutationStateDocumentSchema.parse({
            schemaVersion: assistantPreferenceMutationStateSchemaVersion,
            applied: nextState.applied,
          });
          await batch.stageTextWrite(
            assistantPreferenceMutationStateRelativePath,
            `${JSON.stringify(validatedState, null, 2)}\n`,
            { overwrite: true },
          );
        }

        return {
          result: null,
          changes: [
            {
              path: preferencesDocumentRelativePath,
              op: current.exists ? "update" : "create",
            },
            ...(hasMutationStateChanges
              ? [{
                  path: assistantPreferenceMutationStateRelativePath,
                  op: stateDocument.exists ? "update" as const : "create" as const,
                }]
              : []),
          ],
        };
      },
    });

    return {
      created: !current.exists,
      updated: hasChanges,
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
    resources: [await canonicalPathResourceForVault(vaultRoot, preferencesDocumentRelativePath)],
    run,
  });
}
