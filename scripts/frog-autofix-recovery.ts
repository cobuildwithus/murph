import { homedir, userInfo } from "node:os";
import path from "node:path";

import {
  FROG_AUTOFIX_REPOSITORY,
  classifyWorkerMode,
  hasParentOwnedPullRequestBody,
  isParentOwnedPullRequest,
  parseAuthenticatedGitHubOperator,
  type BranchPullRequestState,
  type FrogAutofixWorkerMode,
  type PullRequestAuthorityRecord,
} from "./frog-autofix-lib.ts";
import {
  FROG_AUTOFIX_PR_BODY_PATH,
  extractFirstReviewedHead,
  readBoundedParentFile,
  validatePullRequestBody,
} from "./frog-autofix-parent.ts";

interface CommandResult {
  status: number;
  stdout: string;
}

export interface RecoveryCommandAdapter {
  authenticatedOperator: (cwd: string) => string;
  require: (command: string, args: string[], cwd: string) => string;
  run: (command: string, args: string[], cwd: string) => CommandResult;
}

export interface BranchPullRequestRecord extends PullRequestAuthorityRecord {
  body: string;
  headRefOid: string;
  isDraft: boolean;
  number: number;
  state: "CLOSED" | "MERGED" | "OPEN";
}

export function branchOpenPullRequest(
  root: string,
  branch: string,
  issueNumber: number,
  commands: RecoveryCommandAdapter,
): BranchPullRequestRecord | null {
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("invalid Frog issue number");
  }
  const pullRequests = branchPullRequests(root, branch, commands);
  if (
    pullRequests.length !== 1
    || pullRequests[0]?.state !== "OPEN"
  ) return null;
  return pullRequests[0];
}

export function parseBranchPullRequestPages(
  raw: string,
  branch: string,
  authenticatedOperator: string,
): BranchPullRequestRecord[] {
  const pages: unknown = JSON.parse(raw);
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("GitHub returned an invalid pull request page list");
  }
  let expectedTotal: number | null = null;
  const entries: unknown[] = [];
  for (const [index, pageEntry] of pages.entries()) {
    const page = pageEntry as {
      data?: {
        repository?: {
          pullRequests?: {
            nodes?: unknown;
            pageInfo?: { endCursor?: unknown; hasNextPage?: unknown };
            totalCount?: unknown;
          };
        };
      };
    };
    const connection = page?.data?.repository?.pullRequests;
    if (
      !connection
      || !Array.isArray(connection.nodes)
      || connection.nodes.length > 100
      || !Number.isSafeInteger(connection.totalCount)
      || Number(connection.totalCount) < 0
      || typeof connection.pageInfo?.hasNextPage !== "boolean"
      || (connection.pageInfo.hasNextPage
        && (typeof connection.pageInfo.endCursor !== "string"
          || !connection.pageInfo.endCursor))
      || (index < pages.length - 1) !== connection.pageInfo.hasNextPage
    ) {
      throw new Error("GitHub returned an invalid pull request page");
    }
    if (expectedTotal === null) expectedTotal = Number(connection.totalCount);
    if (connection.totalCount !== expectedTotal) {
      throw new Error("GitHub pull request pagination changed during traversal");
    }
    entries.push(...connection.nodes);
  }
  if (entries.length !== expectedTotal) {
    throw new Error("GitHub returned an incomplete pull request traversal");
  }
  const parsedRecords = entries.map((entry) => {
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
      || typeof record.isCrossRepository !== "boolean"
      || typeof record.isDraft !== "boolean"
      || (record.lastEditedAt !== null
        && (typeof record.lastEditedAt !== "string"
          || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(record.lastEditedAt)))
      || (record.author !== null
        && (typeof record.author !== "object"
          || typeof record.author.login !== "string"))
      || (record.editor !== null
        && (typeof record.editor !== "object"
          || typeof record.editor.login !== "string"))
      || (record.headRepositoryOwner !== null
        && (typeof record.headRepositoryOwner !== "object"
          || typeof record.headRepositoryOwner.login !== "string"))
    ) {
      throw new Error("GitHub returned an invalid pull request record");
    }
    return record as BranchPullRequestRecord;
  });
  if (
    new Set(parsedRecords.map((record) => record.number)).size
      !== parsedRecords.length
  ) {
    throw new Error("GitHub returned duplicate pull requests during pagination");
  }
  const records = parsedRecords.filter((record) => isParentOwnedPullRequest(
    record,
    authenticatedOperator,
    branch,
  ));
  if (records.length > 1) {
    throw new Error("GitHub returned ambiguous parent-owned pull request history");
  }
  return records;
}

const pullRequestPaginationQuery = `query(
  $owner: String!,
  $name: String!,
  $head: String!,
  $endCursor: String
) {
  repository(owner: $owner, name: $name) {
    pullRequests(
      baseRefName: "main",
      headRefName: $head,
      states: [OPEN, CLOSED, MERGED],
      first: 100,
      after: $endCursor
    ) {
      nodes {
        author { login }
        baseRefName
        body
        editor { login }
        headRefName
        headRefOid
        headRepositoryOwner { login }
        isCrossRepository
        isDraft
        lastEditedAt
        number
        state
      }
      pageInfo { endCursor hasNextPage }
      totalCount
    }
  }
}`;

export function branchPullRequests(
  root: string,
  branch: string,
  commands: RecoveryCommandAdapter,
): BranchPullRequestRecord[] {
  const [owner, name] = FROG_AUTOFIX_REPOSITORY.split("/");
  if (!owner || !name) throw new Error("invalid Frog autofix repository");
  const authenticatedOperator = parseAuthenticatedGitHubOperator(
    commands.authenticatedOperator(root),
  );
  return parseBranchPullRequestPages(
    commands.require(
      "gh",
      [
        "api",
        "graphql",
        "--paginate",
        "--slurp",
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
        "-F",
        `head=${branch}`,
        "-f",
        `query=${pullRequestPaginationQuery}`,
      ],
      root,
    ),
    branch,
    authenticatedOperator,
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

function remoteTrackingBranchExists(
  worktree: string,
  branch: string,
  commands: RecoveryCommandAdapter,
): boolean {
  const result = commands.run(
    "git",
    [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${branch}`,
    ],
    worktree,
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`git failed with status ${result.status}`);
}

function requireExactParentLocalPullRequestBody(
  worktree: string,
  issueNumber: number,
  localHead: string,
) {
  try {
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
    if (extractFirstReviewedHead(body) !== localHead) {
      throw new Error("parent-local PR body is not bound to the exact head");
    }
  } catch {
    throw new Error(
      "remote issue branch lacks exact parent-local PR-body provenance",
    );
  }
}

export function resolveWorkerMode(
  worktree: string,
  branch: string,
  issueNumber: number,
  commands: RecoveryCommandAdapter,
): FrogAutofixWorkerMode {
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

  const dirty = Boolean(commands.require("git", ["status", "--porcelain"], worktree));
  let preserveBoundDirtyState = false;
  if (dirty) {
    const pullRequests = branchPullRequests(worktree, branch, commands);
    const remoteLookup = commands.run(
      "git",
      ["ls-remote", "--exit-code", "--heads", "origin", branch],
      worktree,
    );
    const localHead = commands.require("git", ["rev-parse", "HEAD"], worktree);
    const main = commands.require("git", ["rev-parse", "origin/main"], worktree);
    const ahead = parseCommitCount(commands.require(
      "git",
      ["rev-list", "--count", "origin/main..HEAD"],
      worktree,
    ));
    const exactOpenPullRequest = pullRequests.length === 1
      && pullRequests[0]?.state === "OPEN"
      && pullRequests[0].headRefOid === localHead;
    preserveBoundDirtyState = Boolean(
      exactOpenPullRequest
      && remoteLookup.status === 0
      && ahead > 0,
    );
    if (
      !preserveBoundDirtyState
      && (
        pullRequests.length !== 0
        || remoteLookup.status !== 2
        || ahead !== 0
        || commands.run(
        "git",
        ["merge-base", "--is-ancestor", localHead, main],
        worktree,
        ).status !== 0
      )
    ) {
      throw new Error("dirty issue worktree has ambiguous recovery state");
    }
    if (!preserveBoundDirtyState) {
      commands.require("git", ["reset", "--hard", "origin/main"], worktree);
      commands.require("git", ["clean", "-ffdx"], worktree);
      if (commands.require("git", ["status", "--porcelain"], worktree)) {
        throw new Error("interrupted issue worktree did not recover cleanly");
      }
    }
  }
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
    const remoteLookup = commands.run(
      "git",
      ["ls-remote", "--exit-code", "--heads", "origin", branch],
      worktree,
    );
    if (ahead === 0 && remoteLookup.status === 2) {
      if (
        commands.run(
          "git",
          ["merge-base", "--is-ancestor", beforeAdvance, main],
          worktree,
        ).status !== 0
      ) {
        throw new Error("fresh issue branch cannot reset to origin/main");
      }
      commands.require("git", ["reset", "--hard", "origin/main"], worktree);
      commands.require("git", ["clean", "-ffdx"], worktree);
    } else if (![0, 2].includes(remoteLookup.status)) {
      throw new Error(`git failed with status ${remoteLookup.status}`);
    }
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
      if (remoteLookup.status === 0) {
        commands.require("git", ["merge", "--ff-only", "origin/main"], worktree);
      }
    }
  }

  const localHead = commands.require("git", ["rev-parse", "HEAD"], worktree);
  const aheadCommitCount = parseCommitCount(commands.require(
    "git",
    ["rev-list", "--count", "origin/main..HEAD"],
    worktree,
  ));
  if (
    pullRequests.length === 0
    && aheadCommitCount > 0
    && remoteTrackingBranchExists(worktree, branch, commands)
  ) {
    requireExactParentLocalPullRequestBody(
      worktree,
      issueNumber,
      localHead,
    );
  }
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
      headIsAncestorOfLocal: ancestry.status === 0,
      headMatchesLocal: pullRequest.headRefOid === localHead,
      state: pullRequest.state,
    };
  });
  const mode = classifyWorkerMode(states, aheadCommitCount);
  if (!mode) throw new Error("issue branch or pull request recovery state is ambiguous");
  if (
    commands.require("git", ["status", "--porcelain"], worktree)
    && !(preserveBoundDirtyState && mode === "resume")
  ) {
    throw new Error("issue worktree changed during recovery classification");
  }
  return mode;
}

export function branchHasMergedPullRequest(
  root: string,
  branch: string,
  issueNumber: number,
  commands: RecoveryCommandAdapter,
  expected?: { head: string; pullRequest: number },
): boolean {
  const pullRequests = branchPullRequests(root, branch, commands);
  const operator = parseAuthenticatedGitHubOperator(
    commands.authenticatedOperator(root),
  );
  const localBranchHead = commands.require(
    "git",
    ["rev-parse", `refs/heads/${branch}`],
    root,
  );
  return pullRequests.length === 1
    && pullRequests[0]?.state === "MERGED"
    && pullRequests[0].headRefOid === localBranchHead
    && isParentOwnedPullRequest(pullRequests[0], operator, branch)
    && (!expected || (
      pullRequests[0].number === expected.pullRequest
      && pullRequests[0].headRefOid === expected.head
    ));
}
