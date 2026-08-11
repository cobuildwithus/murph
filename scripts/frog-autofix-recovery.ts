import {
  FROG_AUTOFIX_REPOSITORY,
  classifyWorkerMode,
  type BranchPullRequestState,
  type FrogAutofixWorkerMode,
} from "./frog-autofix-lib.ts";

interface CommandResult {
  status: number;
  stdout: string;
}

export interface RecoveryCommandAdapter {
  require: (command: string, args: string[], cwd: string) => string;
  run: (command: string, args: string[], cwd: string) => CommandResult;
}

interface BranchPullRequestRecord {
  baseRefName: string;
  body: string;
  headRefName: string;
  headRefOid: string;
  number: number;
  state: "CLOSED" | "MERGED" | "OPEN";
}

function issueClosingKeywordPresent(body: string, issueNumber: number): boolean {
  const relationship = new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+`
      + `(?:${FROG_AUTOFIX_REPOSITORY.replace("/", "\\/")})?#${issueNumber}\\b`,
    "iu",
  );
  return relationship.test(body);
}

function parseBranchPullRequests(
  raw: string,
  branch: string,
): BranchPullRequestRecord[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length >= 100) {
    throw new Error("GitHub returned an invalid or unbounded pull request list");
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("GitHub returned an invalid pull request record");
    }
    const record = entry as Partial<BranchPullRequestRecord>;
    if (
      !Number.isSafeInteger(record.number)
      || Number(record.number) <= 0
      || !["CLOSED", "MERGED", "OPEN"].includes(record.state ?? "")
      || record.headRefName !== branch
      || record.baseRefName !== "main"
      || typeof record.headRefOid !== "string"
      || !/^[0-9a-f]{40}$/u.test(record.headRefOid)
      || typeof record.body !== "string"
    ) {
      throw new Error("GitHub returned an invalid pull request record");
    }
    return record as BranchPullRequestRecord;
  });
}

function branchPullRequests(
  root: string,
  branch: string,
  commands: RecoveryCommandAdapter,
): BranchPullRequestRecord[] {
  return parseBranchPullRequests(
    commands.require(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        FROG_AUTOFIX_REPOSITORY,
        "--state",
        "all",
        "--head",
        branch,
        "--limit",
        "100",
        "--json",
        "number,state,headRefName,baseRefName,headRefOid,body",
      ],
      root,
    ),
    branch,
  );
}

function synchronizeRemoteIssueBranch(
  worktree: string,
  branch: string,
  commands: RecoveryCommandAdapter,
) {
  const remoteLookup = commands.run(
    "git",
    ["ls-remote", "--exit-code", "--heads", "origin", branch],
    worktree,
  );
  if (remoteLookup.status === 2) return;
  if (remoteLookup.status !== 0) {
    throw new Error(`git failed with status ${remoteLookup.status}`);
  }
  commands.require(
    "git",
    [
      "fetch",
      "--quiet",
      "origin",
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ],
    worktree,
  );
  const localHead = commands.require("git", ["rev-parse", "HEAD"], worktree);
  const remoteHead = commands.require(
    "git",
    ["rev-parse", `origin/${branch}`],
    worktree,
  );
  if (localHead === remoteHead) return;
  if (
    commands.run(
      "git",
      ["merge-base", "--is-ancestor", localHead, remoteHead],
      worktree,
    ).status === 0
  ) {
    commands.require("git", ["merge", "--ff-only", `origin/${branch}`], worktree);
    return;
  }
  if (
    commands.run(
      "git",
      ["merge-base", "--is-ancestor", remoteHead, localHead],
      worktree,
    ).status === 0
  ) {
    return;
  }
  throw new Error("local and remote issue branches have diverged");
}

function parseCommitCount(raw: string): number {
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("git returned an invalid commit count");
  }
  return count;
}

export function resolveWorkerMode(
  worktree: string,
  branch: string,
  issueNumber: number,
  commands: RecoveryCommandAdapter,
): FrogAutofixWorkerMode {
  if (commands.require("git", ["status", "--porcelain"], worktree)) {
    throw new Error("issue worktree is not clean");
  }
  if (
    commands.require(
      "git",
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      worktree,
    ) !== branch
  ) {
    throw new Error("issue worktree branch does not match its deterministic owner");
  }
  commands.require("git", ["fetch", "--quiet", "origin", "main"], worktree);
  synchronizeRemoteIssueBranch(worktree, branch, commands);

  const pullRequests = branchPullRequests(worktree, branch, commands);
  if (pullRequests.length === 0) {
    const beforeAdvance = commands.require("git", ["rev-parse", "HEAD"], worktree);
    const main = commands.require("git", ["rev-parse", "origin/main"], worktree);
    const ahead = parseCommitCount(commands.require(
      "git",
      ["rev-list", "--count", "origin/main..HEAD"],
      worktree,
    ));
    if (ahead === 0 && beforeAdvance !== main) {
      if (
        commands.run(
          "git",
          ["merge-base", "--is-ancestor", beforeAdvance, main],
          worktree,
        ).status !== 0
      ) {
        throw new Error("fresh issue branch cannot fast-forward to origin/main");
      }
      commands.require("git", ["merge", "--ff-only", "origin/main"], worktree);
    }
  }

  const localHead = commands.require("git", ["rev-parse", "HEAD"], worktree);
  const aheadCommitCount = parseCommitCount(commands.require(
    "git",
    ["rev-list", "--count", "origin/main..HEAD"],
    worktree,
  ));
  const states: BranchPullRequestState[] = pullRequests.map((pullRequest) => {
    const ancestry = commands.run(
      "git",
      ["merge-base", "--is-ancestor", pullRequest.headRefOid, localHead],
      worktree,
    );
    if (![0, 1].includes(ancestry.status)) {
      throw new Error(`git failed with status ${ancestry.status}`);
    }
    return {
      closesIssue: issueClosingKeywordPresent(pullRequest.body, issueNumber),
      headIsAncestorOfLocal: ancestry.status === 0,
      headMatchesLocal: pullRequest.headRefOid === localHead,
      state: pullRequest.state,
    };
  });
  const mode = classifyWorkerMode(states, aheadCommitCount);
  if (!mode) throw new Error("issue branch or pull request recovery state is ambiguous");
  if (commands.require("git", ["status", "--porcelain"], worktree)) {
    throw new Error("issue worktree changed during recovery classification");
  }
  return mode;
}

export function branchHasMergedPullRequest(
  root: string,
  branch: string,
  issueNumber: number,
  commands: RecoveryCommandAdapter,
): boolean {
  const pullRequests = branchPullRequests(root, branch, commands);
  const localBranchHead = commands.require(
    "git",
    ["rev-parse", `refs/heads/${branch}`],
    root,
  );
  return pullRequests.length === 1
    && pullRequests[0]?.state === "MERGED"
    && pullRequests[0].headRefOid === localBranchHead
    && issueClosingKeywordPresent(pullRequests[0].body, issueNumber);
}
