import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import {
  filterDocGardeningInventory,
  formatDocGardeningReport,
  parseDocGardeningReport,
} from "./doc-gardening-report.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const upstream = path.join(repoRoot, "node_modules/@cobuild/repo-tools/src/doc-gardening.sh");
const generated = "agent-docs/generated/";

it.each([false, true])("matches the locked upstream artifacts and diagnostics (issues=%s)", (issues) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-gardening-parity-"));
  const write = (name: string, content = "document\n") => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  };
  try {
    for (const name of ["doc-gardening.sh", "doc-gardening-report.mjs", "repo-tools.config.sh"]) {
      write(`scripts/${name}`, fs.readFileSync(path.join(repoRoot, "scripts", name), "utf8"));
    }
    fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(root, "node_modules"));
    write(".gitignore", "node_modules\n*.local.md\n");
    const rows = [
      "agent-docs/covered/", "agent-docs/z space.md", "agent-docs/é.md",
      "agent-docs/references/model-llms.txt", "ARCHITECTURE.md",
      "agent-docs/linked.md", "agent-docs/covered/", "agent-docs/generated/",
    ];
    if (issues) rows.push("agent-docs/missing.md", "agent-docs/missing-dir/", "agent-docs/z space.md/");
    write("agent-docs/index.md", rows.map((entry) => `| \`${entry}\` | Description |`).join("\n") + "\n");
    for (const name of [
      "agent-docs/covered/nested/a.md", "agent-docs/z space.md", "agent-docs/é.md",
      "agent-docs/references/model-llms.txt", "ARCHITECTURE.md",
      "agent-docs/exec-plans/completed/history.md", "agent-docs/deleted.md",
    ]) write(name);
    fs.symlinkSync("z space.md", path.join(root, "agent-docs/linked.md"));
    if (issues) write("agent-docs/covered-prefix-collision.md");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    fs.unlinkSync(path.join(root, "agent-docs/deleted.md"));
    write("agent-docs/ignored.local.md");
    write("agent-docs/untracked.md");
    const env = {
      ...process.env,
      COBUILD_DOC_GARDENING_EXTRA_TRACKED_PATHS: "ARCHITECTURE.md\n",
      FAIL_ON_DOC_ISSUES: "0",
    };
    const old = spawnSync("bash", [upstream], { cwd: root, env, encoding: "utf8" });
    expect(old.status, old.stderr).toBe(0);
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
    const options = { exclude: /^agent-docs\/exec-plans\/completed\//u, trackedPaths: new Set(tracked.split("\0")) };
    const report = parseDocGardeningReport(fs.readFileSync(path.join(root, generated, "doc-gardening-report.md"), "utf8"), options);
    const inventory = filterDocGardeningInventory(fs.readFileSync(path.join(root, generated, "doc-inventory.md"), "utf8"), options);
    expect(report.unindexed).toEqual(issues ? ["agent-docs/covered-prefix-collision.md"] : []);
    expect(report.broken).toHaveLength(issues ? 3 : 0);
    for (const fail of [false, true]) {
      const current = spawnSync("bash", ["scripts/doc-gardening.sh", ...(fail ? ["--fail-on-issues"] : [])], { cwd: root, env, encoding: "utf8" });
      expect(current.status).toBe(issues && fail ? 1 : 0);
      expect(current.stdout).toBe(`Doc gardening completed. Issues found: ${issues ? 4 : 0}\n`);
      expect(current.stderr).toBe(issues && fail ? "Doc gardening found issues and fail-on-issues is enabled.\n" : "");
      expect(fs.readFileSync(path.join(root, generated, "doc-gardening-report.md"), "utf8")).toBe(formatDocGardeningReport(report));
      expect(fs.readFileSync(path.join(root, generated, "doc-inventory.md"), "utf8")).toBe(inventory);
    }
    const byEnv = spawnSync("bash", ["scripts/doc-gardening.sh"], { cwd: root, env: { ...env, FAIL_ON_DOC_ISSUES: "1" }, encoding: "utf8" });
    expect(byEnv.status).toBe(issues ? 1 : 0);
    fs.unlinkSync(path.join(root, "agent-docs/index.md"));
    const missing = spawnSync("bash", ["scripts/doc-gardening.sh"], { cwd: root, env, encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("Missing agent-docs/index.md\n");
    expect(missing.stderr).toBe("");
    fs.symlinkSync("index.md", path.join(root, "agent-docs/index.md"));
    const invalidIndex = spawnSync("bash", ["scripts/doc-gardening.sh"], { cwd: root, env, encoding: "utf8" });
    expect(invalidIndex.status).toBe(1);
    expect(invalidIndex.stdout).toBe(missing.stdout);
    expect(invalidIndex.stderr).toBe("");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
