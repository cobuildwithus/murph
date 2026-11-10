import { spawnSync } from "node:child_process";
import {
  chmodSync,
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

function runCommitter(repository: string, ...selectedPaths: string[]) {
  return spawnSync(
    "bash",
    [
      committerPath,
      "--skip-hooks",
      "fix(test): update selected evidence",
      ...selectedPaths,
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
  it("amends an unpublished task commit with its message, trailer, and unrelated staging intact", () => {
    const repository = createRepository();
    runGit(repository, ["checkout", "-qb", "task"]);
    writeFileSync(path.join(repository, "selected.txt"), "before\n");
    runGit(repository, ["add", "."]);
    runGit(repository, ["commit", "-qm", "fix(test): original\n\nEvidence: synthetic"]);
    const message = runGit(repository, ["show", "-s", "--format=%B"]);
    const author = runGit(repository, ["show", "-s", "--format=%an <%ae> %aI"]);
    writeFileSync(path.join(repository, "selected.txt"), "after\n");
    writeFileSync(path.join(repository, "other.txt"), "unrelated\n");
    runGit(repository, ["add", "other.txt"]);
    const result = spawnSync("bash", [committerPath, "--skip-hooks", "--amend", "--no-edit", "selected.txt"],
      { cwd: repository, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(runGit(repository, ["rev-list", "--count", "HEAD"])).toBe("1");
    expect(runGit(repository, ["show", "-s", "--format=%B"])).toBe(message);
    expect(runGit(repository, ["show", "-s", "--format=%an <%ae> %aI"])).toBe(author);
    expect(runGit(repository, ["show", "HEAD:selected.txt"])).toBe("after");
    expect(runGit(repository, ["diff", "--cached", "--name-only"])).toBe("other.txt");
    runGit(repository, ["update-ref", "refs/remotes/origin/task", "HEAD"]);
    writeFileSync(path.join(repository, "selected.txt"), "third\n");
    const published = spawnSync("bash", [committerPath, "--skip-hooks", "--amend", "--no-edit", "selected.txt"],
      { cwd: repository, encoding: "utf8" });
    expect(published.status).not.toBe(0);
    expect(published.stderr).toContain("reachable from a remote-tracking ref");
  });

  it("consumes both selected sides of an edited staged rename", () => {
    const repository = createRepository();
    writeFileSync(path.join(repository, "old.txt"), "original\n");
    runGit(repository, ["add", "."]);
    runGit(repository, ["commit", "-qm", "baseline"]);
    runGit(repository, ["mv", "old.txt", "new.txt"]);
    writeFileSync(path.join(repository, "new.txt"), "edited\n");
    writeFileSync(path.join(repository, "other.txt"), "unrelated staged\n");
    runGit(repository, ["add", "other.txt"]);
    const result = runCommitter(repository, "old.txt", "new.txt");
    expect(result.status, result.stderr).toBe(0);
    expect(runGit(repository, ["show", "HEAD:new.txt"])).toBe("edited");
    expect(runGit(repository, ["diff", "--cached", "--name-only"])).toBe("other.txt");
    expect(runGit(repository, ["diff", "--name-only"])).toBe("");
  });

  it.each([false, true])("distinguishes a stat refresh from staged content mutation (%s)", (mutate) => {
    const repository = createRepository();
    for (const name of ["selected.txt", "other.txt"]) writeFileSync(path.join(repository, name), "before\n");
    runGit(repository, ["add", "."]);
    runGit(repository, ["commit", "-qm", "baseline"]);
    const before = runGit(repository, ["rev-parse", "HEAD"]);
    writeFileSync(path.join(repository, "selected.txt"), "after\n");
    mkdirSync(path.join(repository, ".no-hooks"));
    const hook = path.join(repository, ".no-hooks/pre-commit");
    writeFileSync(hook, `#!/bin/sh
unset GIT_INDEX_FILE
${mutate ? 'printf "changed\\n" > other.txt\ngit add other.txt' : 'touch -t 200001010000 other.txt\ngit status --porcelain >/dev/null'}
`);
    chmodSync(hook, 0o755);
    const result = spawnSync("bash", [committerPath, "fix(test): scoped change", "selected.txt"],
      { cwd: repository, encoding: "utf8" });
    if (mutate) {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("repository index changed");
      expect(runGit(repository, ["rev-parse", "HEAD"])).toBe(before);
      expect(runGit(repository, ["show", ":other.txt"])).toBe("changed");
    } else {
      expect(result.status, result.stderr).toBe(0);
      expect(runGit(repository, ["status", "--short"])).toBe("?? .no-hooks/");
    }
  });

  it("rejects concurrent promotion of intent-to-add to a staged empty file", () => {
    const repository = createRepository();
    writeFileSync(path.join(repository, "selected.txt"), "before\n");
    runGit(repository, ["add", "selected.txt"]);
    runGit(repository, ["commit", "-qm", "baseline"]);
    const before = runGit(repository, ["rev-parse", "HEAD"]);
    writeFileSync(path.join(repository, "selected.txt"), "after\n");
    writeFileSync(path.join(repository, "empty.txt"), "");
    runGit(repository, ["add", "-N", "empty.txt"]);
    mkdirSync(path.join(repository, ".no-hooks"));
    const hook = path.join(repository, ".no-hooks/pre-commit");
    writeFileSync(hook, "#!/bin/sh\nunset GIT_INDEX_FILE\ngit add empty.txt\n");
    chmodSync(hook, 0o755);
    const result = spawnSync("bash", [committerPath, "fix(test): scoped change", "selected.txt"], { cwd: repository, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("repository index changed");
    expect(runGit(repository, ["rev-parse", "HEAD"])).toBe(before);
    expect(runGit(repository, ["diff", "--cached", "--name-only"])).toBe("empty.txt");
  });

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

  it("replaces a tracked directory with a selected file", () => {
    const repository = createRepository();
    const selectedPath = "artifact";
    const descendantPath = `${selectedPath}/part.txt`;
    mkdirSync(path.join(repository, selectedPath));
    writeFileSync(path.join(repository, descendantPath), "before\n");
    runGit(repository, ["add", descendantPath]);
    runGit(repository, ["commit", "-q", "-m", "baseline"]);

    rmSync(path.join(repository, selectedPath), { force: true, recursive: true });
    runGit(repository, ["add", "-u", "--", descendantPath]);
    writeFileSync(path.join(repository, selectedPath), "replacement\n");
    const realIndexTree = runGit(repository, ["write-tree"]);

    const result = runCommitter(repository, selectedPath, descendantPath);

    expect(result.status, result.stderr).toBe(0);
    expect(runGit(repository, ["show", `HEAD:${selectedPath}`])).toBe(
      "replacement",
    );
    expect(runGit(repository, ["ls-tree", "-r", "--name-only", "HEAD"])).toBe(
      selectedPath,
    );
    expect(runGit(repository, ["write-tree"])).toBe(realIndexTree);
    expect(readFileSync(path.join(repository, selectedPath), "utf8")).toBe(
      "replacement\n",
    );
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
