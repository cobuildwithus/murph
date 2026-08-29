import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots: string[] = [];

function createTempRoot(): string {
  const sharedTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!sharedTempRoot) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  const root = mkdtempSync(path.join(sharedTempRoot, "review-gpt-bootstrap-"));
  roots.push(root);
  return root;
}

function writeExecutable(filePath: string, contents: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function provideReviewGptToolchain(root: string): void {
  writeExecutable(
    path.join(root, "node_modules", ".bin", "cobuild-review-gpt"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  writeExecutable(
    path.join(root, "node_modules", ".bin", "tsx"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  const consumerShell = path.join(
    root,
    "node_modules",
    "@cobuild",
    "repo-tools",
    "src",
    "consumer-shell.sh",
  );
  mkdirSync(path.dirname(consumerShell), { recursive: true });
  writeFileSync(consumerShell, "#!/usr/bin/env bash\n");
}

function createHarness(installProvidesToolchain: boolean) {
  const root = createTempRoot();
  const scriptsDirectory = path.join(root, "scripts");
  const fakeBin = path.join(root, "fake-bin");
  const gitDirectory = path.join(root, "git-admin");
  const pnpmLog = path.join(root, "pnpm.log");
  const lockLog = path.join(root, "lock.log");
  const wrapper = path.join(scriptsDirectory, "review-gpt-pr-head-preflight.sh");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(gitDirectory, { recursive: true });
  writeExecutable(
    wrapper,
    readFileSync(
      path.join(repoRoot, "scripts", "review-gpt-pr-head-preflight.sh"),
      "utf8",
    ),
  );
  writeExecutable(
    path.join(fakeBin, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "-C" ]]
[[ "$2" == "$MURPH_TEST_ROOT" ]]
[[ "$3" == "rev-parse" ]]
[[ "$4" == "--path-format=absolute" ]]
[[ "$5" == "--git-dir" ]]
printf '%s\n' "$MURPH_TEST_GIT_DIR"
`,
  );
  writeExecutable(
    path.join(fakeBin, "flock"),
    `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "-w" ]]
[[ "$2" == "300" ]]
printf '%s\n' "$3" >> "$MURPH_TEST_LOCK_LOG"
lock_directory="$3.held"
until mkdir "$lock_directory" 2>/dev/null; do
  sleep 0.01
done
cleanup() {
  rmdir "$lock_directory"
}
trap cleanup EXIT HUP INT TERM
shift 3
"$@"
`,
  );
  writeExecutable(
    path.join(fakeBin, "pnpm"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MURPH_TEST_PNPM_LOG"
if [[ "$1" == "install" ]]; then
  [[ "$*" == "install --frozen-lockfile --filter . --ignore-scripts" ]]
  if [[ "$MURPH_TEST_INSTALL_STATUS" != "0" ]]; then
    printf 'install failed below %s and %s\n' "$MURPH_TEST_ROOT" "$HOME" >&2
    exit "$MURPH_TEST_INSTALL_STATUS"
  fi
  if [[ "$MURPH_TEST_INSTALL_DELAY" == "1" ]]; then
    sleep 0.2
  fi
  if [[ "$MURPH_TEST_INSTALL_PROVIDES_TOOLCHAIN" == "1" ]]; then
    mkdir -p "$MURPH_TEST_ROOT/node_modules/.bin"
    mkdir -p "$MURPH_TEST_ROOT/node_modules/@cobuild/repo-tools/src"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$MURPH_TEST_ROOT/node_modules/.bin/cobuild-review-gpt"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$MURPH_TEST_ROOT/node_modules/.bin/tsx"
    chmod +x "$MURPH_TEST_ROOT/node_modules/.bin/cobuild-review-gpt"
    chmod +x "$MURPH_TEST_ROOT/node_modules/.bin/tsx"
    printf '#!/usr/bin/env bash\n' > "$MURPH_TEST_ROOT/node_modules/@cobuild/repo-tools/src/consumer-shell.sh"
  fi
  exit 0
fi
[[ "$1" == "exec" ]]
[[ "$2" == "cobuild-review-gpt" ]]
`,
  );

  return {
    environment: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      MURPH_TEST_GIT_DIR: gitDirectory,
      MURPH_TEST_INSTALL_DELAY: "0",
      MURPH_TEST_INSTALL_PROVIDES_TOOLCHAIN: installProvidesToolchain ? "1" : "0",
      MURPH_TEST_INSTALL_STATUS: "0",
      MURPH_TEST_LOCK_LOG: lockLog,
      MURPH_TEST_PNPM_LOG: pnpmLog,
      MURPH_TEST_ROOT: root,
    },
    lockLog,
    pnpmLog,
    root,
    wrapper,
  };
}

function runReviewGpt(harness: ReturnType<typeof createHarness>) {
  return spawnSync("bash", [harness.wrapper, "--run", "--zip", "--dry-run"], {
    cwd: harness.root,
    encoding: "utf8",
    env: harness.environment,
  });
}

function runReviewGptWithEnvironment(
  harness: ReturnType<typeof createHarness>,
  environment: NodeJS.ProcessEnv,
) {
  return spawnSync("bash", [harness.wrapper, "--run", "--zip", "--dry-run"], {
    cwd: harness.root,
    encoding: "utf8",
    env: { ...harness.environment, ...environment },
  });
}

function runReviewGptAsync(
  harness: ReturnType<typeof createHarness>,
): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "bash",
      [harness.wrapper, "--run", "--zip", "--dry-run"],
      {
        cwd: harness.root,
        env: { ...harness.environment, MURPH_TEST_INSTALL_DELAY: "1" },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { force: true, recursive: true });
});

describe("ReviewGPT fresh-worktree toolchain bootstrap", () => {
  it("links the frozen root importer before invoking ReviewGPT", () => {
    const harness = createHarness(true);

    const result = runReviewGpt(harness);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(
      "ReviewGPT repository tools are missing; linking the frozen root workspace importer.",
    );
    expect(readFileSync(harness.pnpmLog, "utf8")).toBe(
      "install --frozen-lockfile --filter . --ignore-scripts\n" +
        "exec cobuild-review-gpt --config scripts/review-gpt.config.sh --minimum-marked-response-time 5m --zip --dry-run\n",
    );
    expect(readFileSync(harness.lockLog, "utf8")).toContain(
      "review-gpt-toolchain-install.lock\n",
    );
  });

  it("uses the ready local toolchain without running an install", () => {
    const harness = createHarness(true);
    provideReviewGptToolchain(harness.root);

    const result = runReviewGpt(harness);

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(harness.pnpmLog, "utf8")).toBe(
      "exec cobuild-review-gpt --config scripts/review-gpt.config.sh --minimum-marked-response-time 5m --zip --dry-run\n",
    );
  });

  it("serializes concurrent fresh-worktree setup and installs once", async () => {
    const harness = createHarness(true);

    const results = await Promise.all([
      runReviewGptAsync(harness),
      runReviewGptAsync(harness),
    ]);

    for (const result of results) {
      expect(result.status, result.stderr).toBe(0);
    }
    const pnpmCalls = readFileSync(harness.pnpmLog, "utf8")
      .trim()
      .split("\n");
    expect(
      pnpmCalls.filter((call) => call.startsWith("install ")),
    ).toEqual(["install --frozen-lockfile --filter . --ignore-scripts"]);
    expect(
      pnpmCalls.filter((call) => call.startsWith("exec ")),
    ).toHaveLength(2);
  });

  it("fails closed when the filtered install leaves the toolchain incomplete", () => {
    const harness = createHarness(false);

    const result = runReviewGpt(harness);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "the frozen root workspace importer did not provide the complete ReviewGPT toolchain",
    );
    expect(result.stderr).toContain(
      "serialized ReviewGPT toolchain setup failed or timed out",
    );
    expect(readFileSync(harness.pnpmLog, "utf8")).toBe(
      "install --frozen-lockfile --filter . --ignore-scripts\n",
    );
  });

  it("redacts local paths from failed install diagnostics", () => {
    const harness = createHarness(false);

    const result = runReviewGptWithEnvironment(harness, {
      MURPH_TEST_INSTALL_STATUS: "17",
    });

    expect(result.status).toBe(17);
    expect(result.stderr).toContain("install failed below <repo> and <home>");
    expect(result.stderr).not.toContain(harness.root);
    expect(result.stderr).not.toContain(process.env.HOME);
  });
});
