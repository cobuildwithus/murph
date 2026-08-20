import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFLIGHT_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "review-gpt-pr-head-preflight.sh",
);
const PACKAGE_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "package-audit-context-full.sh",
);
const BASE_OID = "a".repeat(40);

async function readLines(filePath) {
  try {
    return (await readFile(filePath, "utf8"))
      .split("\n")
      .filter((line) => line.length > 0);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function waitFor(predicate, description, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for ${description}.`);
}

function spawnBasePreflight(environment) {
  const child = spawn(
    "bash",
    [PREFLIGHT_SCRIPT, "--refresh-pr-base-if-missing", "main", BASE_OID],
    {
      cwd: REPO_ROOT,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  return {
    child,
    completed: new Promise((resolve) => {
      child.on("error", (error) => {
        resolve({ error, status: null, stderr, stdout });
      });
      child.on("close", (status, signal) => {
        resolve({ signal, status, stderr, stdout });
      });
    }),
  };
}

async function writeExecutable(filePath, contents) {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
}

test("routes only the missing-base fetch through the shared preflight owner", async () => {
  const [preflight, packager] = await Promise.all([
    readFile(PREFLIGHT_SCRIPT, "utf8"),
    readFile(PACKAGE_SCRIPT, "utf8"),
  ]);

  assert.match(
    preflight,
    /--json baseRefName,baseRefOid,headRefOid/u,
  );
  assert.match(
    preflight,
    /review_gpt_refresh_pr_base_if_missing "\$base_ref" "\$base_oid"/u,
  );
  assert.match(
    packager,
    /if ! git cat-file -e "\$review_gpt_base_oid\^\{commit\}"/u,
  );
  assert.match(
    packager,
    /review-gpt-pr-head-preflight\.sh/u,
  );
  assert.match(packager, /--refresh-pr-base-if-missing/u);
  assert.doesNotMatch(
    packager,
    /git fetch --quiet origin "\$review_gpt_base_ref"/u,
  );
  assert.match(preflight, /lock_dir="\$common_dir\/murph-locks"/u);
  assert.match(
    preflight,
    /lock_file="\$lock_dir\/review-gpt-base-fetch\.lock"/u,
  );
  assert.match(preflight, /command -v flock/u);
  assert.match(preflight, /command -v lockf/u);
});

test(
  "concurrent base preflights perform one fetch and then continue independently",
  { timeout: 10_000 },
  async () => {
    const fixtureRoot = await mkdtemp(
      path.join(tmpdir(), "review-gpt-base-fetch-test-"),
    );
    const fakeBin = path.join(fixtureRoot, "bin");
    const commonDir = path.join(fixtureRoot, "common-git-dir");
    const baseAvailablePath = path.join(fixtureRoot, "base-available");
    const allowFetchPath = path.join(fixtureRoot, "allow-fetch");
    const fetchLogPath = path.join(fixtureRoot, "fetch.log");
    const gitLogPath = path.join(fixtureRoot, "git.log");
    const lockLogPath = path.join(fixtureRoot, "lock.log");
    const workers = [];

    try {
      await mkdir(fakeBin, { recursive: true });
      await mkdir(commonDir, { recursive: true });
      await writeExecutable(
        path.join(fakeBin, "git"),
        `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  cat-file)
    printf 'cat-file\\n' >> "$TEST_GIT_LOG"
    [[ -f "$TEST_BASE_AVAILABLE" ]]
    ;;
  rev-parse)
    [[ "\${2:-}" == "--path-format=absolute" ]]
    [[ "\${3:-}" == "--git-common-dir" ]]
    printf '%s\\n' "$TEST_COMMON_DIR"
    ;;
  fetch)
    [[ "\${2:-}" == "--quiet" ]]
    [[ "\${3:-}" == "origin" ]]
    [[ "\${4:-}" == "main" ]]
    printf 'start\\n' >> "$TEST_FETCH_LOG"
    until [[ -f "$TEST_ALLOW_FETCH" ]]; do
      sleep 0.01
    done
    : > "$TEST_BASE_AVAILABLE"
    printf 'end\\n' >> "$TEST_FETCH_LOG"
    ;;
  *)
    printf 'unexpected fake git invocation: %s\\n' "$*" >&2
    exit 64
    ;;
esac
`,
      );
      await writeExecutable(
        path.join(fakeBin, "flock"),
        `#!/usr/bin/env bash
set -euo pipefail
[[ "\${1:-}" == "-w" ]]
timeout_seconds="\${2:-}"
lock_file="\${3:-}"
shift 3
printf 'request\\t%s\\n' "$lock_file" >> "$TEST_LOCK_LOG"
lock_dir="\${lock_file}.held"
deadline=$((SECONDS + timeout_seconds))
until mkdir "$lock_dir" 2>/dev/null; do
  if (( SECONDS >= deadline )); then
    exit 75
  fi
  sleep 0.01
done
cleanup() {
  rmdir "$lock_dir"
}
trap cleanup EXIT HUP INT TERM
printf 'acquired\\t%s\\n' "$lock_file" >> "$TEST_LOCK_LOG"
"$@"
`,
      );

      const environment = {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        TEST_ALLOW_FETCH: allowFetchPath,
        TEST_BASE_AVAILABLE: baseAvailablePath,
        TEST_COMMON_DIR: commonDir,
        TEST_FETCH_LOG: fetchLogPath,
        TEST_GIT_LOG: gitLogPath,
        TEST_LOCK_LOG: lockLogPath,
      };

      workers.push(spawnBasePreflight(environment));
      await waitFor(
        async () => (await readLines(fetchLogPath))[0] === "start",
        "the first fetch to start",
      );

      workers.push(spawnBasePreflight(environment));
      await waitFor(
        async () => (
          await readLines(lockLogPath)
        ).filter((line) => line.startsWith("request\t")).length === 2,
        "both preflights to request the shared lock",
      );

      assert.deepEqual(await readLines(fetchLogPath), ["start"]);
      await writeFile(allowFetchPath, "");

      const results = await Promise.all(workers.map((worker) => worker.completed));
      for (const result of results) {
        assert.equal(
          result.status,
          0,
          `preflight failed: ${result.error ?? result.signal ?? result.stderr}`,
        );
      }

      assert.deepEqual(await readLines(fetchLogPath), ["start", "end"]);
      assert.equal(
        (await readLines(lockLogPath)).filter((line) =>
          line.startsWith("acquired\t")
        ).length,
        2,
      );
      assert.ok((await readLines(gitLogPath)).length >= 4);
      assert.equal(
        await readFile(baseAvailablePath, "utf8"),
        "",
      );
    } finally {
      await writeFile(allowFetchPath, "").catch(() => undefined);
      let cleanupTimer;
      await Promise.race([
        Promise.allSettled(workers.map((worker) => worker.completed)),
        new Promise((resolve) => {
          cleanupTimer = setTimeout(resolve, 1_000);
        }),
      ]);
      clearTimeout(cleanupTimer);
      for (const worker of workers) {
        if (worker.child.exitCode === null) {
          worker.child.kill("SIGKILL");
        }
      }
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  },
);

test("the public pushed-head preflight bypasses the lock when the base is available", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "review-gpt-base-fast-path-test-"),
  );
  const fakeBin = path.join(fixtureRoot, "bin");

  try {
    await mkdir(fakeBin, { recursive: true });
    await writeExecutable(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}:\${2:-}" in
  rev-parse:--is-inside-work-tree)
    printf 'true\\n'
    ;;
  status:--porcelain)
    ;;
  rev-parse:--verify)
    printf '%s\\n' "$TEST_HEAD"
    ;;
  cat-file:-e)
    ;;
  *)
    printf 'unexpected fake git invocation: %s\\n' "$*" >&2
    exit 64
    ;;
esac
`,
    );
    await writeExecutable(
      path.join(fakeBin, "gh"),
      `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "pr" ]]
[[ "$2" == "view" ]]
[[ "$3" == "42" ]]
[[ "$4" == "--json" ]]
[[ "$5" == "baseRefName,baseRefOid,headRefOid" ]]
printf 'main\\t%s\\t%s\\n' "$TEST_HEAD" "$TEST_HEAD"
`,
    );
    await writeExecutable(
      path.join(fakeBin, "flock"),
      `#!/usr/bin/env bash
printf 'flock must not run on the available-base fast path\\n' >&2
exit 99
`,
    );

    const result = spawnSync("bash", [PREFLIGHT_SCRIPT, "42"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        TEST_HEAD: BASE_OID,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /preflight passed/u);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});
