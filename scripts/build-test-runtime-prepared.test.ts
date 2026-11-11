import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function runPreparedFixture(compilerStatus: number) {
  const root = mkdtempSync(path.join(os.tmpdir(), "prepared-runtime-"));
  roots.push(root);
  const write = (file: string, contents: string) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
    chmodSync(target, 0o755);
  };
  write("scripts/build-test-runtime-prepared.mjs", readFileSync(path.join(repoRoot, "scripts/build-test-runtime-prepared.mjs"), "utf8"));
  write("scripts/run-typescript.mjs", `import { appendFileSync } from 'node:fs';
appendFileSync('compiler-calls', JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(${compilerStatus});\n`);
  write("bin/pnpm", '#!/bin/sh\nprintf "importer\\n" >> importer-calls\n');
  for (const name of ["operator-config", "assistant-engine", "vault-usecases", "inbox-services"]) {
    write(`packages/${name}/package.json`, '{"exports":{".":"./dist/index.js"}}');
  }
  const imports = ["operator-config/command-helpers", "operator-config/vault-cli-contracts", "operator-config/vault-cli-errors", "assistant-engine/assistant-state", "assistant-engine/knowledge", "vault-usecases/helpers", "vault-usecases/records", "vault-usecases/runtime", "vault-usecases/workouts"];
  write("packages/cli/src/index.ts", imports.map((name) => `import '@murphai/${name}';`).join("\n"));
  const result = spawnSync(process.execPath, ["scripts/build-test-runtime-prepared.mjs"], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, MURPH_VERIFY_SHARED_HOST: "0", PATH: `${path.join(root, "bin")}:${process.env.PATH}` },
  });
  const calls = readFileSync(path.join(root, "compiler-calls"), "utf8").trim().split("\n").map((line): string[] => JSON.parse(line));
  return { result, calls };
}

it("returns the compiler error without a forced retry", () => {
  const { result, calls } = runPreparedFixture(17);
  expect(result.status, result.stderr).toBe(17);
  expect(calls).toHaveLength(1);
  expect(calls[0]).not.toContain("--force");
});

it("repairs absent emitted files at most once and fails if they remain missing", () => {
  const { result, calls } = runPreparedFixture(0);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("did not produce importable runtime artifacts");
  expect(calls).toHaveLength(2);
  expect(calls[0]).not.toContain("--force");
  expect(calls[1]).toContain("--force");
});
