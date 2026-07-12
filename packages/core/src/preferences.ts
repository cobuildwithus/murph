import {
  assistantPersonalityScoreSchema,
  assistantPersonalitySettingIds,
  assistantPreferenceMutationStateSchema,
  assistantPreferencesSchema,
  assistantTonePreferenceSchema,
  assistantVoiceOptionIdSchema,
  isAssistantPersonalitySettingId,
  isWearablePreferenceProvider,
  normalizeWearablePreferenceProviders,
  preferencesDocumentRelativePath,
  preferencesDocumentSchema,
  preferencesDocumentSchemaVersion,
  type AssistantPersonalityPreferences,
  type AssistantPersonalityScores,
  type AssistantPersonalitySettingId,
  type AssistantPreferenceFieldId,
  type AssistantPreferenceMutationState,
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
  tone?: AssistantTonePreference;
  voice?: AssistantVoiceOptionId;
  personality?: AssistantPersonalityPreferencesUpdate;
}

export interface PreferencesDocumentSnapshot extends Omit<PreferencesDocument, "updatedAt"> {
  exists: boolean;
  sourcePath: string;
  updatedAt: string | null;
}

const MAX_ASSISTANT_PREFERENCE_RESERVATIONS = 128;

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
    if (key !== "tone" && key !== "voice" && key !== "personality") {
      throw new TypeError(`Unknown assistant preference: ${key}.`);
    }
  }

  const nextPreferences: AssistantPreferencesUpdate = {};

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

function createAssistantPreferenceMutationState(): AssistantPreferenceMutationState {
  return {
    applied: {},
    nextRevision: "1",
    reservations: [],
  };
}

function advanceAssistantPreferenceRevision(
  state: AssistantPreferenceMutationState,
): { nextStateRevision: string; revision: string } {
  const revision = state.nextRevision;
  const nextStateRevision = (BigInt(revision) + 1n).toString();
  if (nextStateRevision.length > 39) {
    throw new RangeError("Assistant preference revision limit reached.");
  }
  return { nextStateRevision, revision };
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
    ...(allowed.has("tone") && preferences.tone !== undefined
      ? { tone: preferences.tone }
      : {}),
    ...(allowed.has("voice") && preferences.voice !== undefined
      ? { voice: preferences.voice }
      : {}),
    ...(Object.keys(personality).length > 0 ? { personality } : {}),
  };
}

function equalAssistantPreferenceFields(
  left: readonly AssistantPreferenceFieldId[],
  right: readonly AssistantPreferenceFieldId[],
): boolean {
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function buildPreferencesDocument(input: {
  assistant?: AssistantPreferences;
  assistantMutationState?: AssistantPreferenceMutationState;
  updatedAt: string;
  wearablePreferences: WearablePreferences;
  workoutUnitPreferences: WorkoutUnitPreferences;
}): PreferencesDocument {
  const document: PreferencesDocument = {
    schemaVersion: preferencesDocumentSchemaVersion,
    updatedAt: input.updatedAt,
    ...(input.assistant ? { assistant: input.assistant } : {}),
    ...(input.assistantMutationState
      ? { assistantMutationState: input.assistantMutationState }
      : {}),
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
    await readJsonFile(vaultRoot, resolved.relativePath),
  );
  const assistantPreferences = normalizeAssistantPreferencesForRead(parsedDocument.assistant);
  const document = buildPreferencesDocument({
    ...(assistantPreferences ? { assistant: assistantPreferences } : {}),
    ...(parsedDocument.assistantMutationState
      ? { assistantMutationState: parsedDocument.assistantMutationState }
      : {}),
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
      ...(current.assistantMutationState
        ? { assistantMutationState: current.assistantMutationState }
        : {}),
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
      ...(current.assistantMutationState
        ? { assistantMutationState: current.assistantMutationState }
        : {}),
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

export async function reserveAssistantPreferenceMutation(input: {
  eventId: string;
  vaultRoot: string;
  preferences: AssistantPreferencesUpdate;
  updatedAt?: string;
}): Promise<{
  fields: AssistantPreferenceFieldId[];
  revision: string;
}> {
  return await withLockedPreferencesDocument(input.vaultRoot, async () => {
    const eventId = input.eventId.trim();
    if (eventId.length === 0 || eventId.length > 512) {
      throw new TypeError("Assistant preference reservation event id is invalid.");
    }
    const requestedPreferences = normalizeAssistantPreferencesForWrite(input.preferences);
    const fields = resolveAssistantPreferenceFieldIds(requestedPreferences);
    if (fields.length === 0) {
      throw new TypeError("At least one assistant preference is required.");
    }

    const current = await readPreferencesDocument(input.vaultRoot);
    const state = current.assistantMutationState ?? createAssistantPreferenceMutationState();
    const existing = state.reservations.find((reservation) => reservation.eventId === eventId);
    if (existing) {
      if (!equalAssistantPreferenceFields(existing.fields, fields)) {
        throw new TypeError("Assistant preference reservation event id was reused.");
      }
      return {
        fields: [...existing.fields],
        revision: existing.revision,
      };
    }
    let retainedReservations = state.reservations;
    if (retainedReservations.length >= MAX_ASSISTANT_PREFERENCE_RESERVATIONS) {
      const oldestHandledIndex = retainedReservations.findIndex(
        (reservation) => reservation.status === "handled",
      );
      if (oldestHandledIndex < 0) {
        throw new RangeError("Assistant preference reservation limit reached.");
      }
      retainedReservations = retainedReservations.filter(
        (_, index) => index !== oldestHandledIndex,
      );
    }

    const { nextStateRevision, revision } = advanceAssistantPreferenceRevision(state);
    const nextState = assistantPreferenceMutationStateSchema.parse({
      ...state,
      nextRevision: nextStateRevision,
      reservations: [
        ...retainedReservations,
        { eventId, fields, revision, status: "pending" },
      ],
    });
    const operationAt = input.updatedAt ?? new Date().toISOString();
    const validatedDocument = buildPreferencesDocument({
      ...(current.assistant ? { assistant: current.assistant } : {}),
      assistantMutationState: nextState,
      updatedAt: current.updatedAt ?? operationAt,
      workoutUnitPreferences: current.workoutUnitPreferences,
      wearablePreferences: current.wearablePreferences,
    });

    await commitAuditedCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: "preferences_update",
      summary: "Reserve canonical assistant preference ordering",
      occurredAt: operationAt,
      audit: {
        action: "preferences_update",
        commandName: "core.reserveAssistantPreferenceMutation",
        summary: "Reserved canonical assistant preference ordering.",
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

    return { fields, revision };
  });
}

export async function updateAssistantPreferences(input: {
  vaultRoot: string;
  preferences: AssistantPreferencesUpdate;
  reservationEventId?: string;
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
    const state = current.assistantMutationState ?? createAssistantPreferenceMutationState();
    const unguardedNextPreferences = mergeAssistantPreferences(
      current.assistant,
      requestedPreferences,
    );
    const requestedHasChanges =
      JSON.stringify(current.assistant ?? {})
      !== JSON.stringify(unguardedNextPreferences ?? {});
    let nextState: AssistantPreferenceMutationState;
    let applicableFields: AssistantPreferenceFieldId[];
    if (input.reservationEventId !== undefined) {
      const reservation = state.reservations.find(
        (candidate) => candidate.eventId === input.reservationEventId,
      );
      if (!reservation) {
        throw new TypeError("Assistant preference reservation is missing.");
      }
      if (!equalAssistantPreferenceFields(reservation.fields, requestedFields)) {
        throw new TypeError("Assistant preference reservation fields do not match.");
      }
      if (reservation.status === "handled") {
        return {
          created: false,
          updated: false,
          document: current,
        };
      }
      applicableFields = requestedFields.filter((field) => {
        const appliedRevision = state.applied[field];
        return appliedRevision === undefined
          || BigInt(reservation.revision) >= BigInt(appliedRevision);
      });
      nextState = assistantPreferenceMutationStateSchema.parse({
        ...state,
        applied: {
          ...state.applied,
          ...Object.fromEntries(
            applicableFields.map((field) => [field, reservation.revision]),
          ),
        },
        reservations: state.reservations.map(
          (candidate) => candidate.eventId === input.reservationEventId
            ? { ...candidate, status: "handled" as const }
            : candidate,
        ),
      });
    } else {
      const overlapsPendingReservation = state.reservations.some(
        (reservation) => reservation.status === "pending"
          && reservation.fields.some((field) => requestedFields.includes(field)),
      );
      if (!requestedHasChanges && !overlapsPendingReservation) {
        return {
          created: false,
          updated: false,
          document: current,
        };
      }
      const { nextStateRevision, revision } = advanceAssistantPreferenceRevision(state);
      applicableFields = requestedFields;
      nextState = assistantPreferenceMutationStateSchema.parse({
        ...state,
        applied: {
          ...state.applied,
          ...Object.fromEntries(requestedFields.map((field) => [field, revision])),
        },
        nextRevision: nextStateRevision,
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

    const operationAt = input.updatedAt ?? new Date().toISOString();
    const validatedDocument = buildPreferencesDocument({
      ...(nextPreferences ? { assistant: nextPreferences } : {}),
      assistantMutationState: nextState,
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
