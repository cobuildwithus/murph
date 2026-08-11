import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  FROG_AUTOFIX_BOT,
  FROG_AUTOFIX_INTERVAL_SECONDS,
  buildCodexWorkerArguments,
  isTrustedFrogIssue,
  normalizeGitHubRepository,
  parseEventLog,
  renderInstalledLauncher,
  renderLaunchAgentPlist,
  renderWorkerPrompt,
  safeFailureMessage,
  selectEligibleFrogIssue,
} from "./frog-autofix-lib.ts";
import { acquireRunLock } from "./frog-autofix.ts";

const trustedIssue = (number: number) => ({
  author: { login: FROG_AUTOFIX_BOT },
  labels: [{ name: "enhancement" }],
  number,
  state: "OPEN",
});
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("Frog autofix guards", () => {
  it("normalizes only explicit GitHub repository remotes", () => {
    expect(normalizeGitHubRepository("https://github.com/cobuildwithus/murph.git"))
      .toBe("cobuildwithus/murph");
    expect(normalizeGitHubRepository("git@github.com:cobuildwithus/murph.git"))
      .toBe("cobuildwithus/murph");
    expect(normalizeGitHubRepository("ssh://github.com/cobuildwithus/murph"))
      .toBeNull();
    expect(normalizeGitHubRepository("https://example.invalid/cobuildwithus/murph"))
      .toBeNull();
  });

  it("selects only the oldest exact App-authored, labeled, singly bound issue", () => {
    const issues = [
      trustedIssue(12),
      trustedIssue(9),
      { ...trustedIssue(7), author: { login: "someone" } },
      { ...trustedIssue(8), state: "CLOSED" },
      { ...trustedIssue(10), labels: [] },
      trustedIssue(11),
    ];
    const bindings = new Map([
      [9, 1],
      [11, 2],
      [12, 1],
    ]);

    expect(isTrustedFrogIssue(trustedIssue(9))).toBe(true);
    expect(selectEligibleFrogIssue(issues, bindings)?.number).toBe(9);
    expect(selectEligibleFrogIssue([trustedIssue(1)], new Map())).toBeNull();
  });

  it("renders a two-hour LaunchAgent without direct local identifiers", () => {
    const plist = renderLaunchAgentPlist();
    const launcher = renderInstalledLauncher();
    expect(plist).toContain(`<integer>${FROG_AUTOFIX_INTERVAL_SECONDS}</integer>`);
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("$HOME/Library/Application Support/Murph/FrogAutofix/launch");
    expect(launcher).toContain('exec "$HOME/$repo_relative/scripts/frog-autofix" run');
    for (const content of [plist, launcher]) {
      expect(content).not.toMatch(/\/Users\/[A-Za-z0-9._-]+/u);
      expect(content).not.toContain("GH_TOKEN");
      expect(content).not.toContain("GITHUB_TOKEN");
    }
  });

  it("keeps the shell entrypoint executable, root-owned, and clears ambient tokens", () => {
    const wrapperPath = path.join(repositoryRoot, "scripts", "frog-autofix");
    const wrapper = readFileSync(wrapperPath, "utf8");
    expect(statSync(wrapperPath).mode & 0o111).not.toBe(0);
    expect(spawnSync("bash", ["-n", wrapperPath]).status).toBe(0);
    expect(wrapper).toContain('cd "$repo_root"');
    expect(wrapper).toContain("GH_TOKEN");
    expect(wrapper).toContain("GITHUB_TOKEN");
    expect(wrapper).toContain('exec "$tsx_bin" scripts/frog-autofix.ts "$@"');
    const implementation = readFileSync(
      path.join(repositoryRoot, "scripts", "frog-autofix.ts"),
      "utf8",
    );
    expect(implementation).toContain("rmdirSync(supportRoot)");
    expect(implementation).toContain("const lock = acquireRunLock(lockPath)");
    expect(implementation).toContain(
      "Frog autofix is currently running; uninstall after it finishes",
    );
    expect(implementation).not.toContain(
      "rmSync(supportRoot, { recursive: false })",
    );
  });

  it("constructs the worker prompt from an issue number, not issue content", () => {
    const prompt = renderWorkerPrompt(
      "Issue {{ISSUE_NUMBER}} must remain {{ISSUE_NUMBER}}.",
      42,
    );
    expect(prompt).toBe("Issue 42 must remain 42.");
    expect(() => renderWorkerPrompt("No placeholder", 42)).toThrow();
    expect(() => renderWorkerPrompt("{{ISSUE_NUMBER}}", 0)).toThrow();
    const template = readFileSync(
      path.join(repositoryRoot, "scripts", "frog-autofix-worker.md"),
      "utf8",
    );
    const complete = renderWorkerPrompt(template, 42);
    expect(complete).not.toContain("{{ISSUE_NUMBER}}");
    expect(complete).toContain("--connector github");
    expect(complete).toContain("--send --wait");
    expect(complete).toContain("--skip-resume");
    expect(complete).toContain("exactly one patch or diff attachment");
  });

  it("redacts local identifiers from unexpected failure text", () => {
    expect(safeFailureMessage(new Error("primary worktree is not clean")))
      .toBe("primary worktree is not clean");
    expect(
      safeFailureMessage(
        new Error(`cannot read ${path.join(homedir(), "config")}`),
      ),
    )
      .toBe("unexpected local failure");
    expect(safeFailureMessage(new Error("first line\nsecond line")))
      .toBe("unexpected local failure");
  });

  it("normalizes only bounded metadata event logs", () => {
    expect(
      parseEventLog(
        '{"at":"2026-08-11T00:00:00.000Z","event":"worker_started","issue":42}\n',
      ),
    ).toEqual([
      {
        at: "2026-08-11T00:00:00.000Z",
        event: "worker_started",
        issue: 42,
      },
    ]);
    expect(
      parseEventLog(
        '{"at":"2026-08-11T00:00:00.000Z","event":"worker_started","body":"untrusted"}\n',
      ),
    ).toBeNull();
    expect(parseEventLog("not-json\n")).toBeNull();
  });

  it("keeps the Codex worker networked but filesystem-scoped", () => {
    const args = buildCodexWorkerArguments({
      browserProfileRoot: "<BROWSER_PROFILE>",
      codexHome: "<CODEX_HOME>",
      gitCommonDirectory: "<GIT_COMMON_DIR>",
      helper: "<WORKER_HELPER>",
      outputDirectory: "<OUTPUT_DIR>",
      promptFile: "<PROMPT_FILE>",
      worktree: "<WORKTREE>",
    });
    expect(args).toContain("workspace-write");
    expect(args).toContain("sandbox_workspace_write.network_access=true");
    expect(args).toContain("--add-dir");
    expect(args).toContain("<BROWSER_PROFILE>");
    expect(args).toContain("<OUTPUT_DIR>");
    expect(args).toContain("<GIT_COMMON_DIR>");
    expect(args).not.toContain("danger-full-access");
  });

  it("recovers only dead or PID-reused locks and preserves live ownership", () => {
    const root = mkdtempSync(path.join(tmpdir(), "frog-autofix-lock-"));
    const lock = path.join(root, "run.lock");
    try {
      writeFileSync(
        lock,
        `${JSON.stringify({ nonce: "live", pid: 10, startToken: "same" })}\n`,
      );
      expect(
        acquireRunLock(lock, {
          isProcessAlive: () => "alive",
          processStartToken: () => "same",
        }),
      ).toBeNull();
      expect(readFileSync(lock, "utf8")).toContain('"nonce":"live"');

      writeFileSync(
        lock,
        `${JSON.stringify({
          nonce: "orphan",
          pid: 10,
          startToken: "dead-owner",
          workerPid: 11,
          workerStartToken: "live-worker",
        })}\n`,
      );
      expect(
        acquireRunLock(lock, {
          isProcessAlive: (pid) => (pid === 10 ? "dead" : "alive"),
          processStartToken: (pid) => (pid === 11 ? "live-worker" : null),
        }),
      ).toBeNull();

      const acquired = acquireRunLock(lock, {
        isProcessAlive: () => "alive",
        processStartToken: (pid) => (pid === 11 ? "reused" : "current"),
      });
      expect(acquired).not.toBeNull();
      acquired?.setWorker(12);
      expect(JSON.parse(readFileSync(lock, "utf8"))).toMatchObject({
        workerPid: 12,
        workerStartToken: "current",
      });
      acquired?.release();
      expect(() => readFileSync(lock, "utf8")).toThrow();

      mkdirSync(root, { recursive: true });
      writeFileSync(lock, "not-json\n");
      expect(() =>
        acquireRunLock(lock, {
          isProcessAlive: () => "dead",
          processStartToken: () => "current",
        }),
      ).toThrow("run lock is malformed");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
