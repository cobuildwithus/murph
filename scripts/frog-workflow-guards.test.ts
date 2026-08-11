import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
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
    expect(frogScript).toContain(
      'frog_bin="$repo_root/node_modules/.bin/frog"',
    );
    expect(frogScript).toContain('exec "$frog_bin" "$@"');
    expect(frogScript).not.toContain("pnpm dlx");

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
    const testRepo = path.join(testRoot, "repo");
    const testScriptDir = path.join(testRepo, "scripts");
    const testScript = path.join(testScriptDir, "frog");
    const fakeBin = path.join(testRepo, "node_modules", ".bin");
    const capturePath = path.join(testRoot, "capture.txt");
    mkdirSync(testScriptDir, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(testScript, readRepoFile("scripts", "frog"), { mode: 0o755 });
    writeFileSync(
      path.join(fakeBin, "frog"),
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
      const result = spawnSync(testScript, ["list"], {
        cwd: testRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          FROG_DATABASE_URL: "postgresql://example.invalid/frog",
          FROG_NAMESPACE: "ambient",
          FROG_SCHEMA: "ambient",
          FROG_TEST_CAPTURE: capturePath,
          FROG_TEST_EXPECTED_CWD: realpathSync(testRepo),
        },
      });

      expect(result.status).toBe(0);
      expect(readFileSync(capturePath, "utf8")).toBe(
        "cwd=repo\narg=list\n",
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
    expect(JSON.parse(readRepoFile("package.json")).devDependencies.frog).toBe(
      "1.1.0",
    );

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
    expect(skill).toContain(
      "Creating or updating a tracked plan file is edit-authorized repository work",
    );
    expect(skill).toContain("planning-only");
    expect(skill).toContain("scripts/frog list");
    expect(skill).toContain(
      'Do not create an empty or synthetic "no friction" entry',
    );
    expect(skill).toContain("include it in the same scoped task commit");
    expect(skill).toContain("untracked, unstaged, or omitted from the commit");
    expect(skill).toMatch(
      /If a safe scoped\s+commit is blocked, preserve the entry and report the exact blocker/u,
    );
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

    const agents = readRepoFile("AGENTS.md");
    expect(agents).toContain("§ Developer Friction Logging");
    expect(agents).toContain("commit each created entry with the task");

    const workflowRouting = readRepoFile(
      "agent-docs",
      "operations",
      "agent-workflow-routing.md",
    );
    expect(workflowRouting).toContain("### Developer Friction Logging");
    expect(workflowRouting).toContain(
      "For every edit-authorized repository task",
    );
    expect(workflowRouting).toMatch(
      /Creating or\s+updating a tracked plan file is edit-authorized repository work/u,
    );
    expect(workflowRouting).toContain("planning-only");
    expect(workflowRouting).toContain("run `scripts/frog list`");
    expect(workflowRouting).toMatch(
      /record it\s+through `scripts\/frog log`/u,
    );
    expect(workflowRouting).toContain(
      "A task is not complete while its Frog entry is untracked",
    );

    const completionWorkflow = readRepoFile(
      "agent-docs",
      "operations",
      "completion-workflow.md",
    );
    expect(completionWorkflow).toContain(
      "Include every public-safe Frog entry created or modified during the task in that same scoped commit",
    );
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
      "github.event.issue.user.login == vars.FROG_APP_BOT_LOGIN",
    );
    expect(workflow).not.toContain("github-actions[bot]");
    expect(workflow).not.toMatch(/^\s+pull_request(?:_target)?:/mu);
    expect(workflow).toContain(`environment:
      name: frog-reconciliation
      deployment: false`);

    const topLevelPermissions = workflow.indexOf("permissions: {}");
    const jobs = workflow.indexOf("jobs:");
    expect(topLevelPermissions).toBeGreaterThanOrEqual(0);
    expect(jobs).toBeGreaterThan(topLevelPermissions);
    const jobPermissions = /^    permissions:\n(?<permissions>(?:      .+\n)+)/mu
      .exec(workflow)?.groups?.permissions;
    expect(jobPermissions).toBe("      contents: read\n");
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).toContain("timeout-minutes: 10");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("ref: ${{ github.sha }}");
    expect(workflow).toContain(
      "run: pnpm install --frozen-lockfile --ignore-scripts",
    );
    expect(workflow).not.toContain("pnpm dlx");
    expect(workflow).not.toMatch(/\bnpm install\b/u);
    expect(workflow).not.toMatch(/^\s+max:/mu);
    expect(actionRefs(workflow)).toEqual([
      "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      "fc06bc1257f339d1d5d8b3a19a8cae5388b55320",
      "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
      "bcd2ba49218906704ab6c1aa796996da409d3eb1",
      "7b71c098683d49a573c279a2031a24205ea76841",
    ]);
    const appTokenInputs =
      /^        uses: actions\/create-github-app-token@[^\n]+\n        with:\n(?<inputs>(?:          [^\n]+\n)+)/mu
        .exec(workflow)?.groups?.inputs;
    expect(
      appTokenInputs?.trim().split("\n").map((line) => line.trim()),
    ).toEqual([
      "client-id: ${{ vars.FROG_APP_CLIENT_ID }}",
      "private-key: ${{ secrets.FROG_APP_PRIVATE_KEY }}",
      "permission-contents: write",
      "permission-issues: write",
      "permission-pull-requests: write",
    ]);
    for (const input of [
      "branch: frog/sync",
      "command: node_modules/.bin/frog",
      "issue-author: ${{ vars.FROG_APP_BOT_LOGIN }}",
      "push: pull-request",
      "token: ${{ steps.frog-app-token.outputs.token }}",
    ]) {
      expect(workflow).toContain(input);
    }
    expect(workflow).not.toMatch(/^\s+token:\s*\$\{\{\s*github\.token\s*\}\}/mu);
    expect(workflow).not.toContain("secrets.GITHUB_TOKEN");
    expect(workflow).not.toMatch(/^\s+version:/mu);

    const readme = readRepoFile(".agents", "friction-log", "README.md");
    expect(readme).toContain("FROG_APP_CLIENT_ID");
    expect(readme).toContain("FROG_APP_BOT_LOGIN");
    expect(readme).toContain("FROG_APP_PRIVATE_KEY");
    expect(readme).toContain("installed only on this repository");
    expect(readme).toContain("environment is limited");
    expect(readme).toMatch(/Missing credentials\s+fail the workflow closed/u);
  });
});
