import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, test } from "vitest";

import {
  initializeVault,
  readJsonlRecords,
  readPreferencesDocument,
  resolvePreferencesDocumentPath,
  updateAssistantPreferences,
  updateWearablePreferences,
  updateWorkoutUnitPreferences,
  validateVault,
} from "../src/index.ts";
import { resolveAuditShardPath } from "../src/audit.ts";

const createdVaultRoots: string[] = [];

function asAuditLikeRecord(value: unknown): {
  action?: string;
  commandName?: string;
  changes?: Array<{
    path?: string;
  }>;
} {
  return (typeof value === "object" && value !== null ? value : {}) as {
    action?: string;
    commandName?: string;
    changes?: Array<{
      path?: string;
    }>;
  };
}

async function createTempVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-core-preferences-"));
  createdVaultRoots.push(vaultRoot);
  await initializeVault({
    vaultRoot,
    title: "Preferences Test Vault",
    timezone: "UTC",
  });
  return vaultRoot;
}

async function countAssistantPreferenceAudits(
  vaultRoot: string,
  occurredAt: string,
): Promise<number> {
  const auditPath = path.join(vaultRoot, resolveAuditShardPath(occurredAt));
  let content: string;
  try {
    content = await readFile(auditPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }

  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => asAuditLikeRecord(JSON.parse(line) as unknown))
    .filter((record) => record.commandName === "core.updateAssistantPreferences")
    .length;
}

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map((vaultRoot) =>
      rm(vaultRoot, {
        recursive: true,
        force: true,
      })
    ),
  );
});

test("reads and writes canonical workout unit preferences from the singleton preferences owner", async () => {
  const vaultRoot = await createTempVault();

  const initial = await readPreferencesDocument(vaultRoot);
  assert.equal(initial.exists, false);
  assert.deepEqual(initial.workoutUnitPreferences, {});
  assert.deepEqual(initial.wearablePreferences, {
    desiredProviders: [],
  });
  assert.equal(initial.updatedAt, null);
  assert.equal(initial.sourcePath, "bank/preferences.json");
  assert.equal(
    resolvePreferencesDocumentPath(vaultRoot),
    path.join(vaultRoot, "bank/preferences.json"),
  );
  assert.equal(
    resolvePreferencesDocumentPath(vaultRoot),
    path.join(vaultRoot, "bank/preferences.json"),
  );

  const updated = await updateWorkoutUnitPreferences({
    vaultRoot,
    updatedAt: "2026-04-08T10:00:00.000Z",
    preferences: {
      weight: "lb",
      bodyMeasurement: "in",
    },
  });
  assert.equal(updated.created, true);
  assert.equal(updated.document.exists, true);
  assert.equal(updated.document.updatedAt, "2026-04-08T10:00:00.000Z");
  assert.deepEqual(updated.document.workoutUnitPreferences, {
    weight: "lb",
    bodyMeasurement: "in",
  });
  assert.deepEqual(updated.document.wearablePreferences, {
    desiredProviders: [],
  });

  const serialized = await readFile(path.join(vaultRoot, "bank/preferences.json"), "utf8");
  assert.match(serialized, /"schemaVersion": 1/u);
  assert.match(serialized, /"weight": "lb"/u);
  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: resolveAuditShardPath("2026-04-08T10:00:00.000Z"),
  });
  assert.ok(
    auditRecords.some((record) => {
      const audit = asAuditLikeRecord(record);
      return (
        audit.action === "preferences_update" &&
        audit.commandName === "core.updateWorkoutUnitPreferences" &&
        audit.changes?.[0]?.path === "bank/preferences.json"
      );
    }),
  );

  const noChange = await updateWorkoutUnitPreferences({
    vaultRoot,
    preferences: {
      weight: "lb",
    },
  });
  assert.equal(noChange.created, false);
  assert.equal(noChange.document.updatedAt, "2026-04-08T10:00:00.000Z");

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, true);
});

test("rejects legacy preference documents that still carry the removed distance key", async () => {
  const vaultRoot = await createTempVault();
  await writeFile(
    path.join(vaultRoot, "bank/preferences.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-04-08T10:00:00.000Z",
      workoutUnitPreferences: {
        weight: "kg",
        distance: "mi",
        bodyMeasurement: "cm",
      },
    }, null, 2)}\n`,
    "utf8",
  );

  await assert.rejects(() => readPreferencesDocument(vaultRoot));

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, false);
});

test("rejects invalid workout preference updates before writing", async () => {
  const vaultRoot = await createTempVault();

  await assert.rejects(() =>
    updateWorkoutUnitPreferences({
      vaultRoot,
      preferences: {
        distance: "mi",
      } as never,
      updatedAt: "2026-04-08T10:00:00.000Z",
    }),
  );

  const after = await readPreferencesDocument(vaultRoot);
  assert.equal(after.exists, false);
});

test("defaults updatedAt when writing new preferences without an explicit timestamp", async () => {
  const vaultRoot = await createTempVault();

  const updated = await updateWorkoutUnitPreferences({
    vaultRoot,
    preferences: {
      weight: "kg",
    },
  });

  assert.equal(updated.created, true);
  assert.equal(updated.document.exists, true);
  assert.equal(typeof updated.document.updatedAt, "string");
  assert.deepEqual(updated.document.workoutUnitPreferences, {
    weight: "kg",
  });
  assert.deepEqual(updated.document.wearablePreferences, {
    desiredProviders: [],
  });
});

test("serializes parallel workout unit preference updates against the singleton document", async () => {
  const vaultRoot = await createTempVault();

  await Promise.all([
    updateWorkoutUnitPreferences({
      vaultRoot,
      updatedAt: "2026-04-08T10:30:00.000Z",
      preferences: {
        weight: "lb",
      },
    }),
    updateWorkoutUnitPreferences({
      vaultRoot,
      updatedAt: "2026-04-08T10:30:01.000Z",
      preferences: {
        bodyMeasurement: "in",
      },
    }),
  ]);

  const document = await readPreferencesDocument(vaultRoot);
  assert.deepEqual(document.workoutUnitPreferences, {
    weight: "lb",
    bodyMeasurement: "in",
  });
});

test("serializes concurrent workout and wearable preference updates through the singleton document", async () => {
  const vaultRoot = await createTempVault();

  await Promise.all([
    updateWorkoutUnitPreferences({
      vaultRoot,
      updatedAt: "2026-04-08T10:40:00.000Z",
      preferences: {
        weight: "lb",
      },
    }),
    updateWearablePreferences({
      vaultRoot,
      updatedAt: "2026-04-08T10:40:01.000Z",
      preferences: {
        desiredProviders: ["whoop", "oura", "whoop"],
      },
    }),
  ]);

  const document = await readPreferencesDocument(vaultRoot);
  assert.deepEqual(document.workoutUnitPreferences, {
    weight: "lb",
  });
  assert.deepEqual(document.wearablePreferences, {
    desiredProviders: ["oura", "whoop"],
  });
});

test("reads and writes canonical wearable preferences from the singleton preferences owner", async () => {
  const vaultRoot = await createTempVault();

  const updated = await updateWearablePreferences({
    vaultRoot,
    updatedAt: "2026-04-08T10:00:00.000Z",
    preferences: {
      desiredProviders: ["whoop", "oura", "whoop"],
    },
  });
  assert.equal(updated.created, true);
  assert.equal(updated.updated, true);
  assert.equal(updated.document.exists, true);
  assert.deepEqual(updated.document.wearablePreferences, {
    desiredProviders: ["oura", "whoop"],
  });
  assert.deepEqual(updated.document.workoutUnitPreferences, {});

  const serialized = await readFile(path.join(vaultRoot, "bank/preferences.json"), "utf8");
  assert.match(serialized, /"desiredProviders": \[/u);
  assert.match(serialized, /"oura"/u);
  assert.match(serialized, /"whoop"/u);
  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: resolveAuditShardPath("2026-04-08T10:00:00.000Z"),
  });
  assert.ok(
    auditRecords.some((record) => {
      const audit = asAuditLikeRecord(record);
      return (
        audit.action === "preferences_update" &&
        audit.commandName === "core.updateWearablePreferences" &&
        audit.changes?.[0]?.path === "bank/preferences.json"
      );
    }),
  );

  const noChange = await updateWearablePreferences({
    vaultRoot,
    preferences: {
      desiredProviders: ["oura", "whoop"],
    },
  });
  assert.equal(noChange.created, false);
  assert.equal(noChange.updated, false);
  assert.equal(noChange.document.updatedAt, "2026-04-08T10:00:00.000Z");
});

test("reads and writes canonical assistant preferences from the singleton preferences owner", async () => {
  const vaultRoot = await createTempVault();

  const updated = await updateAssistantPreferences({
    vaultRoot,
    updatedAt: "2026-07-08T10:00:00.000Z",
    preferences: {
      tone: "formal",
      voice: "deep-calm",
    },
  });
  assert.equal(updated.created, true);
  assert.equal(updated.updated, true);
  assert.deepEqual(updated.document.assistant, {
    tone: "formal",
    voice: "deep-calm",
  });

  const serialized = await readFile(path.join(vaultRoot, "bank/preferences.json"), "utf8");
  assert.match(serialized, /"assistant": \{/u);
  assert.match(serialized, /"tone": "formal"/u);
  assert.match(serialized, /"voice": "deep-calm"/u);
  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: resolveAuditShardPath("2026-07-08T10:00:00.000Z"),
  });
  assert.ok(
    auditRecords.some((record) => {
      const audit = asAuditLikeRecord(record);
      return (
        audit.action === "preferences_update" &&
        audit.commandName === "core.updateAssistantPreferences" &&
        audit.changes?.[0]?.path === "bank/preferences.json"
      );
    }),
  );

  const noChange = await updateAssistantPreferences({
    vaultRoot,
    preferences: {
      tone: "formal",
    },
  });
  assert.equal(noChange.created, false);
  assert.equal(noChange.updated, false);
  assert.equal(noChange.document.updatedAt, "2026-07-08T10:00:00.000Z");

  await updateWorkoutUnitPreferences({
    vaultRoot,
    updatedAt: "2026-07-08T10:05:00.000Z",
    preferences: {
      weight: "kg",
    },
  });
  await updateWearablePreferences({
    vaultRoot,
    updatedAt: "2026-07-08T10:06:00.000Z",
    preferences: {
      desiredProviders: ["oura"],
    },
  });

  const document = await readPreferencesDocument(vaultRoot);
  assert.deepEqual(document.assistant, {
    tone: "formal",
    voice: "deep-calm",
  });
  assert.deepEqual(document.workoutUnitPreferences, {
    weight: "kg",
  });
  assert.deepEqual(document.wearablePreferences, {
    desiredProviders: ["oura"],
  });
});

test("stores sparse personality overrides while preserving every unrelated preference", async () => {
  const vaultRoot = await createTempVault();

  await updateAssistantPreferences({
    vaultRoot,
    updatedAt: "2026-07-10T10:00:00.000Z",
    preferences: {
      tone: "formal",
      voice: "deep-calm",
    },
  });
  await updateWorkoutUnitPreferences({
    vaultRoot,
    updatedAt: "2026-07-10T10:01:00.000Z",
    preferences: {
      weight: "kg",
      bodyMeasurement: "cm",
    },
  });
  await updateWearablePreferences({
    vaultRoot,
    updatedAt: "2026-07-10T10:02:00.000Z",
    preferences: {
      desiredProviders: ["whoop", "oura"],
    },
  });

  const firstPersonalityUpdate = await updateAssistantPreferences({
    vaultRoot,
    updatedAt: "2026-07-10T10:03:00.000Z",
    preferences: {
      personality: {
        humor: 9,
        detail: 5,
      },
    },
  });
  assert.equal(firstPersonalityUpdate.created, false);
  assert.equal(firstPersonalityUpdate.updated, true);
  assert.deepEqual(firstPersonalityUpdate.document.assistant, {
    tone: "formal",
    voice: "deep-calm",
    personality: {
      humor: 9,
      detail: 5,
    },
  });

  const secondPersonalityUpdate = await updateAssistantPreferences({
    vaultRoot,
    updatedAt: "2026-07-10T10:04:00.000Z",
    preferences: {
      personality: {
        push: 3,
      },
    },
  });
  assert.deepEqual(secondPersonalityUpdate.document.assistant, {
    tone: "formal",
    voice: "deep-calm",
    personality: {
      humor: 9,
      detail: 5,
      push: 3,
    },
  });
  assert.deepEqual(secondPersonalityUpdate.document.workoutUnitPreferences, {
    weight: "kg",
    bodyMeasurement: "cm",
  });
  assert.deepEqual(secondPersonalityUpdate.document.wearablePreferences, {
    desiredProviders: ["oura", "whoop"],
  });

  const serialized = JSON.parse(
    await readFile(path.join(vaultRoot, "bank/preferences.json"), "utf8"),
  ) as {
    assistant?: {
      personality?: Record<string, number>;
    };
  };
  assert.deepEqual(serialized.assistant?.personality, {
    humor: 9,
    detail: 5,
    push: 3,
  });
});

test("clears individual personality overrides and removes the empty personality object", async () => {
  const vaultRoot = await createTempVault();

  await updateAssistantPreferences({
    vaultRoot,
    updatedAt: "2026-07-10T11:00:00.000Z",
    preferences: {
      tone: "casual",
      voice: "upbeat",
      personality: {
        humor: 9,
        push: 8,
        detail: 2,
      },
    },
  });
  await updateWorkoutUnitPreferences({
    vaultRoot,
    updatedAt: "2026-07-10T11:01:00.000Z",
    preferences: {
      weight: "lb",
    },
  });
  await updateWearablePreferences({
    vaultRoot,
    updatedAt: "2026-07-10T11:02:00.000Z",
    preferences: {
      desiredProviders: ["garmin"],
    },
  });

  const partiallyCleared = await updateAssistantPreferences({
    vaultRoot,
    updatedAt: "2026-07-10T11:03:00.000Z",
    preferences: {
      personality: {
        push: null,
      },
    },
  });
  assert.deepEqual(partiallyCleared.document.assistant?.personality, {
    humor: 9,
    detail: 2,
  });

  const fullyCleared = await updateAssistantPreferences({
    vaultRoot,
    updatedAt: "2026-07-10T11:04:00.000Z",
    preferences: {
      personality: {
        humor: null,
        detail: null,
      },
    },
  });
  assert.equal(fullyCleared.updated, true);
  assert.deepEqual(fullyCleared.document.assistant, {
    tone: "casual",
    voice: "upbeat",
  });
  assert.deepEqual(fullyCleared.document.workoutUnitPreferences, {
    weight: "lb",
  });
  assert.deepEqual(fullyCleared.document.wearablePreferences, {
    desiredProviders: ["garmin"],
  });

  const personalityOnlyVaultRoot = await createTempVault();
  await updateAssistantPreferences({
    vaultRoot: personalityOnlyVaultRoot,
    preferences: {
      personality: {
        humor: 6,
      },
    },
  });
  const personalityOnlyCleared = await updateAssistantPreferences({
    vaultRoot: personalityOnlyVaultRoot,
    preferences: {
      personality: {
        humor: null,
      },
    },
  });
  assert.equal(personalityOnlyCleared.document.assistant, undefined);
});

test("treats clearing an absent personality override as a no-op without creating state", async () => {
  const vaultRoot = await createTempVault();
  const occurredAt = "2026-07-10T12:00:00.000Z";
  const auditCountBefore = await countAssistantPreferenceAudits(vaultRoot, occurredAt);

  const result = await updateAssistantPreferences({
    vaultRoot,
    updatedAt: occurredAt,
    preferences: {
      personality: {
        humor: null,
      },
    },
  });

  assert.equal(result.created, false);
  assert.equal(result.updated, false);
  assert.equal(result.document.exists, false);
  await assert.rejects(
    () => readFile(path.join(vaultRoot, "bank/preferences.json"), "utf8"),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
  );
  assert.equal(
    await countAssistantPreferenceAudits(vaultRoot, occurredAt),
    auditCountBefore,
  );
});

test("rejects empty, unknown, and invalid assistant personality updates before writing", async () => {
  const vaultRoot = await createTempVault();

  const invalidPreferences = [
    {},
    { personality: {} },
    { personality: { humor: -1 } },
    { personality: { push: 11 } },
    { personality: { detail: 2.5 } },
    { personality: { sarcasm: 8 } },
    { unknown: true },
  ];

  for (const preferences of invalidPreferences) {
    await assert.rejects(() =>
      updateAssistantPreferences({
        vaultRoot,
        preferences: preferences as never,
      }),
    );
  }

  assert.equal((await readPreferencesDocument(vaultRoot)).exists, false);
});

test("does not rewrite or re-audit no-op personality updates", async () => {
  const vaultRoot = await createTempVault();
  const occurredAt = "2026-07-10T13:00:00.000Z";

  await updateAssistantPreferences({
    vaultRoot,
    updatedAt: occurredAt,
    preferences: {
      personality: {
        humor: 9,
      },
    },
  });
  const auditCountAfterWrite = await countAssistantPreferenceAudits(vaultRoot, occurredAt);

  const repeated = await updateAssistantPreferences({
    vaultRoot,
    updatedAt: "2026-07-10T13:05:00.000Z",
    preferences: {
      personality: {
        humor: 9,
      },
    },
  });
  const absentReset = await updateAssistantPreferences({
    vaultRoot,
    updatedAt: "2026-07-10T13:06:00.000Z",
    preferences: {
      personality: {
        push: null,
      },
    },
  });

  assert.equal(repeated.updated, false);
  assert.equal(absentReset.updated, false);
  assert.equal(absentReset.document.updatedAt, occurredAt);
  assert.equal(
    await countAssistantPreferenceAudits(vaultRoot, occurredAt),
    auditCountAfterWrite,
  );
});

test("serializes concurrent updates to distinct personality settings", async () => {
  const vaultRoot = await createTempVault();

  await Promise.all([
    updateAssistantPreferences({
      vaultRoot,
      updatedAt: "2026-07-10T14:00:00.000Z",
      preferences: {
        personality: {
          humor: 10,
        },
      },
    }),
    updateAssistantPreferences({
      vaultRoot,
      updatedAt: "2026-07-10T14:00:01.000Z",
      preferences: {
        personality: {
          push: 8,
        },
      },
    }),
    updateAssistantPreferences({
      vaultRoot,
      updatedAt: "2026-07-10T14:00:02.000Z",
      preferences: {
        personality: {
          detail: 1,
        },
      },
    }),
  ]);

  assert.deepEqual((await readPreferencesDocument(vaultRoot)).assistant?.personality, {
    humor: 10,
    push: 8,
    detail: 1,
  });
});

test("rejects legacy preference documents without wearable preferences", async () => {
  const vaultRoot = await createTempVault();
  await writeFile(
    path.join(vaultRoot, "bank/preferences.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-04-08T10:00:00.000Z",
      workoutUnitPreferences: {
        weight: "kg",
      },
    }, null, 2)}\n`,
    "utf8",
  );

  await assert.rejects(() => readPreferencesDocument(vaultRoot));
});

test("rejects future preference schema versions instead of coercing them to the current shape", async () => {
  const vaultRoot = await createTempVault();
  await writeFile(
    path.join(vaultRoot, "bank/preferences.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      updatedAt: "2026-04-08T10:00:00.000Z",
      workoutUnitPreferences: {
        weight: "kg",
      },
      wearablePreferences: {
        desiredProviders: ["oura"],
      },
      futurePreference: {
        enabled: true,
      },
    }, null, 2)}\n`,
    "utf8",
  );

  await assert.rejects(() => readPreferencesDocument(vaultRoot));

  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, false);
  assert.match(
    validation.issues.map((issue) => issue.message).join("\n"),
    /schemaVersion/u,
  );
});
