import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots: string[] = [];
const generatedCliOutputs = [
  "packages/cli/config.schema.json",
  "packages/cli/src/incur.generated.ts",
  "packages/cli/src/vault-cli-skill-hash.generated.ts",
] as const;

function createTempRoot(prefix: string): string {
  const sharedTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!sharedTempRoot) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  const root = mkdtempSync(path.join(sharedTempRoot, prefix));
  roots.push(root);
  return root;
}

function writeExecutable(filePath: string, contents: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Git fixture command failed (${args.join(" ")}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

function listFiles(root: string, relativeDirectory = ""): string[] {
  const directory = path.join(root, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? listFiles(root, relativePath) : [relativePath];
  });
}

function createPlanHarness() {
  const root = createTempRoot("open-exec-plan-");
  const scriptsDirectory = path.join(root, "scripts");
  const delegate = path.join(root, "fake-open-exec-plan");
  const capture = path.join(root, "delegate-arguments");
  mkdirSync(scriptsDirectory, { recursive: true });
  writeExecutable(
    path.join(scriptsDirectory, "open-exec-plan.sh"),
    readFileSync(path.join(repoRoot, "scripts", "open-exec-plan.sh"), "utf8"),
  );
  writeFileSync(
    path.join(scriptsDirectory, "repo-tools.config.sh"),
    `cobuild_repo_tool_bin() {
  printf '%s\\n' "\${MURPH_TEST_PLAN_BIN:?}"
}
`,
  );
  writeExecutable(
    delegate,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "\${MURPH_TEST_PLAN_CAPTURE:?}"
mkdir -p agent-docs/exec-plans/active
printf 'created\\n' > "agent-docs/exec-plans/active/$1.md"
`,
  );
  return { capture, delegate, root };
}

function createPreCommitHarness() {
  const root = createTempRoot("pre-commit-merge-");
  const repository = path.join(root, "repo");
  const fakeBin = path.join(root, "bin");
  const capture = path.join(root, "pnpm-arguments");
  mkdirSync(path.join(repository, ".githooks"), { recursive: true });
  mkdirSync(path.join(repository, "scripts"), { recursive: true });
  mkdirSync(path.join(repository, "packages", "cli", "src"), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeExecutable(
    path.join(repository, ".githooks", "pre-commit"),
    readFileSync(path.join(repoRoot, ".githooks", "pre-commit"), "utf8"),
  );
  writeExecutable(
    path.join(repository, "scripts", "worktree-storage-guard"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  writeExecutable(
    path.join(fakeBin, "pnpm"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "\${MURPH_TEST_PNPM_CAPTURE:?}"
if [[ "\${MURPH_TEST_WRITE_GENERATED:-0}" == '1' ]]; then
  cli_dir="$2"
  case "\${MURPH_TEST_GENERATOR_MUTATION:-}" in
    tracked)
      printf 'raced\\n' > "$cli_dir/input.ts"
      ;;
    untracked)
      printf 'raced\\n' > "$cli_dir/untracked-during-generation.ts"
      ;;
  esac
  input="$(cat "$cli_dir/input.ts")"
  printf 'generated:%s\\n' "$input" > "$cli_dir/config.schema.json"
  printf 'generated:%s\\n' "$input" > "$cli_dir/src/incur.generated.ts"
  printf 'generated:%s\\n' "$input" > "$cli_dir/src/vault-cli-skill-hash.generated.ts"
fi
`,
  );
  writeFileSync(path.join(repository, "packages", "cli", "input.ts"), "base\n");
  writeFileSync(path.join(repository, "packages", "cli", "incoming.ts"), "base\n");
  writeFileSync(path.join(repository, "packages", "cli", "task.ts"), "base\n");
  for (const output of generatedCliOutputs) {
    writeFileSync(path.join(repository, output), "generated:base\n");
  }
  writeFileSync(path.join(repository, "feature.txt"), "base\n");
  runGit(repository, ["init", "-b", "main"]);
  runGit(repository, ["config", "core.hooksPath", ".no-hooks"]);
  runGit(repository, ["config", "user.name", "Workflow Test"]);
  runGit(repository, ["config", "user.email", "workflow-test@invalid"]);
  runGit(repository, ["add", "."]);
  runGit(repository, ["commit", "-m", "baseline"]);

  return {
    capture,
    environment: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      MURPH_TEST_PNPM_CAPTURE: capture,
    },
    repository,
  };
}

function createMergeHarness(withTaskAuthoredCliChange: boolean) {
  const harness = createPreCommitHarness();
  const { repository } = harness;

  runGit(repository, ["checkout", "-b", "task"]);
  writeFileSync(path.join(repository, "feature.txt"), "task branch\n");
  runGit(repository, ["add", "feature.txt"]);
  runGit(repository, ["commit", "-m", "task change"]);

  runGit(repository, ["checkout", "main"]);
  writeFileSync(path.join(repository, "packages", "cli", "incoming.ts"), "incoming\n");
  runGit(repository, ["add", "packages/cli/incoming.ts"]);
  runGit(repository, ["commit", "-m", "incoming CLI change"]);

  runGit(repository, ["checkout", "task"]);
  runGit(repository, ["merge", "--no-ff", "--no-commit", "main"]);
  if (withTaskAuthoredCliChange) {
    writeFileSync(path.join(repository, "packages", "cli", "task.ts"), "task during merge\n");
    runGit(repository, ["add", "packages/cli/task.ts"]);
  }

  return harness;
}

function runPreCommit(
  harness: ReturnType<typeof createPreCommitHarness>,
  environment: NodeJS.ProcessEnv = {},
) {
  return spawnSync("bash", [".githooks/pre-commit"], {
    cwd: harness.repository,
    encoding: "utf8",
    env: { ...harness.environment, ...environment },
  });
}

function runLegacyNameGate(repository: string) {
  return spawnSync(
    "bash",
    ["-o", "pipefail", "-c", "git diff --cached --name-only | grep -q '^packages/cli/'"],
    { cwd: repository, encoding: "utf8" },
  );
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { force: true, recursive: true });
});

describe("open execution plan wrapper", () => {
  it.each([
    ["-h", ["-h"]],
    ["--help", ["--help"]],
    ["separator plus -h", ["--", "-h"]],
    ["separator plus --help", ["--", "--help"]],
  ])("prints %s help without mutating the checkout", (_label, args) => {
    const harness = createPlanHarness();
    const before = listFiles(harness.root);

    const result = spawnSync("bash", ["scripts/open-exec-plan.sh", ...args], {
      cwd: harness.root,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("Usage: scripts/open-exec-plan.sh <slug> [title]\n");
    expect(listFiles(harness.root)).toEqual(before);
    expect(existsSync(harness.capture)).toBe(false);
  });

  it.each([
    ["directly", []],
    ["after one separator", ["--"]],
  ])("preserves ordinary plan creation %s", (_label, prefix) => {
    const harness = createPlanHarness();
    const result = spawnSync(
      "bash",
      ["scripts/open-exec-plan.sh", ...prefix, "routine-change", "Routine title"],
      {
        cwd: harness.root,
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_TEST_PLAN_BIN: harness.delegate,
          MURPH_TEST_PLAN_CAPTURE: harness.capture,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(harness.capture, "utf8")).toBe("routine-change\nRoutine title\n");
    expect(
      readFileSync(
        path.join(harness.root, "agent-docs", "exec-plans", "active", "routine-change.md"),
        "utf8",
      ),
    ).toBe("created\n");
  });
});

describe("pre-commit CLI schema generation", () => {
  it("skips generation when a merge's staged CLI tree exactly matches MERGE_HEAD", () => {
    const harness = createMergeHarness(false);
    const result = runPreCommit(harness);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("skipped CLI config-schema generation for base-only merge changes");
    expect(existsSync(harness.capture)).toBe(false);
  });

  it("still generates when the staged merge tree includes a task-authored CLI change", () => {
    const harness = createMergeHarness(true);
    const result = runPreCommit(harness);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain("base-only merge changes");
    expect(readFileSync(harness.capture, "utf8")).toContain("gen:config-schema");
  });

  it("detects a staged CLI rename out of the package", () => {
    const harness = createPreCommitHarness();
    runGit(harness.repository, ["mv", "packages/cli/input.ts", "renamed-outside.ts"]);

    expect(runLegacyNameGate(harness.repository).status).not.toBe(0);
    const result = runPreCommit(harness);

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(harness.capture, "utf8")).toContain("gen:config-schema");
  });

  it("detects a staged CLI path that Git quotes in name-only output", () => {
    const harness = createPreCommitHarness();
    const unicodePath = "packages/cli/naïve file.ts";
    writeFileSync(path.join(harness.repository, unicodePath), "quoted path\n");
    runGit(harness.repository, ["add", unicodePath]);

    expect(runLegacyNameGate(harness.repository).status).not.toBe(0);
    const result = runPreCommit(harness);

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(harness.capture, "utf8")).toContain("gen:config-schema");
  });

  it("detects CLI changes even when a large staged diff breaks the legacy pipefail gate", () => {
    const harness = createPreCommitHarness();
    writeFileSync(path.join(harness.repository, "packages", "cli", "first.ts"), "cli\n");
    runGit(harness.repository, ["add", "packages/cli/first.ts"]);
    const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: harness.repository,
      encoding: "utf8",
      input: "large diff\n",
    });
    expect(blob.status, blob.stderr).toBe(0);
    const indexEntries: string[] = [];
    for (let index = 0; index < 512; index += 1) {
      const name = `entry-${String(index).padStart(4, "0")}-${"x".repeat(200)}.txt`;
      indexEntries.push(`100644 ${blob.stdout.trim()}\tzz-large-diff/${name}`);
    }
    const updateIndex = spawnSync("git", ["update-index", "--add", "--index-info"], {
      cwd: harness.repository,
      encoding: "utf8",
      input: `${indexEntries.join("\n")}\n`,
    });
    expect(updateIndex.status, updateIndex.stderr).toBe(0);

    expect(runLegacyNameGate(harness.repository).status).not.toBe(0);
    const result = runPreCommit(harness);

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(harness.capture, "utf8")).toContain("gen:config-schema");
  });

  it("fails before generation when a tracked CLI input has unstaged changes", () => {
    const harness = createPreCommitHarness();
    const inputPath = path.join(harness.repository, "packages", "cli", "input.ts");
    writeFileSync(inputPath, "staged\n");
    runGit(harness.repository, ["add", "packages/cli/input.ts"]);
    writeFileSync(inputPath, "unstaged\n");

    const result = runPreCommit(harness);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unstaged CLI generator inputs");
    expect(existsSync(harness.capture)).toBe(false);
    for (const output of generatedCliOutputs) {
      expect(readFileSync(path.join(harness.repository, output), "utf8")).toBe("generated:base\n");
    }
  });

  it("fails before generation when an untracked CLI input is present", () => {
    const harness = createPreCommitHarness();
    writeFileSync(path.join(harness.repository, "packages", "cli", "input.ts"), "staged\n");
    runGit(harness.repository, ["add", "packages/cli/input.ts"]);
    writeFileSync(
      path.join(harness.repository, "packages", "cli", "untracked-input.ts"),
      "untracked\n",
    );

    const result = runPreCommit(harness);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unstaged CLI generator inputs");
    expect(existsSync(harness.capture)).toBe(false);
  });

  it.each(["tracked", "untracked"] as const)(
    "fails before staging when a %s CLI input changes during generation",
    (mutation) => {
      const harness = createPreCommitHarness();
      writeFileSync(path.join(harness.repository, "packages", "cli", "input.ts"), "staged\n");
      runGit(harness.repository, ["add", "packages/cli/input.ts"]);

      const result = runPreCommit(harness, {
        MURPH_TEST_GENERATOR_MUTATION: mutation,
        MURPH_TEST_WRITE_GENERATED: "1",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("unstaged CLI generator inputs");
      expect(readFileSync(harness.capture, "utf8")).toContain("gen:config-schema");
      for (const output of generatedCliOutputs) {
        expect(runGit(harness.repository, ["show", `:${output}`])).toBe("generated:base");
      }
    },
  );

  it("commits all generated artifacts from the exact staged CLI input tree", () => {
    const harness = createPreCommitHarness();
    writeFileSync(path.join(harness.repository, "packages", "cli", "input.ts"), "updated\n");
    runGit(harness.repository, ["add", "packages/cli/input.ts"]);
    runGit(harness.repository, ["config", "core.hooksPath", ".githooks"]);

    const commit = spawnSync("git", ["commit", "-m", "update CLI input"], {
      cwd: harness.repository,
      encoding: "utf8",
      env: {
        ...harness.environment,
        MURPH_TEST_WRITE_GENERATED: "1",
      },
    });

    expect(commit.status, commit.stderr).toBe(0);
    expect(runGit(harness.repository, ["show", "HEAD:packages/cli/input.ts"])).toBe("updated");
    for (const output of generatedCliOutputs) {
      expect(runGit(harness.repository, ["show", `HEAD:${output}`])).toBe("generated:updated");
    }
    expect(runGit(harness.repository, ["status", "--porcelain=v1"])).toBe("");
  });
});
