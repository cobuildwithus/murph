import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frogScriptPath = path.join(repoRoot, "scripts", "frog");
const readRepoFile = (...parts: string[]) =>
  readFileSync(path.join(repoRoot, ...parts), "utf8");

function actionRefs(workflow: string): string[] {
  return workflow.split("\n").flatMap((line) => {
    const match = /^\s*-?\s*uses:\s+[^@\s]+@([^\s#]+)/u.exec(line);
    return match?.[1] ? [match[1]] : [];
  });
}

describe("Frog workflow guards", () => {
  it("keeps local commands file-backed and workflow-owned", () => {
    expect(statSync(frogScriptPath).mode & 0o111).not.toBe(0);
    expect(spawnSync("bash", ["-n", frogScriptPath]).status).toBe(0);

    const frogScript = readRepoFile("scripts", "frog");
    expect(frogScript).toContain(
      "unset FROG_DATABASE_URL FROG_NAMESPACE FROG_SCHEMA",
    );
    expect(frogScript).toContain('cd "$repo_root"');
    expect(frogScript).toContain('exec pnpm dlx frog@1.1.0 "$@"');

    const publish = spawnSync(frogScriptPath, ["publish"], {
      encoding: "utf8",
    });
    expect(publish.status).toBe(2);
    expect(publish.stderr).toContain("Usage: scripts/frog {list|log}");

    const immediate = spawnSync(frogScriptPath, ["log", "--publish"], {
      encoding: "utf8",
    });
    expect(immediate.status).toBe(2);
    expect(immediate.stderr).toContain(
      "Publishing is owned by .github/workflows/friction-log.yml.",
    );

    for (const args of [
      ["list", "--cwd", "."],
      ["list", "--cwd=.."],
      ["list", "--mcp"],
      ["list", "--mcp=true"],
    ]) {
      const escaped = spawnSync(frogScriptPath, args, { encoding: "utf8" });
      expect(escaped.status).toBe(2);
      expect(escaped.stderr).toContain(
        "scripts/frog owns the repository root; --cwd and --mcp are not allowed.",
      );
    }
  });

  it("enters the repository root and clears ambient database settings", () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), "frog-wrapper-"));
    const fakeBin = path.join(testRoot, "bin");
    const capturePath = path.join(testRoot, "capture.txt");
    mkdirSync(fakeBin);
    writeFileSync(
      path.join(fakeBin, "pnpm"),
      `#!/usr/bin/env bash
set -euo pipefail

if [[ -n "\${FROG_DATABASE_URL+x}" || -n "\${FROG_NAMESPACE+x}" || -n "\${FROG_SCHEMA+x}" ]]; then
  printf 'ambient-variable-present\n' > "$FROG_TEST_CAPTURE"
  exit 91
fi

if [[ "$PWD" != "$FROG_TEST_EXPECTED_CWD" ]]; then
  printf 'cwd=unexpected\n' > "$FROG_TEST_CAPTURE"
  exit 92
fi

{
  printf 'cwd=repo\n'
  for argument in "$@"; do
    printf 'arg=%s\n' "$argument"
  done
} > "$FROG_TEST_CAPTURE"
`,
      { mode: 0o755 },
    );

    try {
      const result = spawnSync(frogScriptPath, ["list"], {
        cwd: testRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          FROG_DATABASE_URL: "postgresql://example.invalid/frog",
          FROG_NAMESPACE: "ambient",
          FROG_SCHEMA: "ambient",
          FROG_TEST_CAPTURE: capturePath,
          FROG_TEST_EXPECTED_CWD: repoRoot,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      });

      expect(result.status).toBe(0);
      expect(readFileSync(capturePath, "utf8")).toBe(
        "cwd=repo\narg=dlx\narg=frog@1.1.0\narg=list\n",
      );
    } finally {
      rmSync(testRoot, { force: true, recursive: true });
    }
  });

  it("keeps reporting local, bounded, and public-safe", () => {
    for (const repoRelativePath of [
      ".agents/friction-log/example/friction.md",
      ".agents/skills/frog/SKILL.md",
    ]) {
      expect(
        spawnSync(
          "git",
          ["check-ignore", "--no-index", "--quiet", repoRelativePath],
          { cwd: repoRoot },
        ).status,
      ).toBe(1);
    }

    expect(
      JSON.parse(readRepoFile(".agents", "friction-log", "config.json")),
    ).toEqual({
      $schema: "https://unpkg.com/frog@1.1.0/schema.json",
      inbound: { enabled: false },
      labels: ["enhancement"],
      maxPerRun: 5,
      outbound: { enabled: false },
    });

    const issueTemplateDir = path.join(repoRoot, ".github", "ISSUE_TEMPLATE");
    const issueForms = existsSync(issueTemplateDir)
      ? readdirSync(issueTemplateDir, { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isFile()
              && entry.name !== "config.yml"
              && /\.ya?ml$/u.test(entry.name),
          )
          .map((entry) => entry.name)
      : [];
    const selectedIssueForm = issueForms.find((file) => file === "friction.yml")
      ?? (issueForms.length === 1
        ? issueForms[0]
        : issueForms.find((file) => file.includes("bug")));
    // Frog validates supplied bodies against the form it auto-selects.
    expect(selectedIssueForm).toBeUndefined();

    const readme = readRepoFile(".agents", "friction-log", "README.md");
    expect(readme).toContain("scripts/frog list");
    expect(readme).toContain("workflow cleanup, not data deletion");
    expect(readme).toContain(".agents/friction-log/.sync.json");

    const skill = readRepoFile(".agents", "skills", "frog", "SKILL.md");
    expect(skill).toContain("current request authorizes repository edits");
    expect(skill).toContain("review-only");
    expect(skill).toContain("scripts/frog list");
    expect(skill).toContain("repository root");
    expect(skill).toContain("`--cwd` and `--mcp`");
    expect(skill).toContain("cat <<'FROG' | scripts/frog log");
    expect(skill).toContain("Use synthetic reproduction data only.");
    expect(skill).toContain("raw logs or command output");
    expect(skill).toContain("Closing an issue is not data deletion");
    for (const heading of [
      "## Expected Behavior",
      "## Current Behavior",
      "## Possible Solution",
      "## Minimal Reproducible Example",
      "## Context",
    ]) {
      expect(skill).toContain(heading);
    }
  });

  it("keeps the Action on trusted default-branch events with narrow authority", () => {
    const workflow = readRepoFile(
      ".github",
      "workflows",
      "friction-log.yml",
    );

    expect(workflow).toContain(`push:
    branches:
      - main
    paths:
      - ".agents/friction-log/**"`);
    expect(workflow).toContain(`issues:
    types:
      - closed
      - reopened`);
    expect(workflow).toContain("  workflow_dispatch:");
    expect(workflow).toContain('cron: "17 0 * * *"');
    expect(workflow).toContain("group: friction-log");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain(
      "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    );
    expect(workflow).toContain(
      "github.event.issue.user.login == 'github-actions[bot]'",
    );
    expect(workflow).not.toMatch(/^\s+pull_request(?:_target)?:/mu);

    const topLevelPermissions = workflow.indexOf("permissions: {}");
    const jobs = workflow.indexOf("jobs:");
    expect(topLevelPermissions).toBeGreaterThanOrEqual(0);
    expect(jobs).toBeGreaterThan(topLevelPermissions);
    expect(
      (workflow.match(/^\s+[a-z-]+: write$/gmu) ?? []).map((line) =>
        line.trim()
      ),
    ).toEqual([
      "contents: write",
      "issues: write",
      "pull-requests: write",
    ]);
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).toContain("timeout-minutes: 10");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("ref: ${{ github.sha }}");
    expect(workflow).not.toMatch(/^\s+max:/mu);
    expect(actionRefs(workflow)).toEqual([
      "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      "7b71c098683d49a573c279a2031a24205ea76841",
    ]);
    for (const input of [
      "branch: frog/sync",
      "issue-author: github-actions[bot]",
      "push: pull-request",
      'version: "1.1.0"',
    ]) {
      expect(workflow).toContain(input);
    }
  });
});
