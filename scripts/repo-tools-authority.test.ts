import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageRoot = path.join(repoRoot, "node_modules/@cobuild/repo-tools");
const roots: string[] = [];
function fixture() {
  const parent = mkdtempSync(path.join(os.tmpdir(), "tool-authority-"));
  roots.push(parent);
  const root = path.join(parent, "repo");
  mkdirSync(root);
  return { parent, root };
}
function write(root: string, file: string, text: string) {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
  chmodSync(target, 0o755);
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("selects only installed package tools even when sibling and global copies exist", () => {
  const { root, parent } = fixture();
  write(parent, "repo-tools/bin/probe", "#!/bin/sh\nexit 0\n");
  write(parent, "repo-tools/src/probe.sh", "exit 0\n");
  write(parent, "bin/probe", "#!/bin/sh\nexit 0\n");
  const env = { ...process.env, COBUILD_REPO_ROOT: root,
    TEST_HELPER: path.join(packageRoot, "src/consumer-shell.sh"),
    PATH: `${path.join(parent, "bin")}:${process.env.PATH}` };
  const run = (command: string) => spawnSync("bash", ["-c", 'source "$TEST_HELPER"; ' + command], { env, encoding: "utf8" });
  expect(run("cobuild_repo_tool_bin probe").status).toBe(1);
  expect(run("cobuild_repo_tool_path src/probe.sh").status).toBe(1);
  write(root, "node_modules/.bin/probe", "#!/bin/sh\nexit 0\n");
  write(root, "node_modules/@cobuild/repo-tools/src/probe.sh", "exit 0\n");
  expect(run("cobuild_repo_tool_bin probe").stdout.trim()).toBe(path.join(root, "node_modules/.bin/probe"));
  expect(run("cobuild_repo_tool_path src/probe.sh").stdout.trim()).toBe(path.join(root, "node_modules/@cobuild/repo-tools/src/probe.sh"));
});

it("does not source a sibling helper when the installed package is missing", () => {
  const { root, parent } = fixture();
  write(root, "scripts/repo-tools.config.sh", readFileSync(path.join(repoRoot, "scripts/repo-tools.config.sh"), "utf8"));
  write(parent, "repo-tools/src/consumer-shell.sh", 'echo unexpected-sibling\nexit 0\n');
  const result = spawnSync("bash", ["scripts/repo-tools.config.sh"], { cwd: root, encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stdout).not.toContain("unexpected-sibling");
  expect(result.stderr).toContain("missing installed repo-tools");
});

it("allows source-only changes at any file count while retaining structural documentation checks", () => {
  const { root } = fixture();
  execFileSync("git", ["init", "-q"], { cwd: root });
  write(root, "AGENTS.md", "required owner\n");
  for (let index = 0; index < 15; index += 1) write(root, `scripts/source-${index}.ts`, "export {}\n");
  execFileSync("git", ["add", "."], { cwd: root });
  const run = () => spawnSync("bash", [path.join(packageRoot, "src/check-agent-docs-drift.sh")], {
    cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_BASE_REF: "", COBUILD_DRIFT_REQUIRED_FILES: "AGENTS.md" },
  });
  expect(run().status).toBe(0);
  write(root, "agent-docs/owner.md", "owner contract\n");
  execFileSync("git", ["add", "."], { cwd: root });
  expect(run().stdout).toContain("without updating agent-docs/index.md");
  write(root, "agent-docs/index.md", "| `agent-docs/owner.md` | Owner |\n");
  execFileSync("git", ["add", "."], { cwd: root });
  expect(run().status).toBe(0);
  rmSync(path.join(root, "AGENTS.md"));
  expect(run().stdout).toContain("Missing required agent-doc artifact");
});
