import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import * as core from "@murphai/core";
import { experimentFrontmatterSchema } from "@murphai/contracts";
import { afterEach, test, vi } from "vitest";

import { importWithMocks, mockActualModule } from "./mock-import.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      assert.ok(resolvePromise);
      resolvePromise(value);
    },
  };
}

afterEach(() => {
  vi.doUnmock("../src/runtime-import.ts");
  vi.restoreAllMocks();
  vi.resetModules();
});

test("a concurrent session cannot interpose between outcome evidence analysis and its write", async () => {
  const vaultRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "murph-experiment-outcome-concurrency-"),
  );
  const closeoutLockAttempted = deferred<void>();
  const closeoutWriteAttempted = deferred<void>();
  let closeoutLockAttemptCount = 0;

  try {
    await core.initializeVault({ vaultRoot, timezone: "UTC" });
    const created = await core.createExperiment({
      vaultRoot,
      slug: "serialized-evening-walk",
      title: "Serialized Evening Walk",
      startedOn: "2026-06-01T12:00:00.000Z",
      status: "active",
      runPlan: {
        interventionStart: "2026-06-01",
        interventionEnd: "2026-06-07",
        modality: "walking",
        targetSessions: 1,
        minimumUsefulSessions: 1,
      },
    });

    const experimentJournal = await importWithMocks<
      typeof import("../src/usecases/experiment-journal-vault.ts")
    >("../src/usecases/experiment-journal-vault.ts", {
      "../src/runtime-import.ts": mockActualModule(
        "../src/runtime-import.ts",
        (actual) => ({
          ...actual,
          loadRuntimeModule: vi.fn(async (specifier: string) => {
            if (specifier === "@murphai/query") {
              return vi.importActual<typeof import("@murphai/query")>(
                "@murphai/query",
              );
            }
            if (specifier !== "@murphai/core") {
              throw new Error(`Unexpected runtime module: ${specifier}`);
            }
            return {
              ...core,
              withCanonicalWriteLock: async <TResult>(
                lockVaultRoot: string | undefined,
                run: () => Promise<TResult>,
              ) => {
                closeoutLockAttemptCount += 1;
                closeoutLockAttempted.resolve();
                return core.withCanonicalWriteLock(lockVaultRoot, run);
              },
              writeExperimentOutcome: async (
                input: Parameters<typeof core.writeExperimentOutcome>[0],
              ) => {
                closeoutWriteAttempted.resolve();
                return core.writeExperimentOutcome(input);
              },
            };
          }),
        }),
      ),
    });

    const sessionLockHeld = deferred<void>();
    const allowSessionWrite = deferred<void>();
    const session = core.withCanonicalWriteLock(vaultRoot, async () => {
      sessionLockHeld.resolve();
      await allowSessionWrite.promise;
      return experimentJournal.logExperimentSessionRecord({
        vault: vaultRoot,
        lookup: created.experiment.id,
        occurredAt: "2026-06-06T20:00:00.000Z",
        date: "2026-06-06",
        durationMinutes: 20,
      });
    });
    await sessionLockHeld.promise;

    const closeout = experimentJournal.writeExperimentOutcomeRecord({
      vault: vaultRoot,
      lookup: created.experiment.id,
      asOf: "2026-06-07",
    });
    const firstCloseoutBoundary = await Promise.race([
      closeoutLockAttempted.promise.then(() => "lock" as const),
      closeoutWriteAttempted.promise.then(() => "write" as const),
    ]);
    assert.equal(firstCloseoutBoundary, "lock");
    assert.equal(closeoutLockAttemptCount, 1);

    allowSessionWrite.resolve();
    await session;
    const result = await closeout;

    assert.equal(result.outcome.adherenceSummary.completedSessions, 1);
    assert.equal(result.outcome.experiment.status, "completed");
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});

test("a next-day outcome retry returns the referenced artifact after supported experiment edits", async () => {
  const vaultRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "murph-experiment-outcome-retry-"),
  );

  try {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T12:00:00.000Z"));
    await core.initializeVault({ vaultRoot, timezone: "UTC" });
    const created = await core.createExperiment({
      vaultRoot,
      slug: "stable-saved-result",
      title: "Stable Saved Result",
      startedOn: "2026-06-01T12:00:00.000Z",
      status: "active",
      runPlan: {
        interventionStart: "2026-06-01",
        interventionEnd: "2026-06-07",
      },
    });
    const experimentJournal = await import(
      "../src/usecases/experiment-journal-vault.ts"
    );
    const first = await experimentJournal.writeExperimentOutcomeRecord({
      vault: vaultRoot,
      lookup: created.experiment.id,
      asOf: "2026-06-07",
    });
    const outcomeFile = path.join(vaultRoot, first.outcomePath);
    const firstOutcomeBytes = await fs.readFile(outcomeFile, "utf8");

    await core.updateExperiment({
      vaultRoot,
      relativePath: created.experiment.relativePath,
      title: "Stable Saved Result (reviewed)",
      status: "paused",
      runPlan: {
        baselineStart: "2026-05-25",
        baselineEnd: "2026-05-31",
        interventionStart: "2026-06-01",
        interventionEnd: "2026-06-08",
        logging: {
          sessionFields: ["estimated-sleep-onset-minutes"],
        },
      },
      analysisPlan: {
        primaryBiomarkerKey: "biomarker:resting-heart-rate",
        desiredDirection: "decrease",
        measurementAnchors: [
          {
            role: "baseline",
            kind: "lab_panel",
            recordId: "evt_01JNV4458HYPP53JDQCBP1QJH2",
            biomarkerKeys: ["biomarker:resting-heart-rate"],
            observedOn: "2026-05-31",
          },
          {
            role: "followup",
            kind: "lab_panel",
            recordId: "evt_01JNV4458HYPP53JDQCBP1QJH3",
            biomarkerKeys: ["biomarker:resting-heart-rate"],
            observedOn: "2026-06-08",
          },
        ],
      },
    });
    const experimentFile = path.join(vaultRoot, created.experiment.relativePath);
    const editedExperimentBytes = await fs.readFile(experimentFile, "utf8");
    vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"));
    const analyzeExperimentOutcome = vi.fn(() => {
      throw new Error("A valid referenced outcome must bypass fresh analysis.");
    });
    const retryJournal = await importWithMocks<
      typeof import("../src/usecases/experiment-journal-vault.ts")
    >("../src/usecases/experiment-journal-vault.ts", {
      "../src/runtime-import.ts": mockActualModule(
        "../src/runtime-import.ts",
        (actual) => ({
          ...actual,
          loadRuntimeModule: vi.fn(async (specifier: string) => {
            if (specifier === "@murphai/core") {
              return core;
            }
            if (specifier === "@murphai/query") {
              const query = await vi.importActual<typeof import("@murphai/query")>(
                "@murphai/query",
              );
              return { ...query, analyzeExperimentOutcome };
            }
            throw new Error(`Unexpected runtime module: ${specifier}`);
          }),
        }),
      ),
    });

    const retried = await retryJournal.writeExperimentOutcomeRecord({
      vault: vaultRoot,
      lookup: created.experiment.id,
    });

    assert.equal(analyzeExperimentOutcome.mock.calls.length, 0);
    assert.equal(retried.asOf, first.asOf);
    assert.equal(retried.outcomePath, first.outcomePath);
    assert.equal(retried.updatedExperiment, false);
    assert.deepEqual(retried.outcome, first.outcome);
    assert.equal(await fs.readFile(outcomeFile, "utf8"), firstOutcomeBytes);
    assert.equal(await fs.readFile(experimentFile, "utf8"), editedExperimentBytes);
  } finally {
    vi.useRealTimers();
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});

test("an active interim outcome advances once to a distinct final artifact", async () => {
  const vaultRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "murph-experiment-outcome-interim-final-"),
  );

  try {
    await core.initializeVault({ vaultRoot, timezone: "UTC" });
    const created = await core.createExperiment({
      vaultRoot,
      slug: "interim-then-final",
      title: "Interim Then Final",
      startedOn: "2026-06-01T12:00:00.000Z",
      status: "active",
      runPlan: {
        interventionStart: "2026-06-01",
        interventionEnd: "2026-06-07",
      },
    });
    const experimentJournal = await import(
      "../src/usecases/experiment-journal-vault.ts"
    );

    const interim = await experimentJournal.writeExperimentOutcomeRecord({
      vault: vaultRoot,
      lookup: created.experiment.id,
      asOf: "2026-06-04",
    });
    const interimFile = path.join(vaultRoot, interim.outcomePath);
    const interimBytes = await fs.readFile(interimFile, "utf8");
    assert.equal(interim.outcome.experiment.status, "active");

    const final = await experimentJournal.writeExperimentOutcomeRecord({
      vault: vaultRoot,
      lookup: created.experiment.id,
      asOf: "2026-06-07",
    });
    assert.equal(final.outcome.experiment.status, "completed");
    assert.notEqual(final.outcomePath, interim.outcomePath);
    assert.notEqual(final.outcome.outcomeId, interim.outcome.outcomeId);
    assert.equal(await fs.readFile(interimFile, "utf8"), interimBytes);
    const completedFrontmatter = experimentFrontmatterSchema.parse(
      core.parseFrontmatterDocument(
        await fs.readFile(
          path.join(vaultRoot, created.experiment.relativePath),
          "utf8",
        ),
      ).attributes,
    );
    assert.equal(completedFrontmatter.status, "completed");
    assert.equal(completedFrontmatter.endedOn, "2026-06-07");
    assert.equal(completedFrontmatter.outcomeRef?.outcomeId, final.outcome.outcomeId);

    const repeated = await experimentJournal.writeExperimentOutcomeRecord({
      vault: vaultRoot,
      lookup: created.experiment.id,
      asOf: "2026-06-08",
    });
    assert.equal(repeated.updatedExperiment, false);
    assert.equal(repeated.outcomePath, final.outcomePath);
    assert.deepEqual(repeated.outcome, final.outcome);
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});

test("an on-time stopped run advances its active interim to one final artifact", async () => {
  const vaultRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "murph-experiment-outcome-on-time-stop-"),
  );

  try {
    await core.initializeVault({ vaultRoot, timezone: "UTC" });
    const created = await core.createExperiment({
      vaultRoot,
      slug: "on-time-stop-final",
      title: "On Time Stop Final",
      startedOn: "2026-06-01T12:00:00.000Z",
      status: "active",
      runPlan: {
        interventionStart: "2026-06-01",
        interventionEnd: "2026-06-07",
      },
    });
    const experimentJournal = await import(
      "../src/usecases/experiment-journal-vault.ts"
    );
    const interim = await experimentJournal.writeExperimentOutcomeRecord({
      vault: vaultRoot,
      lookup: created.experiment.id,
      asOf: "2026-06-04",
    });
    const interimFile = path.join(vaultRoot, interim.outcomePath);
    const interimBytes = await fs.readFile(interimFile, "utf8");

    await core.stopExperiment({
      vaultRoot,
      relativePath: created.experiment.relativePath,
      occurredAt: "2026-06-07T20:00:00.000Z",
      title: "Stopped",
    });

    const query = await vi.importActual<typeof import("@murphai/query")>(
      "@murphai/query",
    );
    const analyzeExperimentOutcome = vi.fn(query.analyzeExperimentOutcome);
    const finalJournal = await importWithMocks<
      typeof import("../src/usecases/experiment-journal-vault.ts")
    >("../src/usecases/experiment-journal-vault.ts", {
      "../src/runtime-import.ts": mockActualModule(
        "../src/runtime-import.ts",
        (actual) => ({
          ...actual,
          loadRuntimeModule: vi.fn(async (specifier: string) => {
            if (specifier === "@murphai/core") return core;
            if (specifier === "@murphai/query") {
              return { ...query, analyzeExperimentOutcome };
            }
            throw new Error(`Unexpected runtime module: ${specifier}`);
          }),
        }),
      ),
    });

    const final = await finalJournal.writeExperimentOutcomeRecord({
      vault: vaultRoot,
      lookup: created.experiment.id,
      asOf: "2026-06-07",
    });

    assert.equal(analyzeExperimentOutcome.mock.calls.length, 1);
    assert.equal(final.outcome.experiment.status, "completed");
    assert.notEqual(final.outcomePath, interim.outcomePath);
    assert.notEqual(final.outcome.outcomeId, interim.outcome.outcomeId);
    assert.equal(await fs.readFile(interimFile, "utf8"), interimBytes);

    const stoppedOnTimeFrontmatter = experimentFrontmatterSchema.parse(
      core.parseFrontmatterDocument(
        await fs.readFile(
          path.join(vaultRoot, created.experiment.relativePath),
          "utf8",
        ),
      ).attributes,
    );
    assert.equal(stoppedOnTimeFrontmatter.status, "completed");
    assert.equal(stoppedOnTimeFrontmatter.endedOn, "2026-06-07");
    assert.equal(
      stoppedOnTimeFrontmatter.outcomeRef?.outcomeId,
      final.outcome.outcomeId,
    );

    const repeated = await finalJournal.writeExperimentOutcomeRecord({
      vault: vaultRoot,
      lookup: created.experiment.id,
      asOf: "2026-06-08",
    });
    assert.equal(analyzeExperimentOutcome.mock.calls.length, 1);
    assert.equal(repeated.outcomePath, final.outcomePath);
    assert.deepEqual(repeated.outcome, final.outcome);
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});

test("an early-stopped run keeps its active interim without fresh analysis", async () => {
  const vaultRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "murph-experiment-outcome-early-stop-"),
  );

  try {
    await core.initializeVault({ vaultRoot, timezone: "UTC" });
    const created = await core.createExperiment({
      vaultRoot,
      slug: "early-stop-interim",
      title: "Early Stop Interim",
      startedOn: "2026-06-01T12:00:00.000Z",
      status: "active",
      runPlan: {
        interventionStart: "2026-06-01",
        interventionEnd: "2026-06-07",
      },
    });
    const experimentJournal = await import(
      "../src/usecases/experiment-journal-vault.ts"
    );
    const interim = await experimentJournal.writeExperimentOutcomeRecord({
      vault: vaultRoot,
      lookup: created.experiment.id,
      asOf: "2026-06-04",
    });
    const interimFile = path.join(vaultRoot, interim.outcomePath);
    const interimBytes = await fs.readFile(interimFile, "utf8");

    await core.stopExperiment({
      vaultRoot,
      relativePath: created.experiment.relativePath,
      occurredAt: "2026-06-06T20:00:00.000Z",
      title: "Stopped",
    });

    const analyzeExperimentOutcome = vi.fn(() => {
      throw new Error("An early stop must not refresh its interim result.");
    });
    const stoppedJournal = await importWithMocks<
      typeof import("../src/usecases/experiment-journal-vault.ts")
    >("../src/usecases/experiment-journal-vault.ts", {
      "../src/runtime-import.ts": mockActualModule(
        "../src/runtime-import.ts",
        (actual) => ({
          ...actual,
          loadRuntimeModule: vi.fn(async (specifier: string) => {
            if (specifier === "@murphai/core") return core;
            if (specifier === "@murphai/query") {
              const query = await vi.importActual<typeof import("@murphai/query")>(
                "@murphai/query",
              );
              return { ...query, analyzeExperimentOutcome };
            }
            throw new Error(`Unexpected runtime module: ${specifier}`);
          }),
        }),
      ),
    });

    const repeated = await stoppedJournal.writeExperimentOutcomeRecord({
      vault: vaultRoot,
      lookup: created.experiment.id,
      asOf: "2026-06-07",
    });

    assert.equal(analyzeExperimentOutcome.mock.calls.length, 0);
    assert.equal(repeated.outcomePath, interim.outcomePath);
    assert.deepEqual(repeated.outcome, interim.outcome);
    assert.equal(await fs.readFile(interimFile, "utf8"), interimBytes);
    const stoppedFrontmatter = experimentFrontmatterSchema.parse(
      core.parseFrontmatterDocument(
        await fs.readFile(
          path.join(vaultRoot, created.experiment.relativePath),
          "utf8",
        ),
      ).attributes,
    );
    assert.equal(stoppedFrontmatter.status, "completed");
    assert.equal(stoppedFrontmatter.endedOn, "2026-06-06");
    assert.equal(stoppedFrontmatter.outcomeRef?.outcomeId, interim.outcome.outcomeId);
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});
