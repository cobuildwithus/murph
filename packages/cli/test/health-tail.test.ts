import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

interface CliResult<TData = Record<string, unknown>> {
  ok: boolean;
  data?: TData;
}

const execFileAsync = promisify(execFile);
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = path.resolve(packageDir, "../..");
const binPath = path.join(packageDir, "dist/bin.js");

async function runCli<TData = Record<string, unknown>>(
  args: string[],
): Promise<CliResult<TData>> {
  const { stdout } = await execFileAsync(process.execPath, [binPath, ...args], {
    cwd: repoRoot,
  });

  return JSON.parse(stdout) as CliResult<TData>;
}

function requireData<TData>(result: CliResult<TData>): TData {
  if (result.data === undefined) {
    throw new Error("CLI result did not include a data payload.");
  }

  return result.data;
}

test.sequential("intake show and intake list route assessment reads through the noun-specific commands", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cli-health-"));

  try {
    await runCli(["init", "--vault", vaultRoot, "--format", "json"]);
    await mkdir(path.join(vaultRoot, "ledger/assessments/2026"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, "ledger/assessments/2026/2026-03.jsonl"),
      `${JSON.stringify({
        schemaVersion: "hb.assessment-response.v1",
        id: "asmt_cli_01",
        assessmentType: "full-intake",
        recordedAt: "2026-03-12T13:00:00Z",
        source: "import",
        title: "CLI intake fixture",
        responses: {
          sleep: {
            averageHours: 6,
          },
        },
      })}\n`,
      "utf8",
    );

    const showResult = await runCli<{
      entity: {
        id: string;
        kind: string;
      };
    }>([
      "intake",
      "show",
      "asmt_cli_01",
      "--vault",
      vaultRoot,
      "--format",
      "json",
    ]);
    const listResult = await runCli<{
      items: Array<{
        id: string;
        kind: string;
      }>;
    }>([
      "intake",
      "list",
      "--vault",
      vaultRoot,
      "--format",
      "json",
    ]);

    assert.equal(showResult.ok, true);
    assert.equal(requireData(showResult).entity.id, "asmt_cli_01");
    assert.equal(requireData(showResult).entity.kind, "assessment");
    assert.equal(listResult.ok, true);
    assert.deepEqual(
      requireData(listResult).items.map((item) => item.id),
      ["asmt_cli_01"],
    );
    assert.deepEqual(
      requireData(listResult).items.map((item) => item.kind),
      ["assessment"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
