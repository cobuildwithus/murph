import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, test } from "vitest";

const execFileAsync = promisify(execFile);

const appTestDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appTestDir, "../../..");
const installScriptPath = path.join(repoRoot, "apps/web/public/install.sh");

async function writeExecutable(absolutePath: string, contents: string): Promise<void> {
  await writeFile(absolutePath, contents, "utf8");
  await chmod(absolutePath, 0o755);
}

async function createStubMurphCheckout(root: string, marker: string): Promise<void> {
  await mkdir(path.join(root, "packages/cli"), { recursive: true });
  await mkdir(path.join(root, "scripts"), { recursive: true });

  await writeFile(path.join(root, "package.json"), '{ "name": "murph-workspace" }\n', "utf8");
  await writeFile(
    path.join(root, "packages/cli/package.json"),
    '{ "name": "@murphai/murph" }\n',
    "utf8",
  );
  await writeExecutable(
    path.join(root, "scripts/setup-host.sh"),
    `#!/usr/bin/env bash
set -euo pipefail

receipt="\${INSTALL_TEST_RECEIPT:?}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"

{
  printf 'marker=%s\\n' ${JSON.stringify(marker)}
  printf 'repo_root=%s\\n' "$repo_root"
  for arg in "$@"; do
    printf 'arg=%s\\n' "$arg"
  done
} > "$receipt"
`,
  );
}

async function createGitStub(binDir: string): Promise<void> {
  await mkdir(binDir, { recursive: true });
  await writeExecutable(
    path.join(binDir, "git"),
    `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >> "\${INSTALL_TEST_GIT_LOG:?}"

if [[ "\${1:-}" == "clone" ]]; then
  dest=""
  for arg in "$@"; do
    dest="$arg"
  done
  mkdir -p "$(dirname "$dest")"
  cp -R "\${INSTALL_TEST_TEMPLATE_REPO:?}" "$dest"
  exit 0
fi

printf 'unexpected git invocation: %s\\n' "$*" >&2
exit 1
`,
  );
}

async function runHostedInstaller(input: {
  cwd: string;
  homeDir: string;
  gitLogPath: string;
  receiptPath: string;
  targetDir: string;
  templateRepoDir: string;
}): Promise<{ stderr: string; stdout: string }> {
  const fakeBinDir = path.join(input.homeDir, "fake-bin");
  await createGitStub(fakeBinDir);

  return await execFileAsync(
    "/bin/bash",
    [
      installScriptPath,
      "--install-method",
      "git",
      "--git-dir",
      input.targetDir,
      "--no-git-update",
      "--no-onboard",
    ],
    {
      cwd: input.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: input.homeDir,
        INSTALL_TEST_GIT_LOG: input.gitLogPath,
        INSTALL_TEST_RECEIPT: input.receiptPath,
        INSTALL_TEST_TEMPLATE_REPO: input.templateRepoDir,
        NO_COLOR: "1",
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        XDG_CONFIG_HOME: path.join(input.homeDir, ".config"),
        XDG_DATA_HOME: path.join(input.homeDir, ".local/share"),
      },
    },
  );
}

describe.sequential("hosted install.sh", () => {
  test("runs successfully under macOS system bash when using the git install path", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-install-script-"));

    try {
      const homeDir = path.join(tempRoot, "home");
      const targetDir = path.join(tempRoot, "target-repo");
      const templateRepoDir = path.join(tempRoot, "template-repo");
      const receiptPath = path.join(tempRoot, "receipt.txt");
      const gitLogPath = path.join(tempRoot, "git.log");

      await mkdir(homeDir, { recursive: true });
      await createStubMurphCheckout(templateRepoDir, "target");

      const result = await runHostedInstaller({
        cwd: tempRoot,
        gitLogPath,
        homeDir,
        receiptPath,
        targetDir,
        templateRepoDir,
      });

      const receipt = await readFile(receiptPath, "utf8");
      const gitLog = await readFile(gitLogPath, "utf8");

      assert.match(result.stdout, /Murph install complete/u);
      assert.match(gitLog, /clone/u);
      assert.match(receipt, /marker=target/u);
      assert.match(receipt, new RegExp(`repo_root=${escapeRegExp(targetDir)}`, "u"));
      assert.match(receipt, /arg=--format/u);
      assert.match(receipt, /arg=md/u);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  test("respects an explicit --git-dir even when run from inside another Murph checkout", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-install-script-checkout-"));

    try {
      const currentCheckoutDir = path.join(tempRoot, "current-checkout");
      const homeDir = path.join(tempRoot, "home");
      const targetDir = path.join(tempRoot, "explicit-target");
      const templateRepoDir = path.join(tempRoot, "template-repo");
      const receiptPath = path.join(tempRoot, "receipt.txt");
      const gitLogPath = path.join(tempRoot, "git.log");

      await mkdir(homeDir, { recursive: true });
      await createStubMurphCheckout(currentCheckoutDir, "current");
      await createStubMurphCheckout(templateRepoDir, "target");

      await runHostedInstaller({
        cwd: currentCheckoutDir,
        gitLogPath,
        homeDir,
        receiptPath,
        targetDir,
        templateRepoDir,
      });

      const receipt = await readFile(receiptPath, "utf8");
      const gitLog = await readFile(gitLogPath, "utf8");

      assert.match(gitLog, /clone/u);
      assert.match(receipt, /marker=target/u);
      assert.doesNotMatch(receipt, /marker=current/u);
      assert.match(receipt, new RegExp(`repo_root=${escapeRegExp(targetDir)}`, "u"));
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
