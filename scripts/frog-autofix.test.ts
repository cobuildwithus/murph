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
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  FROG_AUTOFIX_BOT,
  FROG_AUTOFIX_INTERVAL_SECONDS,
  buildCodexWorkerArguments,
  classifyWorkerMode,
  eligibleFrogIssues,
  isTrustedFrogIssue,
  normalizeGitHubRepository,
  parseEventLog,
  renderInstalledLauncher,
  renderLaunchAgentPlist,
  renderWorkerPrompt,
  runWithCleanup,
  safeFailureMessage,
  superviseOwnedWorker,
  terminalWorkerSucceeded,
} from "./frog-autofix-lib.ts";
import { acquireRunLock, discoverEligibleIssues } from "./frog-autofix.ts";
import {
  branchHasMergedPullRequest,
  resolveWorkerMode,
} from "./frog-autofix-recovery.ts";

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
    expect(eligibleFrogIssues(issues, bindings).map((issue) => issue.number))
      .toEqual([9, 12]);
    expect(eligibleFrogIssues([trustedIssue(1)], new Map())).toEqual([]);
  });

  it("uses the production discovery path for parsing, bounds, and selection", () => {
    const bindingCalls: number[] = [];
    const issues = [
      trustedIssue(12),
      trustedIssue(9),
      trustedIssue(10),
      trustedIssue(11),
      { ...trustedIssue(7), author: { login: "someone" } },
      { ...trustedIssue(8), labels: [] },
    ];
    const dependencies = {
      assertRepository: () => undefined,
      bindingCount: (_root: string, issueNumber: number) => {
        bindingCalls.push(issueNumber);
        if (issueNumber === 10) return 0;
        return issueNumber === 11 ? 2 : 1;
      },
      fetchDefaultBranch: () => undefined,
      listOpenIssues: () => JSON.stringify(issues),
    };

    expect(discoverEligibleIssues("<ROOT>", dependencies).map((issue) => issue.number))
      .toEqual([9, 12]);
    expect(bindingCalls.sort((left, right) => left - right)).toEqual([
      9,
      10,
      11,
      12,
    ]);
    expect(() => discoverEligibleIssues("<ROOT>", {
      ...dependencies,
      listOpenIssues: () => "not-json",
    })).toThrow();
    expect(() => discoverEligibleIssues("<ROOT>", {
      ...dependencies,
      listOpenIssues: () => JSON.stringify(
        Array.from({ length: 1_000 }, (_, index) => trustedIssue(index + 1)),
      ),
    })).toThrow("open issue scan reached its bounded limit");
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
      "Issue {{ISSUE_NUMBER}} must remain {{ISSUE_NUMBER}}. {{MODE_WORKFLOW}}",
      42,
      "implement",
    );
    expect(prompt).toContain("Issue 42 must remain 42.");
    expect(prompt).toContain("pnpm review:gpt --connector github");
    expect(() => renderWorkerPrompt("No placeholder", 42, "implement")).toThrow();
    expect(() => renderWorkerPrompt(
      "{{ISSUE_NUMBER}} {{MODE_WORKFLOW}}",
      0,
      "implement",
    )).toThrow();
    const template = readFileSync(
      path.join(repositoryRoot, "scripts", "frog-autofix-worker.md"),
      "utf8",
    );
    const complete = renderWorkerPrompt(template, 42, "implement");
    expect(complete).not.toContain("{{ISSUE_NUMBER}}");
    expect(complete).not.toContain("{{MODE_WORKFLOW}}");
    expect(complete).toContain("--connector github");
    expect(complete).toContain("--send --wait");
    expect(complete).toContain("--skip-resume");
    expect(complete).toContain("exactly one patch or diff attachment");
    const resume = renderWorkerPrompt(template, 42, "resume");
    expect(resume).toContain("resume mode");
    expect(resume).not.toContain("pnpm review:gpt --connector github");
    const closeIssue = renderWorkerPrompt(template, 42, "close-issue");
    expect(closeIssue).toContain("close-issue mode");
    expect(closeIssue).not.toContain("pnpm review:gpt --connector github");
  });

  it("classifies only unambiguous fresh, resumable, and close-only states", () => {
    expect(classifyWorkerMode([], 0)).toBe("implement");
    expect(classifyWorkerMode([], 1)).toBe("resume");
    expect(classifyWorkerMode([{
      closesIssue: true,
      headIsAncestorOfLocal: true,
      headMatchesLocal: true,
      state: "OPEN",
    }], 2)).toBe("resume");
    expect(classifyWorkerMode([{
      closesIssue: true,
      headIsAncestorOfLocal: true,
      headMatchesLocal: true,
      state: "MERGED",
    }], 2)).toBe("close-issue");
    expect(classifyWorkerMode([{
      closesIssue: false,
      headIsAncestorOfLocal: true,
      headMatchesLocal: true,
      state: "MERGED",
    }], 2)).toBeNull();
    expect(classifyWorkerMode([{
      closesIssue: true,
      headIsAncestorOfLocal: false,
      headMatchesLocal: false,
      state: "OPEN",
    }], 2)).toBeNull();
    expect(classifyWorkerMode([{
      closesIssue: true,
      headIsAncestorOfLocal: true,
      headMatchesLocal: true,
      state: "CLOSED",
    }], 2)).toBeNull();
    expect(classifyWorkerMode([
      {
        closesIssue: true,
        headIsAncestorOfLocal: true,
        headMatchesLocal: true,
        state: "OPEN",
      },
      {
        closesIssue: true,
        headIsAncestorOfLocal: true,
        headMatchesLocal: true,
        state: "MERGED",
      },
    ], 2)).toBeNull();
  });

  it("drives production recovery classification from controlled Git and GitHub state", () => {
    const branch = "agent/frog-autofix-42";
    const mainHead = "a".repeat(40);
    const implementationHead = "b".repeat(40);
    const runScenario = (options: {
      ahead: number;
      localHead: string;
      pullRequest?: { body: string; state: "MERGED" | "OPEN" };
      remoteBranch: boolean;
    }) => resolveWorkerMode("<WORKTREE>", branch, 42, {
      require: (command, args) => {
        if (command === "gh") {
          return JSON.stringify(options.pullRequest ? [{
            baseRefName: "main",
            body: options.pullRequest.body,
            headRefName: branch,
            headRefOid: options.localHead,
            number: 99,
            state: options.pullRequest.state,
          }] : []);
        }
        const invocation = args.join(" ");
        if (invocation === "status --porcelain") return "";
        if (invocation === "symbolic-ref --quiet --short HEAD") return branch;
        if (invocation === "fetch --quiet origin main") return "";
        if (invocation.startsWith("fetch --quiet origin +refs/heads/")) return "";
        if (invocation === "rev-parse HEAD") return options.localHead;
        if (invocation === "rev-parse origin/main") return mainHead;
        if (invocation === `rev-parse origin/${branch}`) return options.localHead;
        if (invocation === "rev-list --count origin/main..HEAD") {
          return String(options.ahead);
        }
        throw new Error(`unexpected required command: ${command} ${invocation}`);
      },
      run: (command, args) => {
        const invocation = args.join(" ");
        if (invocation.startsWith("ls-remote --exit-code --heads origin")) {
          return { status: options.remoteBranch ? 0 : 2, stdout: "" };
        }
        if (invocation.startsWith("merge-base --is-ancestor")) {
          return { status: 0, stdout: "" };
        }
        throw new Error(`unexpected command: ${command} ${invocation}`);
      },
    });

    expect(runScenario({ ahead: 0, localHead: mainHead, remoteBranch: false }))
      .toBe("implement");
    expect(runScenario({
      ahead: 1,
      localHead: implementationHead,
      remoteBranch: true,
    })).toBe("resume");
    expect(runScenario({
      ahead: 1,
      localHead: implementationHead,
      pullRequest: { body: "Fixes #42", state: "OPEN" },
      remoteBranch: true,
    })).toBe("resume");
    expect(runScenario({
      ahead: 1,
      localHead: implementationHead,
      pullRequest: { body: "Fixes #42", state: "MERGED" },
      remoteBranch: true,
    })).toBe("close-issue");
  });

  it("requires one exact merged branch head and closing relationship", () => {
    const branch = "agent/frog-autofix-42";
    const mergedHead = "b".repeat(40);
    const record = {
      baseRefName: "main",
      body: "Fixes #42",
      headRefName: branch,
      headRefOid: mergedHead,
      number: 99,
      state: "MERGED",
    };
    const commands = (localHead: string, body = record.body) => ({
      require: (command: string) => command === "gh"
        ? JSON.stringify([{ ...record, body }])
        : localHead,
      run: () => ({ status: 0, stdout: "" }),
    });

    expect(branchHasMergedPullRequest(
      "<ROOT>",
      branch,
      42,
      commands(mergedHead),
    )).toBe(true);
    expect(branchHasMergedPullRequest(
      "<ROOT>",
      branch,
      42,
      commands("c".repeat(40)),
    )).toBe(false);
    expect(branchHasMergedPullRequest(
      "<ROOT>",
      branch,
      42,
      commands(mergedHead, "Related to #42"),
    )).toBe(false);
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

  it("supervises and signals only the exact owned worker process group", async () => {
    class FakeChild extends EventEmitter {
      pid = 42;
    }
    const child = new FakeChild() as unknown as ChildProcess;
    const timers: Array<{ callback: () => void; cleared: boolean }> = [];
    const signals: Array<[number, string]> = [];
    const started: number[] = [];
    const resultPromise = superviseOwnedWorker(child, (pid) => started.push(pid), 100, 10, {
      clearTimer: (timer) => {
        (timer as { cleared: boolean }).cleared = true;
      },
      setTimer: (callback) => {
        const timer = { callback, cleared: false };
        timers.push(timer);
        return timer;
      },
      signalProcessGroup: (pid, signal) => signals.push([pid, signal]),
    });
    expect(started).toEqual([42]);
    timers[0]?.callback();
    expect(signals).toEqual([[-42, "SIGTERM"]]);
    timers[1]?.callback();
    expect(signals).toEqual([[-42, "SIGTERM"], [-42, "SIGKILL"]]);
    (child as unknown as EventEmitter).emit("exit", 143);
    await expect(resultPromise).resolves.toEqual({ status: 143, timedOut: true });
    expect(timers.every((timer) => timer.cleared)).toBe(true);
  });

  it("handles ordinary and graceful-timeout worker exits without a forced signal", async () => {
    class FakeChild extends EventEmitter {
      constructor(public pid: number) {
        super();
      }
    }
    const timers: Array<{ callback: () => void; cleared: boolean }> = [];
    const signals: Array<[number, string]> = [];
    const dependencies = {
      clearTimer: (timer: unknown) => {
        (timer as { cleared: boolean }).cleared = true;
      },
      setTimer: (callback: () => void) => {
        const timer = { callback, cleared: false };
        timers.push(timer);
        return timer;
      },
      signalProcessGroup: (pid: number, signal: "SIGKILL" | "SIGTERM") => {
        signals.push([pid, signal]);
      },
    };

    const ordinary = new FakeChild(7) as unknown as ChildProcess;
    const ordinaryResult = superviseOwnedWorker(ordinary, () => undefined, 100, 10, dependencies);
    (ordinary as unknown as EventEmitter).emit("exit", 5);
    await expect(ordinaryResult).resolves.toEqual({ status: 5, timedOut: false });
    expect(signals).toEqual([]);

    const graceful = new FakeChild(8) as unknown as ChildProcess;
    const gracefulResult = superviseOwnedWorker(graceful, () => undefined, 100, 10, dependencies);
    timers.at(-1)?.callback();
    expect(signals).toEqual([[-8, "SIGTERM"]]);
    (graceful as unknown as EventEmitter).emit("exit", 143);
    await expect(gracefulResult).resolves.toEqual({ status: 143, timedOut: true });
    expect(signals).toEqual([[-8, "SIGTERM"]]);
    expect(timers.at(-1)?.cleared).toBe(true);
  });

  it("waits for exact child termination when lock identity recording fails", async () => {
    class FakeChild extends EventEmitter {
      pid = 42;
    }
    const child = new FakeChild() as unknown as ChildProcess;
    const timers: Array<{ callback: () => void; cleared: boolean }> = [];
    const signals: Array<[number, string]> = [];
    const startError = new Error("worker identity unavailable");
    const resultPromise = superviseOwnedWorker(child, () => {
      throw startError;
    }, 100, 10, {
      clearTimer: (timer) => {
        (timer as { cleared: boolean }).cleared = true;
      },
      setTimer: (callback) => {
        const timer = { callback, cleared: false };
        timers.push(timer);
        return timer;
      },
      signalProcessGroup: (pid, signal) => signals.push([pid, signal]),
    });
    expect(signals).toEqual([[-42, "SIGTERM"]]);
    let settled = false;
    void resultPromise.finally(() => {
      settled = true;
    }).catch(() => undefined);
    await Promise.resolve();
    expect(settled).toBe(false);
    timers.at(-1)?.callback();
    expect(signals).toEqual([[-42, "SIGTERM"], [-42, "SIGKILL"]]);
    (child as unknown as EventEmitter).emit("exit", 137);
    await expect(resultPromise).rejects.toBe(startError);
    expect(settled).toBe(true);
  });

  it("keeps transient cleanup behind worker completion and requires both remote terminals", async () => {
    let finishWorker: ((value: number) => void) | undefined;
    let cleaned = false;
    const resultPromise = runWithCleanup(
      () => new Promise<number>((resolve) => {
        finishWorker = resolve;
      }),
      () => {
        cleaned = true;
      },
    );
    await Promise.resolve();
    expect(cleaned).toBe(false);
    finishWorker?.(0);
    await expect(resultPromise).resolves.toBe(0);
    expect(cleaned).toBe(true);
    expect(terminalWorkerSucceeded(true, true)).toBe(true);
    expect(terminalWorkerSucceeded(true, false)).toBe(false);
    expect(terminalWorkerSucceeded(false, true)).toBe(false);
    expect(terminalWorkerSucceeded(false, false)).toBe(false);
  });
});
