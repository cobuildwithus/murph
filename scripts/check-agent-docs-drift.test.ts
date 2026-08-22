import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const baseSha = "1".repeat(40);
const candidateSha = "2".repeat(40);
const roots: string[] = [];

function writeExecutable(filePath: string, contents: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function createHarness(
  options: {
    basePresent?: boolean;
    checkedOutSha?: string;
    changedFiles?: string;
    includeEventBase?: boolean;
  } = {},
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "murph-docs-drift-"));
  roots.push(root);
  const scriptsDir = path.join(root, "scripts");
  const fakeBin = path.join(root, "fake-bin");
  const gitLog = path.join(root, "git.log");
  const delegateCapture = path.join(root, "delegate.log");
  const fetchMarker = path.join(root, "base-fetched");
  const eventPath = path.join(root, "event.json");
  const delegatePath = path.join(fakeBin, "cobuild-check-agent-docs-drift");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeExecutable(
    path.join(scriptsDir, "check-agent-docs-drift.sh"),
    readFileSync(path.join(repoRoot, "scripts", "check-agent-docs-drift.sh"), "utf8"),
  );
  writeFileSync(
    path.join(scriptsDir, "release-manifest.json"),
    `${JSON.stringify({ packages: [{ path: "packages/cli" }] })}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(scriptsDir, "repo-tools.config.sh"),
    `cobuild_repo_tool_bin() {
  printf '%s\\n' "\${MURPH_TEST_DOCS_DRIFT_TOOL:?}"
}
`,
    "utf8",
  );
  writeFileSync(
    eventPath,
    `${JSON.stringify({
      pull_request: {
        base: options.includeEventBase === false ? {} : { sha: baseSha },
        head: { sha: candidateSha },
      },
    })}\n`,
    "utf8",
  );

  writeExecutable(
    path.join(fakeBin, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${MURPH_TEST_GIT_LOG:?}"

case "\${1:-}" in
  rev-parse)
    if [[ "\${2:-}" == "--is-inside-work-tree" ]]; then
      printf 'true\\n'
    elif [[ "\${2:-}" == "HEAD" ]]; then
      printf '%s\\n' "\${MURPH_TEST_CHECKED_OUT_SHA:?}"
    else
      exit 2
    fi
    ;;
  cat-file)
    [[ "\${2:-}" == "-e" ]]
    if [[ "\${3:-}" == "\${MURPH_TEST_CANDIDATE_SHA:?}^{commit}" ]]; then
      exit 0
    fi
    if [[ "\${3:-}" == "\${MURPH_TEST_BASE_SHA:?}^{commit}" ]]; then
      [[ "\${MURPH_TEST_BASE_PRESENT:-0}" == "1" || -f "\${MURPH_TEST_FETCH_MARKER:?}" ]]
      exit $?
    fi
    exit 2
    ;;
  fetch)
    : > "\${MURPH_TEST_FETCH_MARKER:?}"
    ;;
  diff)
    if [[ "\${2:-}" == "--name-only" && "\${3:-}" == "\${MURPH_TEST_BASE_SHA:?}..\${MURPH_TEST_CANDIDATE_SHA:?}" ]]; then
      printf '%s' "\${MURPH_TEST_CHANGED_FILES:?}"
      exit 0
    fi
    if [[ "\${2:-}" == "--unified=0" && "\${3:-}" == "--no-color" && "\${6:-}" == "packages/cli/package.json" ]]; then
      cat <<'DIFF'
--- a/packages/cli/package.json
+++ b/packages/cli/package.json
@@ -1 +1 @@
-  "version": "1.0.0",
+  "version": "1.0.1",
DIFF
      exit 0
    fi
    if [[ "\${2:-}" == "--name-only" && "\${3:-}" == "--cached" ]]; then
      [[ -n "\${GIT_INDEX_FILE:-}" && -f "\${GIT_INDEX_FILE}" ]]
      printf '%s' "\${MURPH_TEST_CHANGED_FILES:?}"
      exit 0
    fi
    exit 2
    ;;
  read-tree)
    [[ "\${2:-}" == "\${MURPH_TEST_BASE_SHA:?}" ]]
    [[ -n "\${GIT_INDEX_FILE:-}" ]]
    : > "\${GIT_INDEX_FILE}"
    ;;
  *)
    exit 2
    ;;
esac
`,
  );
  writeExecutable(
    delegatePath,
    `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'base-ref=%s\\n' "\${GITHUB_BASE_REF-<unset>}"
  if [[ -n "\${GIT_INDEX_FILE:-}" && -f "\${GIT_INDEX_FILE}" ]]; then
    printf 'alternate-index=present\\n'
  else
    printf 'alternate-index=missing\\n'
  fi
  git diff --name-only --cached
} > "\${MURPH_TEST_DELEGATE_CAPTURE:?}"
`,
  );

  const env = {
    ...process.env,
    GITHUB_BASE_REF: "main",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_SHA: candidateSha,
    MURPH_DOCS_DRIFT_BASE_SHA: "",
    MURPH_DOCS_DRIFT_CANDIDATE_SHA: "",
    MURPH_PR_BASE_SHA: "",
    MURPH_PR_HEAD_SHA: "",
    MURPH_TEST_BASE_PRESENT: options.basePresent === false ? "0" : "1",
    MURPH_TEST_BASE_SHA: baseSha,
    MURPH_TEST_CANDIDATE_SHA: candidateSha,
    MURPH_TEST_CHECKED_OUT_SHA: options.checkedOutSha ?? candidateSha,
    MURPH_TEST_CHANGED_FILES: options.changedFiles ?? "scripts/example.sh\n",
    MURPH_TEST_DELEGATE_CAPTURE: delegateCapture,
    MURPH_TEST_DOCS_DRIFT_TOOL: delegatePath,
    MURPH_TEST_FETCH_MARKER: fetchMarker,
    MURPH_TEST_GIT_LOG: gitLog,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
  };

  return {
    delegateCapture,
    gitLog,
    run() {
      return spawnSync("bash", ["scripts/check-agent-docs-drift.sh"], {
        cwd: root,
        encoding: "utf8",
        env,
      });
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("agent docs drift CI comparison", () => {
  it("uses immutable event commits without rewriting a shallow base ref", () => {
    const harness = createHarness();
    const result = harness.run();

    expect(result.status, result.stderr).toBe(0);
    const gitLog = readFileSync(harness.gitLog, "utf8");
    expect(gitLog).toContain(`diff --name-only ${baseSha}..${candidateSha}`);
    expect(gitLog).toContain(`read-tree ${baseSha}`);
    expect(gitLog).not.toContain("fetch ");
    expect(gitLog).not.toContain("origin/main");
    expect(gitLog).not.toContain("...HEAD");
    expect(readFileSync(harness.delegateCapture, "utf8")).toBe(
      "base-ref=\nalternate-index=present\nscripts/example.sh\n",
    );
  });

  it("keeps the release-only exemption tied to the exact candidate diff", () => {
    const harness = createHarness({
      changedFiles: [
        "packages/cli/package.json",
        "packages/cli/CHANGELOG.md",
        "packages/cli/release-notes/v1.0.1.md",
        "",
      ].join("\n"),
    });
    const result = harness.run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Agent docs drift checks passed for release artifacts only.",
    );
    const gitLog = readFileSync(harness.gitLog, "utf8");
    expect(gitLog).toContain(`diff --name-only ${baseSha}..${candidateSha}`);
    expect(gitLog).toContain(
      `diff --unified=0 --no-color ${baseSha}..${candidateSha} -- packages/cli/package.json`,
    );
    expect(gitLog).not.toContain("read-tree ");
  });

  it("fetches only a missing exact base object and leaves mutable refs untouched", () => {
    const harness = createHarness({ basePresent: false });
    const result = harness.run();

    expect(result.status, result.stderr).toBe(0);
    const gitLog = readFileSync(harness.gitLog, "utf8");
    expect(gitLog).toContain(
      `fetch --quiet --no-tags --no-write-fetch-head --depth=1 origin ${baseSha}`,
    );
    expect(gitLog).not.toContain("origin/main");
    expect(gitLog).not.toContain("...HEAD");
  });

  it("fails closed instead of falling back to a mutable base branch", () => {
    const harness = createHarness({ includeEventBase: false });
    const result = harness.run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("requires an exact base SHA");
    const gitLog = readFileSync(harness.gitLog, "utf8");
    expect(gitLog).not.toContain("fetch ");
    expect(gitLog).not.toContain("diff ");
    expect(gitLog).not.toContain("read-tree ");
  });

  it("fails closed when the requested candidate is not the checked-out tree", () => {
    const harness = createHarness({ checkedOutSha: "3".repeat(40) });
    const result = harness.run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not match checked-out HEAD");
    const gitLog = readFileSync(harness.gitLog, "utf8");
    expect(gitLog).not.toContain("fetch ");
    expect(gitLog).not.toContain("diff ");
    expect(gitLog).not.toContain("read-tree ");
  });
});
