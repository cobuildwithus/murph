import assert from "node:assert/strict";
import { mock } from "node:test";
import { DatabaseSync, StatementSync } from "node:sqlite";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { VaultServices } from "@murphai/vault-usecases/vault-services";
import type { CliTiming } from "@murphai/runtime-state/cli-timing";
import { fingerprint, readGlobalProof } from "./wearable-sleep-fixture.ts";
import { experimentDays, experimentNow, experimentPath, readExperimentListProof, seedExperimentListFixture } from "./experiment-list-fixture.ts";

export const experimentScenarios = {
  cold: ["list"], "repeat-2": ["list", "list"], "repeat-3": ["list", "list", "list"],
  "fresh-global": ["setup-global", "list", "list", "list"],
  stale: ["setup-global", "edit", "list", "list", "global"],
  "list-global": ["list", "global", "list", "global"],
} as const;
export type ExperimentScenario = keyof typeof experimentScenarios;

// One new process per scenario, both revisions at the same disposable vault path.
// Type-only workspace imports above do not warm production modules before timing.
export async function runExperimentTrial(vault: string, scenario: ExperimentScenario) {
  assert.ok(Object.hasOwn(experimentScenarios, scenario));
  let services: VaultServices | undefined;
  let edited = false;
  let mutationMs = 0;
  const steps = [];
  // Observe real native calls, never replace their implementation or results.
  // These are SQLite method invocations, not unique SQL texts or CLI commands.
  const sql = {
    exec: mock.method(DatabaseSync.prototype, "exec"),
    all: mock.method(StatementSync.prototype, "all"),
    get: mock.method(StatementSync.prototype, "get"),
    run: mock.method(StatementSync.prototype, "run"),
    iterate: mock.method(StatementSync.prototype, "iterate"),
  };
  const sqlCounts = () => Object.fromEntries(Object.entries(sql).map(([key, method]) => [key, method.mock.callCount()]));
  let mutationSqlCalls: Record<string, number> = {};
  mock.timers.enable({ apis: ["Date"], now: Date.parse(experimentNow) });
  try {
    for (const operation of experimentScenarios[scenario]) {
      for (const method of Object.values(sql)) method.mock.resetCalls();
      if (operation === "edit") {
        const start = performance.now();
        await (await import("@murphai/core")).updateExperiment({ vaultRoot: vault,
          relativePath: experimentPath(0), title: "Revised synthetic experiment", status: "paused" });
        mutationMs += performance.now() - start;
        mutationSqlCalls = sqlCounts();
        edited = true;
        continue;
      }
      const start = performance.now();
      const cpuStart = process.cpuUsage();
      // Imports and factory initialization belong to the first actual timed read.
      const timing = await import("@murphai/runtime-state/node/cli-timing");
      services ??= (await import("@murphai/vault-usecases/vault-services")).createIntegratedVaultServices();
      const service = services;
      let report: CliTiming | undefined;
      let value: Awaited<ReturnType<typeof readExperimentListProof | typeof readGlobalProof>> | undefined;
      await timing.withCliTiming(() => timing.timeCliDispatch(
        operation === "list" ? "experiment list" : "query list",
        async () => {
          value = operation === "list"
            ? await readExperimentListProof(service, vault, edited)
            : await readGlobalProof(service, await import("@murphai/query"), vault, experimentDays);
        },
      ), result => { report = result; });
      const cpu = process.cpuUsage(cpuStart);
      const wallMs = performance.now() - start;
      assert.ok(value);
      assert.ok(report);
      assert.equal(report.droppedCalls + report.droppedSpans, 0);
      assert.equal(report.transportTruncated, false);
      steps.push({ operation, setup: operation === "setup-global", wallMs,
        cpuMs: (cpu.user + cpu.system) / 1000, ...fingerprint(value),
        sqlCalls: sqlCounts(), phases: report.commands.flatMap(command => command.phases),
        commandCalls: report.commands.reduce((sum, command) => sum + command.calls, 0) });
    }
    return { scenario, steps, mutationMs, mutationSqlCalls,
      wallMs: mutationMs + steps.reduce((sum, step) => sum + step.wallMs, 0),
      readWallMs: steps.filter(step => !step.setup).reduce((sum, step) => sum + step.wallMs, 0),
      bytes: steps.reduce((sum, step) => sum + step.bytes, 0) };
  } finally {
    for (const method of Object.values(sql)) method.mock.restore();
    mock.timers.reset();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, vault, scenario] = process.argv.slice(2);
  assert.ok(vault);
  if (mode === "seed") await seedExperimentListFixture(await import("@murphai/core"), vault);
  else {
    assert.equal(mode, "trial");
    assert.ok(scenario && Object.hasOwn(experimentScenarios, scenario));
    console.log(JSON.stringify(await runExperimentTrial(vault, scenario as ExperimentScenario)));
  }
}
