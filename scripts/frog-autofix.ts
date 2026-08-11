import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import {
  FROG_AUTOFIX_BRANCH_PREFIX,
  FROG_AUTOFIX_INTERVAL_SECONDS,
  FROG_AUTOFIX_INVOCATION_TIMEOUT_MS,
  FROG_AUTOFIX_LAUNCH_LABEL,
  FROG_AUTOFIX_REPOSITORY,
  FROG_AUTOFIX_WORKER_TIMEOUT_MS,
  authorityChangedPaths,
  buildCodexWorkerArguments,
  codexWorkerPermissionArguments,
  eligibleFrogIssues,
  hasParentOwnedPullRequestBody,
  isParentOwnedPullRequest,
  isTrustedFrogIssue,
  localAgentOnlyChange,
  normalizeGitHubRepository,
  parseAuthenticatedGitHubOperator,
  parseEventLog,
  renderInstalledLauncher,
  renderLaunchAgentPlist,
  renderWorkerPrompt,
  reviewOutcome,
  reviewEvidenceIsValid,
  reviewRequiresHumanHandoff,
  safeFailureMessage,
  superviseOwnedWorker,
  type EventName,
  type EventRecord,
  type FrogIssue,
} from "./frog-autofix-lib.ts";
import {
  branchHasMergedPullRequest,
  branchOpenPullRequest,
  branchPullRequests,
  resolveWorkerMode,
  type BranchPullRequestRecord,
  type RecoveryCommandAdapter,
} from "./frog-autofix-recovery.ts";
import { finalizeReadyRepair } from "./frog-autofix-finalize.ts";
import {
  FROG_AUTOFIX_PR_BODY_PATH,
  extractFirstReviewedHead,
  extractSingleConversationUrl,
  parseSinglePatchArtifact,
  readBoundedParentFile,
  renderImplementationPrompt,
  renderRecoveredPullRequestBody,
  validatePatchText,
  validatePullRequestBody,
} from "./frog-autofix-parent.ts";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const supportRoot = path.join(
  homedir(),
  "Library",
  "Application Support",
  "Murph",
  "FrogAutofix",
);
const launchAgentPath = path.join(
  homedir(),
  "Library",
  "LaunchAgents",
  `${FROG_AUTOFIX_LAUNCH_LABEL}.plist`,
);
const eventLogPath = path.join(supportRoot, "events.jsonl");
const lockPath = path.join(supportRoot, "run.lock");
const nativeGatePath = path.join(supportRoot, "run.native.lock");
const nativeGateEnvironment = "MURPH_FROG_AUTOFIX_NATIVE_LOCK_HELD";

interface RunLockRecord {
  nonce: string;
  pid: number;
  startToken: string;
  workerPid?: number;
  workerStartToken?: string;
}

interface CommandResult {
  status: number;
  stdout: string;
}

const COMMAND_TIMEOUT_MS = 10 * 60 * 1_000;
const COMMAND_KILL_MARGIN_MS = 15_000;
let invocationDeadline = Number.POSITIVE_INFINITY;

function beginInvocation(command: string | undefined) {
  const duration = command === "run"
    ? FROG_AUTOFIX_INVOCATION_TIMEOUT_MS
    : command === "install"
      ? 30 * 60 * 1_000
      : COMMAND_TIMEOUT_MS;
  invocationDeadline = Date.now() + duration;
}

function remainingInvocationMs(): number {
  const remaining = Math.floor(invocationDeadline - Date.now());
  if (!Number.isFinite(remaining)) return COMMAND_TIMEOUT_MS;
  if (remaining <= 0) throw new Error("Frog autofix invocation deadline expired");
  return remaining;
}

function boundedRuntimeMs(maximumMs: number, terminationMarginMs: number): number {
  const remaining = remainingInvocationMs();
  if (remaining <= terminationMarginMs) {
    throw new Error("Frog autofix lacks time to reap an owned process group");
  }
  return Math.min(maximumMs, remaining - terminationMarginMs);
}

interface LockDependencies {
  isProcessAlive: (pid: number) => "alive" | "dead" | "unknown";
  processStartToken: (pid: number) => string | null;
}

const safeToolEnvironment = (overrides: NodeJS.ProcessEnv = {}) => {
  const allowedNames = [
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "SHELL",
    "SSH_AUTH_SOCK",
    "TERM",
    "TMPDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
  ] as const;
  const environment: NodeJS.ProcessEnv = {
    CI: "1",
    GH_PROMPT_DISABLED: "1",
    GIT_TERMINAL_PROMPT: "0",
    NO_COLOR: "1",
  };

  for (const name of allowedNames) {
    if (process.env[name]) environment[name] = process.env[name];
  }

  return { ...environment, ...overrides };
};

const runCommand = (
  command: string,
  args: string[],
  cwd = repoRoot,
  environmentOverrides: NodeJS.ProcessEnv = {},
  maximumRuntimeMs = COMMAND_TIMEOUT_MS,
): CommandResult => {
  const timeoutMs = boundedRuntimeMs(maximumRuntimeMs, COMMAND_KILL_MARGIN_MS);
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(repoRoot, "scripts", "frog-autofix-command.ts"),
    String(timeoutMs),
    cwd,
    "--",
    command,
    ...args,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: safeToolEnvironment(environmentOverrides),
    maxBuffer: 16 * 1024 * 1024,
    timeout: timeoutMs + COMMAND_KILL_MARGIN_MS,
  });
  if (result.error) {
    throw new Error(`${command} could not start`);
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `${command} returned an invalid command envelope (wrapper status ${result.status ?? "unknown"}, stdout bytes ${Buffer.byteLength(result.stdout)})`,
    );
  }
  const candidate = envelope as CommandResult & { timedOut?: unknown };
  if (
    !envelope
    || typeof envelope !== "object"
    || Array.isArray(envelope)
    || !Number.isSafeInteger(candidate.status)
    || typeof candidate.stdout !== "string"
    || typeof candidate.timedOut !== "boolean"
  ) {
    throw new Error(`${command} returned an invalid command envelope`);
  }
  if (candidate.timedOut) throw new Error(`${command} exceeded its bounded runtime`);
  return { status: candidate.status, stdout: candidate.stdout };
};

const requireCommand = (
  command: string,
  args: string[],
  cwd = repoRoot,
  environmentOverrides: NodeJS.ProcessEnv = {},
  maximumRuntimeMs = COMMAND_TIMEOUT_MS,
) => {
  const result = runCommand(
    command,
    args,
    cwd,
    environmentOverrides,
    maximumRuntimeMs,
  );
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return result.stdout.trim();
};

const recoveryCommands: RecoveryCommandAdapter = {
  authenticatedOperator: (cwd) => requireCommand(
    "gh",
    ["api", "user", "--jq", ".login"],
    cwd,
  ),
  require: requireCommand,
  run: runCommand,
};

function parseIssueList(raw: string): FrogIssue[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("GitHub returned an invalid issue list");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("GitHub returned an invalid issue record");
    }
    const issue = entry as Partial<FrogIssue>;
    if (
      typeof issue.number !== "number"
      || typeof issue.state !== "string"
      || (issue.author !== null
        && (typeof issue.author !== "object"
          || typeof issue.author.login !== "string"))
      || !Array.isArray(issue.labels)
      || issue.labels.some(
        (label) => !label || typeof label.name !== "string",
      )
    ) {
      throw new Error("GitHub returned an invalid issue record");
    }
    return issue as FrogIssue;
  });
}

function assertRepositoryIdentity(root: string) {
  const remote = requireCommand("git", ["config", "--get", "remote.origin.url"], root);
  if (normalizeGitHubRepository(remote) !== FROG_AUTOFIX_REPOSITORY) {
    throw new Error("repository identity does not match the Frog owner");
  }
}

function fetchMain(root: string) {
  requireCommand("git", ["fetch", "--quiet", "origin", "main"], root);
}

function committedBindingCount(root: string, issueNumber: number): number {
  const needle = `issue: '${FROG_AUTOFIX_REPOSITORY}#${issueNumber}'`;
  const result = runCommand(
    "git",
    [
      "grep",
      "-l",
      "-F",
      needle,
      "origin/main",
      "--",
      ":(glob).agents/friction-log/*/friction.md",
    ],
    root,
  );
  if (result.status === 1) return 0;
  if (result.status !== 0) {
    throw new Error(`git failed with status ${result.status}`);
  }
  return result.stdout.split("\n").filter(Boolean).length;
}

export interface DiscoveryDependencies {
  authenticatedOperator: (root: string) => string;
  assertRepository: (root: string) => void;
  bindingCount: (root: string, issueNumber: number) => number;
  fetchDefaultBranch: (root: string) => void;
  listOpenIssues: (root: string) => string;
  listIssuePullRequests: (
    root: string,
    issueNumber: number,
  ) => BranchPullRequestRecord[];
}

const defaultDiscoveryDependencies: DiscoveryDependencies = {
  authenticatedOperator: recoveryCommands.authenticatedOperator,
  assertRepository: assertRepositoryIdentity,
  bindingCount: committedBindingCount,
  fetchDefaultBranch: fetchMain,
  listOpenIssues: (root) => requireCommand(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      FROG_AUTOFIX_REPOSITORY,
      "--state",
      "open",
      "--limit",
      "1000",
      "--json",
      "number,state,author,labels",
    ],
    root,
  ),
  listIssuePullRequests: (root, issueNumber) => branchPullRequests(
    root,
    `${FROG_AUTOFIX_BRANCH_PREFIX}${issueNumber}`,
    recoveryCommands,
  ),
};

export function completedHandoffIssueNumbers(
  pullRequests: readonly BranchPullRequestRecord[],
  authenticatedOperator: string,
): Set<number> {
  const operator = parseAuthenticatedGitHubOperator(authenticatedOperator);
  const completed = new Set<number>();
  for (const record of pullRequests) {
    const branchMatch = new RegExp(
      `^${FROG_AUTOFIX_BRANCH_PREFIX.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(\\d+)$`,
      "u",
    ).exec(record.headRefName);
    if (!branchMatch) continue;
    const issueNumber = Number(branchMatch[1]);
    if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) continue;
    if (!isParentOwnedPullRequest(
      record,
      operator,
      `${FROG_AUTOFIX_BRANCH_PREFIX}${issueNumber}`,
    )) continue;
    if (!hasParentOwnedPullRequestBody(record, operator)) continue;
    if (record.state === "MERGED") continue;
    const relationship = new RegExp(
      `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+`
        + `(?:${FROG_AUTOFIX_REPOSITORY.replace("/", "\\/")})?#${issueNumber}\\b`,
      "iu",
    );
    if (!relationship.test(record.body)) continue;
    const matches = record.body.match(
      /^Frog autofix handoff: (product-runtime|review-findings) at ([0-9a-f]{40})$/gmu,
    ) ?? [];
    if (matches.length !== 1 || !matches[0]?.endsWith(` at ${record.headRefOid}`)) {
      continue;
    }
    completed.add(issueNumber);
  }
  return completed;
}

export function closedPullRequestForHandoff(
  pullRequests: readonly BranchPullRequestRecord[],
): BranchPullRequestRecord | null {
  return pullRequests.length === 1 && pullRequests[0]?.state === "CLOSED"
    ? pullRequests[0]
    : null;
}

export function closedPullRequestHandoffBody(
  pullRequest: BranchPullRequestRecord,
  issueNumber: number,
): string {
  if (pullRequest.state !== "CLOSED") {
    throw new Error("closed handoff requires a closed pull request");
  }
  return bodyWithParentMetadata(
    renderRecoveredPullRequestBody(issueNumber),
    {
      firstHead: pullRequest.headRefOid,
      handoff: "review-findings",
      handoffHead: pullRequest.headRefOid,
    },
  );
}

export function discoverEligibleIssues(
  root: string,
  dependencies: DiscoveryDependencies = defaultDiscoveryDependencies,
): FrogIssue[] {
  dependencies.assertRepository(root);
  dependencies.fetchDefaultBranch(root);
  const issues = parseIssueList(dependencies.listOpenIssues(root));
  if (issues.length >= 1_000) {
    throw new Error("open issue scan reached its bounded limit");
  }
  const trusted = issues.filter(isTrustedFrogIssue);
  const counts = new Map(
    trusted.map((issue) => [
      issue.number,
      dependencies.bindingCount(root, issue.number),
    ]),
  );
  const operator = dependencies.authenticatedOperator(root);
  return eligibleFrogIssues(issues, counts).filter((issue) => (
    !completedHandoffIssueNumbers(
      dependencies.listIssuePullRequests(root, issue.number),
      operator,
    ).has(issue.number)
  ));
}

function parsePrimaryWorktree(raw: string): string {
  const firstLine = raw.split("\n").find((line) => line.startsWith("worktree "));
  if (!firstLine) throw new Error("primary worktree could not be resolved");
  return realpathSync(firstLine.slice("worktree ".length));
}

function resolvePrimaryWorktree(root: string): string {
  return parsePrimaryWorktree(
    requireCommand("git", ["worktree", "list", "--porcelain"], root),
  );
}

const loadedRunnerPaths = [
  "scripts/frog-autofix",
  "scripts/frog-autofix.ts",
  "scripts/frog-autofix-command.ts",
  "scripts/frog-autofix-finalize.ts",
  "scripts/frog-autofix-lib.ts",
  "scripts/frog-autofix-parent.ts",
  "scripts/frog-autofix-recovery.ts",
];

export function primaryAdvanceRequiresRestart(paths: string[]): boolean {
  return paths.some((filePath) => loadedRunnerPaths.includes(filePath));
}

function changedAuthorityPaths(root: string, from: string, to: string): string[] {
  const noRenames = runCommand(
    "git",
    ["diff", "--no-renames", "--name-only", "-z", from, to],
    root,
  );
  const copies = runCommand(
    "git",
    [
      "diff",
      "--find-renames=50%",
      "--find-copies=50%",
      "--find-copies-harder",
      "--name-status",
      "-z",
      from,
      to,
    ],
    root,
  );
  if (noRenames.status !== 0 || copies.status !== 0) {
    throw new Error("git authority path inventory failed");
  }
  return authorityChangedPaths(noRenames.stdout, copies.stdout);
}

export function advanceCleanPrimary(primary: string): {
  advanced: boolean;
  loadedRunnerChanged: boolean;
} {
  if (requireCommand("git", ["status", "--porcelain"], primary)) {
    throw new Error("primary worktree is not clean");
  }
  fetchMain(primary);
  const head = requireCommand("git", ["rev-parse", "HEAD"], primary);
  const main = requireCommand("git", ["rev-parse", "origin/main"], primary);
  if (head === main) return { advanced: false, loadedRunnerChanged: false };

  const ancestry = runCommand(
    "git",
    ["merge-base", "--is-ancestor", head, main],
    primary,
  );
  if (ancestry.status !== 0) {
    throw new Error("primary worktree cannot fast-forward to origin/main");
  }

  const loadedRunnerChanged = primaryAdvanceRequiresRestart(
    changedAuthorityPaths(primary, head, main),
  );

  const branch = runCommand(
    "git",
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    primary,
  );
  if (branch.status === 0 && branch.stdout.trim() === "main") {
    requireCommand("git", ["merge", "--ff-only", "origin/main"], primary);
  } else if (branch.status === 1) {
    requireCommand("git", ["switch", "--detach", "origin/main"], primary);
  } else {
    throw new Error("primary worktree is on a non-default branch");
  }
  return { advanced: true, loadedRunnerChanged };
}

function verifyExactIssue(root: string, issueNumber: number) {
  const issue = parseIssueList(
    `[${requireCommand(
      "gh",
      [
        "issue",
        "view",
        String(issueNumber),
        "--repo",
        FROG_AUTOFIX_REPOSITORY,
        "--json",
        "number,state,author,labels",
      ],
      root,
    )}]`,
  )[0];
  if (!issue || !isTrustedFrogIssue(issue) || committedBindingCount(root, issueNumber) !== 1) {
    throw new Error("issue no longer satisfies the trusted Frog boundary");
  }
}

function findBranchWorktree(root: string, branch: string): string | null {
  const output = requireCommand("git", ["worktree", "list", "--porcelain"], root);
  for (const block of output.split("\n\n")) {
    const lines = block.split("\n");
    const worktree = lines.find((line) => line.startsWith("worktree "));
    const branchLine = lines.find((line) => line.startsWith("branch "));
    if (branchLine === `branch refs/heads/${branch}` && worktree) {
      return realpathSync(worktree.slice("worktree ".length));
    }
  }
  return null;
}

function gitRefExists(root: string, ref: string): boolean {
  const result = runCommand("git", ["show-ref", "--verify", "--quiet", ref], root);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`git failed with status ${result.status}`);
}

function prepareIssueWorktree(primary: string, issueNumber: number): string {
  const branch = `${FROG_AUTOFIX_BRANCH_PREFIX}${issueNumber}`;
  const existing = findBranchWorktree(primary, branch);
  if (existing) return existing;

  const target = path.join(path.dirname(primary), `murph-frog-autofix-${issueNumber}`);
  if (existsSync(target)) {
    throw new Error("expected issue worktree path already exists but is unregistered");
  }

  const localRef = `refs/heads/${branch}`;
  const remoteRef = `refs/remotes/origin/${branch}`;
  const args = [path.join(primary, "scripts", "create-worktree")];
  if (gitRefExists(primary, localRef)) {
    args.push(target, branch);
  } else if (gitRefExists(primary, remoteRef)) {
    args.push("-b", branch, target, `origin/${branch}`);
  } else {
    args.push("-b", branch, target, "origin/main");
  }
  requireCommand("bash", args, primary);
  return realpathSync(target);
}

function ensureWorkerTooling(worktree: string, allowInstall: boolean) {
  const requiredFiles = [
    path.join(worktree, "node_modules", ".bin", "tsx"),
    path.join(worktree, "node_modules", ".bin", "cobuild-review-gpt"),
  ];
  if (requiredFiles.every((candidate) => existsSync(candidate))) return;
  if (!allowInstall) {
    throw new Error("resumable issue worktree is missing pre-model tooling");
  }
  if (
    requireCommand("git", ["status", "--porcelain"], worktree)
    || requireCommand("git", ["rev-list", "--count", "origin/main..HEAD"], worktree)
      !== "0"
  ) {
    throw new Error("worker tooling installation requires a clean fresh branch");
  }
  requireCommand(
    "pnpm",
    ["install", "--frozen-lockfile", "--ignore-scripts"],
    worktree,
  );
  if (!requiredFiles.every((candidate) => existsSync(candidate))) {
    throw new Error("worker tooling remains unavailable after installation");
  }
}

function currentProcessStartToken(pid: number): string | null {
  if (platform() !== "darwin") return null;
  const result = runCommand("ps", ["-o", "lstart=", "-p", String(pid)]);
  if (result.status !== 0) return null;
  const token = result.stdout.trim().replace(/\s+/gu, " ");
  return token || null;
}

function processLiveness(pid: number): "alive" | "dead" | "unknown" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "dead";
    return "unknown";
  }
}

export function acquireRunLock(
  filePath: string,
  dependencies: LockDependencies = {
    isProcessAlive: processLiveness,
    processStartToken: currentProcessStartToken,
  },
): { release: () => void; setWorker: (pid: number) => void } | null {
  mkdirSync(path.dirname(filePath), { mode: 0o700, recursive: true });
  if (existsSync(filePath)) {
    if (!lstatSync(filePath).isFile() || lstatSync(filePath).isSymbolicLink()) {
      throw new Error("run lock is not a regular file");
    }
    let existing: RunLockRecord;
    try {
      existing = JSON.parse(readFileSync(filePath, "utf8")) as RunLockRecord;
    } catch {
      throw new Error("run lock is malformed");
    }
    if (
      !Number.isSafeInteger(existing.pid)
      || existing.pid <= 0
      || typeof existing.startToken !== "string"
      || !existing.startToken
      || typeof existing.nonce !== "string"
      || !existing.nonce
      || ((existing.workerPid === undefined) !== (existing.workerStartToken === undefined))
      || (existing.workerPid !== undefined
        && (!Number.isSafeInteger(existing.workerPid) || existing.workerPid <= 0))
      || (existing.workerStartToken !== undefined
        && (typeof existing.workerStartToken !== "string"
          || !existing.workerStartToken))
    ) {
      throw new Error("run lock is malformed");
    }
    for (const [pid, startToken] of [
      [existing.pid, existing.startToken],
      [existing.workerPid, existing.workerStartToken],
    ] as const) {
      if (pid === undefined || startToken === undefined) continue;
      const liveness = dependencies.isProcessAlive(pid);
      if (liveness === "unknown") {
        throw new Error("run lock ownership cannot be verified");
      }
      if (
        liveness === "alive"
        && dependencies.processStartToken(pid) === startToken
      ) {
        return null;
      }
    }
    unlinkSync(filePath);
  }

  const startToken = dependencies.processStartToken(process.pid);
  if (!startToken) throw new Error("current process identity cannot be verified");
  const record: RunLockRecord = {
    nonce: randomUUID(),
    pid: process.pid,
    startToken,
  };
  writeFileSync(filePath, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  return {
    release: () => {
      if (!existsSync(filePath)) return;
      try {
        const current = JSON.parse(readFileSync(filePath, "utf8")) as RunLockRecord;
        if (current.nonce === record.nonce) unlinkSync(filePath);
      } catch {
        // A changed or malformed lock no longer belongs to this process.
      }
    },
    setWorker: (pid: number) => {
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new Error("worker process identity is invalid");
      }
      const workerStartToken = dependencies.processStartToken(pid);
      if (!workerStartToken) {
        throw new Error("worker process identity cannot be verified");
      }
      const current = JSON.parse(readFileSync(filePath, "utf8")) as RunLockRecord;
      if (current.nonce !== record.nonce) {
        throw new Error("run lock ownership changed before worker start");
      }
      writePrivateFileAtomically(
        filePath,
        `${JSON.stringify({ ...record, workerPid: pid, workerStartToken })}\n`,
        0o600,
      );
    },
  };
}

function appendEvent(event: EventRecord) {
  mkdirSync(supportRoot, { mode: 0o700, recursive: true });
  if (existsSync(eventLogPath)) {
    const state = lstatSync(eventLogPath);
    if (!state.isFile() || state.isSymbolicLink()) {
      throw new Error("event log is not a regular file");
    }
  }
  writeFileSync(eventLogPath, `${JSON.stringify(event)}\n`, {
    encoding: "utf8",
    flag: "a",
    mode: 0o600,
  });
  if (statSync(eventLogPath).size <= 256 * 1024) return;
  const lines = readFileSync(eventLogPath, "utf8").trimEnd().split("\n");
  const retained: string[] = [];
  let retainedBytes = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    const bytes = Buffer.byteLength(`${line}\n`);
    if (retainedBytes + bytes > 128 * 1024) break;
    retained.unshift(line);
    retainedBytes += bytes;
  }
  writePrivateFileAtomically(eventLogPath, `${retained.join("\n")}\n`, 0o600);
}

function recordEvent(event: EventName, issue?: number, status?: number) {
  const record: EventRecord = { at: new Date().toISOString(), event };
  if (issue !== undefined) record.issue = issue;
  if (status !== undefined) record.status = status;
  appendEvent(record);
}

function assertSafeRelativeToHome(candidate: string): string {
  const relative = path.relative(realpathSync(homedir()), realpathSync(candidate));
  if (
    !relative
    || path.isAbsolute(relative)
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || relative.split(path.sep).includes("..")
  ) {
    throw new Error("path must be a descendant of the home directory");
  }
  return relative;
}

function writePrivateFileAtomically(
  target: string,
  content: string,
  mode: number,
) {
  mkdirSync(path.dirname(target), { mode: 0o700, recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode });
  renameSync(temporary, target);
  chmodSync(target, mode);
}

function resolveCodexHome(value: string | undefined): string {
  const candidate = value || process.env.CODEX_HOME || path.join(homedir(), ".codex");
  const resolved = realpathSync(candidate);
  assertSafeRelativeToHome(resolved);
  const auth = path.join(resolved, "auth.json");
  if (!existsSync(auth) || !lstatSync(auth).isFile() || lstatSync(auth).isSymbolicLink()) {
    throw new Error("selected Codex home does not contain regular file-backed auth");
  }
  return resolved;
}

function readConfiguredCodexHome(): string {
  const configPath = path.join(supportRoot, "codex-home-relative");
  if (!existsSync(configPath)) throw new Error("Codex home is not configured");
  const state = lstatSync(configPath);
  if (!state.isFile() || state.isSymbolicLink()) {
    throw new Error("Codex home configuration is not a regular file");
  }
  const relative = readFileSync(configPath, "utf8").trim();
  if (!relative) throw new Error("Codex home is not configured");
  const codexHome = realpathSync(path.join(homedir(), relative));
  assertSafeRelativeToHome(codexHome);
  return codexHome;
}

function launchctlDomain() {
  return `gui/${userInfo().uid}`;
}

function isLaunchAgentLoaded(): boolean {
  return runCommand(
    "launchctl",
    ["print", `${launchctlDomain()}/${FROG_AUTOFIX_LAUNCH_LABEL}`],
    homedir(),
  ).status === 0;
}

function runCodexPermissionSmoke(primary: string) {
  mkdirSync(supportRoot, { mode: 0o700, recursive: true });
  const outsideRoot = path.join(
    supportRoot,
    `permission-smoke-${randomUUID()}`,
  );
  const workspaceRoot = path.join(
    primary,
    "audit-packages",
    `frog-autofix-permission-smoke-${randomUUID()}`,
  );
  const codexHome = path.join(outsideRoot, "codex-home");
  const outsideCanary = path.join(outsideRoot, "outside-canary");
  const insideCanary = path.join(workspaceRoot, "inside-canary");
  const workerHome = path.join(workspaceRoot, "home");
  const workerTmp = path.join(workspaceRoot, "tmp");
  mkdirSync(outsideRoot, { mode: 0o700, recursive: false });
  mkdirSync(codexHome, { mode: 0o700, recursive: true });
  mkdirSync(workerHome, { mode: 0o700, recursive: true });
  mkdirSync(workerTmp, { mode: 0o700, recursive: true });
  writePrivateFileAtomically(outsideCanary, "outside\n", 0o600);
  try {
    requireCommand(
      "env",
      [
        `CODEX_HOME=${codexHome}`,
        `HOME=${workerHome}`,
        `TMPDIR=${workerTmp}`,
        "codex",
        "sandbox",
        "--cd",
        primary,
        ...codexWorkerPermissionArguments(),
        "--permission-profile",
        "frog-workspace-only",
        "/bin/zsh",
        "-c",
        'test -r package.json && test -z "${CODEX_HOME:-}" && /usr/bin/touch "$1" && test -f "$1" && ! /bin/cat "$2" >/dev/null 2>&1 && ! /usr/bin/curl -fsS --max-time 2 https://example.com >/dev/null 2>&1',
        "frog-permission-smoke",
        insideCanary,
        outsideCanary,
      ],
      primary,
    );
    if (
      !existsSync(insideCanary)
      || !lstatSync(insideCanary).isFile()
      || lstatSync(insideCanary).isSymbolicLink()
    ) {
      throw new Error("Codex permission smoke did not prove workspace writes");
    }
  } finally {
    if (existsSync(workspaceRoot)) {
      rmSync(workspaceRoot, { force: false, recursive: true });
    }
    if (existsSync(outsideRoot)) {
      rmSync(outsideRoot, { force: false, recursive: true });
    }
    try {
      rmdirSync(supportRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
    }
  }
}

function install(codexHomeArgument: string | undefined) {
  if (platform() !== "darwin") throw new Error("install is supported only on macOS");
  const lock = acquireRunLock(lockPath);
  if (!lock) {
    throw new Error("Frog autofix is currently running; install after it finishes");
  }
  try {
    installWhileLocked(codexHomeArgument);
  } finally {
    lock.release();
  }
}

function installWhileLocked(codexHomeArgument: string | undefined) {
  assertRepositoryIdentity(repoRoot);
  const primary = resolvePrimaryWorktree(repoRoot);
  if (realpathSync(repoRoot) !== primary) {
    throw new Error("install must run from the primary worktree");
  }
  if (advanceCleanPrimary(primary).loadedRunnerChanged) {
    throw new Error("primary advanced to origin/main; rerun install from the updated checkout");
  }
  requireCommand("gh", ["auth", "status"], primary);
  requireCommand("codex", ["--version"], primary);
  runCodexPermissionSmoke(primary);
  const codexHome = resolveCodexHome(codexHomeArgument);
  const repoRelative = assertSafeRelativeToHome(primary);
  const codexHomeRelative = assertSafeRelativeToHome(codexHome);
  const plist = renderLaunchAgentPlist();
  const launcher = renderInstalledLauncher();

  if (isLaunchAgentLoaded()) {
    if (
      existsSync(launchAgentPath)
      && readFileSync(launchAgentPath, "utf8") === plist
      && existsSync(path.join(supportRoot, "launch"))
      && readFileSync(path.join(supportRoot, "launch"), "utf8") === launcher
      && readFileSync(path.join(supportRoot, "repo-relative"), "utf8").trim() === repoRelative
      && readFileSync(path.join(supportRoot, "codex-home-relative"), "utf8").trim() === codexHomeRelative
    ) {
      recordEvent("installed");
      console.log("Frog autofix is already installed and loaded.");
      return;
    }
    throw new Error("a loaded Frog autofix job has different local configuration");
  }

  mkdirSync(supportRoot, { mode: 0o700, recursive: true });
  mkdirSync(path.dirname(launchAgentPath), { mode: 0o700, recursive: true });
  writePrivateFileAtomically(path.join(supportRoot, "launch"), launcher, 0o700);
  writePrivateFileAtomically(
    path.join(supportRoot, "repo-relative"),
    `${repoRelative}\n`,
    0o600,
  );
  writePrivateFileAtomically(
    path.join(supportRoot, "codex-home-relative"),
    `${codexHomeRelative}\n`,
    0o600,
  );
  writePrivateFileAtomically(launchAgentPath, plist, 0o600);
  requireCommand("launchctl", ["bootstrap", launchctlDomain(), launchAgentPath], homedir());
  recordEvent("installed");
  console.log("Frog autofix installed: run at load and every 7200 seconds.");
}

function safeRemoveInstalledState() {
  for (const target of [
    path.join(supportRoot, "launch"),
    path.join(supportRoot, "repo-relative"),
    path.join(supportRoot, "codex-home-relative"),
    eventLogPath,
    lockPath,
  ]) {
    if (existsSync(target) && lstatSync(target).isFile()) unlinkSync(target);
  }
  const transientRoot = path.join(supportRoot, "transient");
  if (existsSync(transientRoot)) {
    const state = lstatSync(transientRoot);
    if (!state.isDirectory() || state.isSymbolicLink()) {
      throw new Error("transient state is not a regular directory");
    }
    const remaining = requireCommand(
      "find",
      [transientRoot, "-mindepth", "1", "-print"],
      homedir(),
    );
    if (remaining) throw new Error("transient worker state is not empty");
    rmdirSync(transientRoot);
  }
  if (existsSync(supportRoot)) {
    const remaining = readdirSync(supportRoot);
    if (
      remaining.length !== 1
      || remaining[0] !== path.basename(nativeGatePath)
      || !existsSync(nativeGatePath)
      || !lstatSync(nativeGatePath).isFile()
      || lstatSync(nativeGatePath).isSymbolicLink()
    ) {
      throw new Error("local state contains unexpected entries");
    }
    chmodSync(nativeGatePath, 0o600);
  }
}

function uninstall() {
  if (platform() !== "darwin") throw new Error("uninstall is supported only on macOS");
  const lock = acquireRunLock(lockPath);
  if (!lock) {
    throw new Error("Frog autofix is currently running; uninstall after it finishes");
  }
  try {
    if (isLaunchAgentLoaded()) {
      requireCommand(
        "launchctl",
        ["bootout", launchctlDomain(), launchAgentPath],
        homedir(),
      );
    }
    if (existsSync(launchAgentPath) && lstatSync(launchAgentPath).isFile()) {
      unlinkSync(launchAgentPath);
    }
    if (existsSync(supportRoot)) recordEvent("uninstalled");
    safeRemoveInstalledState();
    console.log("Frog autofix uninstalled.");
  } finally {
    lock.release();
  }
}

function status() {
  const loaded = platform() === "darwin" && isLaunchAgentLoaded();
  console.log(`loaded=${loaded ? "yes" : "no"}`);
  console.log(`interval_seconds=${FROG_AUTOFIX_INTERVAL_SECONDS}`);
  if (!existsSync(eventLogPath)) {
    console.log("events=none");
    return;
  }
  const parsedEvents = parseEventLog(readFileSync(eventLogPath, "utf8"));
  if (!parsedEvents) {
    console.log("events=invalid");
    return;
  }
  const events = parsedEvents.slice(-10);
  console.log(`events=${events.length}`);
  for (const event of events) console.log(JSON.stringify(event));
}

function safeRemoveTransientDirectory(transientRoot: string, candidate: string) {
  const relative = path.relative(realpathSync(transientRoot), realpathSync(candidate));
  if (
    !relative
    || path.isAbsolute(relative)
    || relative.startsWith(`..${path.sep}`)
    || !path.basename(candidate).startsWith("run-")
  ) {
    throw new Error("refusing to remove an unowned transient directory");
  }
  rmSync(candidate, { force: false, recursive: true });
}

async function runWorker(
  worktree: string,
  prompt: string,
  outputDirectory: string,
  codexHome: string,
  onStart: (pid: number) => void,
): Promise<{ status: number; timedOut: boolean }> {
  for (const relativePath of [".codex", ".mcp.json"]) {
    if (existsSync(path.join(worktree, relativePath))) {
      throw new Error("issue worktree contains unsupported Codex project config");
    }
  }
  const workerHome = path.join(outputDirectory, "home");
  const workerTmp = path.join(outputDirectory, "tmp");
  mkdirSync(workerHome, { mode: 0o700, recursive: true });
  mkdirSync(workerTmp, { mode: 0o700, recursive: true });
  const child = spawn(
    "codex",
    buildCodexWorkerArguments({
      lastMessageFile: path.join(outputDirectory, "last-message.txt"),
      worktree,
    }),
    {
      cwd: worktree,
      detached: true,
      env: (() => {
        const environment = safeToolEnvironment({
          CODEX_HOME: codexHome,
          HOME: workerHome,
          TMPDIR: workerTmp,
        });
        delete environment.SSH_AUTH_SOCK;
        delete environment.GH_TOKEN;
        delete environment.GITHUB_TOKEN;
        delete environment.XDG_CACHE_HOME;
        delete environment.XDG_CONFIG_HOME;
        return environment;
      })(),
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  child.stdin?.end(prompt);
  return await superviseOwnedWorker(
    child,
    onStart,
    boundedRuntimeMs(FROG_AUTOFIX_WORKER_TIMEOUT_MS, 31_000),
    30_000,
  );
}

function safeShellLiteral(value: string): string {
  if (value.includes("\n") || value.includes("\r") || value.includes("\0")) {
    throw new Error("unsafe parent review path");
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function repairPlanRelative(issueNumber: number, phase: string, completed: boolean) {
  if (!/^[a-z0-9-]+$/u.test(phase)) throw new Error("invalid repair phase");
  return `agent-docs/exec-plans/${completed ? "completed" : "active"}/frog-autofix-repair-${issueNumber}-${phase}.md`;
}

function writeRepairPlan(worktree: string, issueNumber: number, phase: string) {
  const planPath = path.join(
    worktree,
    repairPlanRelative(issueNumber, phase, false),
  );
  const content = `# Frog Autofix Repair

## Goal

Repair trusted Frog issue #${issueNumber} through the ordinary repository
verification and review gates without granting the edit-only child Git,
GitHub, ReviewGPT, merge, or issue-close authority.

## Tasks

1. [ ] Inspect and integrate the parent-applied proposal.
2. [ ] Add focused regression coverage and update durable owner docs.
3. [ ] Leave a complete private PR body for parent validation.
4. [ ] Let the parent run fixed verification, commit, review, CI, and the
   local-tooling-only merge gate.

Phase: ${phase}
Status: active
Updated: ${new Date().toISOString().slice(0, 10)}
`;
  writePrivateFileAtomically(planPath, content, 0o600);
}

function closeRepairPlan(worktree: string, issueNumber: number, phase: string) {
  const active = path.join(
    worktree,
    repairPlanRelative(issueNumber, phase, false),
  );
  const completedRelative = repairPlanRelative(issueNumber, phase, true);
  const completed = path.join(worktree, completedRelative);
  const content = readBoundedParentFile(active, 64 * 1024)
    .replace("Status: active", "Status: completed")
    .concat(`Completed: ${new Date().toISOString().slice(0, 10)}\n`);
  if (existsSync(completed)) {
    throw new Error("completed repair plan path already exists");
  }
  writePrivateFileAtomically(completed, content, 0o600);
  unlinkSync(active);
}

export function reusableRepairPhase(
  worktree: string,
  issueNumber: number,
  requested: string,
): string {
  let phase = requested;
  for (let suffix = 2; ; suffix += 1) {
    const completed = path.join(
      worktree,
      repairPlanRelative(issueNumber, phase, true),
    );
    if (!existsSync(completed)) return phase;
    phase = `${requested}-${suffix}`;
  }
}

function changedWorktreePaths(worktree: string): string[] {
  const tracked = requireCommand(
    "git",
    ["diff", "--name-only", "-z"],
    worktree,
  ).split("\0").filter(Boolean);
  const untracked = requireCommand(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    worktree,
  ).split("\0").filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}

function assertParentSafeChanges(worktree: string, paths: string[]) {
  if (paths.length === 0 || paths.length > 200) {
    throw new Error("worker returned an empty or unbounded change set");
  }
  for (const relativePath of paths) {
    const normalized = relativePath.replaceAll("\\", "/");
    if (
      normalized.startsWith("/")
      || normalized.split("/").includes("..")
      || normalized === ".git"
      || normalized.startsWith(".git/")
      || normalized === ".codex"
      || normalized.startsWith(".codex/")
      || normalized === ".mcp.json"
      || normalized === ".env"
      || normalized.startsWith(".env.")
      || normalized.startsWith("audit-packages/")
      || normalized === ".gitmodules"
      || normalized === ".gitconfig"
      || normalized.endsWith("/.gitattributes")
      || normalized === ".gitattributes"
      || normalized.startsWith(".githooks/")
      || normalized.startsWith(".github/actions/")
      || normalized.startsWith(".github/workflows/")
    ) {
      throw new Error("worker returned an unsafe change path");
    }
    const target = path.join(worktree, relativePath);
    if (existsSync(target)) {
      const state = lstatSync(target);
      if (!state.isFile() || state.isSymbolicLink() || state.size > 2 * 1024 * 1024) {
        throw new Error("worker returned an unsupported changed file");
      }
    }
  }
  const binary = requireCommand(
    "git",
    ["diff", "--numstat", "--", ...paths],
    worktree,
  ).split("\n").some((line) => /^-\s+-\s+/u.test(line));
  if (binary) throw new Error("worker returned a binary change");

  const diff = requireCommand(
    "git",
    ["diff", "--no-ext-diff", "--", ...paths],
    worktree,
  );
  const untrackedContent = paths
    .filter((relativePath) => runCommand(
      "git",
      ["ls-files", "--error-unmatch", "--", relativePath],
      worktree,
    ).status === 1)
    .map((relativePath) => {
      const content = readFileSync(path.join(worktree, relativePath));
      if (content.includes(0)) {
        throw new Error("worker returned a binary untracked file");
      }
      return content.toString("utf8");
    })
    .join("\n");
  const inspected = `${diff}\n${untrackedContent}`;
  const localUsername = userInfo().username;
  const configuredName = runCommand("git", ["config", "--get", "user.name"], worktree)
    .stdout.trim();
  if (
    inspected.includes(homedir())
    || (localUsername && inspected.includes(localUsername))
    || (configuredName && inspected.includes(configuredName))
    || /\/Users\/[A-Za-z0-9._-]+/u.test(inspected)
    || /(?:GH_TOKEN|GITHUB_TOKEN|Authorization: Bearer|PRIVATE KEY)/iu.test(inspected)
  ) {
    throw new Error("worker diff contains private or credential-shaped data");
  }
}

function commitParentOwnedChanges(
  primary: string,
  worktree: string,
  issueNumber: number,
): string {
  const paths = changedWorktreePaths(worktree);
  assertParentSafeChanges(worktree, paths);
  const committer = realpathSync(
    path.join(primary, "node_modules", ".bin", "cobuild-committer"),
  );
  requireCommand(
    committer,
    [
      "--skip-hooks",
      "--allow-non-conventional",
      `Repair Frog issue #${issueNumber}`,
      ...paths,
    ],
    worktree,
    {},
    30 * 60 * 1_000,
  );
  if (requireCommand("git", ["status", "--porcelain"], worktree)) {
    throw new Error("parent commit did not leave a clean worktree");
  }
  return requireCommand("git", ["rev-parse", "HEAD"], worktree);
}

export const trustedReviewControlPaths = [
  ".npmrc",
  ".pnpmfile.cjs",
  "package.json",
  "pnpm-workspace.yaml",
  "scripts/chatgpt-review-presets",
  "scripts/check-no-js.ts",
  "scripts/package-audit-context-full.sh",
  "scripts/prune-generated-source-sidecars.ts",
  "scripts/repo-tools.config.sh",
  "scripts/review-gpt-context-policy.sh",
  "scripts/review-gpt-pr-head-preflight.sh",
  "scripts/review-gpt.config.sh",
];

function trustedReviewControlsMatch(
  primary: string,
  sourceWorktree: string,
): boolean {
  const head = requireCommand("git", ["rev-parse", "HEAD"], sourceWorktree);
  return runCommand(
    "git",
    ["diff", "--quiet", "origin/main", head, "--", ...trustedReviewControlPaths],
    primary,
  ).status === 0;
}

function prepareTrustedReviewCheckout(
  primary: string,
  sourceWorktree: string,
  transient: string,
  label: string,
): string {
  if (!trustedReviewControlsMatch(primary, sourceWorktree)) {
    throw new Error("candidate changes trusted ReviewGPT execution controls");
  }
  const head = requireCommand("git", ["rev-parse", "HEAD"], sourceWorktree);
  const checkout = path.join(transient, label);
  requireCommand("git", ["worktree", "add", "--detach", checkout, head], primary);
  symlinkSync(path.join(primary, "node_modules"), path.join(checkout, "node_modules"), "dir");
  return realpathSync(checkout);
}

function removeTrustedReviewCheckout(primary: string, checkout: string) {
  const result = runCommand(
    "git",
    ["worktree", "remove", "--force", checkout],
    primary,
  );
  if (result.status !== 0) {
    throw new Error("parent-owned ReviewGPT checkout could not be removed");
  }
}

export function buildParentReviewArchive(
  primary: string,
  worktree: string,
  transient: string,
  label: string,
) {
  const reviewRoot = path.join(transient, label);
  mkdirSync(reviewRoot, { mode: 0o700, recursive: true });
  const zipPath = path.join(reviewRoot, "codebase.zip");
  if (existsSync(zipPath)) unlinkSync(zipPath);
  const checkout = prepareTrustedReviewCheckout(
    primary,
    worktree,
    transient,
    `${label}-package`,
  );
  try {
    requireCommand(
      "bash",
      [
        "scripts/package-audit-context-full.sh",
        "--zip",
        "--out-dir",
        reviewRoot,
        "--name",
        "codebase",
      ],
      checkout,
      {},
      30 * 60 * 1_000,
    );
  } finally {
    removeTrustedReviewCheckout(primary, checkout);
  }
  if (statSync(zipPath).size > 100 * 1024 * 1024) {
    throw new Error("parent review archive exceeds its size bound");
  }

  const emitScript = path.join(reviewRoot, "emit-package.sh");
  writePrivateFileAtomically(
    emitScript,
    `#!/bin/bash\nset -euo pipefail\nbytes="$(wc -c < ${safeShellLiteral(zipPath)} | tr -d ' ')"\nprintf 'ZIP: %s (%s bytes)\\n' ${safeShellLiteral(zipPath)} "$bytes"\n`,
    0o700,
  );
  const config = path.join(reviewRoot, "review-gpt.config.sh");
  writePrivateFileAtomically(
    config,
    `#!/bin/bash\nname_prefix="frog-autofix-parent"\nout_dir=""\ninclude_tests=0\ninclude_docs=0\nchatgpt_url="https://chatgpt.com"\npackage_script=${safeShellLiteral(emitScript)}\nattach_artifacts=1\nmanaged_browser_user_data_dir="$HOME/Library/Application Support/BraveSoftware/Brave-Browser"\nmanaged_browser_profile="Default"\nmanaged_browser_port="9452"\nmanaged_browser_background_mode="balanced"\nbrowser_binary_path="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"\nmodel="gpt-5.6-sol"\nthinking="current"\napp_connector="current"\nresponse_timeout_ms="10800000"\nsnapshot_attachment_name="codebase.zip"\n`,
    0o600,
  );
  return { config, reviewRoot };
}

export function reviewGptEntry(primary: string): string {
  const packageRoot = realpathSync(path.join(primary, "node_modules", "@cobuild", "review-gpt"));
  return path.join(packageRoot, "dist", "bin.mjs");
}

function runParentReview(options: {
  connector?: "github";
  head?: string;
  issueNumber: number;
  kind?: "final" | "specialist";
  label: string;
  marker: string;
  primary: string;
  prompt: string;
  transient: string;
  worktree: string;
}): {
  chatUrl: string;
  outcome?: "findings" | "pass" | "retrospective-required";
  response: string;
} {
  const { config, reviewRoot } = buildParentReviewArchive(
    options.primary,
    options.worktree,
    options.transient,
    options.label,
  );
  const promptPath = path.join(reviewRoot, "prompt.md");
  const responsePath = path.join(reviewRoot, "response.md");
  writePrivateFileAtomically(promptPath, options.prompt, 0o600);
  const args = [
    reviewGptEntry(options.primary),
    "--config",
    config,
    "--model",
    "pro",
    "--thinking",
    "current",
    "--prompt-file",
    promptPath,
    "--send",
    "--wait",
    "--wait-timeout",
    "3h",
    "--response-marker",
    options.marker,
    "--response-file",
    responsePath,
  ];
  if (options.connector) args.push("--connector", options.connector);
  const output = requireCommand(
    process.execPath,
    args,
    options.worktree,
    {},
    3 * 60 * 60 * 1_000,
  );
  const response = readBoundedParentFile(responsePath, 1024 * 1024);
  const chatUrl = extractSingleConversationUrl(output);
  if (options.kind && options.head) {
    const modelVerification = readBoundedParentFile(
      `${responsePath}.model-verification.json`,
      16 * 1024,
    );
    if (!reviewEvidenceIsValid({
      expectedHash: sha256(response),
      head: options.head,
      issueNumber: options.issueNumber,
      kind: options.kind,
      modelVerification,
      response,
    })) {
      throw new Error(`${options.kind} ReviewGPT evidence is invalid`);
    }
    const outcome = reviewOutcome(response, options.kind);
    if (outcome === "invalid") {
      throw new Error(`${options.kind} ReviewGPT response is invalid`);
    }
    return { chatUrl, outcome, response };
  }
  if (!response.split(/\r?\n/u).some(
    (line) => line.trim() === "IMPLEMENTATION_PATCH_COMPLETE",
  )) {
    throw new Error("implementation ReviewGPT response is incomplete");
  }
  return { chatUrl, response };
}

function runCanonicalPullRequestReview(options: {
  head: string;
  issueNumber: number;
  kind: "final" | "specialist";
  primary: string;
  prompt: string;
  pullRequest: number;
  transient: string;
  worktree: string;
}): "findings" | "pass" | "retrospective-required" {
  const label = options.kind === "specialist" ? "specialists" : "final-round-1";
  const reviewRoot = path.join(options.transient, label);
  mkdirSync(reviewRoot, { mode: 0o700, recursive: true });
  const responsePath = path.join(reviewRoot, "response.md");
  const checkout = prepareTrustedReviewCheckout(
    options.primary,
    options.worktree,
    options.transient,
    `${label}-checkout`,
  );
  const marker = options.kind === "specialist"
    ? "SPECIALIST_REVIEW_COMPLETE"
    : "REVIEW_COMPLETE";
  const preset = options.kind === "specialist"
    ? "completion-specialists"
    : "pr-review";
  const environment: NodeJS.ProcessEnv = {
    REVIEW_GPT_PR_URL: String(options.pullRequest),
    REVIEW_GPT_REVIEW_PHASE: options.kind === "specialist" ? "preliminary" : "final",
  };
  if (options.kind === "final") {
    environment.REVIEW_GPT_ROUND_NUMBER = "1";
    environment.REVIEW_GPT_FIRST_REVIEWED_HEAD = options.head;
    environment.REVIEW_GPT_CONTEXT_ANCHOR_HEAD = options.head;
  }
  try {
    requireCommand(
      "pnpm",
      [
        "review:gpt",
        preset,
        "--wait",
        "--response-marker",
        marker,
        "--response-file",
        responsePath,
        "--prompt",
        options.prompt,
      ],
      checkout,
      environment,
      3 * 60 * 60 * 1_000,
    );
  } finally {
    removeTrustedReviewCheckout(options.primary, checkout);
  }
  const response = readBoundedParentFile(responsePath, 1024 * 1024);
  const modelVerification = readBoundedParentFile(
    `${responsePath}.model-verification.json`,
    16 * 1024,
  );
  if (!reviewEvidenceIsValid({
    expectedHash: sha256(response),
    head: options.head,
    issueNumber: options.issueNumber,
    kind: options.kind,
    modelVerification,
    response,
  })) {
    throw new Error(`${options.kind} ReviewGPT evidence is invalid`);
  }
  const outcome = reviewOutcome(response, options.kind);
  if (outcome === "invalid") {
    throw new Error(`${options.kind} ReviewGPT response is invalid`);
  }
  return outcome;
}

function downloadImplementationPatch(
  primary: string,
  worktree: string,
  reviewRoot: string,
  chatUrl: string,
): string {
  const outputDirectory = path.join(reviewRoot, "wake");
  requireCommand(
    process.execPath,
    [
      reviewGptEntry(primary),
      "thread",
      "wake",
      "--browser-endpoint",
      "http://127.0.0.1:9452",
      "--chat-url",
      chatUrl,
      "--delay",
      "0s",
      "--poll-interval",
      "1m",
      "--poll-jitter",
      "0s",
      "--poll-timeout",
      "20m",
      "--output-dir",
      outputDirectory,
      "--repo-dir",
      worktree,
      "--skip-resume",
      "--format",
      "json",
    ],
    worktree,
    {},
    30 * 60 * 1_000,
  );
  const status = readBoundedParentFile(
    path.join(outputDirectory, "status.json"),
    64 * 1024,
  );
  return parseSinglePatchArtifact(status, outputDirectory);
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function runParentVerification(worktree: string) {
  // Do not execute child-authored package scripts or test code in the
  // credentialed parent. The edit-only child may iterate locally in its
  // network-denied sandbox; exact-head GitHub CI is the independent executable
  // proof. The parent performs only fixed Git structural validation here.
  requireCommand("git", ["diff", "--check"], worktree);
}

function validatedWorkerPrBody(worktree: string, issueNumber: number): string {
  const body = readBoundedParentFile(
    path.join(worktree, FROG_AUTOFIX_PR_BODY_PATH),
    32 * 1024,
  );
  validatePullRequestBody(
    body,
    issueNumber,
    homedir(),
    userInfo().username,
  );
  return body;
}

export function recoverablePullRequestBody(
  existing: BranchPullRequestRecord,
  authenticatedOperator: string,
  localBody: string | null,
  issueNumber: number,
): string {
  if (hasParentOwnedPullRequestBody(existing, authenticatedOperator)) {
    return existing.body;
  }
  return localBody ?? renderRecoveredPullRequestBody(issueNumber);
}

function preserveExistingPullRequestBody(
  worktree: string,
  issueNumber: number,
  existing: BranchPullRequestRecord,
) {
  const bodyPath = path.join(worktree, FROG_AUTOFIX_PR_BODY_PATH);
  const operator = parseAuthenticatedGitHubOperator(
    recoveryCommands.authenticatedOperator(worktree),
  );
  const localBody = existsSync(bodyPath)
    ? validatedWorkerPrBody(worktree, issueNumber)
    : null;
  const recovered = recoverablePullRequestBody(
    existing,
    operator,
    localBody,
    issueNumber,
  );
  validatePullRequestBody(
    recovered,
    issueNumber,
    homedir(),
    userInfo().username,
  );
  writePrivateFileAtomically(
    bodyPath,
    recovered,
    0o600,
  );
}

function publishPullRequest(
  primary: string,
  worktree: string,
  branch: string,
  issueNumber: number,
): number {
  const head = requireCommand("git", ["rev-parse", "HEAD"], worktree);
  requireCommand(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "push",
      "--set-upstream",
      "origin",
      `${head}:refs/heads/${branch}`,
    ],
    worktree,
    {},
    30 * 60 * 1_000,
  );
  const existing = branchOpenPullRequest(
    primary,
    branch,
    issueNumber,
    recoveryCommands,
  );
  if (existing) {
    requireCommand(
      "gh",
      [
        "pr",
        "edit",
        String(existing.number),
        "--repo",
        FROG_AUTOFIX_REPOSITORY,
        "--body-file",
        path.join(worktree, FROG_AUTOFIX_PR_BODY_PATH),
      ],
      primary,
    );
    return existing.number;
  }
  requireCommand(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      FROG_AUTOFIX_REPOSITORY,
      "--base",
      "main",
      "--head",
      branch,
      "--draft",
      "--title",
      `Repair Frog issue #${issueNumber}`,
      "--body-file",
      path.join(worktree, FROG_AUTOFIX_PR_BODY_PATH),
    ],
    primary,
  );
  const current = branchOpenPullRequest(
    primary,
    branch,
    issueNumber,
    recoveryCommands,
  );
  if (!current || current.headRefOid !== head) {
    throw new Error("parent could not resolve the created pull request");
  }
  return current.number;
}

function updateParentPullRequestBody(
  primary: string,
  worktree: string,
  pullRequest: number,
  body: string,
) {
  const bodyPath = path.join(worktree, FROG_AUTOFIX_PR_BODY_PATH);
  writePrivateFileAtomically(bodyPath, body, 0o600);
  requireCommand(
    "gh",
    [
      "pr",
      "edit",
      String(pullRequest),
      "--repo",
      FROG_AUTOFIX_REPOSITORY,
      "--body-file",
      bodyPath,
    ],
    primary,
  );
}

function persistClosedPullRequestHandoff(
  primary: string,
  pullRequest: BranchPullRequestRecord,
  issueNumber: number,
) {
  const transientRoot = path.join(supportRoot, "transient");
  mkdirSync(transientRoot, { mode: 0o700, recursive: true });
  const transient = mkdtempSync(path.join(transientRoot, "run-"));
  try {
    const body = closedPullRequestHandoffBody(pullRequest, issueNumber);
    validatePullRequestBody(body, issueNumber, homedir(), userInfo().username);
    const bodyPath = path.join(transient, "closed-pr-body.md");
    writePrivateFileAtomically(bodyPath, body, 0o600);
    requireCommand(
      "gh",
      [
        "pr",
        "edit",
        String(pullRequest.number),
        "--repo",
        FROG_AUTOFIX_REPOSITORY,
        "--body-file",
        bodyPath,
      ],
      primary,
    );
    const operator = parseAuthenticatedGitHubOperator(
      recoveryCommands.authenticatedOperator(primary),
    );
    const refreshed = branchPullRequests(
      primary,
      pullRequest.headRefName,
      recoveryCommands,
    );
    if (!completedHandoffIssueNumbers(refreshed, operator).has(issueNumber)) {
      throw new Error("closed pull request handoff did not persist");
    }
  } finally {
    if (existsSync(transient)) {
      safeRemoveTransientDirectory(transientRoot, transient);
    }
  }
}

export function bodyWithParentMetadata(
  body: string,
  metadata: {
    finalHead?: string;
    firstHead: string;
    handoff?: "product-runtime" | "review-findings";
    handoffHead?: string;
    specialistHead?: string;
  },
): string {
  const prefixes = [
    "ReviewGPT first-reviewed head:",
    "Frog autofix specialist review:",
    "Frog autofix final review:",
    "Frog autofix handoff:",
  ];
  const lines = body
    .split(/\r?\n/u)
    .filter((line) => !prefixes.some((prefix) => line.startsWith(prefix)))
    .join("\n")
    .trimEnd();
  const additions = [`ReviewGPT first-reviewed head: ${metadata.firstHead}`];
  if (metadata.specialistHead) {
    additions.push(`Frog autofix specialist review: PASS at ${metadata.specialistHead}`);
  }
  if (metadata.finalHead) {
    additions.push(`Frog autofix final review: PASS at ${metadata.finalHead}`);
  }
  if (metadata.handoff) {
    const head = metadata.handoffHead
      ?? metadata.finalHead
      ?? metadata.specialistHead;
    if (!head) throw new Error("handoff metadata requires a reviewed head");
    additions.push(`Frog autofix handoff: ${metadata.handoff} at ${head}`);
  }
  return `${lines}\n\n${additions.join("\n")}\n`;
}

export function bodyHasExactReviewPass(
  body: string,
  kind: "final" | "specialist",
  head: string,
): boolean {
  const expected = `Frog autofix ${kind} review: PASS at ${head}`;
  return body.split(/\r?\n/u).filter((line) => line === expected).length === 1;
}

export function bodyHandoff(
  body: string,
  head: string,
): "product-runtime" | "review-findings" | null {
  const handoff = bodyHandoffRecord(body);
  if (!handoff) return null;
  if (handoff.head !== head) {
    throw new Error("pull request has ambiguous Frog handoff metadata");
  }
  return handoff.kind;
}

export interface BodyHandoffRecord {
  head: string;
  kind: "product-runtime" | "review-findings";
}

export function bodyHandoffRecord(body: string): BodyHandoffRecord | null {
  const matches = body.match(/^Frog autofix handoff: (product-runtime|review-findings) at ([0-9a-f]{40})$/gmu)
    ?? [];
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new Error("pull request has ambiguous Frog handoff metadata");
  }
  const match = /^Frog autofix handoff: (product-runtime|review-findings) at ([0-9a-f]{40})$/u
    .exec(matches[0] ?? "");
  if (!match?.[1] || !match[2]) {
    throw new Error("pull request has ambiguous Frog handoff metadata");
  }
  return {
    head: match[2],
    kind: match[1] as BodyHandoffRecord["kind"],
  };
}

export function carriedForwardBodyHandoff(
  body: string,
  currentHead: string,
  isAncestor: (priorHead: string, currentHead: string) => boolean,
): BodyHandoffRecord["kind"] | null {
  const handoff = bodyHandoffRecord(body);
  if (!handoff) return null;
  if (handoff.head !== currentHead && !isAncestor(handoff.head, currentHead)) {
    throw new Error("Frog handoff head is not an ancestor of the current head");
  }
  return handoff.kind;
}

function resolveFirstReviewedHead(
  worktree: string,
  existingBody: string | null,
  currentHead: string,
): string {
  const existing = existingBody === null
    ? null
    : extractFirstReviewedHead(existingBody);
  if (existingBody !== null && !existing) {
    throw new Error("existing pull request is missing its immutable review baseline");
  }
  if (!existing) return currentHead;
  requireCommand("git", ["cat-file", "-e", `${existing}^{commit}`], worktree);
  if (
    runCommand(
      "git",
      ["merge-base", "--is-ancestor", existing, currentHead],
      worktree,
    ).status !== 0
  ) {
    throw new Error("ReviewGPT baseline is not an ancestor of the current head");
  }
  return existing;
}

async function runEditOnlyCycle(options: {
  codexHome: string;
  issueNumber: number;
  lock: { setWorker: (pid: number) => void };
  mode: "implement" | "resume";
  phase: string;
  primary: string;
  transient: string;
  worktree: string;
}) {
  const phase = reusableRepairPhase(
    options.worktree,
    options.issueNumber,
    options.phase,
  );
  writeRepairPlan(options.worktree, options.issueNumber, phase);
  const template = readFileSync(
    path.join(options.primary, "scripts", "frog-autofix-worker.md"),
    "utf8",
  );
  const prompt = renderWorkerPrompt(template, options.issueNumber, options.mode);
  const outputDirectory = path.join(
    options.worktree,
    "audit-packages",
    "frog-autofix-worker",
  );
  if (existsSync(outputDirectory)) rmSync(outputDirectory, { force: true, recursive: true });
  recordEvent("worker_started", options.issueNumber);
  const result = await runWorker(
    options.worktree,
    prompt,
    outputDirectory,
    options.codexHome,
    options.lock.setWorker,
  );
  if (existsSync(outputDirectory)) rmSync(outputDirectory, { force: true, recursive: true });
  if (result.timedOut) {
    recordEvent("worker_timed_out", options.issueNumber, result.status);
    throw new Error("edit-only worker exceeded its bounded runtime");
  }
  if (result.status !== 0) {
    recordEvent("worker_failed", options.issueNumber, result.status);
    throw new Error(`edit-only worker failed with status ${result.status}`);
  }
  validatedWorkerPrBody(options.worktree, options.issueNumber);
  runParentVerification(options.worktree);
  closeRepairPlan(options.worktree, options.issueNumber, phase);
  commitParentOwnedChanges(
    options.primary,
    options.worktree,
    options.issueNumber,
  );
}

function issueIsClosed(root: string, issueNumber: number): boolean {
  return requireCommand(
    "gh",
    [
      "issue",
      "view",
      String(issueNumber),
      "--repo",
      FROG_AUTOFIX_REPOSITORY,
      "--json",
      "state",
      "--jq",
      ".state",
    ],
    root,
  ) === "CLOSED";
}

interface RequiredCheckRecord {
  bucket: string;
  name: string;
  state: string;
  workflow: string;
}

export type RequiredPullRequestCheckState =
  | "failed"
  | "indeterminate"
  | "pass"
  | "pending";

export function requiredPullRequestCheckState(
  raw: string,
): RequiredPullRequestCheckState {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) {
    throw new Error("GitHub returned an invalid required check list");
  }
  if (value.length === 0) return "indeterminate";
  const buckets = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("GitHub returned an invalid required check record");
    }
    const check = entry as Partial<RequiredCheckRecord>;
    if (
      !["cancel", "fail", "pass", "pending", "skipping"].includes(check.bucket ?? "")
      || typeof check.name !== "string"
      || !check.name
      || typeof check.state !== "string"
      || !check.state
      || typeof check.workflow !== "string"
      || !check.workflow
    ) {
      throw new Error("GitHub returned an invalid required check record");
    }
    return check.bucket;
  });
  if (buckets.some((bucket) => bucket === "cancel" || bucket === "fail")) {
    return "failed";
  }
  if (buckets.every((bucket) => bucket === "pass")) return "pass";
  if (buckets.some((bucket) => bucket === "pending")) return "pending";
  return "indeterminate";
}

export function requiredCheckWatchHandoff(
  watchStatus: number,
  checkState: RequiredPullRequestCheckState,
): "review-findings" | null {
  if (watchStatus === 0) return null;
  if (checkState === "failed") return "review-findings";
  throw new Error("required pull request checks did not complete");
}

function requiredPullRequestCheckStateFromGitHub(
  root: string,
  pullRequest: number,
): RequiredPullRequestCheckState {
  const result = runCommand(
    "gh",
    [
      "pr",
      "checks",
      String(pullRequest),
      "--repo",
      FROG_AUTOFIX_REPOSITORY,
      "--required",
      "--json",
      "bucket,name,state,workflow",
    ],
    root,
  );
  if (![0, 1, 8].includes(result.status)) {
    throw new Error(`gh failed with status ${result.status}`);
  }
  return requiredPullRequestCheckState(result.stdout);
}

function requiredPullRequestChecksPass(root: string, pullRequest: number): boolean {
  return requiredPullRequestCheckStateFromGitHub(root, pullRequest) === "pass";
}

function exactHeadIsLocalAgentOnly(
  primary: string,
  head: string,
): boolean {
  fetchMain(primary);
  const mergeBase = requireCommand(
    "git",
    ["merge-base", "origin/main", head],
    primary,
  );
  const paths = changedAuthorityPaths(primary, mergeBase, head);
  const show = (ref: string, filePath: string) => requireCommand(
    "git",
    ["show", `${ref}:${filePath}`],
    primary,
  );
  return localAgentOnlyChange({
    architectureBase: paths.includes("ARCHITECTURE.md")
      ? show(mergeBase, "ARCHITECTURE.md")
      : undefined,
    architectureHead: paths.includes("ARCHITECTURE.md")
      ? show(head, "ARCHITECTURE.md")
      : undefined,
    packageBase: paths.includes("package.json")
      ? show(mergeBase, "package.json")
      : undefined,
    packageHead: paths.includes("package.json")
      ? show(head, "package.json")
      : undefined,
    paths,
  });
}

function finalizeReviewedRepair(
  primary: string,
  branch: string,
  issueNumber: number,
  pullRequest: number,
  head: string,
): "awaiting-human-conflict" | "awaiting-human-product" | "merged" {
  return finalizeReadyRepair({ branch, issueNumber, pullRequest, head }, {
    autoMergeAllowed: (identity) => exactHeadIsLocalAgentOnly(
      primary,
      identity.head,
    ),
    closeIssue: (identity) => requireCommand(
      "gh",
      [
        "issue",
        "close",
        String(issueNumber),
        "--repo",
        FROG_AUTOFIX_REPOSITORY,
        "--comment",
        `Closed after verified merge of PR #${identity.pullRequest}.`,
      ],
      primary,
    ),
    currentPullRequest: () => {
      const current = branchOpenPullRequest(
        primary,
        branch,
        issueNumber,
        recoveryCommands,
      );
      return current
        ? { head: current.headRefOid, pullRequest: current.number }
        : null;
    },
    issueIsClosed: () => issueIsClosed(primary, issueNumber),
    merge: (identity) => requireCommand(
      "gh",
      [
        "pr",
        "merge",
        String(identity.pullRequest),
        "--repo",
        FROG_AUTOFIX_REPOSITORY,
        "--squash",
        "--match-head-commit",
        identity.head,
      ],
      primary,
    ),
    mergeTreePasses: () => runCommand(
      "git",
      [
        "merge-tree",
        "--write-tree",
        "--quiet",
        "origin/main",
        `refs/heads/${branch}`,
      ],
      primary,
    ).status === 0,
    pullRequestIsMerged: () => branchHasMergedPullRequest(
      primary,
      branch,
      issueNumber,
      recoveryCommands,
    ),
    refreshAndVerifyIssue: () => {
      fetchMain(primary);
      verifyExactIssue(primary, issueNumber);
    },
    requiredChecksPass: (identity) => requiredPullRequestChecksPass(
      primary,
      identity.pullRequest,
    ),
  });
}

async function reviewPublishAndFinalize(options: {
  branch: string;
  issueNumber: number;
  primary: string;
  transient: string;
  worktree: string;
}): Promise<"awaiting-human" | "merged"> {
  let body = validatedWorkerPrBody(options.worktree, options.issueNumber);
  const existingBeforePublish = branchOpenPullRequest(
    options.primary,
    options.branch,
    options.issueNumber,
    recoveryCommands,
  );
  const head = requireCommand("git", ["rev-parse", "HEAD"], options.worktree);
  const operator = parseAuthenticatedGitHubOperator(
    recoveryCommands.authenticatedOperator(options.primary),
  );
  const existingBodyIsParentOwned = Boolean(
    existingBeforePublish
    && hasParentOwnedPullRequestBody(existingBeforePublish, operator),
  );
  const firstHead = resolveFirstReviewedHead(
    options.worktree,
    existingBeforePublish && existingBodyIsParentOwned
      ? existingBeforePublish.body
      : null,
    head,
  );
  let specialistPassed = Boolean(
    existingBeforePublish && existingBodyIsParentOwned
    && bodyHasExactReviewPass(existingBeforePublish.body, "specialist", head),
  );
  let finalPassed = Boolean(
    existingBeforePublish && existingBodyIsParentOwned
    && bodyHasExactReviewPass(existingBeforePublish.body, "final", head),
  );
  let handoff = existingBeforePublish && existingBodyIsParentOwned
    ? carriedForwardBodyHandoff(
      existingBeforePublish.body,
      head,
      (priorHead, currentHead) => {
        requireCommand(
          "git",
          ["cat-file", "-e", `${priorHead}^{commit}`],
          options.worktree,
        );
        const ancestry = runCommand(
          "git",
          ["merge-base", "--is-ancestor", priorHead, currentHead],
          options.worktree,
        );
        if (![0, 1].includes(ancestry.status)) {
          throw new Error(`git failed with status ${ancestry.status}`);
        }
        return ancestry.status === 0;
      },
    )
    : null;
  body = bodyWithParentMetadata(body, {
    finalHead: finalPassed ? head : undefined,
    firstHead,
    handoff: handoff ?? undefined,
    handoffHead: handoff ? head : undefined,
    specialistHead: specialistPassed ? head : undefined,
  });
  writePrivateFileAtomically(
    path.join(options.worktree, FROG_AUTOFIX_PR_BODY_PATH),
    body,
    0o600,
  );
  const pullRequest = publishPullRequest(
    options.primary,
    options.worktree,
    options.branch,
    options.issueNumber,
  );

  const persistMetadata = () => {
    body = bodyWithParentMetadata(body, {
      finalHead: finalPassed ? head : undefined,
      firstHead,
      handoff: handoff ?? undefined,
      handoffHead: handoff ? head : undefined,
      specialistHead: specialistPassed ? head : undefined,
    });
    updateParentPullRequestBody(
      options.primary,
      options.worktree,
      pullRequest,
      body,
    );
  };

  if (handoff) return "awaiting-human";
  if (firstHead !== head || !trustedReviewControlsMatch(
    options.primary,
    options.worktree,
  )) {
    handoff = "review-findings";
    persistMetadata();
    return "awaiting-human";
  }

  if (!specialistPassed) {
    const specialist = runCanonicalPullRequestReview({
      head,
      issueNumber: options.issueNumber,
      kind: "specialist",
      primary: options.primary,
      prompt: `Review PR #${pullRequest} for the repair bound to Frog issue #${options.issueNumber} at exact head ${head}. Apply every preliminary lens declared in the PR body. Include #${options.issueNumber} and ${head.slice(0, 12)} in the response, then end with SPECIALIST_REVIEW_COMPLETE and exactly one SPECIALIST_OUTCOME marker.`,
      pullRequest,
      transient: options.transient,
      worktree: options.worktree,
    });
    if (reviewRequiresHumanHandoff(specialist)) {
      handoff = "review-findings";
      persistMetadata();
      return "awaiting-human";
    }
    specialistPassed = true;
    persistMetadata();
  }

  if (!finalPassed) {
    const finalReview = runCanonicalPullRequestReview({
      head,
      issueNumber: options.issueNumber,
      kind: "final",
      primary: options.primary,
      prompt: `Review PR #${pullRequest} for the repair bound to Frog issue #${options.issueNumber} at exact head ${head}. The preliminary specialist gate passed this same head. Perform final substantive round 1 from the canonical full snapshot. Include #${options.issueNumber} and ${head.slice(0, 12)} in the response, then end with REVIEW_COMPLETE and exactly one ROUND_OUTCOME marker.`,
      pullRequest,
      transient: options.transient,
      worktree: options.worktree,
    });
    if (reviewRequiresHumanHandoff(finalReview)) {
      handoff = "review-findings";
      persistMetadata();
      return "awaiting-human";
    }
    finalPassed = true;
    persistMetadata();
  }

  const draft = requireCommand(
    "gh",
    [
      "pr",
      "view",
      String(pullRequest),
      "--repo",
      FROG_AUTOFIX_REPOSITORY,
      "--json",
      "isDraft",
      "--jq",
      ".isDraft",
    ],
    options.primary,
  );
  if (draft === "true") {
    requireCommand(
      "gh",
      [
        "pr",
        "ready",
        String(pullRequest),
        "--repo",
        FROG_AUTOFIX_REPOSITORY,
      ],
      options.primary,
    );
  } else if (draft !== "false") {
    throw new Error("GitHub returned an invalid pull request draft state");
  }
  const checkWatch = runCommand(
    "gh",
    [
      "pr",
      "checks",
      String(pullRequest),
      "--repo",
      FROG_AUTOFIX_REPOSITORY,
      "--required",
      "--watch",
      "--interval",
      "30",
    ],
    options.primary,
    {},
    3 * 60 * 60 * 1_000,
  );
  if (checkWatch.status !== 0) {
    const checkHandoff = requiredCheckWatchHandoff(
      checkWatch.status,
      requiredPullRequestCheckStateFromGitHub(options.primary, pullRequest),
    );
    if (checkHandoff) {
      handoff = checkHandoff;
      persistMetadata();
      return "awaiting-human";
    }
  }
  const result = finalizeReviewedRepair(
    options.primary,
    options.branch,
    options.issueNumber,
    pullRequest,
    head,
  );
  if (result === "awaiting-human-conflict") {
    handoff = "review-findings";
    persistMetadata();
    return "awaiting-human";
  }
  if (result === "awaiting-human-product") {
    handoff = "product-runtime";
    persistMetadata();
    return "awaiting-human";
  }
  return "merged";
}

function retireMergedWorktree(
  primary: string,
  worktree: string,
  branch: string,
  issueNumber: number,
) {
  if (!branchHasMergedPullRequest(
    primary,
    branch,
    issueNumber,
    recoveryCommands,
  )) return;
  const result = runCommand(
    "bash",
    [path.join(primary, "scripts", "retire-worktree"), worktree],
    primary,
  );
  if (result.status !== 0) return;
}

async function runOnce() {
  const lock = acquireRunLock(lockPath);
  if (!lock) {
    recordEvent("blocked");
    console.log("Frog autofix is already running.");
    return;
  }
  try {
    assertRepositoryIdentity(repoRoot);
    const primary = resolvePrimaryWorktree(repoRoot);
    if (realpathSync(repoRoot) !== primary) {
      throw new Error("scheduled runs must enter the primary worktree");
    }
    const primaryAdvance = advanceCleanPrimary(primary);
    if (primaryAdvance.loadedRunnerChanged) {
      recordEvent("blocked");
      console.log("Primary advanced to origin/main; the next run will use the updated launcher.");
      return;
    }
    const eligible = discoverEligibleIssues(primary);
    const issue = eligible[0];
    if (!issue) {
      recordEvent("no_eligible_issue");
      console.log("No eligible trusted Frog issues.");
      return;
    }
    verifyExactIssue(primary, issue.number);
    const branch = `${FROG_AUTOFIX_BRANCH_PREFIX}${issue.number}`;
    const closedPullRequest = closedPullRequestForHandoff(
      branchPullRequests(primary, branch, recoveryCommands),
    );
    if (closedPullRequest) {
      persistClosedPullRequestHandoff(primary, closedPullRequest, issue.number);
      recordEvent("awaiting_human_merge", issue.number);
      console.log(
        "Closed repair reached a durable human-review handoff; continuing with later issues on the next run.",
      );
      return;
    }
    const codexHome = readConfiguredCodexHome();
    const worktree = prepareIssueWorktree(primary, issue.number);
    const workerMode = resolveWorkerMode(
      worktree,
      branch,
      issue.number,
      recoveryCommands,
    );
    ensureWorkerTooling(worktree, workerMode === "implement");
    const transientRoot = path.join(supportRoot, "transient");
    mkdirSync(transientRoot, { mode: 0o700, recursive: true });
    const transient = mkdtempSync(path.join(transientRoot, "run-"));
    try {
      const existingPullRequest = branchOpenPullRequest(
        primary,
        branch,
        issue.number,
        recoveryCommands,
      );
      if (workerMode === "implement") {
        const implementation = runParentReview({
          connector: "github",
          issueNumber: issue.number,
          label: "implementation",
          marker: "IMPLEMENTATION_PATCH_COMPLETE",
          primary,
          prompt: renderImplementationPrompt(issue.number),
          transient,
          worktree,
        });
        const reviewRoot = path.join(transient, "implementation");
        const patchPath = downloadImplementationPatch(
          primary,
          worktree,
          reviewRoot,
          implementation.chatUrl,
        );
        const patch = readBoundedParentFile(patchPath, 2 * 1024 * 1024);
        validatePatchText(patch);
        requireCommand("git", ["apply", "--stat", patchPath], worktree);
        requireCommand("git", ["apply", "--check", patchPath], worktree);
        requireCommand("git", ["apply", patchPath], worktree);
      }

      if (
        workerMode === "resume"
        && existingPullRequest
        && existingPullRequest.headRefOid
          === requireCommand("git", ["rev-parse", "HEAD"], worktree)
        && !requireCommand("git", ["status", "--porcelain"], worktree)
      ) {
        preserveExistingPullRequestBody(
          worktree,
          issue.number,
          existingPullRequest,
        );
      } else if (
        workerMode === "resume"
        && !existingPullRequest
        && existsSync(path.join(worktree, FROG_AUTOFIX_PR_BODY_PATH))
        && !requireCommand("git", ["status", "--porcelain"], worktree)
      ) {
        validatedWorkerPrBody(worktree, issue.number);
      } else {
        await runEditOnlyCycle({
          codexHome,
          issueNumber: issue.number,
          lock,
          mode: workerMode,
          phase: workerMode === "implement" ? "implementation" : "resume",
          primary,
          transient,
          worktree,
        });
      }
      const result = await reviewPublishAndFinalize({
        branch,
        issueNumber: issue.number,
        primary,
        transient,
        worktree,
      });
      if (result === "awaiting-human") {
        recordEvent("awaiting_human_merge", issue.number);
        console.log(
          "Repair reached a durable human-review handoff; continuing with later issues on the next run.",
        );
        return;
      }
      recordEvent("repair_closed_issue", issue.number);
      retireMergedWorktree(primary, worktree, branch, issue.number);
      return;
    } finally {
      if (existsSync(transient)) {
        safeRemoveTransientDirectory(transientRoot, transient);
      }
    }
  } finally {
    lock.release();
  }
}

function assertNativeAcquisitionGate() {
  if (
    platform() !== "darwin"
    || process.env[nativeGateEnvironment] !== "1"
    || requireCommand(
      "/bin/ps",
      ["-o", "comm=", "-p", String(process.ppid)],
      homedir(),
    ) !== "/usr/bin/lockf"
    || !existsSync(nativeGatePath)
    || !lstatSync(nativeGatePath).isFile()
    || lstatSync(nativeGatePath).isSymbolicLink()
  ) {
    throw new Error("mutating Frog autofix commands require the native launcher gate");
  }
  const contender = runCommand(
    "/usr/bin/lockf",
    ["-t", "0", nativeGatePath, "/usr/bin/true"],
    homedir(),
  );
  if (contender.status === 0) {
    throw new Error("mutating Frog autofix commands require the native launcher gate");
  }
}

function scan() {
  const eligible = discoverEligibleIssues(repoRoot);
  console.log(`eligible=${eligible.length}`);
  for (const issue of eligible) console.log(`issue=${issue.number}`);
}

function parseInstallCodexHome(args: string[]): string | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === "--codex-home" && args[1]) {
    return args[1];
  }
  throw new Error("install accepts only --codex-home <dir>");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  beginInvocation(command);
  switch (command) {
    case "install":
      assertNativeAcquisitionGate();
      install(parseInstallCodexHome(args));
      return;
    case "uninstall":
      assertNativeAcquisitionGate();
      if (args.length) throw new Error("uninstall accepts no arguments");
      uninstall();
      return;
    case "status":
      if (args.length) throw new Error("status accepts no arguments");
      status();
      return;
    case "verify-permissions":
      if (args.length) throw new Error("verify-permissions accepts no arguments");
      assertRepositoryIdentity(repoRoot);
      runCodexPermissionSmoke(repoRoot);
      console.log("Frog Codex worker permission profile passed.");
      return;
    case "scan":
      if (args.length) throw new Error("scan accepts no arguments");
      scan();
      return;
    case "run":
      assertNativeAcquisitionGate();
      if (args.length) throw new Error("run accepts no arguments");
      await runOnce();
      return;
    default:
      throw new Error(
        "expected install, uninstall, status, scan, verify-permissions, or run",
      );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error: unknown) => {
    if (process.argv[2] !== "scan") {
      try {
        recordEvent("blocked");
      } catch {
        // Failure reporting must not expose unsafe local filesystem details.
      }
    }
    const message = safeFailureMessage(error);
    console.error(`Frog autofix stopped: ${message}`);
    process.exitCode = 1;
  });
}
