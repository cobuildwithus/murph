import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import { describe, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const prodWatchPath = path.join(repoRoot, "scripts", "prod-watch.ts");
const snapshotSchemaPath = path.join(
  repoRoot,
  "scripts",
  "prod-watch",
  "schemas",
  "snapshot.v1.schema.json",
);
const addFormats = createRequire(import.meta.url)("ajv-formats") as FormatsPlugin;
const liveDatabaseEnabled = process.env.MURPH_PROD_WATCH_LIVE_DB_INTEGRATION === "1";

describe.runIf(liveDatabaseEnabled)("production-watch live read-only database boundary", () => {
  it("executes the exact aggregate SQL through the helper and validates the snapshot contract", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        prodWatchPath,
        "collect",
        "--lookback-minutes",
        "5",
        "--settling-delay-seconds",
        "60",
        "--adapter-timeout-ms",
        "30000",
        "--output",
        "-",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_PROD_WATCH_SOURCES: "database",
        },
        timeout: 60_000,
      },
    );
    if (result.status !== 0 || result.error !== undefined) {
      throw new Error("live_database_collect_failed");
    }

    let snapshot: unknown;
    try {
      snapshot = JSON.parse(result.stdout) as unknown;
    } catch {
      throw new Error("live_database_snapshot_json_invalid");
    }

    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validateSnapshot = ajv.compile(
      JSON.parse(readFileSync(snapshotSchemaPath, "utf8")) as object,
    );
    if (!validateSnapshot(snapshot)) {
      throw new Error("live_database_snapshot_schema_invalid");
    }

    const validated = snapshot as {
      collectorFailures: Array<{ source: string }>;
      monitor: { evidenceComplete: boolean; status: string };
      sourceHealth: Array<{ source: string; status: string }>;
    };
    const databaseHealth = validated.sourceHealth.find((source) => source.source === "database");
    if (
      databaseHealth?.status !== "ok"
      || validated.collectorFailures.some((failure) => failure.source === "database")
      || validated.monitor.status !== "healthy"
      || !validated.monitor.evidenceComplete
    ) {
      throw new Error("live_database_snapshot_unhealthy");
    }
  }, 70_000);
});
