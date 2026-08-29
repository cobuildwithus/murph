import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const committerPath = path.join(
  repoRoot,
  "node_modules",
  "@cobuild",
  "repo-tools",
  "src",
  "committer.sh",
);
const roots: string[] = [];

function createTempRoot(): string {
  const sharedTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!sharedTempRoot) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  const root = mkdtempSync(path.join(sharedTempRoot, "repo-tools-committer-"));
  roots.push(root);
  return root;
}

function runGit(repository: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: repository,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function createRepository(): string {
  const repository = createTempRoot();
  runGit(repository, ["init", "-q", "-b", "main"]);
  runGit(repository, ["config", "core.hooksPath", ".no-hooks"]);
  runGit(repository, ["config", "user.name", "Committer Test"]);
  runGit(repository, [
    "config",
    "user.email",
    "committer-test@users.noreply.github.com",
  ]);
  return repository;
}

function runCommitter(repository: string, selectedPath: string) {
  return spawnSync(
    "bash",
    [
      committerPath,
      "--skip-hooks",
      "fix(test): update selected evidence",
      selectedPath,
    ],
    {
      cwd: repository,
      encoding: "utf8",
    },
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("repo-tools scoped committer staging", () => {
  it("updates a tracked file beneath a locally ignored parent", () => {
    const repository = createRepository();
    const selectedPath = "evidence/result.md";
    mkdirSync(path.join(repository, "evidence"));
    writeFileSync(path.join(repository, selectedPath), "before\n");
    runGit(repository, ["add", selectedPath]);
    runGit(repository, ["commit", "-q", "-m", "baseline"]);

    writeFileSync(path.join(repository, ".git", "info", "exclude"), "evidence/\n");
    writeFileSync(path.join(repository, selectedPath), "after\n");
    runGit(repository, ["add", "-u", "--", selectedPath]);

    const result = runCommitter(repository, selectedPath);

    expect(result.status, result.stderr).toBe(0);
    expect(runGit(repository, ["show", `HEAD:${selectedPath}`])).toBe("after");
    expect(runGit(repository, ["status", "--short"])).toBe("");
  });

  it("still adds a selected untracked file", () => {
    const repository = createRepository();
    writeFileSync(path.join(repository, "baseline.txt"), "baseline\n");
    runGit(repository, ["add", "baseline.txt"]);
    runGit(repository, ["commit", "-q", "-m", "baseline"]);
    writeFileSync(path.join(repository, "new.txt"), "new\n");

    const result = runCommitter(repository, "new.txt");

    expect(result.status, result.stderr).toBe(0);
    expect(runGit(repository, ["show", "HEAD:new.txt"])).toBe("new");
  });

  it("keeps rejecting a selected ignored untracked file", () => {
    const repository = createRepository();
    writeFileSync(path.join(repository, "baseline.txt"), "baseline\n");
    runGit(repository, ["add", "baseline.txt"]);
    runGit(repository, ["commit", "-q", "-m", "baseline"]);
    writeFileSync(path.join(repository, ".git", "info", "exclude"), "private/\n");
    mkdirSync(path.join(repository, "private"));
    writeFileSync(path.join(repository, "private", "new.txt"), "new\n");

    const result = runCommitter(repository, "private/new.txt");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("file not found: private/new.txt");
    expect(runGit(repository, ["rev-list", "--count", "HEAD"])).toBe("1");
  });
});
