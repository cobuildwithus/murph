import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import * as core from "@murphai/core";
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
