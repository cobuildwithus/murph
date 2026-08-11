import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import {
  FROG_AUTOFIX_BRANCH_PREFIX,
  FROG_AUTOFIX_FINAL_RESPONSE_PATH,
  FROG_AUTOFIX_INTERVAL_SECONDS,
  FROG_AUTOFIX_LAUNCH_LABEL,
  FROG_AUTOFIX_READY_PATH,
  FROG_AUTOFIX_REPOSITORY,
  FROG_AUTOFIX_SPECIALIST_RESPONSE_PATH,
  FROG_AUTOFIX_WORKER_TIMEOUT_MS,
  buildCodexWorkerArguments,
  eligibleFrogIssues,
  isTrustedFrogIssue,
  normalizeGitHubRepository,
  parseEventLog,
  parseReadyManifest,
  renderInstalledLauncher,
  renderLaunchAgentPlist,
  renderWorkerPrompt,
  runWithCleanup,
  reviewEvidenceIsValid,
  safeFailureMessage,
  superviseOwnedWorker,
  terminalWorkerSucceeded,
  type EventName,
  type EventRecord,
  type FrogIssue,
} from "./frog-autofix-lib.ts";
import {
  branchHasMergedPullRequest,
  branchOpenPullRequest,
  resolveWorkerMode,
  type RecoveryCommandAdapter,
} from "./frog-autofix-recovery.ts";
import { validateAndFinalizeReadyRepair } from "./frog-autofix-finalize.ts";

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
    ? FROG_AUTOFIX_WORKER_TIMEOUT_MS
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
): CommandResult => {
  const timeoutMs = boundedRuntimeMs(COMMAND_TIMEOUT_MS, COMMAND_KILL_MARGIN_MS);
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
    env: safeToolEnvironment(),
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
    throw new Error(`${command} returned an invalid command envelope`);
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
) => {
  const result = runCommand(command, args, cwd);
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return result.stdout.trim();
};

const recoveryCommands: RecoveryCommandAdapter = {
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
  assertRepository: (root: string) => void;
  bindingCount: (root: string, issueNumber: number) => number;
  fetchDefaultBranch: (root: string) => void;
  listOpenIssues: (root: string) => string;
}

const defaultDiscoveryDependencies: DiscoveryDependencies = {
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
};

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
  return eligibleFrogIssues(issues, counts);
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

function advanceCleanPrimary(primary: string): boolean {
  if (requireCommand("git", ["status", "--porcelain"], primary)) {
    throw new Error("primary worktree is not clean");
  }
  fetchMain(primary);
  const head = requireCommand("git", ["rev-parse", "HEAD"], primary);
  const main = requireCommand("git", ["rev-parse", "origin/main"], primary);
  if (head === main) return false;

  const ancestry = runCommand(
    "git",
    ["merge-base", "--is-ancestor", head, main],
    primary,
  );
  if (ancestry.status !== 0) {
    throw new Error("primary worktree cannot fast-forward to origin/main");
  }

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
  return true;
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

function ensureWorkerTooling(worktree: string) {
  const requiredFiles = [
    path.join(worktree, "node_modules", ".bin", "tsx"),
    path.join(worktree, "node_modules", ".bin", "cobuild-review-gpt"),
  ];
  if (requiredFiles.every((candidate) => existsSync(candidate))) return;
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
  const helper = path.join(
    resolved,
    "skills",
    "codex-workers",
    "scripts",
    "codex-workers",
  );
  if (!existsSync(helper) || !lstatSync(helper).isFile()) {
    throw new Error("selected Codex home does not contain the codex-workers helper");
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

function install(codexHomeArgument: string | undefined) {
  if (platform() !== "darwin") throw new Error("install is supported only on macOS");
  assertRepositoryIdentity(repoRoot);
  const primary = resolvePrimaryWorktree(repoRoot);
  if (realpathSync(repoRoot) !== primary) {
    throw new Error("install must run from the primary worktree");
  }
  if (advanceCleanPrimary(primary)) {
    throw new Error("primary advanced to origin/main; rerun install from the updated checkout");
  }
  requireCommand("gh", ["auth", "status"], primary);
  requireCommand("codex", ["--version"], primary);
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
    const remaining = requireCommand("find", [supportRoot, "-mindepth", "1", "-print"], homedir());
    if (remaining) throw new Error("local state contains unexpected entries");
    rmdirSync(supportRoot);
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
  promptFile: string,
  outputDirectory: string,
  codexHome: string,
  gitCommonDirectory: string,
  onStart: (pid: number) => void,
): Promise<{ status: number; timedOut: boolean }> {
  const helper = path.join(
    codexHome,
    "skills",
    "codex-workers",
    "scripts",
    "codex-workers",
  );
  const child = spawn(
    "bash",
    buildCodexWorkerArguments({
      browserProfileRoot: path.join(
        homedir(),
        "Library",
        "Application Support",
        "BraveSoftware",
        "Brave-Browser",
      ),
      codexHome,
      gitCommonDirectory,
      helper,
      outputDirectory,
      promptFile,
      worktree,
    }),
    {
      cwd: worktree,
      detached: true,
      env: safeToolEnvironment({ CODEX_HOME: codexHome }),
      stdio: "ignore",
    },
  );
  return await superviseOwnedWorker(
    child,
    onStart,
    boundedRuntimeMs(FROG_AUTOFIX_WORKER_TIMEOUT_MS, 31_000),
    30_000,
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

function readBoundedRegularFile(
  worktree: string,
  relativePath: string,
  maximumBytes: number,
): string {
  const target = path.resolve(worktree, relativePath);
  const relative = path.relative(worktree, target);
  if (
    !relative
    || path.isAbsolute(relative)
    || relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error("worker evidence path escapes its worktree");
  }
  const state = lstatSync(target);
  if (!state.isFile() || state.isSymbolicLink() || state.size > maximumBytes) {
    throw new Error("worker evidence is not a bounded regular file");
  }
  return readFileSync(target, "utf8");
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

interface RequiredCheckRecord {
  bucket: string;
  name: string;
  state: string;
  workflow: string;
}

function requiredPullRequestChecksPass(root: string, pullRequest: number): boolean {
  const raw = requireCommand(
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
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const check = entry as Partial<RequiredCheckRecord>;
    return check.bucket === "pass"
      && typeof check.name === "string"
      && Boolean(check.name)
      && typeof check.state === "string"
      && Boolean(check.state)
      && typeof check.workflow === "string"
      && Boolean(check.workflow);
  });
}

function validateReadyRepair(
  primary: string,
  worktree: string,
  branch: string,
  issueNumber: number,
) {
  validateAndFinalizeReadyRepair({ branch, issueNumber }, {
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
    loadManifest: () => parseReadyManifest(
      readBoundedRegularFile(worktree, FROG_AUTOFIX_READY_PATH, 4 * 1024),
      issueNumber,
      branch,
    ),
    localHead: () => requireCommand("git", ["rev-parse", "HEAD"], worktree),
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
    reviewEvidencePasses: (kind, reviewedHead) => {
      const responsePath = kind === "specialist"
        ? FROG_AUTOFIX_SPECIALIST_RESPONSE_PATH
        : FROG_AUTOFIX_FINAL_RESPONSE_PATH;
      const response = readBoundedRegularFile(worktree, responsePath, 1024 * 1024);
      const modelVerification = readBoundedRegularFile(
        worktree,
        `${responsePath}.model-verification.json`,
        16 * 1024,
      );
      return reviewEvidenceIsValid({
        expectedHash: sha256(response),
        head: reviewedHead,
        issueNumber,
        kind,
        modelVerification,
        response,
      });
    },
    specialistHeadIsAncestor: (specialistHead, finalHead) => runCommand(
      "git",
      ["merge-base", "--is-ancestor", specialistHead, finalHead],
      worktree,
    ).status === 0,
    worktreeIsClean: () => !requireCommand(
      "git",
      ["status", "--porcelain"],
      worktree,
    ),
  });
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
    if (advanceCleanPrimary(primary)) {
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
    const codexHome = readConfiguredCodexHome();
    const worktree = prepareIssueWorktree(primary, issue.number);
    const workerMode = resolveWorkerMode(
      worktree,
      branch,
      issue.number,
      recoveryCommands,
    );
    ensureWorkerTooling(worktree);
    const gitCommonDirectory = realpathSync(
      requireCommand(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        worktree,
      ),
    );
    const transientRoot = path.join(supportRoot, "transient");
    mkdirSync(transientRoot, { mode: 0o700, recursive: true });
    const transient = mkdtempSync(path.join(transientRoot, "run-"));
    let cleanupOwnedByWorkerLifecycle = false;
    let workerSucceeded = false;
    try {
      const template = readFileSync(
        path.join(primary, "scripts", "frog-autofix-worker.md"),
        "utf8",
      );
      const promptFile = path.join(transient, "frog-autofix.prompt.md");
      writeFileSync(promptFile, renderWorkerPrompt(
        template,
        issue.number,
        workerMode,
      ), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      const outputDirectory = path.join(transient, "worker-output");
      recordEvent("worker_started", issue.number);
      cleanupOwnedByWorkerLifecycle = true;
      const result = await runWithCleanup(
        () => runWorker(
          worktree,
          promptFile,
          outputDirectory,
          codexHome,
          gitCommonDirectory,
          lock.setWorker,
        ),
        () => safeRemoveTransientDirectory(transientRoot, transient),
      );
      if (result.timedOut) {
        recordEvent("worker_timed_out", issue.number, result.status);
      } else if (result.status !== 0) {
        recordEvent("worker_failed", issue.number, result.status);
      } else {
        workerSucceeded = true;
      }
    } finally {
      if (!cleanupOwnedByWorkerLifecycle && existsSync(transient)) {
        safeRemoveTransientDirectory(transientRoot, transient);
      }
    }

    if (!workerSucceeded) {
      recordEvent("worker_incomplete", issue.number);
      process.exitCode = 1;
      return;
    }
    validateReadyRepair(primary, worktree, branch, issue.number);

    const issueClosed = issueIsClosed(primary, issue.number);
    const pullRequestMerged = branchHasMergedPullRequest(
      primary,
      branch,
      issue.number,
      recoveryCommands,
    );
    if (terminalWorkerSucceeded(issueClosed, pullRequestMerged)) {
      recordEvent("worker_closed_issue", issue.number);
      retireMergedWorktree(primary, worktree, branch, issue.number);
      return;
    }
    recordEvent("worker_incomplete", issue.number);
    process.exitCode = 1;
  } finally {
    lock.release();
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
      install(parseInstallCodexHome(args));
      return;
    case "uninstall":
      if (args.length) throw new Error("uninstall accepts no arguments");
      uninstall();
      return;
    case "status":
      if (args.length) throw new Error("status accepts no arguments");
      status();
      return;
    case "scan":
      if (args.length) throw new Error("scan accepts no arguments");
      scan();
      return;
    case "run":
      if (args.length) throw new Error("run accepts no arguments");
      await runOnce();
      return;
    default:
      throw new Error("expected install, uninstall, status, scan, or run");
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
