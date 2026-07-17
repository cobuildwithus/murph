import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, test, vi } from "vitest";

import { importWithMocks } from "./mock-import.ts";

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);

const withCanonicalWriteLock = async <T>(
  _vaultRoot: string | undefined,
  run: () => Promise<T>,
): Promise<T> => run();

const mockExperimentDocumentRead = async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  return {
    ...actual,
    readFile: vi.fn(async () => "---\n"),
  };
};

afterEach(() => {
  vi.doUnmock("../src/query-runtime.js");
  vi.doUnmock("../src/runtime-import.js");
  vi.restoreAllMocks();
});

test("applyExperimentOnboardingRecord writes structured run-plan schedules", async () => {
  const experimentEntity = {
    entityId: "exp_01JNV44P4R5SWC90K2AHXQJQYT",
    family: "experiment",
    kind: "experiment",
    title: "Sauna Daily",
    status: "planned",
    occurredAt: null,
    date: null,
    path: "bank/experiments/sauna-daily.md",
    body: "---\n",
    attributes: {
      schemaVersion: "murph.frontmatter.experiment.v1",
      docType: "experiment",
      experimentId: "exp_01JNV44P4R5SWC90K2AHXQJQYT",
      slug: "sauna-daily",
      status: "planned",
      title: "Sauna Daily",
      startedOn: "2026-04-29",
    },
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: "sauna-daily",
    tags: [],
    frontmatter: null,
  };
  const queryRuntime = {
    readVault: vi.fn(async () => ({ entities: [experimentEntity] })),
    lookupEntityById: vi.fn(() => experimentEntity),
  };
  const updateExperiment = vi.fn(
    async (_input: { runPlan?: { schedule?: unknown } }) => ({
      experimentId: "exp_01JNV44P4R5SWC90K2AHXQJQYT",
      slug: "sauna-daily",
      relativePath: "bank/experiments/sauna-daily.md",
      status: "planned",
      updated: true as const,
    }),
  );

  const module = await importWithMocks<
    typeof import("../src/usecases/experiment-journal-vault.ts")
  >("../src/usecases/experiment-journal-vault.ts", {
    "../src/query-runtime.js": () => ({
      loadQueryRuntime: vi.fn(async () => queryRuntime),
    }),
    "../src/runtime-import.js": () => ({
      loadRuntimeModule: vi.fn(async (specifier: string) => {
        assert.equal(specifier, "@murphai/core");
        return { updateExperiment, withCanonicalWriteLock };
      }),
    }),
    "node:fs/promises": mockExperimentDocumentRead,
  });

  await module.applyExperimentOnboardingRecord({
    vault: "test-vault",
    lookup: "sauna-daily",
    scheduleKind: "dailyLocal",
    scheduleLocalTime: "19:30",
    scheduleTimeZone: "America/Los_Angeles",
  });

  const updateInput = updateExperiment.mock.calls[0]?.[0];
  assert.ok(updateInput);
  assert.deepEqual(updateInput.runPlan?.schedule, {
    kind: "dailyLocal",
    localTime: "19:30",
    timeZone: "America/Los_Angeles",
  });
});

test("applyExperimentOnboardingRecord accepts status-only updates", async () => {
  const experimentEntity = {
    entityId: "exp_01JNV44P4R5SWC90K2AHXQJQYT",
    family: "experiment",
    kind: "experiment",
    title: "Sauna Daily",
    status: "planned",
    occurredAt: null,
    date: null,
    path: "bank/experiments/sauna-daily.md",
    body: "---\n",
    attributes: {
      schemaVersion: "murph.frontmatter.experiment.v1",
      docType: "experiment",
      experimentId: "exp_01JNV44P4R5SWC90K2AHXQJQYT",
      slug: "sauna-daily",
      status: "planned",
      title: "Sauna Daily",
      startedOn: "2026-04-29",
      analysisPlan: {
        primaryBiomarkerKey: "biomarker:resting-heart-rate",
      },
    },
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: "sauna-daily",
    tags: [],
    frontmatter: null,
  };
  const queryRuntime = {
    readVault: vi.fn(async () => ({ entities: [experimentEntity] })),
    lookupEntityById: vi.fn(() => experimentEntity),
  };
  const updateExperiment = vi.fn(
    async (_input: { runPlan?: unknown; status?: string }) => ({
      experimentId: "exp_01JNV44P4R5SWC90K2AHXQJQYT",
      slug: "sauna-daily",
      relativePath: "bank/experiments/sauna-daily.md",
      status: "active",
      updated: true as const,
    }),
  );

  const module = await importWithMocks<
    typeof import("../src/usecases/experiment-journal-vault.ts")
  >("../src/usecases/experiment-journal-vault.ts", {
    "../src/query-runtime.js": () => ({
      loadQueryRuntime: vi.fn(async () => queryRuntime),
    }),
    "../src/runtime-import.js": () => ({
      loadRuntimeModule: vi.fn(async (specifier: string) => {
        assert.equal(specifier, "@murphai/core");
        return { updateExperiment, withCanonicalWriteLock };
      }),
    }),
    "node:fs/promises": mockExperimentDocumentRead,
  });

  await module.applyExperimentOnboardingRecord({
    vault: "test-vault",
    lookup: "sauna-daily",
    status: "active",
  });

  const updateInput = updateExperiment.mock.calls[0]?.[0];
  assert.ok(updateInput);
  assert.equal(updateInput.status, "active");
  assert.equal(updateInput.runPlan, undefined);
});

test("applyExperimentOnboardingRecord preserves untouched hypothesis fields on primary edits", async () => {
  const experimentEntity = {
    entityId: "exp_01JNV44P4R5SWC90K2AHXQJQZA",
    family: "experiment",
    kind: "experiment",
    title: "Recovery experiment",
    status: "active",
    occurredAt: null,
    date: null,
    path: "bank/experiments/recovery-experiment.md",
    body: "---\n",
    attributes: {
      schemaVersion: "murph.frontmatter.experiment.v1",
      docType: "experiment",
      experimentId: "exp_01JNV44P4R5SWC90K2AHXQJQZA",
      slug: "recovery-experiment",
      status: "active",
      title: "Recovery experiment",
      startedOn: "2026-04-29",
      analysisPlan: {
        primaryBiomarkerKey: "biomarker:resting-heart-rate",
        secondaryBiomarkerKeys: ["biomarker:hrv"],
        desiredDirection: "decrease",
        expectedDirections: [
          { biomarkerKey: "biomarker:hrv", direction: "decrease" },
        ],
      },
    },
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: "recovery-experiment",
    tags: [],
    frontmatter: null,
  };
  const queryRuntime = {
    readVault: vi.fn(async () => ({ entities: [experimentEntity] })),
    lookupEntityById: vi.fn(() => experimentEntity),
  };
  const updateExperiment = vi.fn(
    async (_input: { analysisPlan?: Record<string, unknown> }) => ({
      experimentId: "exp_01JNV44P4R5SWC90K2AHXQJQZA",
      slug: "recovery-experiment",
      relativePath: "bank/experiments/recovery-experiment.md",
      status: "active",
      updated: true as const,
    }),
  );

  const module = await importWithMocks<
    typeof import("../src/usecases/experiment-journal-vault.ts")
  >("../src/usecases/experiment-journal-vault.ts", {
    "../src/query-runtime.js": () => ({
      loadQueryRuntime: vi.fn(async () => queryRuntime),
    }),
    "../src/runtime-import.js": () => ({
      loadRuntimeModule: vi.fn(async (specifier: string) => {
        assert.equal(specifier, "@murphai/core");
        return { updateExperiment, withCanonicalWriteLock };
      }),
    }),
    "node:fs/promises": mockExperimentDocumentRead,
  });

  await module.applyExperimentOnboardingRecord({
    vault: "test-vault",
    lookup: "recovery-experiment",
    primaryBiomarkerKey: "biomarker:hrv-rmssd",
  });

  const updateInput = updateExperiment.mock.calls[0]?.[0];
  assert.ok(updateInput);
  assert.deepEqual(updateInput.analysisPlan, {
    primaryBiomarkerKey: "biomarker:hrv-rmssd",
    secondaryBiomarkerKeys: ["biomarker:hrv"],
    desiredDirection: "decrease",
    expectedDirections: [
      { biomarkerKey: "biomarker:hrv", direction: "decrease" },
    ],
  });
});

test("applyExperimentOnboardingRecord clears run baseline windows with zero baseline days", async () => {
  const experimentEntity = {
    entityId: "exp_01JNV44P4R5SWC90K2AHXQJQYT",
    family: "experiment",
    kind: "experiment",
    title: "Psyllium LDL",
    status: "active",
    occurredAt: null,
    date: null,
    path: "bank/experiments/psyllium-ldl.md",
    body: "---\n",
    attributes: {
      schemaVersion: "murph.frontmatter.experiment.v1",
      docType: "experiment",
      experimentId: "exp_01JNV44P4R5SWC90K2AHXQJQYT",
      slug: "psyllium-ldl",
      status: "active",
      title: "Psyllium LDL",
      startedOn: "2026-05-09",
      runPlan: {
        baselineStart: "2026-05-02",
        baselineEnd: "2026-05-08",
        interventionStart: "2026-05-09",
        interventionEnd: "2026-08-01",
        modality: "psyllium",
      },
      analysisPlan: {
        primaryBiomarkerKey: "biomarker:ldl-c",
      },
    },
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: "psyllium-ldl",
    tags: [],
    frontmatter: null,
  };
  const queryRuntime = {
    readVault: vi.fn(async () => ({ entities: [experimentEntity] })),
    lookupEntityById: vi.fn(() => experimentEntity),
  };
  const updateExperiment = vi.fn(
    async (_input: { runPlan?: Record<string, unknown> }) => ({
      experimentId: "exp_01JNV44P4R5SWC90K2AHXQJQYT",
      slug: "psyllium-ldl",
      relativePath: "bank/experiments/psyllium-ldl.md",
      status: "active",
      updated: true as const,
    }),
  );

  const module = await importWithMocks<
    typeof import("../src/usecases/experiment-journal-vault.ts")
  >("../src/usecases/experiment-journal-vault.ts", {
    "../src/query-runtime.js": () => ({
      loadQueryRuntime: vi.fn(async () => queryRuntime),
    }),
    "../src/runtime-import.js": () => ({
      loadRuntimeModule: vi.fn(async (specifier: string) => {
        assert.equal(specifier, "@murphai/core");
        return { updateExperiment, withCanonicalWriteLock };
      }),
    }),
    "node:fs/promises": mockExperimentDocumentRead,
  });

  await module.applyExperimentOnboardingRecord({
    vault: "test-vault",
    lookup: "psyllium-ldl",
    baselineDays: 0,
    baselineStart: "2026-05-01",
    baselineEnd: "2026-05-07",
  });

  const updateInput = updateExperiment.mock.calls[0]?.[0];
  assert.ok(updateInput);
  assert.equal("baselineStart" in (updateInput.runPlan ?? {}), false);
  assert.equal("baselineEnd" in (updateInput.runPlan ?? {}), false);
  assert.equal(updateInput.runPlan?.interventionStart, "2026-05-09");
  assert.equal(updateInput.runPlan?.interventionEnd, "2026-08-01");
});

test("applyExperimentOnboardingRecord rejects legacy string schedule payloads", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-onboarding-schedule-"));
  const schedulePayloadPath = path.join(vaultRoot, "schedule.json");
  const experimentEntity = {
    entityId: "exp_01JNV44P4R5SWC90K2AHXQJQYZ",
    family: "experiment",
    kind: "experiment",
    title: "Sauna Legacy",
    status: "planned",
    occurredAt: null,
    date: null,
    path: "bank/experiments/sauna-legacy.md",
    body: "---\n",
    attributes: {
      schemaVersion: "murph.frontmatter.experiment.v1",
      docType: "experiment",
      experimentId: "exp_01JNV44P4R5SWC90K2AHXQJQYZ",
      slug: "sauna-legacy",
      status: "planned",
      title: "Sauna Legacy",
      startedOn: "2026-04-29",
    },
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: "sauna-legacy",
    tags: [],
    frontmatter: null,
  };
  const queryRuntime = {
    readVault: vi.fn(async () => ({ entities: [experimentEntity] })),
    lookupEntityById: vi.fn(() => experimentEntity),
  };
  const updateExperiment = vi.fn();

  try {
    await writeFile(
      schedulePayloadPath,
      `${JSON.stringify("Three evening sauna sessions per week.")}\n`,
      "utf8",
    );

    const module = await importWithMocks<
      typeof import("../src/usecases/experiment-journal-vault.ts")
    >("../src/usecases/experiment-journal-vault.ts", {
      "../src/query-runtime.js": () => ({
        loadQueryRuntime: vi.fn(async () => queryRuntime),
      }),
      "../src/runtime-import.js": () => ({
        loadRuntimeModule: vi.fn(async (specifier: string) => {
          assert.equal(specifier, "@murphai/core");
          return { updateExperiment, withCanonicalWriteLock };
        }),
      }),
    });

    await assert.rejects(
      () =>
        module.applyExperimentOnboardingRecord({
          vault: "test-vault",
          lookup: "sauna-legacy",
          scheduleInputFile: schedulePayloadPath,
        }),
      /ExperimentRunScheduleIntent/u,
    );
    assert.equal(updateExperiment.mock.calls.length, 0);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("experiment onboarding writers do not preserve legacy string run-plan schedules", async () => {
  const sourceFiles = [
    "packages/vault-usecases/src/usecases/experiment-journal-vault.ts",
    "packages/vault-usecases/src/usecases/types.ts",
    "packages/cli/src/commands/experiment.ts",
  ];
  const sourcePatterns = [
    /schedule\?: string/u,
    /Plain-language schedule string/u,
    /schedule:\s*options\.schedule/u,
    /patch\.schedule\s*=\s*normalizeRequiredTextOption/u,
    /runPlan\s*:\s*\{[\s\S]*?schedule\s*:\s*["'`]/u,
  ];
  const generatedFiles = [
    "packages/cli/src/incur.generated.ts",
    "packages/cli/config.schema.json",
  ];
  const generatedPatterns = [
    /experiment edit[^\n]*schedule\?: string/u,
    /Plain-language schedule string for the run plan/u,
  ];
  const violations: string[] = [];

  for (const relativePath of sourceFiles) {
    const source = await readFile(path.join(repoRoot, relativePath), "utf8");
    for (const pattern of sourcePatterns) {
      if (pattern.test(source)) {
        violations.push(`${relativePath} matched ${pattern}`);
      }
    }
  }

  for (const relativePath of generatedFiles) {
    const source = await readFile(path.join(repoRoot, relativePath), "utf8");
    for (const pattern of generatedPatterns) {
      if (pattern.test(source)) {
        violations.push(`${relativePath} matched ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
