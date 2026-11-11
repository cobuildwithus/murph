import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validatePrChangelog } from "./check-pr-changelog.mjs";
import {
  normalizeFrogPullRequestBody,
  renderFrogChangeShape,
  selectFrogPullRequest,
} from "./frog-pr-context.ts";

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

function renderPlainFooterDeclaration(
  body: string,
  heading: "Changelog",
): string {
  const items = new RegExp(`^## ${heading}\\n\\n(?<items>(?:- .+\\n?)+)`, "mu")
    .exec(body)?.groups?.items.trim().split("\n");
  expect(items).toBeDefined();
  return [
    `<h2>${heading}</h2>`,
    "<ul>",
    ...(items ?? []).map((item) => `<li>${item.replace(/^- /u, "")}</li>`),
    "</ul>",
  ].join("\n");
}

describe("Frog workflow guards", () => {
  const shapeFiles = [
    { path: ".agents/friction-log/example/friction.md", changeType: "MODIFIED", additions: 1, deletions: 2 },
    { path: ".agents/friction-log/closed/friction.md", changeType: "DELETED", additions: 0, deletions: 20 },
    { path: ".agents/friction-log/.sync.json", changeType: "MODIFIED", additions: 3, deletions: 1 },
  ];
  const shapeSnapshot = { changedFiles: 3, additions: 4, deletions: 23, files: shapeFiles };

  it("derives complete change-shape evidence and replaces stale owned totals", () => {
    const shape = renderFrogChangeShape(shapeSnapshot);
    expect(shape).toContain("| Docs | 1 | 22 |");
    expect(shape).toContain("| Generated / other | 3 | 1 |");
    expect(shape).toContain("| **Total** | **4** | **23** |");
    const body = normalizeFrogPullRequestBody("Generated report.", "Owner context.", shape);
    expect(normalizeFrogPullRequestBody(body, "Owner context.", shape)).toBe(body);
    const replacement = renderFrogChangeShape({ changedFiles: 0, additions: 0, deletions: 0, files: [] });
    const updated = normalizeFrogPullRequestBody(`${body}\nHuman note.`, "Owner context.", replacement);
    expect(updated).not.toContain("| **Total** | **4** | **23** |");
    expect(updated).toContain("| **Total** | **0** | **0** |");
    expect(updated).toContain("Human note.");
    expect(updated.match(/^## Change-shape breakdown$/gmu)).toHaveLength(1);
  });

  it.each([
    { changedFiles: 4 },
    { files: [shapeFiles[0], shapeFiles[0], shapeFiles[2]] },
    { additions: 5 },
    { deletions: -1 },
    { files: [{ ...shapeFiles[0], path: "scripts/tool.ts" }, ...shapeFiles.slice(1)] },
    { files: [{ ...shapeFiles[0], changeType: "RENAMED" }, ...shapeFiles.slice(1)] },
    { files: [{ ...shapeFiles[0], additions: 0.5 }, ...shapeFiles.slice(1)] },
    { files: [{ ...shapeFiles[0], additions: 0, deletions: 0 }, ...shapeFiles.slice(1)] },
  ])("rejects incomplete or unsupported change-shape evidence (%j)", (override) => {
    expect(() => renderFrogChangeShape({ ...shapeSnapshot, ...override })).toThrow();
  });

  it("normalizes the workflow's single PR response through the CLI", () => {
    const result = spawnSync(process.execPath, [
      "--import", "tsx", path.join(repoRoot, "scripts/frog-pr-context.ts"), "normalize",
    ], {
      input: JSON.stringify({ ...shapeSnapshot, body: "Generated report." }),
      encoding: "utf8",
      env: { ...process.env, FROG_PR_BODY_FOOTER: "Owner context." },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Generated report.");
    expect(result.stdout).toContain("| **Total** | **4** | **23** |");
    expect(result.stdout).not.toContain('"changedFiles"');
    expect(readRepoFile(".github/workflows/friction-log.yml"))
      .toContain("--json body,files,changedFiles,additions,deletions");
  });

  it("keeps local commands file-backed and workflow-owned", () => {
    expect(statSync(frogScriptPath).mode & 0o111).not.toBe(0);
    expect(spawnSync("bash", ["-n", frogScriptPath]).status).toBe(0);

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

    const config = JSON.parse(readRepoFile(".agents", "friction-log", "config.json"));
    expect(config).toMatchObject({
      inbound: { enabled: false },
      outbound: { enabled: false },
    });
    expect(config.maxPerRun).toBeGreaterThan(0);
    expect(config.maxPerRun).toBeLessThanOrEqual(5);
  });

  it("keeps the Action on trusted default-branch events with narrow authority", () => {
    const workflow = readRepoFile(
      ".github",
      "workflows",
      "friction-log.yml",
    );

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
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("ref: ${{ github.sha }}");
    expect(workflow).toContain(
      "run: pnpm install --frozen-lockfile --ignore-scripts",
    );
    expect(workflow).not.toContain("pnpm dlx");
    expect(workflow).not.toMatch(/\bnpm install\b/u);
    expect(workflow).not.toMatch(/^\s+max:/mu);
    const refs = actionRefs(workflow);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((ref) => /^[a-f0-9]{40}$/u.test(ref))).toBe(true);
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
    expect(workflow).toContain(
      "GH_TOKEN: ${{ steps.frog-app-token.outputs.token }}",
    );
    const footerMarker = "          FROG_PR_BODY_FOOTER: |-\n";
    const footerStart = workflow.indexOf(footerMarker);
    const footerEnd = workflow.indexOf(
      "          FROG_PR_BRANCH: frog/sync",
      footerStart,
    );
    expect(footerStart).toBeGreaterThanOrEqual(0);
    expect(footerEnd).toBeGreaterThan(footerStart);
    const footer = workflow
      .slice(footerStart + footerMarker.length, footerEnd)
      .split("\n")
      .map((line) => line.replace(/^ {12}/u, ""))
      .join("\n")
      .trim();
    const expectedPullRequest = {
      appBotLogin: "murph-frog[bot]",
      baseBranch: "main",
      branch: "frog/sync",
      repository: "cobuildwithus/murph",
    };
    const internalPullRequest = {
      base: { ref: "main" },
      head: {
        ref: "frog/sync",
        repo: { full_name: "cobuildwithus/murph" },
      },
      number: 17,
      user: { login: "murph-frog[bot]" },
    };
    const forkPullRequest = {
      base: { ref: "main" },
      head: {
        ref: "frog/sync",
        repo: { full_name: "example/fork" },
      },
      number: 18,
      user: { login: "contributor" },
    };
    expect(
      selectFrogPullRequest(
        [forkPullRequest, internalPullRequest],
        expectedPullRequest,
      ),
    ).toBe(17);
    expect(selectFrogPullRequest([], expectedPullRequest)).toBeUndefined();
    expect(
      selectFrogPullRequest([forkPullRequest], expectedPullRequest),
    ).toBeUndefined();
    expect(() =>
      selectFrogPullRequest(
        [internalPullRequest, { ...internalPullRequest, number: 19 }],
        expectedPullRequest,
      )
    ).toThrow("exactly one repository-owned");
    expect(() =>
      selectFrogPullRequest(
        [
          {
            ...internalPullRequest,
            user: { login: "untrusted-bot[bot]" },
          },
        ],
        expectedPullRequest,
      )
    ).toThrow("configured App bot");

    const generatedBody = `Opened by the Frog action.

## Linked

- [cobuildwithus/murph#123](https://example.invalid/issues/123) Synthetic friction`;
    const normalizedBody = normalizeFrogPullRequestBody(
      generatedBody,
      footer,
      renderFrogChangeShape({ changedFiles: 0, additions: 0, deletions: 0, files: [] }),
    );
    expect(normalizeFrogPullRequestBody(normalizedBody, footer,
      renderFrogChangeShape({ changedFiles: 0, additions: 0, deletions: 0, files: [] }))).toBe(
      normalizedBody,
    );
    expect(normalizedBody).toContain(generatedBody);
    expect(
      normalizedBody.match(/<!-- murph:frog-pr-context:start -->/gu),
    ).toHaveLength(1);
    expect(
      normalizedBody.match(/<!-- murph:frog-pr-context:end -->/gu),
    ).toHaveLength(1);
    expect(
      validatePrChangelog({
        changedPaths: [".agents/friction-log/example.md"],
        prBodyHtml: renderPlainFooterDeclaration(normalizedBody, "Changelog"),
      }),
    ).toEqual([]);
  });
});
