import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as core from "@murphai/core";
import * as query from "@murphai/query";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import { withCliTiming, timeCliDispatch } from "@murphai/runtime-state/node/cli-timing";
import type { CliTiming } from "@murphai/runtime-state/cli-timing";
import { experimentPath, seedExperimentListFixture } from "./experiment-list-fixture.ts";

// Run unchanged in baseline and candidate checkouts. Imports and fixture setup
// are excluded identically; measured work uses the real public service and query.
const scenarios = ["cold", "fresh", "stale", "repeat", "mixed"] as const;
const scenario = process.argv[2] ?? "cold";
assert.ok(scenarios.some(value => value === scenario));
const vault = await mkdtemp(path.join(tmpdir(), "murph-followup-bench-"));
try {
  await seedExperimentListFixture(core, vault);
  // Keep the complete global-result fingerprint comparable across fresh vaults.
  const corePath = path.join(vault, "CORE.md");
  await writeFile(corePath, (await readFile(corePath, "utf8")).replace(
    /vault_[0-9A-Z]+/gu, core.deterministicContractId("vault", "synthetic-followup-benchmark")));
  if (scenario === "fresh" || scenario === "stale") await query.readVault(vault);
  if (scenario === "stale") await core.updateExperiment({ vaultRoot: vault,
    relativePath: experimentPath(0), title: "Unrelated synthetic revision" });
  const services = createIntegratedVaultServices();
  const operations = scenario === "repeat" ? ["followup", "followup", "followup"]
    : scenario === "mixed" ? ["followup", "global", "followup"] : ["followup"];
  const steps = [];
  for (const operation of operations) {
    let report: CliTiming | undefined;
    let result: unknown;
    const cpu = process.cpuUsage();
    const start = performance.now();
    await withCliTiming(() => timeCliDispatch(operation === "followup" ? "experiment followup due" : "query list", async () => {
      result = operation === "followup"
        ? await services.query.showExperimentFollowupDue({ vault, requestId: "synthetic-followup-benchmark",
            lookup: "synthetic-list-1", kind: "missed-log", date: "2026-01-20" })
        : (await query.readVault(vault)).entities;
    }), value => { report = value; });
    const wallMs = performance.now() - start;
    const used = process.cpuUsage(cpu);
    assert.ok(report);
    assert.equal(report.droppedCalls + report.droppedSpans, 0);
    const json = JSON.stringify(result);
    assert.ok(json);
    steps.push({ operation, wallMs, cpuMs: (used.user + used.system) / 1000,
      bytes: Buffer.byteLength(json), hash: createHash("sha256").update(json).digest("hex"),
      phases: report.commands.flatMap(command => command.phases) });
  }
  console.log(JSON.stringify({ scenario, steps, wallMs: steps.reduce((sum, step) => sum + step.wallMs, 0) }));
} finally { await rm(vault, { recursive: true, force: true }); }
