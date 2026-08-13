import {
  existsSync,
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
import { createHash } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  FROG_AUTOFIX_BOT,
  FROG_AUTOFIX_INTERVAL_SECONDS,
  authorityChangedPaths,
  buildCodexWorkerArguments,
  classifyWorkerMode,
  eligibleFrogIssues,
  hasParentOwnedPullRequestBody,
  isTrustedFrogIssue,
  localAgentOnlyChange,
  normalizeGitHubRepository,
  parseAuthenticatedGitHubOperator,
  parseEventLog,
  renderRepairPlanContent,
  renderInstalledLauncher,
  renderLaunchAgentPlist,
  renderWorkerPrompt,
  reviewOutcome,
  reviewEvidenceIsValid,
  reviewRequiresHumanHandoff,
  safeFailureMessage,
  superviseOwnedWorker,
} from "./frog-autofix-lib.ts";
import {
  acquireRunLock,
  applyImplementationPatch,
  assertExpectedPullRequestBody,
  bodyHasExactReviewPass,
  bodyHandoff,
  bodyHandoffRecord,
  bodyWithParentMetadata,
  carriedForwardBodyHandoff,
  closedPullRequestForHandoff,
  closedPullRequestHandoffBody,
  completedHandoffIssueNumbers,
  committedFrictionTask,
  committedFrictionTaskMatches,
  createEmptyRepairHandoffCommit,
  discoverEligibleIssues,
  expectedPullRequestBodyDisposition,
  materializeCommittedFrictionTask,
  mergedIssueClosureAction,
  mergedPullRequestForClosure,
  primaryAdvanceRequiresRestart,
  recoverablePullRequestBody,
  recoveredReviewHandoffBody,
  requiredCheckWatchHandoff,
  requireImplementationCompletion,
  requiredPullRequestCheckState,
  renderTerminalRepairHandoffBody,
  resolveReviewBaselineState,
  reusableRepairPhase,
  restoreRecoveredHandoffBeforeWorktreeRecovery,
  TerminalPrePullRequestFailure,
  terminalWorkerFailureClass,
  trustedReviewControlPaths,
} from "./frog-autofix.ts";
import {
  branchHasMergedPullRequest,
  branchOpenPullRequest,
  branchPullRequests,
  parseBranchPullRequestPages,
  resolveWorkerMode,
  type BranchPullRequestRecord,
} from "./frog-autofix-recovery.ts";
import {
  finalizeReadyRepair,
  type ReadyRepairFinalizationDependencies,
} from "./frog-autofix-finalize.ts";
import {
  FROG_AUTOFIX_PR_BODY_PATH,
  extractFrogTaskIdentity,
  extractFirstReviewedHead,
  extractSingleConversationUrl,
  extractTerminalPrePullRequestFailure,
  publishDraftRepair,
  renderImplementationPrompt,
  renderRecoveredPullRequestBody,
  validatePatchText,
  validatePullRequestBody,
} from "./frog-autofix-parent.ts";

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
const authenticatedOperator = "automation-operator";
const authoritativeBodySha256 = "d".repeat(64);
const taskIdentity = {
  path: ".agents/friction-log/selected/friction.md",
  sha256: "f".repeat(64),
};
const pullRequestAuthority = (branch: string) => ({
  author: { login: authenticatedOperator },
  baseRefName: "main",
  editor: { login: authenticatedOperator },
  headRefName: branch,
  headRepositoryOwner: { login: "cobuildwithus" },
  isCrossRepository: false,
  lastEditedAt: "2026-08-11T12:00:00Z",
  mergedAt: null,
});
const pullRequestPages = (
  records: readonly object[],
  pageSize = 100,
): string => {
  const chunks = records.length === 0
    ? [[]]
    : Array.from(
      { length: Math.ceil(records.length / pageSize) },
      (_, index) => records.slice(index * pageSize, (index + 1) * pageSize),
    );
  return JSON.stringify(chunks.map((nodes, index) => ({
    data: {
      repository: {
        pullRequests: {
          nodes,
          pageInfo: {
            endCursor: index < chunks.length - 1 ? `cursor-${index + 1}` : null,
            hasNextPage: index < chunks.length - 1,
          },
          totalCount: records.length,
        },
      },
    },
  })));
};

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

  it("accepts only valid authenticated GitHub operator identities", () => {
    expect(parseAuthenticatedGitHubOperator(` ${authenticatedOperator}\n`))
      .toBe(authenticatedOperator);
    expect(() => parseAuthenticatedGitHubOperator("operator/name")).toThrow();
    expect(() => parseAuthenticatedGitHubOperator("")).toThrow();
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

  it("uses the production GitHub GraphQL App author representation exactly", () => {
    expect(isTrustedFrogIssue({
      author: { login: "app/murph-frog-reconciliation" },
      labels: [{ name: "enhancement" }],
      number: 42,
      state: "OPEN",
    })).toBe(true);
    expect(isTrustedFrogIssue({
      author: { login: "murph-frog-reconciliation[bot]" },
      labels: [{ name: "enhancement" }],
      number: 42,
      state: "OPEN",
    })).toBe(false);
  });

  it("accepts only parent-bound ReviewGPT outcomes and model evidence", () => {
    const head = "a".repeat(40);
    const response = `Issue #42\nReviewed ${head.slice(0, 12)}\nROUND_OUTCOME: PASS\nREVIEW_COMPLETE\n`;
    const hash = createHash("sha256").update(response).digest("hex");
    const modelVerification = JSON.stringify({
      requestedModel: "gpt-5.6-sol",
      responseModelSlug: "gpt-5-6-pro",
      responseSha256: hash,
      schemaVersion: 1,
    });
    expect(reviewEvidenceIsValid({
      expectedHash: hash,
      head,
      issueNumber: 42,
      kind: "final",
      modelVerification,
      response,
    })).toBe(true);
    expect(reviewEvidenceIsValid({
      expectedHash: "0".repeat(64),
      head,
      issueNumber: 42,
      kind: "final",
      modelVerification,
      response,
    })).toBe(false);
    expect(reviewOutcome(response, "final")).toBe("pass");
    expect(reviewOutcome(
      "SPECIALIST_OUTCOME: FINDINGS\nSPECIALIST_REVIEW_COMPLETE\n",
      "specialist",
    )).toBe("findings");
    const retrospective = `Issue #42\nReviewed ${head.slice(0, 12)}\nROUND_OUTCOME: RETROSPECTIVE_REQUIRED\nREVIEW_COMPLETE\n`;
    const retrospectiveHash = createHash("sha256").update(retrospective).digest("hex");
    const retrospectiveVerification = JSON.stringify({
      requestedModel: "gpt-5.6-sol",
      responseModelSlug: "gpt-5-6-pro",
      responseSha256: retrospectiveHash,
      schemaVersion: 1,
    });
    const retrospectiveOutcome = reviewOutcome(retrospective, "final");
    expect(retrospectiveOutcome).toBe("retrospective-required");
    if (retrospectiveOutcome === "invalid") {
      throw new Error("expected a verified retrospective outcome");
    }
    expect(reviewRequiresHumanHandoff(retrospectiveOutcome)).toBe(true);
    expect(reviewEvidenceIsValid({
      expectedHash: retrospectiveHash,
      head,
      issueNumber: 42,
      kind: "final",
      modelVerification: retrospectiveVerification,
      response: retrospective,
    })).toBe(true);
    expect(reviewOutcome(
      "SPECIALIST_OUTCOME: RETROSPECTIVE_REQUIRED\nSPECIALIST_REVIEW_COMPLETE\n",
      "specialist",
    )).toBe("invalid");
    expect(reviewOutcome("ROUND_OUTCOME: PASS\n", "final")).toBe("invalid");
  });

  it("keeps every ReviewGPT preset in the trusted parent control inventory", () => {
    expect(trustedReviewControlPaths).toContain("scripts/chatgpt-review-presets");
    const root = mkdtempSync(path.join(tmpdir(), "frog-review-controls-"));
    const presetDirectory = path.join(root, "scripts", "chatgpt-review-presets");
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      if (result.status !== 0) {
        throw new Error(`git command failed: ${args[0] ?? "unknown"}`);
      }
      return result.stdout;
    };
    try {
      mkdirSync(presetDirectory, { recursive: true });
      writeFileSync(path.join(presetDirectory, "pr-deep-review.md"), "trusted\n");
      git("init", "--quiet");
      git("config", "user.name", "Automation");
      git("config", "user.email", "automation@example.invalid");
      git("add", ".");
      git("commit", "--quiet", "-m", "base");
      const base = git("rev-parse", "HEAD").trim();
      writeFileSync(path.join(presetDirectory, "pr-deep-review.md"), "candidate\n");
      git("add", ".");
      git("commit", "--quiet", "-m", "candidate");
      const head = git("rev-parse", "HEAD").trim();
      expect(spawnSync(
        "git",
        ["diff", "--quiet", base, head, "--", ...trustedReviewControlPaths],
        { cwd: root },
      ).status).toBe(1);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
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
      authenticatedOperator: () => authenticatedOperator,
      assertRepository: () => undefined,
      bindingCount: (_root: string, issueNumber: number) => {
        bindingCalls.push(issueNumber);
        if (issueNumber === 10) return 0;
        return issueNumber === 11 ? 2 : 1;
      },
      fetchDefaultBranch: () => undefined,
      listOpenIssues: () => JSON.stringify(issues),
      listIssuePullRequests: () => [],
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

  it("advances past exact human handoffs without trusting stale markers", () => {
    const firstHead = "a".repeat(40);
    const secondHead = "b".repeat(40);
    const openPullRequests: BranchPullRequestRecord[] = [
      {
        ...pullRequestAuthority("agent/frog-autofix-9"),
        body: `Frog autofix issue: #9\n\nFrog autofix handoff: review-findings at ${firstHead}\n`,
        headRefOid: firstHead,
        isDraft: true,
        number: 90,
        state: "OPEN",
      },
      {
        ...pullRequestAuthority("agent/frog-autofix-10"),
        body: `Frog autofix issue: #10\n\nFrog autofix handoff: product-runtime at ${secondHead}\n`,
        headRefOid: secondHead,
        isDraft: false,
        number: 100,
        state: "OPEN",
      },
      {
        ...pullRequestAuthority("agent/frog-autofix-11"),
        body: `Frog autofix issue: #11\n\nFrog autofix handoff: product-runtime at ${secondHead}\n`,
        headRefOid: secondHead,
        isDraft: true,
        number: 110,
        state: "CLOSED",
      },
      {
        ...pullRequestAuthority("agent/frog-autofix-12"),
        body: `Frog autofix issue: #12\n\nFrog autofix handoff: review-findings at ${firstHead}\n`,
        headRefOid: secondHead,
        isDraft: true,
        number: 120,
        state: "OPEN",
      },
      {
        ...pullRequestAuthority("agent/frog-autofix-13"),
        author: { login: "different-operator" },
        body: `Frog autofix issue: #13\n\nFrog autofix handoff: review-findings at ${secondHead}\n`,
        headRefOid: secondHead,
        isDraft: true,
        number: 130,
        state: "OPEN",
      },
      {
        ...pullRequestAuthority("agent/frog-autofix-14"),
        body: `Frog autofix issue: #14\n\nFrog autofix handoff: review-findings at ${secondHead}\n`,
        headRefOid: secondHead,
        headRepositoryOwner: { login: "foreign-owner" },
        isCrossRepository: true,
        isDraft: true,
        number: 140,
        state: "OPEN",
      },
      {
        ...pullRequestAuthority("agent/frog-autofix-15"),
        body: `Frog autofix issue: #15\n\nFrog autofix handoff: review-findings at ${secondHead}\n`,
        editor: { login: "different-operator" },
        headRefOid: secondHead,
        isDraft: true,
        number: 150,
        state: "OPEN",
      },
      {
        ...pullRequestAuthority("agent/frog-autofix-16"),
        body: `Frog autofix issue: #16\n\nFrog autofix handoff: review-findings at ${secondHead}\n`,
        editor: { login: "different-operator" },
        headRefOid: secondHead,
        isDraft: true,
        number: 160,
        state: "CLOSED",
      },
      {
        ...pullRequestAuthority("agent/frog-autofix-17"),
        body: "Foreign presentation after merge",
        editor: { login: "different-operator" },
        headRefOid: secondHead,
        isDraft: false,
        number: 170,
        state: "MERGED",
      },
    ];
    expect([...completedHandoffIssueNumbers(openPullRequests, authenticatedOperator)])
      .toEqual([9, 10, 11]);
    expect(hasParentOwnedPullRequestBody(openPullRequests[0], authenticatedOperator))
      .toBe(true);
    expect(hasParentOwnedPullRequestBody(openPullRequests[6], authenticatedOperator))
      .toBe(false);

    const issues = [
      trustedIssue(9),
      trustedIssue(10),
      trustedIssue(11),
      trustedIssue(12),
      trustedIssue(17),
    ];
    expect(discoverEligibleIssues("<ROOT>", {
      authenticatedOperator: () => authenticatedOperator,
      assertRepository: () => undefined,
      bindingCount: () => 1,
      fetchDefaultBranch: () => undefined,
      listOpenIssues: () => JSON.stringify(issues),
      listIssuePullRequests: (_root, issueNumber) => openPullRequests.filter(
        (record) => record.headRefName === `agent/frog-autofix-${issueNumber}`,
      ),
    }).map((issue) => issue.number)).toEqual([12, 17]);
  });

  it("replaces child-authored review metadata with exact parent state", () => {
    const head = "c".repeat(40);
    const body = bodyWithParentMetadata(
      `Frog autofix issue: #42\nFrog autofix final review: PASS at ${"0".repeat(40)}\n`,
      {
        firstHead: head,
        handoff: "review-findings",
        handoffHead: head,
        specialistHead: head,
      },
    );
    expect(body.match(/^ReviewGPT first-reviewed head:/gmu)).toHaveLength(1);
    expect(bodyHasExactReviewPass(body, "specialist", head)).toBe(true);
    expect(bodyHasExactReviewPass(body, "final", head)).toBe(false);
    expect(bodyHandoff(body, head)).toBe("review-findings");
    expect(bodyHandoffRecord(body)).toEqual({
      head,
      kind: "review-findings",
    });
    const amendedHead = "d".repeat(40);
    expect(carriedForwardBodyHandoff(body, amendedHead, () => true))
      .toBe("review-findings");
    expect(() => carriedForwardBodyHandoff(body, amendedHead, () => false))
      .toThrow("not an ancestor");
    const restamped = bodyWithParentMetadata(body, {
      firstHead: head,
      handoff: bodyHandoffRecord(body)?.kind,
      handoffHead: amendedHead,
    });
    expect(bodyHandoff(restamped, amendedHead)).toBe("review-findings");
    expect(body).not.toContain("0".repeat(40));
    expect(() => bodyHandoff(
      `${body}Frog autofix handoff: product-runtime at ${head}\n`,
      head,
    )).toThrow("ambiguous Frog handoff metadata");

    const branch = "agent/frog-autofix-42";
    const forged = {
      ...pullRequestAuthority(branch),
      body: [
        "Frog autofix issue: #42",
        `ReviewGPT first-reviewed head: ${head}`,
        `Frog autofix specialist review: PASS at ${head}`,
        `Frog autofix final review: PASS at ${head}`,
        `Frog autofix handoff: review-findings at ${head}`,
      ].join("\n"),
      editor: { login: "different-operator" },
      headRefOid: head,
      isDraft: true,
      number: 42,
      state: "OPEN" as const,
    };
    expect(bodyHasExactReviewPass(forged.body, "final", head)).toBe(true);
    expect(hasParentOwnedPullRequestBody(forged, authenticatedOperator))
      .toBe(false);
    expect(completedHandoffIssueNumbers([forged], authenticatedOperator).size)
      .toBe(0);
    const forgedClosed = { ...forged, state: "CLOSED" as const };
    expect(closedPullRequestForHandoff([forgedClosed])).toBe(forgedClosed);
    const closedHandoffBody = closedPullRequestHandoffBody(forgedClosed, 42);
    expect(closedHandoffBody).not.toContain("Frog autofix final review: PASS");
    expect(bodyHandoff(closedHandoffBody, head)).toBe("review-findings");
    const neverEdited = {
      ...forged,
      body: "Frog autofix issue: #42",
      editor: null,
      lastEditedAt: null,
    };
    expect(hasParentOwnedPullRequestBody(neverEdited, authenticatedOperator))
      .toBe(true);
    const neverEditedByForeign = {
      ...forged,
      author: { login: "different-operator" },
      editor: null,
      lastEditedAt: null,
    };
    expect(hasParentOwnedPullRequestBody(
      neverEditedByForeign,
      authenticatedOperator,
    )).toBe(false);
    const recovered = renderRecoveredPullRequestBody(42);
    expect(recoverablePullRequestBody(forged, authenticatedOperator, null, 42))
      .toBe(recovered);
    expect(recoverablePullRequestBody(
      forged,
      authenticatedOperator,
      "trusted local body",
      42,
    )).toBe("trusted local body");
    expect(recovered).not.toContain("Frog autofix final review:");
    expect(recovered).not.toContain("Frog autofix handoff:");
    expect(() => validatePullRequestBody(recovered, 42, "<HOME>", "<USER>"))
      .not.toThrow();
  });

  it("round-trips only exact parent-owned task and terminal metadata", () => {
    const head = "a".repeat(40);
    const body = renderTerminalRepairHandoffBody({
      failure: "implementation-patch",
      head,
      issueNumber: 42,
      task: taskIdentity,
    });
    expect(extractFrogTaskIdentity(body)).toEqual(taskIdentity);
    expect(extractTerminalPrePullRequestFailure(body))
      .toBe("implementation-patch");
    expect(bodyHandoff(body, head)).toBe("review-findings");
    expect(() => validatePullRequestBody(body, 42, "<HOME>", "<USER>"))
      .not.toThrow();

    for (const malformed of [
      `${body}Frog autofix task path: ${taskIdentity.path}\n`,
      body.replace(taskIdentity.sha256, "not-a-digest"),
      `${body}Frog autofix terminal failure: worker-timeout\n`,
      body.replace("implementation-patch", "unknown-failure"),
    ]) {
      expect(() => validatePullRequestBody(malformed, 42, "<HOME>", "<USER>"))
        .toThrow();
    }

    const terminalHandoff = {
      ...pullRequestAuthority("agent/frog-autofix-42"),
      body,
      headRefOid: head,
      isDraft: true,
      number: 99,
      state: "OPEN" as const,
    };
    expect(completedHandoffIssueNumbers(
      [terminalHandoff],
      authenticatedOperator,
    )).toEqual(new Set([42]));
    expect(discoverEligibleIssues("<ROOT>", {
      authenticatedOperator: () => authenticatedOperator,
      assertRepository: () => undefined,
      bindingCount: () => 1,
      fetchDefaultBranch: () => undefined,
      listOpenIssues: () => JSON.stringify([trustedIssue(42), trustedIssue(43)]),
      listIssuePullRequests: (_root, issueNumber) => issueNumber === 42
        ? [terminalHandoff]
        : [],
    }).map((issue) => issue.number)).toEqual([43]);
  });

  it("preserves parent-local review ancestry and handoffs after a foreign body edit", () => {
    const root = mkdtempSync(path.join(tmpdir(), "frog-review-baseline-"));
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    try {
      git("init", "--quiet");
      git("config", "user.name", "Automation");
      git("config", "user.email", "automation@example.invalid");
      writeFileSync(path.join(root, "authority.txt"), "trusted\n");
      git("add", ".");
      git("commit", "--quiet", "-m", "trusted candidate");
      const trustedHead = git("rev-parse", "HEAD");
      writeFileSync(path.join(root, "authority.txt"), "foreign descendant\n");
      git("add", ".");
      git("commit", "--quiet", "-m", "foreign descendant");
      const descendantHead = git("rev-parse", "HEAD");
      const branch = "agent/frog-autofix-42";
      const localBody = bodyWithParentMetadata(
        renderRecoveredPullRequestBody(42),
        { firstHead: trustedHead },
      );
      const foreignEdited = {
        ...pullRequestAuthority(branch),
        body: bodyWithParentMetadata(renderRecoveredPullRequestBody(42), {
          firstHead: descendantHead,
        }),
        editor: { login: "different-operator" },
        headRefOid: descendantHead,
        isDraft: true,
        number: 99,
        state: "OPEN" as const,
      };

      expect(resolveReviewBaselineState(
        root,
        foreignEdited,
        authenticatedOperator,
        localBody,
        descendantHead,
      )).toEqual({
        firstHead: trustedHead,
        handoff: "review-findings",
        requiresHumanHandoff: true,
      });
      expect(resolveReviewBaselineState(
        root,
        { ...foreignEdited, headRefOid: trustedHead },
        authenticatedOperator,
        localBody,
        trustedHead,
      )).toEqual({
        firstHead: trustedHead,
        handoff: null,
        requiresHumanHandoff: false,
      });
      expect(resolveReviewBaselineState(
        root,
        foreignEdited,
        authenticatedOperator,
        renderRecoveredPullRequestBody(42),
        descendantHead,
      )).toEqual({
        handoff: "review-findings",
        requiresHumanHandoff: true,
      });
      expect(resolveReviewBaselineState(
        root,
        foreignEdited,
        authenticatedOperator,
        null,
        descendantHead,
      )).toEqual({
        handoff: "review-findings",
        requiresHumanHandoff: true,
      });
      expect(resolveReviewBaselineState(
        root,
        { ...foreignEdited, editor: { login: authenticatedOperator }, body: localBody },
        authenticatedOperator,
        null,
        descendantHead,
      )).toEqual({
        firstHead: trustedHead,
        handoff: "review-findings",
        requiresHumanHandoff: true,
      });
      expect(resolveReviewBaselineState(
        root,
        null,
        authenticatedOperator,
        null,
        descendantHead,
      )).toEqual({
        firstHead: descendantHead,
        handoff: null,
        requiresHumanHandoff: false,
      });
      expect(() => resolveReviewBaselineState(
        root,
        null,
        authenticatedOperator,
        localBody,
        descendantHead,
      )).toThrow("existing pull request changed during review recovery");

      const fixedHandoff = bodyWithParentMetadata(
        renderRecoveredPullRequestBody(42),
        { handoff: "review-findings", handoffHead: descendantHead },
      );
      expect(extractFirstReviewedHead(fixedHandoff)).toBeNull();
      expect(bodyHandoff(fixedHandoff, descendantHead)).toBe("review-findings");

      for (const kind of ["review-findings", "product-runtime"] as const) {
        const exactLocalHandoff = bodyWithParentMetadata(
          renderRecoveredPullRequestBody(42),
          {
            firstHead: trustedHead,
            handoff: kind,
            handoffHead: trustedHead,
          },
        );
        const exactState = resolveReviewBaselineState(
          root,
          { ...foreignEdited, headRefOid: trustedHead },
          authenticatedOperator,
          exactLocalHandoff,
          trustedHead,
        );
        expect(exactState).toEqual({
          firstHead: trustedHead,
          handoff: kind,
          requiresHumanHandoff: true,
        });
        const restamped = recoveredReviewHandoffBody({
          authenticatedOperator,
          currentHead: trustedHead,
          existing: { ...foreignEdited, headRefOid: trustedHead },
          recoveredExistingBody: exactLocalHandoff,
          worktree: root,
        });
        expect(restamped).not.toBeNull();
        const restoredPullRequest = {
          ...foreignEdited,
          body: restamped!,
          editor: { login: authenticatedOperator },
          headRefOid: trustedHead,
        };
        expect(completedHandoffIssueNumbers(
          [restoredPullRequest],
          authenticatedOperator,
        )).toEqual(new Set([42]));
      }

      const ancestorHandoff = bodyWithParentMetadata(
        renderRecoveredPullRequestBody(42),
        {
          firstHead: trustedHead,
          handoff: "product-runtime",
          handoffHead: trustedHead,
        },
      );
      expect(resolveReviewBaselineState(
        root,
        foreignEdited,
        authenticatedOperator,
        ancestorHandoff,
        descendantHead,
      )).toEqual({
        firstHead: trustedHead,
        handoff: "product-runtime",
        requiresHumanHandoff: true,
      });
      writeFileSync(path.join(root, "human-in-progress.txt"), "do not publish\n");
      const dirtyBefore = readFileSync(
        path.join(root, "human-in-progress.txt"),
        "utf8",
      );
      const ancestorRestamp = recoveredReviewHandoffBody({
        authenticatedOperator,
        currentHead: descendantHead,
        existing: foreignEdited,
        recoveredExistingBody: ancestorHandoff,
        worktree: root,
      });
      expect(ancestorRestamp).not.toBeNull();
      expect(bodyHandoff(ancestorRestamp!, descendantHead))
        .toBe("product-runtime");
      expect(readFileSync(path.join(root, "human-in-progress.txt"), "utf8"))
        .toBe(dirtyBefore);

      const exactPassBody = bodyWithParentMetadata(
        renderRecoveredPullRequestBody(42),
        {
          finalHead: trustedHead,
          firstHead: trustedHead,
          specialistHead: trustedHead,
        },
      );
      expect(resolveReviewBaselineState(
        root,
        {
          ...foreignEdited,
          body: exactPassBody,
          editor: { login: authenticatedOperator },
          headRefOid: trustedHead,
        },
        authenticatedOperator,
        null,
        trustedHead,
      )).toEqual({
        firstHead: trustedHead,
        handoff: null,
        requiresHumanHandoff: false,
      });
      expect(bodyHasExactReviewPass(exactPassBody, "specialist", trustedHead))
        .toBe(true);
      expect(bodyHasExactReviewPass(exactPassBody, "final", trustedHead))
        .toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("requires the exact parent-owned body before either canonical review", () => {
    const branch = "agent/frog-autofix-42";
    const head = "a".repeat(40);
    const expectedBody = bodyWithParentMetadata(
      renderRecoveredPullRequestBody(42),
      { firstHead: head },
    );
    const record = {
      ...pullRequestAuthority(branch),
      body: expectedBody,
      headRefOid: head,
      isDraft: true,
      number: 99,
      state: "OPEN" as const,
    };
    const assertRecord = (candidate: BranchPullRequestRecord | null) => (
      assertExpectedPullRequestBody({
        authenticatedOperator,
        branch,
        expectedBody,
        head,
        issueNumber: 42,
        pullRequest: 99,
        record: candidate,
      })
    );

    expect(() => assertRecord(record)).not.toThrow();
    expect(() => assertRecord({
      ...record,
      editor: { login: "different-operator" },
    })).toThrow("body authority changed before review");
    expect(() => assertRecord({
      ...record,
      body: expectedBody.replace("bounded local autofix", "foreign intent"),
    })).toThrow("body authority changed before review");
    expect(() => assertRecord({
      ...record,
      body: expectedBody.replace(
        "Frog autofix issue: #42",
        "Frog autofix issue: #43",
      ),
    })).toThrow("body authority changed before review");
    expect(() => assertRecord({ ...record, headRefOid: "b".repeat(40) }))
      .toThrow("body authority changed before review");
    const source = readFileSync(
      path.join(repositoryRoot, "scripts", "frog-autofix.ts"),
      "utf8",
    );
    const canonical = source.slice(
      source.indexOf("function runCanonicalPullRequestReview"),
      source.indexOf("function downloadImplementationPatch"),
    );
    expect(canonical.indexOf("assertExpectedPullRequestBody({"))
      .toBeLessThan(canonical.indexOf("prepareTrustedReviewCheckout("));
    expect(canonical.indexOf("assertExpectedPullRequestBody({"))
      .toBeLessThan(canonical.indexOf('requireCommand(\n      "pnpm"'));
    expect(canonical.lastIndexOf("expectedPullRequestBodyDisposition({"))
      .toBeGreaterThan(canonical.indexOf('requireCommand(\n      "pnpm"'));
  });

  it("preserves an authenticated operator handoff written during review", () => {
    const branch = "agent/frog-autofix-42";
    const head = "a".repeat(40);
    const expectedBody = bodyWithParentMetadata(
      renderRecoveredPullRequestBody(42),
      { firstHead: head },
    );
    const unchanged = {
      ...pullRequestAuthority(branch),
      body: expectedBody,
      headRefOid: head,
      isDraft: true,
      number: 99,
      state: "OPEN" as const,
    };
    expect(expectedPullRequestBodyDisposition({
      authenticatedOperator,
      branch,
      expectedBody,
      head,
      issueNumber: 42,
      pullRequest: 99,
      record: unchanged,
    })).toBe("unchanged");
    const handoffBody = bodyWithParentMetadata(expectedBody, {
      firstHead: head,
      handoff: "review-findings",
      handoffHead: head,
    });
    expect(expectedPullRequestBodyDisposition({
      authenticatedOperator,
      branch,
      expectedBody,
      head,
      issueNumber: 42,
      pullRequest: 99,
      record: { ...unchanged, body: handoffBody },
    })).toBe("operator-handoff");
    expect(() => expectedPullRequestBodyDisposition({
      authenticatedOperator,
      branch,
      expectedBody,
      head,
      issueNumber: 42,
      pullRequest: 99,
      record: {
        ...unchanged,
        body: handoffBody,
        editor: { login: "different-operator" },
      },
    })).toThrow("authority changed during review");
    expect(() => expectedPullRequestBodyDisposition({
      authenticatedOperator,
      branch,
      expectedBody,
      head,
      issueNumber: 42,
      pullRequest: 99,
      record: {
        ...unchanged,
        body: expectedBody.replace("bounded local autofix", "changed intent"),
      },
    })).toThrow("body changed during review");
  });

  it("returns recovered handoffs before tooling or child orchestration", () => {
    const source = readFileSync(
      path.join(repositoryRoot, "scripts", "frog-autofix.ts"),
      "utf8",
    );
    const runOnce = source.slice(source.indexOf("async function runOnce()"));
    const localNoPullRequestHandoff = runOnce.indexOf(
      'if (bodyHandoff(localBody, currentHead))',
    );
    expect(localNoPullRequestHandoff).toBeGreaterThanOrEqual(0);
    expect(localNoPullRequestHandoff)
      .toBeLessThan(runOnce.indexOf("const transientRoot"));
    const handoff = runOnce.indexOf("const recoveredHandoffBody =");
    expect(handoff).toBeGreaterThanOrEqual(0);
    expect(handoff).toBeLessThan(runOnce.indexOf("ensureWorkerTooling("));
    expect(handoff).toBeLessThan(runOnce.indexOf("runParentReview({"));
    expect(handoff).toBeLessThan(runOnce.indexOf("runEditOnlyCycle({"));
    const restamp = runOnce.slice(handoff, runOnce.indexOf("const transientRoot"));
    const early = runOnce.indexOf(
      "restoreRecoveredHandoffBeforeWorktreeRecovery(",
    );
    expect(early).toBeGreaterThanOrEqual(0);
    expect(early).toBeLessThan(runOnce.indexOf("prepareIssueWorktree("));
    expect(restamp).toContain(
      "!samePullRequestProjection(currentPullRequest, existingPullRequest)",
    );
    expect(restamp).not.toContain("!hasParentOwnedPullRequestBody(");
    expect(restamp.indexOf("!samePullRequestProjection"))
      .toBeLessThan(restamp.indexOf("updateParentPullRequestBody("));
    const terminalHandoff = source.slice(
      source.indexOf("function persistRepairHandoff"),
      source.indexOf("function persistClosedPullRequestHandoff"),
    );
    expect(terminalHandoff).toContain("firstHead: head");
    expect(terminalHandoff).toContain("handoffTree !== mainTree");
  });

  it("restamps foreign-edited exact and ancestor handoffs before worktree recovery", () => {
    const root = mkdtempSync(path.join(tmpdir(), "frog-early-handoff-"));
    const worktree = path.join(root, "repair");
    const branch = "agent/frog-autofix-42";
    mkdirSync(path.join(worktree, "audit-packages"), { recursive: true });
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: worktree, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    git("init", "--quiet");
    git("config", "user.name", "Automation");
    git("config", "user.email", "automation@example.invalid");
    writeFileSync(path.join(worktree, "base.txt"), "base\n");
    git("add", "base.txt");
    git("commit", "--quiet", "-m", "base");
    const trustedHead = git("rev-parse", "HEAD");
    writeFileSync(path.join(worktree, "base.txt"), "base\ndescendant\n");
    git("add", "base.txt");
    git("commit", "--quiet", "-m", "descendant");
    const descendantHead = git("rev-parse", "HEAD");
    const trusted = bodyWithParentMetadata(renderRecoveredPullRequestBody(42), {
      firstHead: trustedHead,
      handoff: "review-findings",
      handoffHead: trustedHead,
    });
    writeFileSync(path.join(worktree, FROG_AUTOFIX_PR_BODY_PATH), trusted);
    writeFileSync(path.join(worktree, "human-in-progress.txt"), "preserve me\n");
    const dirtyBefore = readFileSync(path.join(worktree, "human-in-progress.txt"));
    try {
      for (const currentHead of [trustedHead, descendantHead]) {
        const foreign = {
          ...pullRequestAuthority(branch),
          body: renderRecoveredPullRequestBody(42),
          editor: { login: "different-operator" },
          headRefOid: currentHead,
          isDraft: true,
          mergedAt: null,
          number: 99,
          state: "OPEN" as const,
        };
        let current = foreign;
        const events: string[] = [];
        expect(restoreRecoveredHandoffBeforeWorktreeRecovery(
          root,
          branch,
          42,
          {
            authenticatedOperator: () => authenticatedOperator,
            currentPullRequest: () => current,
            fetchRemoteBranch: () => {
              events.push("fetch");
            },
            findWorktree: () => worktree,
            refreshAndVerifyIssue: () => {
              events.push("verify");
            },
            restampBody: (_primary, _worktree, pullRequest, body) => {
              events.push("restamp");
              expect(pullRequest).toBe(99);
              current = {
                ...current,
                body,
                editor: { login: authenticatedOperator },
              };
            },
          },
        )).toBe(true);
        expect(events).toEqual(["fetch", "verify", "restamp"]);
        expect(bodyHandoff(current.body, currentHead)).toBe("review-findings");
        expect(readFileSync(path.join(worktree, "human-in-progress.txt")))
          .toEqual(dirtyBefore);
      }
      const source = readFileSync(
        path.join(repositoryRoot, "scripts", "frog-autofix.ts"),
        "utf8",
      );
      const early = source.slice(
        source.indexOf("export function restoreRecoveredHandoffBeforeWorktreeRecovery"),
        source.indexOf("function gitRefExists"),
      );
      for (const prohibited of [
        "prepareIssueWorktree(",
        "resolveWorkerMode(",
        "ensureWorkerTooling(",
        "runParentReview(",
        "runEditOnlyCycle(",
        '"reset"',
        '"clean"',
        '"push"',
      ]) expect(early).not.toContain(prohibited);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
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
    expect(wrapper).toContain("verify-permissions");
    expect(wrapper).toContain("/usr/bin/lockf -t 0");
    expect(wrapper).toContain("MURPH_FROG_AUTOFIX_NATIVE_LOCK_HELD=1");
    expect(wrapper).toContain('install|uninstall|run)');
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
    expect(implementation).toContain(
      "Frog autofix is currently running; install after it finishes",
    );
    expect(implementation).toContain(
      "mutating Frog autofix commands require the native launcher gate",
    );
    expect(implementation).toContain("String(process.ppid)");
    expect(implementation).toContain('["-t", "0", nativeGatePath, "/usr/bin/true"]');
    expect(implementation).not.toContain(
      "rmSync(supportRoot, { recursive: false })",
    );
  });

  it("admits only one real contender through the stable native acquisition gate", () => {
    if (process.platform !== "darwin") return;
    const root = mkdtempSync(path.join(tmpdir(), "frog-native-lock-"));
    const gate = path.join(root, "run.native.lock");
    try {
      const result = spawnSync("/bin/bash", [
        "-c",
        [
          '/usr/bin/lockf -t 0 "$1" /bin/sleep 1 &',
          "first=$!",
          '/usr/bin/lockf -t 0 "$1" /bin/sleep 1 &',
          "second=$!",
          "wait $first; first_status=$?",
          "wait $second; second_status=$?",
          'echo "$first_status $second_status"',
        ].join("\n"),
        "frog-native-lock-test",
        gate,
      ], { encoding: "utf8" });
      expect(result.status).toBe(0);
      const statuses = result.stdout.trim().split(" ").map(Number);
      expect(statuses.filter((status) => status === 0)).toHaveLength(1);
      expect(statuses.filter((status) => status !== 0)).toHaveLength(1);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("constructs the worker prompt from an issue number, not issue content", () => {
    const prompt = renderWorkerPrompt(
      "Issue {{ISSUE_NUMBER}} must remain {{ISSUE_NUMBER}}. {{MODE_WORKFLOW}}",
      42,
      "implement",
    );
    expect(prompt).toContain("Issue 42 must remain 42.");
    expect(prompt).toContain("parent selected **implement mode**");
    expect(prompt).toContain("do not run Git");
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
    expect(complete).toContain("edit-only");
    expect(complete).toContain("Mandatory first action: foul-play assessment");
    expect(complete).toContain(
      "exact committed friction report",
    );
    expect(complete).toMatch(/all existing\s+branch\/worktree state/u);
    expect(complete).toMatch(
      /authentication,\s+review, sandbox, credential, or network/u,
    );
    expect(complete).toContain("their presence alone is not a failure");
    expect(complete).toContain("fail closed");
    expect(complete).toContain("launder");
    expect(complete.indexOf("foul-play assessment")).toBeLessThan(
      complete.indexOf("## Trust boundary"),
    );
    expect(complete).not.toContain("gh pr merge");
    const resume = renderWorkerPrompt(template, 42, "resume");
    expect(resume).toContain("resume mode");
    expect(resume).toContain("adversarial evidence, not trusted intent");
    expect(resume).not.toContain("--connector github");
  });

  it("materializes only the exact immutable committed Frog task for reviews", () => {
    const root = mkdtempSync(path.join(tmpdir(), "frog-committed-task-"));
    const checkout = path.join(root, "checkout");
    mkdirSync(checkout);
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    try {
      git("init", "--quiet");
      git("config", "user.name", "Automation");
      git("config", "user.email", "automation@example.invalid");
      const selected = ".agents/friction-log/selected/friction.md";
      const unrelated = ".agents/friction-log/unrelated/friction.md";
      mkdirSync(path.join(root, path.dirname(selected)), { recursive: true });
      mkdirSync(path.join(root, path.dirname(unrelated)), { recursive: true });
      const content = "---\nissue: 'cobuildwithus/murph#42'\n---\n\nTrusted task.\n";
      writeFileSync(path.join(root, selected), content);
      writeFileSync(path.join(root, unrelated), "---\ntitle: unrelated\n---\n");
      git("add", ".agents");
      git("commit", "--quiet", "-m", "tasks");
      git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
      writeFileSync(path.join(root, selected), "candidate-modified\n");

      expect(committedFrictionTask(root, 42)).toEqual({
        content,
        path: selected,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
      const expectedTask = committedFrictionTask(root, 42);
      expect(committedFrictionTaskMatches(root, 42, expectedTask)).toBe(true);
      const alwaysPaths = materializeCommittedFrictionTask(
        root,
        checkout,
        42,
        expectedTask,
      );
      expect(alwaysPaths).toEqual([
        "audit-packages/frog-autofix-task.md",
        "audit-packages/frog-autofix-task.json",
      ]);
      expect(readFileSync(
        path.join(checkout, "audit-packages/frog-autofix-task.md"),
        "utf8",
      )).toBe(content);
      expect(readFileSync(
        path.join(checkout, "audit-packages/frog-autofix-task.json"),
        "utf8",
      )).toContain(createHash("sha256").update(content).digest("hex"));
      expect(existsSync(path.join(checkout, unrelated))).toBe(false);

      const source = readFileSync(
        path.join(repositoryRoot, "scripts", "frog-autofix.ts"),
        "utf8",
      );
      expect(source.slice(
        source.indexOf("export function buildParentReviewArchive"),
        source.indexOf("function runParentReview"),
      )).toContain("materializeCommittedFrictionTask(");
      expect(source.slice(
        source.indexOf("function runCanonicalPullRequestReview"),
        source.indexOf("function downloadImplementationPatch"),
      )).toContain("materializeCommittedFrictionTask(");

      const updated = content.replace("Trusted task.", "Updated task.");
      writeFileSync(path.join(root, selected), updated);
      git("add", selected);
      git("commit", "--quiet", "-m", "edit task");
      git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
      expect(committedFrictionTaskMatches(root, 42, expectedTask)).toBe(false);

      const moved = ".agents/friction-log/moved/friction.md";
      mkdirSync(path.join(root, path.dirname(moved)), { recursive: true });
      git("mv", selected, moved);
      git("commit", "--quiet", "-m", "move task");
      git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
      expect(committedFrictionTaskMatches(root, 42, expectedTask)).toBe(false);

      writeFileSync(
        path.join(root, moved),
        updated.replace("cobuildwithus/murph#42", "cobuildwithus/murph#43"),
      );
      git("add", moved);
      git("commit", "--quiet", "-m", "replace task binding");
      git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
      expect(committedFrictionTaskMatches(root, 42, expectedTask)).toBe(false);

      git("rm", moved);
      git("commit", "--quiet", "-m", "delete task");
      git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
      expect(committedFrictionTaskMatches(root, 42, expectedTask)).toBe(false);

      const replacement = ".agents/friction-log/replacement/friction.md";
      mkdirSync(path.join(root, path.dirname(replacement)), { recursive: true });
      writeFileSync(
        path.join(root, replacement),
        "---\nissue: 'cobuildwithus/murph#42'\n---\n\nReplacement task.\n",
      );
      git("add", replacement);
      git("commit", "--quiet", "-m", "replace task");
      git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
      expect(committedFrictionTaskMatches(root, 42, expectedTask)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("classifies only unambiguous fresh and resumable states", () => {
    expect(classifyWorkerMode([], 0)).toBe("implement");
    expect(classifyWorkerMode([], 1)).toBe("resume");
    expect(classifyWorkerMode([{
      headIsAncestorOfLocal: true,
      headMatchesLocal: true,
      state: "OPEN",
    }], 2)).toBe("resume");
    expect(classifyWorkerMode([{
      headIsAncestorOfLocal: true,
      headMatchesLocal: true,
      state: "MERGED",
    }], 2)).toBeNull();
    expect(classifyWorkerMode([{
      headIsAncestorOfLocal: true,
      headMatchesLocal: true,
      state: "MERGED",
    }], 2)).toBeNull();
    expect(classifyWorkerMode([{
      headIsAncestorOfLocal: false,
      headMatchesLocal: false,
      state: "OPEN",
    }], 2)).toBeNull();
    expect(classifyWorkerMode([{
      headIsAncestorOfLocal: true,
      headMatchesLocal: true,
      state: "CLOSED",
    }], 2)).toBeNull();
    expect(classifyWorkerMode([
      {
        headIsAncestorOfLocal: true,
        headMatchesLocal: true,
        state: "OPEN",
      },
      {
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
      dirty?: boolean;
      localBodyHead?: string | null;
      localHead: string;
      pullRequest?: { body: string; state: "MERGED" | "OPEN" };
      remoteBranch: boolean;
      remoteTrackingBranch?: boolean;
    }) => {
      const worktree = mkdtempSync(path.join(tmpdir(), "frog-recovery-"));
      const required: string[] = [];
      let recovered = false;
      const remoteTrackingBranch = options.remoteTrackingBranch
        ?? options.remoteBranch;
      try {
        if (options.localBodyHead !== undefined) {
          const bodyPath = path.join(worktree, FROG_AUTOFIX_PR_BODY_PATH);
          mkdirSync(path.dirname(bodyPath), { recursive: true });
          const body = options.localBodyHead === null
            ? renderRecoveredPullRequestBody(42)
            : bodyWithParentMetadata(renderRecoveredPullRequestBody(42), {
              firstHead: options.localBodyHead,
              task: taskIdentity,
            });
          writeFileSync(bodyPath, body);
        }
        const mode = resolveWorkerMode(worktree, branch, 42, {
          authenticatedOperator: () => authenticatedOperator,
          require: (command, args) => {
            const invocation = args.join(" ");
            required.push(`${command} ${invocation}`);
            if (command === "gh") {
              return pullRequestPages(options.pullRequest ? [{
                ...pullRequestAuthority(branch),
                body: options.pullRequest.body,
                headRefOid: options.localHead,
                isDraft: true,
                number: 99,
                state: options.pullRequest.state,
              }] : []);
            }
            if (invocation === "status --porcelain") {
              return options.dirty && !recovered ? " M tracked.ts" : "";
            }
            if (invocation === "symbolic-ref --quiet --short HEAD") return branch;
            if (invocation === "fetch --quiet origin main") return "";
            if (invocation.startsWith("fetch --quiet origin +refs/heads/")) return "";
            if (invocation === "rev-parse HEAD") return options.localHead;
            if (invocation === "rev-parse origin/main") return mainHead;
            if (invocation === `rev-parse origin/${branch}`) return options.localHead;
            if (invocation === "rev-list --count origin/main..HEAD") {
              return String(options.ahead);
            }
            if (invocation === "reset --hard origin/main") {
              recovered = true;
              return "";
            }
            if (invocation === "clean -ffdx") return "";
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
            if (
              invocation
                === `show-ref --verify --quiet refs/remotes/origin/${branch}`
            ) {
              return { status: remoteTrackingBranch ? 0 : 1, stdout: "" };
            }
            throw new Error(`unexpected command: ${command} ${invocation}`);
          },
        });
        return { mode, required };
      } finally {
        rmSync(worktree, { force: true, recursive: true });
      }
    };

    expect(runScenario({ ahead: 0, localHead: mainHead, remoteBranch: false }))
      .toMatchObject({ mode: "implement" });
    const recovered = runScenario({
      ahead: 0,
      dirty: true,
      localHead: mainHead,
      remoteBranch: false,
    });
    expect(recovered.mode).toBe("implement");
    expect(recovered.required).toContain("git reset --hard origin/main");
    expect(recovered.required).toContain("git clean -ffdx");
    expect(() => runScenario({
      ahead: 1,
      localHead: implementationHead,
      remoteBranch: true,
    })).toThrow("exact parent-local PR-body provenance");
    expect(runScenario({
      ahead: 1,
      localBodyHead: implementationHead,
      localHead: implementationHead,
      remoteBranch: true,
    })).toMatchObject({ mode: "resume" });
    expect(() => runScenario({
      ahead: 1,
      localBodyHead: null,
      localHead: implementationHead,
      remoteBranch: true,
    })).toThrow("exact parent-local PR-body provenance");
    expect(() => runScenario({
      ahead: 1,
      localBodyHead: "c".repeat(40),
      localHead: implementationHead,
      remoteBranch: true,
    })).toThrow("exact parent-local PR-body provenance");
    expect(() => runScenario({
      ahead: 1,
      localHead: implementationHead,
      remoteBranch: false,
      remoteTrackingBranch: true,
    })).toThrow("exact parent-local PR-body provenance");
    expect(runScenario({
      ahead: 1,
      localBodyHead: implementationHead,
      localHead: implementationHead,
      remoteBranch: false,
      remoteTrackingBranch: true,
    })).toMatchObject({ mode: "resume" });
    const committedBeforeFirstPush = runScenario({
      ahead: 1,
      localHead: implementationHead,
      remoteBranch: false,
    });
    expect(committedBeforeFirstPush).toMatchObject({ mode: "resume" });
    expect(committedBeforeFirstPush.required)
      .not.toContain("git reset --hard origin/main");
    expect(committedBeforeFirstPush.required).not.toContain("git clean -ffdx");
    expect(runScenario({
      ahead: 1,
      localHead: implementationHead,
      pullRequest: { body: "Frog autofix issue: #42", state: "OPEN" },
      remoteBranch: true,
    })).toMatchObject({ mode: "resume" });
    expect(runScenario({
      ahead: 1,
      dirty: true,
      localHead: implementationHead,
      pullRequest: { body: "Frog autofix issue: #42", state: "OPEN" },
      remoteBranch: true,
    })).toMatchObject({ mode: "resume" });
    expect(() => runScenario({
      ahead: 1,
      localHead: implementationHead,
      pullRequest: { body: "Frog autofix issue: #42", state: "MERGED" },
      remoteBranch: true,
    })).toThrow("recovery state is ambiguous");
    expect(() => runScenario({
      ahead: 0,
      dirty: true,
      localHead: mainHead,
      remoteBranch: true,
    })).toThrow("ambiguous recovery state");
  });

  it("requires one exact merged branch head independent of mutable body text", () => {
    const branch = "agent/frog-autofix-42";
    const mergedHead = "b".repeat(40);
    const record = {
      ...pullRequestAuthority(branch),
      body: "Frog autofix issue: #42",
      headRefOid: mergedHead,
      isDraft: false,
      number: 99,
      state: "MERGED",
    };
    const commands = (localHead: string, body = record.body) => ({
      authenticatedOperator: () => authenticatedOperator,
      require: (command: string) => command === "gh"
        ? pullRequestPages([{ ...record, body }])
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
      { head: mergedHead, pullRequest: 99 },
    )).toBe(true);
    expect(branchHasMergedPullRequest(
      "<ROOT>",
      branch,
      42,
      commands(mergedHead),
      { head: mergedHead, pullRequest: 100 },
    )).toBe(false);

    const foreign = {
      ...record,
      author: { login: "different-operator" },
      number: 100,
    };
    expect(branchHasMergedPullRequest(
      "<ROOT>",
      branch,
      42,
      {
        authenticatedOperator: () => authenticatedOperator,
        require: (command: string) => command === "gh"
          ? pullRequestPages([foreign, record])
          : mergedHead,
        run: () => ({ status: 0, stdout: "" }),
      },
    )).toBe(true);
  });

  it("revalidates exact issue authority before push and again before PR creation", () => {
    const head = "a".repeat(40);
    const events: string[] = [];
    let lookupCount = 0;
    expect(publishDraftRepair(head, {
      createPullRequest: () => events.push("create"),
      currentOpenPullRequest: () => {
        events.push("lookup");
        lookupCount += 1;
        return lookupCount === 1 ? null : { headRefOid: head, number: 99 };
      },
      editPullRequest: () => events.push("edit"),
      pushExactHead: () => events.push("push"),
      refreshAndVerifyIssue: () => events.push("verify"),
    })).toBe(99);
    expect(events).toEqual([
      "verify",
      "push",
      "lookup",
      "verify",
      "create",
      "lookup",
    ]);

    const existingEvents: string[] = [];
    expect(publishDraftRepair(head, {
      createPullRequest: () => existingEvents.push("create"),
      currentOpenPullRequest: () => {
        existingEvents.push("lookup");
        return { headRefOid: head, number: 99 };
      },
      editPullRequest: () => existingEvents.push("edit"),
      pushExactHead: () => existingEvents.push("push"),
      refreshAndVerifyIssue: () => existingEvents.push("verify"),
    })).toBe(99);
    expect(existingEvents).toEqual(["verify", "push", "lookup", "edit"]);
    expect(() => publishDraftRepair(head, {
      createPullRequest: () => undefined,
      currentOpenPullRequest: () => ({
        headRefOid: "b".repeat(40),
        number: 99,
      }),
      editPullRequest: () => {
        throw new Error("body edit must not run");
      },
      pushExactHead: () => undefined,
      refreshAndVerifyIssue: () => undefined,
    })).toThrow("head changed before body edit");
  });

  it("creates no draft after issue authority is revoked at either checkpoint", () => {
    const head = "a".repeat(40);
    for (const revokedAt of [1, 2]) {
      const events: string[] = [];
      let verificationCount = 0;
      expect(() => publishDraftRepair(head, {
        createPullRequest: () => events.push("create"),
        currentOpenPullRequest: () => {
          events.push("lookup");
          return null;
        },
        editPullRequest: () => events.push("edit"),
        pushExactHead: () => events.push("push"),
        refreshAndVerifyIssue: () => {
          events.push("verify");
          verificationCount += 1;
          if (verificationCount === revokedAt) {
            throw new Error("revoked Frog authority");
          }
        },
      })).toThrow("revoked Frog authority");
      expect(events).toEqual(revokedAt === 1
        ? ["verify"]
        : ["verify", "push", "lookup", "verify"]);
    }
  });

  it("paginates foreign PR history before enforcing parent-owned cardinality", () => {
    const branch = "agent/frog-autofix-42";
    const head = "e".repeat(40);
    const foreign = Array.from({ length: 100 }, (_, index) => ({
      ...pullRequestAuthority(branch),
      author: { login: "different-operator" },
      body: "Related only",
      headRefOid: head,
      isDraft: false,
      number: index + 1,
      state: "CLOSED" as const,
    }));
    const open = {
      ...pullRequestAuthority(branch),
      body: `Frog autofix issue: #42\n\nFrog autofix handoff: review-findings at ${head}\n`,
      headRefOid: head,
      isDraft: true,
      number: 101,
      state: "OPEN" as const,
    };
    const merged = { ...open, isDraft: false, state: "MERGED" as const };
    const commandsFor = (records: readonly object[]) => ({
      authenticatedOperator: () => authenticatedOperator,
      require: (command: string, args: string[]) => {
        if (command !== "gh") return head;
        expect(args).toContain("--paginate");
        expect(args).toContain("--slurp");
        const query = args.find((argument) => argument.startsWith("query="));
        expect(query).toContain('baseRefName: "main"');
        expect(query).toContain("headRefName: $head");
        return pullRequestPages(records);
      },
      run: () => ({ status: 0, stdout: "" }),
    });

    expect(branchPullRequests("<ROOT>", branch, commandsFor(foreign)))
      .toEqual([]);
    const parsedOpen = branchPullRequests(
      "<ROOT>",
      branch,
      commandsFor([...foreign, open]),
    );
    expect(parsedOpen).toEqual([open]);
    expect(discoverEligibleIssues("<ROOT>", {
      authenticatedOperator: () => authenticatedOperator,
      assertRepository: () => undefined,
      bindingCount: () => 1,
      fetchDefaultBranch: () => undefined,
      listOpenIssues: () => JSON.stringify([trustedIssue(42)]),
      listIssuePullRequests: () => parsedOpen,
    })).toEqual([]);
    expect(branchHasMergedPullRequest(
      "<ROOT>",
      branch,
      42,
      commandsFor([...foreign, merged]),
    )).toBe(true);
    expect(() => branchOpenPullRequest(
      "<ROOT>",
      branch,
      42,
      commandsFor([...foreign, open, { ...open, number: 102 }]),
    )).toThrow("ambiguous parent-owned pull request history");

    const malformed = JSON.parse(pullRequestPages([...foreign, open])) as Array<{
      data: { repository: { pullRequests: { totalCount: number } } };
    }>;
    malformed.at(-1)!.data.repository.pullRequests.totalCount += 1;
    expect(() => parseBranchPullRequestPages(
      JSON.stringify(malformed),
      branch,
      authenticatedOperator,
    )).toThrow("pagination");
    expect(() => parseBranchPullRequestPages(
      pullRequestPages([...foreign, { ...foreign[0] }]),
      branch,
      authenticatedOperator,
    )).toThrow("duplicate pull requests");
  });

  it("classifies definitive, pending, and indeterminate required check states", () => {
    const check = (bucket: string, state = "COMPLETED") => ({
      bucket,
      name: "Required proof",
      state,
      workflow: "CI",
    });
    expect(requiredPullRequestCheckState(JSON.stringify([check("pass")])))
      .toBe("pass");
    expect(requiredPullRequestCheckState(JSON.stringify([
      check("pass"),
      check("fail"),
    ]))).toBe("failed");
    expect(requiredPullRequestCheckState(JSON.stringify([check("cancel")])))
      .toBe("failed");
    expect(requiredPullRequestCheckState(JSON.stringify([
      check("pass"),
      check("pending", "IN_PROGRESS"),
    ]))).toBe("pending");
    expect(requiredPullRequestCheckState(JSON.stringify([check("skipping")])))
      .toBe("indeterminate");
    expect(requiredPullRequestCheckState("[]")).toBe("indeterminate");
    expect(() => requiredPullRequestCheckState("not-json")).toThrow();
    expect(requiredCheckWatchHandoff(1, "failed")).toBe("review-findings");
    expect(requiredCheckWatchHandoff(0, "pass")).toBeNull();
    expect(() => requiredCheckWatchHandoff(8, "pending"))
      .toThrow("did not complete");
    expect(() => requiredCheckWatchHandoff(1, "indeterminate"))
      .toThrow("did not complete");
  });

  it("keeps merge and issue closure in a revalidated non-model parent", () => {
    const identity = {
      bodySha256: authoritativeBodySha256,
      branch: "agent/frog-autofix-42",
      head: "a".repeat(40),
      issueNumber: 42,
      pullRequest: 99,
      taskPath: taskIdentity.path,
      taskSha256: taskIdentity.sha256,
    };
    const events: string[] = [];
    let closed = false;
    const dependencies: ReadyRepairFinalizationDependencies = {
      autoMergeAllowed: () => {
        events.push("scope");
        return true;
      },
      closeIssue: () => {
        events.push("close");
        closed = true;
      },
      currentPullRequest: () => {
        events.push("pr");
        return {
          bodyAuthoritative: true,
          bodySha256: identity.bodySha256,
          head: identity.head,
          issueBound: true,
          pullRequest: identity.pullRequest,
        };
      },
      issueIsClosed: () => closed,
      merge: () => events.push("merge"),
      mergeTreePasses: () => {
        events.push("merge-tree");
        return true;
      },
      pullRequestIsMerged: () => true,
      refreshAndVerifyIssue: () => events.push("verify-issue"),
      requiredChecksPass: () => {
        events.push("checks");
        return true;
      },
      taskAuthorityMatches: () => {
        events.push("task");
        return true;
      },
    };

    finalizeReadyRepair(identity, dependencies);
    expect(events).toEqual([
      "pr",
      "checks",
      "verify-issue",
      "task",
      "pr",
      "checks",
      "merge-tree",
      "scope",
      "verify-issue",
      "task",
      "pr",
      "checks",
      "scope",
      "pr",
      "merge",
      "close",
    ]);
  });

  it("recovers merged-but-open closure without overriding a deliberate reopen", () => {
    const mergedAt = "2026-08-12T12:00:00Z";
    const history = (nodes: readonly object[], totalCount = nodes.length) => JSON.stringify({
      data: {
        repository: {
          issue: { timelineItems: { nodes, totalCount } },
        },
      },
    });
    expect(mergedIssueClosureAction(mergedAt, history([]))).toBe("close");
    expect(mergedIssueClosureAction(mergedAt, history([
      { __typename: "ReopenedEvent", createdAt: "2026-08-12T11:00:00Z" },
    ]))).toBe("close");
    expect(mergedIssueClosureAction(mergedAt, history([
      { __typename: "ClosedEvent", createdAt: "2026-08-12T12:01:00Z" },
      { __typename: "ReopenedEvent", createdAt: "2026-08-12T12:02:00Z" },
    ]))).toBe("handoff");
    expect(() => mergedIssueClosureAction(mergedAt, history([
      { __typename: "ClosedEvent", createdAt: "2026-08-12T12:01:00Z" },
    ]))).toThrow("conflicts");
    expect(() => mergedIssueClosureAction(mergedAt, "[]")).toThrow();
    expect(() => mergedIssueClosureAction(mergedAt, history([], 101))).toThrow();

    const merged = {
      ...pullRequestAuthority("agent/frog-autofix-42"),
      body: "Frog autofix issue: #42",
      headRefOid: "a".repeat(40),
      isDraft: false,
      mergedAt,
      number: 99,
      state: "MERGED" as const,
    };
    expect(mergedPullRequestForClosure([merged])).toBe(merged);
    expect(mergedPullRequestForClosure([{ ...merged, state: "OPEN" }]))
      .toBeNull();
    expect(completedHandoffIssueNumbers([merged], authenticatedOperator).size)
      .toBe(0);
    const reopenedHandoff = {
      ...merged,
      body: bodyWithParentMetadata(renderRecoveredPullRequestBody(42), {
        firstHead: merged.headRefOid,
        handoff: "review-findings",
        handoffHead: merged.headRefOid,
      }),
      editor: { login: authenticatedOperator },
    };
    expect(completedHandoffIssueNumbers(
      [reopenedHandoff],
      authenticatedOperator,
    )).toEqual(new Set([42]));

    const source = readFileSync(
      path.join(repositoryRoot, "scripts", "frog-autofix.ts"),
      "utf8",
    );
    const runOnce = source.slice(source.indexOf("async function runOnce()"));
    expect(runOnce.indexOf("recoverMergedIssueClosure("))
      .toBeLessThan(runOnce.indexOf("restoreRecoveredHandoffBeforeWorktreeRecovery("));
    expect(runOnce.indexOf("recoverMergedIssueClosure("))
      .toBeLessThan(runOnce.indexOf("prepareIssueWorktree("));
  });

  it("fails closed before merge when live authority, head, checks, or mergeability drift", () => {
    const identity = {
      bodySha256: authoritativeBodySha256,
      branch: "agent/frog-autofix-42",
      head: "a".repeat(40),
      issueNumber: 42,
      pullRequest: 99,
      taskPath: taskIdentity.path,
      taskSha256: taskIdentity.sha256,
    };
    for (const failure of [
      "authority",
      "body",
      "body-owner",
      "checks",
      "head",
      "issue-binding",
    ] as const) {
      let mergeCalls = 0;
      let verificationCalls = 0;
      const dependencies: ReadyRepairFinalizationDependencies = {
        autoMergeAllowed: () => true,
        closeIssue: () => undefined,
        currentPullRequest: () => failure === "head"
          ? {
            bodyAuthoritative: true,
            bodySha256: identity.bodySha256,
            head: "b".repeat(40),
            issueBound: true,
            pullRequest: 99,
          }
          : {
            bodyAuthoritative: failure !== "body-owner",
            bodySha256: failure === "body"
              ? "e".repeat(64)
              : identity.bodySha256,
            head: identity.head,
            issueBound: failure !== "issue-binding",
            pullRequest: identity.pullRequest,
          },
        issueIsClosed: () => false,
        merge: () => {
          mergeCalls += 1;
        },
        mergeTreePasses: () => true,
        pullRequestIsMerged: () => false,
        refreshAndVerifyIssue: () => {
          verificationCalls += 1;
          if (failure === "authority") throw new Error("revoked Frog authority");
        },
        requiredChecksPass: () => failure !== "checks",
        taskAuthorityMatches: () => true,
      };
      expect(() => finalizeReadyRepair(identity, dependencies)).toThrow();
      expect(mergeCalls).toBe(0);
      if (failure === "authority") expect(verificationCalls).toBe(1);
    }
    expect(finalizeReadyRepair(identity, {
      autoMergeAllowed: () => true,
      closeIssue: () => undefined,
      currentPullRequest: () => ({
        bodyAuthoritative: true,
        bodySha256: identity.bodySha256,
        head: identity.head,
        issueBound: true,
        pullRequest: identity.pullRequest,
      }),
      issueIsClosed: () => false,
      merge: () => {
        throw new Error("merge must not run");
      },
      mergeTreePasses: () => false,
      pullRequestIsMerged: () => false,
      refreshAndVerifyIssue: () => undefined,
      requiredChecksPass: () => true,
      taskAuthorityMatches: () => true,
    })).toBe("awaiting-human-conflict");

    for (const driftAt of [1, 2]) {
      let taskChecks = 0;
      let mergeCalls = 0;
      const result = finalizeReadyRepair(identity, {
        autoMergeAllowed: () => true,
        closeIssue: () => undefined,
        currentPullRequest: () => ({
          bodyAuthoritative: true,
          bodySha256: identity.bodySha256,
          head: identity.head,
          issueBound: true,
          pullRequest: identity.pullRequest,
        }),
        issueIsClosed: () => false,
        merge: () => {
          mergeCalls += 1;
        },
        mergeTreePasses: () => true,
        pullRequestIsMerged: () => false,
        refreshAndVerifyIssue: () => undefined,
        requiredChecksPass: () => true,
        taskAuthorityMatches: () => {
          taskChecks += 1;
          return taskChecks !== driftAt;
        },
      });
      expect(result).toBe("awaiting-human-authority");
      expect(mergeCalls).toBe(0);
      expect(taskChecks).toBe(driftAt);
    }
  });

  it("hands off every broader authority class and merges exact Frog script scope", () => {
    const identity = {
      bodySha256: authoritativeBodySha256,
      branch: "agent/frog-autofix-42",
      head: "a".repeat(40),
      issueNumber: 42,
      pullRequest: 99,
      taskPath: taskIdentity.path,
      taskSha256: taskIdentity.sha256,
    };
    for (const broaderPath of [
      "AGENTS.md",
      ".agents/skills/frog/SKILL.md",
      ".agents/friction-log/new-task/friction.md",
      "agent-docs/SECURITY.md",
      "agent-docs/RELIABILITY.md",
      "agent-docs/operations/pr-reviewgpt-loop.md",
      "agent-docs/product-specs/repo.md",
    ]) {
      let mergeCalls = 0;
      let closeCalls = 0;
      const outcome = finalizeReadyRepair(identity, {
        autoMergeAllowed: () => localAgentOnlyChange({
          paths: ["scripts/frog-autofix.ts", broaderPath],
        }),
        closeIssue: () => {
          closeCalls += 1;
        },
        currentPullRequest: () => ({
          bodyAuthoritative: true,
          bodySha256: authoritativeBodySha256,
          head: identity.head,
          issueBound: true,
          pullRequest: identity.pullRequest,
        }),
        issueIsClosed: () => false,
        merge: () => {
          mergeCalls += 1;
        },
        mergeTreePasses: () => true,
        pullRequestIsMerged: () => false,
        refreshAndVerifyIssue: () => undefined,
        requiredChecksPass: () => true,
        taskAuthorityMatches: () => true,
      });
      expect(outcome, broaderPath).toBe("awaiting-human-product");
      expect(mergeCalls, broaderPath).toBe(0);
      expect(closeCalls, broaderPath).toBe(0);
    }

    let merged = false;
    let closed = false;
    expect(finalizeReadyRepair(identity, {
      autoMergeAllowed: () => localAgentOnlyChange({
        paths: ["scripts/frog-autofix.ts"],
      }),
      closeIssue: () => {
        closed = true;
      },
      currentPullRequest: () => ({
        bodyAuthoritative: true,
        bodySha256: authoritativeBodySha256,
        head: identity.head,
        issueBound: true,
        pullRequest: identity.pullRequest,
      }),
      issueIsClosed: () => closed,
      merge: () => {
        merged = true;
      },
      mergeTreePasses: () => true,
      pullRequestIsMerged: () => merged,
      refreshAndVerifyIssue: () => undefined,
      requiredChecksPass: () => true,
      taskAuthorityMatches: () => true,
    })).toBe("merged");
    expect(merged).toBe(true);
    expect(closed).toBe(true);
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

  it("keeps the Codex worker edit-only without network or added host roots", () => {
    const args = buildCodexWorkerArguments({
      lastMessageFile: "<OUTPUT_FILE>",
      worktree: "<WORKTREE>",
    });
    expect(args).toContain("exec");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain('default_permissions="frog-workspace-only"');
    expect(args).toContain(
      'permissions.frog-workspace-only.filesystem={":root"="deny",":minimal"="read",":tmpdir"="deny",":slash_tmp"="deny"}',
    );
    expect(args).toContain(
      "permissions.frog-workspace-only.network.enabled=false",
    );
    expect(args).toContain('web_search="disabled"');
    expect(args).toContain('shell_environment_policy.inherit="none"');
    expect(args).toContain(
      'shell_environment_policy.include_only=["CI","HOME","LANG","LC_ALL","PATH","TERM","TMPDIR","NO_COLOR"]',
    );
    expect(args).not.toContain("--add-dir");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("--full-auto");
    expect(args).not.toContain("<BROWSER_PROFILE>");
    expect(args).not.toContain("<GIT_COMMON_DIR>");
    for (const feature of [
      "apps",
      "browser_use",
      "computer_use",
      "hooks",
      "multi_agent",
      "request_permissions_tool",
      "plugins",
      "standalone_web_search",
    ]) expect(args).toContain(feature);
    expect(args).not.toContain("danger-full-access");
  });

  it("auto-merges only deterministic Frog implementation and issue-bound plan scope", () => {
    const packageBase = JSON.stringify({ scripts: { typecheck: "tsc" } });
    const packageHead = JSON.stringify({
      scripts: { typecheck: "tsc", "frog:autofix": "scripts/frog-autofix" },
    });
    const architectureBase = "# Murph Architecture\n\nLast verified: 2026-08-10\n\n## Product\n\nRuntime.\n";
    const architectureHead = "# Murph Architecture\n\nLast verified: 2026-08-11\n\n## Local Frog Autofix\n\nLocal only.\n\n## Product\n\nRuntime.\n";
    const completedPlanPath = "agent-docs/exec-plans/completed/frog-autofix-repair-42-resume-2.md";
    const completedPlanContent = renderRepairPlanContent({
      completed: "2026-08-12",
      issueNumber: 42,
      phase: "resume-2",
      status: "completed",
      updated: "2026-08-12",
    });
    expect(localAgentOnlyChange({
      architectureBase,
      architectureHead,
      completedPlanContent,
      completedPlanPath,
      issueNumber: 42,
      packageBase,
      packageHead,
      paths: [
        "ARCHITECTURE.md",
        completedPlanPath,
        "package.json",
        "scripts/frog-autofix.ts",
        "scripts/frog-autofix.test.ts",
      ],
    })).toBe(true);
    for (const localPath of [
      "scripts/frog-autofix",
      "scripts/frog-autofix-command.ts",
      "scripts/frog-autofix-finalize.ts",
      "scripts/frog-autofix-lib.ts",
      "scripts/frog-autofix-parent.ts",
      "scripts/frog-autofix-recovery.ts",
      "scripts/frog-autofix-worker.md",
      "scripts/frog-autofix.test.ts",
      "scripts/frog-autofix.ts",
    ]) expect(localAgentOnlyChange({ paths: [localPath] })).toBe(true);
    for (const productPath of [
      "apps/web/app/page.tsx",
      "packages/assistant-runtime/src/runtime.ts",
      ".github/workflows/release.yml",
      "scripts/deploy-production.sh",
      "scripts/frog",
      "scripts/frog-pr-context.ts",
      "scripts/frog-safe.ts",
      "scripts/review-gpt.config.sh",
      "AGENTS.md",
      ".agents/skills/frog/SKILL.md",
      ".agents/friction-log/new-task/friction.md",
      "agent-docs/SECURITY.md",
      "agent-docs/RELIABILITY.md",
      "agent-docs/operations/pr-reviewgpt-loop.md",
      "agent-docs/product-specs/repo.md",
    ]) {
      expect(localAgentOnlyChange({ paths: [productPath] })).toBe(false);
    }
    expect(localAgentOnlyChange({
      completedPlanContent,
      completedPlanPath,
      issueNumber: 43,
      paths: [completedPlanPath],
    })).toBe(false);
    expect(localAgentOnlyChange({
      completedPlanContent: completedPlanContent.replace(
        "without granting the edit-only child Git,",
        "with expanded child Git authority,",
      ),
      completedPlanPath,
      issueNumber: 42,
      paths: [completedPlanPath],
    })).toBe(false);
    const anotherIssuePlan = completedPlanPath.replace("42", "43");
    expect(localAgentOnlyChange({
      completedPlanContent,
      completedPlanPath: anotherIssuePlan,
      issueNumber: 42,
      paths: [anotherIssuePlan],
    })).toBe(false);
    expect(localAgentOnlyChange({
      completedPlanPath,
      issueNumber: 42,
      paths: [completedPlanPath],
    })).toBe(false);
    expect(localAgentOnlyChange({
      packageBase,
      packageHead: JSON.stringify({ scripts: { typecheck: "echo bypass" } }),
      paths: ["package.json"],
    })).toBe(false);
    expect(localAgentOnlyChange({
      architectureBase,
      architectureHead: architectureHead.replace("Runtime.", "Changed runtime."),
      paths: ["ARCHITECTURE.md"],
    })).toBe(false);
  });

  it("includes both sides of renames and copies in authority decisions", () => {
    expect(authorityChangedPaths(
      "scripts/frog-safe.ts\0scripts/runtime.ts\0",
      "R100\0scripts/runtime.ts\0scripts/frog-safe.ts\0",
    )).toEqual(["scripts/frog-safe.ts", "scripts/runtime.ts"]);
    expect(authorityChangedPaths(
      "scripts/frog-copy.ts\0",
      "C100\0scripts/deploy-production.sh\0scripts/frog-copy.ts\0",
    )).toEqual(["scripts/deploy-production.sh", "scripts/frog-copy.ts"]);
    expect(() => authorityChangedPaths("", "R100\0only-one-path\0"))
      .toThrow("incomplete copy or rename");
    const workflowHelperRename = authorityChangedPaths(
      "scripts/frog-autofix.ts\0scripts/frog-pr-context.ts\0",
      "R100\0scripts/frog-pr-context.ts\0scripts/frog-autofix.ts\0",
    );
    expect(localAgentOnlyChange({ paths: workflowHelperRename })).toBe(false);
  });

  it("gets prohibited sources from real Git rename and copy fixtures", () => {
    const root = mkdtempSync(path.join(tmpdir(), "frog-authority-git-"));
    const git = (...args: string[]) => {
      const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };
    try {
      git("init", "--quiet");
      git("config", "user.name", "Automation");
      git("config", "user.email", "automation@example.invalid");
      mkdirSync(path.join(root, "scripts"), { recursive: true });
      writeFileSync(path.join(root, "scripts", "deploy-production.sh"), "release\n");
      git("add", ".");
      git("commit", "--quiet", "-m", "base");
      const base = git("rev-parse", "HEAD").trim();
      writeFileSync(path.join(root, "scripts", "frog-copy.sh"), "release\n");
      git("mv", "scripts/deploy-production.sh", "scripts/frog-renamed.sh");
      git("add", ".");
      git("commit", "--quiet", "-m", "candidate");
      const head = git("rev-parse", "HEAD").trim();
      const paths = authorityChangedPaths(
        git("diff", "--no-renames", "--name-only", "-z", base, head),
        git(
          "diff",
          "--find-renames=50%",
          "--find-copies=50%",
          "--find-copies-harder",
          "--name-status",
          "-z",
          base,
          head,
        ),
      );
      expect(paths).toContain("scripts/deploy-production.sh");
      expect(localAgentOnlyChange({ paths })).toBe(false);
      expect(primaryAdvanceRequiresRestart([
        "scripts/frog-autofix.ts",
        "scripts/renamed.ts",
      ])).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("continues after unrelated primary advances and restarts for loaded runner changes", () => {
    expect(primaryAdvanceRequiresRestart(["apps/web/app/page.tsx"])).toBe(false);
    expect(primaryAdvanceRequiresRestart(["scripts/frog-autofix.ts"])).toBe(true);
    expect(primaryAdvanceRequiresRestart(["scripts/frog-autofix-parent.ts"])).toBe(true);
  });

  it("reuses interrupted active plans and advances past completed phase names", () => {
    const root = mkdtempSync(path.join(tmpdir(), "frog-autofix-plan-"));
    try {
      const active = path.join(root, "agent-docs", "exec-plans", "active");
      const completed = path.join(root, "agent-docs", "exec-plans", "completed");
      mkdirSync(active, { recursive: true });
      mkdirSync(completed, { recursive: true });
      writeFileSync(path.join(active, "frog-autofix-repair-42-resume.md"), "active");
      expect(reusableRepairPhase(root, 42, "resume")).toBe("resume");
      writeFileSync(path.join(completed, "frog-autofix-repair-42-resume.md"), "done");
      expect(reusableRepairPhase(root, 42, "resume")).toBe("resume-2");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("validates parent-owned implementation patches and PR metadata", () => {
    const patch = [
      "diff --git a/scripts/frog-tool.ts b/scripts/frog-tool.ts",
      "--- a/scripts/frog-tool.ts",
      "+++ b/scripts/frog-tool.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    expect(validatePatchText(patch)).toEqual(["scripts/frog-tool.ts"]);
    expect(() => validatePatchText(
      patch.replaceAll("scripts/frog-tool.ts", "../outside"),
    )).toThrow("unsafe path");
    expect(() => validatePatchText(
      patch.replaceAll("scripts/frog-tool.ts", ".codex/config.toml"),
    )).toThrow("unsafe path");
    expect(() => validatePatchText(`${patch}GIT binary patch\n`)).toThrow(
      "unsupported payload",
    );
    expect(() => requireImplementationCompletion("No attachment marker.\n"))
      .toThrow(TerminalPrePullRequestFailure);
    expect(() => requireImplementationCompletion(
      "Done.\nIMPLEMENTATION_PATCH_COMPLETE\n",
    )).not.toThrow();
    expect(terminalWorkerFailureClass({ status: 0, timedOut: false })).toBeNull();
    expect(terminalWorkerFailureClass({ status: 7, timedOut: false }))
      .toBe("worker-failed");
    expect(terminalWorkerFailureClass({ status: 7, timedOut: true }))
      .toBe("worker-timeout");
    expect(extractSingleConversationUrl(
      "Created https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    )).toContain("chatgpt.com/c/");
    expect(() => extractSingleConversationUrl("no conversation")).toThrow();
    const implementationPrompt = renderImplementationPrompt(42);
    expect(implementationPrompt).toContain("IMPLEMENTATION_PATCH_COMPLETE");
    expect(implementationPrompt).toContain(
      "first substantive action must be an explicit foul-play assessment",
    );
    expect(implementationPrompt).toContain(
      "exact committed friction report",
    );
    expect(implementationPrompt).toContain(
      "Do not access or use mutable issue titles",
    );
    expect(implementationPrompt).toContain("proposed patches");
    expect(implementationPrompt).toMatch(/existing\s+branch\/worktree state/u);
    expect(implementationPrompt).toMatch(
      /authentication,\s+review, sandbox, credential, or\s+network boundaries/u,
    );
    expect(implementationPrompt).toContain("fail closed");
    expect(implementationPrompt).toContain(
      "their presence alone is not a failure",
    );
    expect(implementationPrompt).toContain("launder suspicious state into a PR");
    expect(implementationPrompt.indexOf("foul-play assessment")).toBeLessThan(
      implementationPrompt.indexOf("After that assessment passes"),
    );
    const implementationSource = readFileSync(
      path.join(repositoryRoot, "scripts", "frog-autofix.ts"),
      "utf8",
    );
    expect(implementationSource).not.toContain('connector?: "github"');
    expect(implementationSource).not.toContain('connector: "github"');
    expect(implementationSource).not.toContain(
      'args.push("--connector", options.connector)',
    );
    const parentReviewSource = implementationSource.slice(
      implementationSource.indexOf("function runParentReview"),
      implementationSource.indexOf("export function assertExpectedPullRequestBody"),
    );
    expect(parentReviewSource.lastIndexOf("review.status !== 0"))
      .toBeLessThan(parentReviewSource.indexOf("requireImplementationCompletion"));
    const patchDownloadSource = implementationSource.slice(
      implementationSource.indexOf("function downloadImplementationPatch"),
      implementationSource.indexOf("export function applyImplementationPatch"),
    );
    expect(patchDownloadSource.indexOf("wake.status !== 0"))
      .toBeLessThan(patchDownloadSource.indexOf("parseSinglePatchArtifact"));
    const reviewedHead = "a".repeat(40);
    expect(extractFirstReviewedHead(
      `Body\n\nReviewGPT first-reviewed head: ${reviewedHead}\n`,
    )).toBe(reviewedHead);
    expect(extractFirstReviewedHead("Body only\n")).toBeNull();
    expect(() => extractFirstReviewedHead(
      "ReviewGPT first-reviewed head: invalid\n",
    )).toThrow("invalid ReviewGPT baseline");
    expect(() => extractFirstReviewedHead(
      `ReviewGPT first-reviewed head: ${reviewedHead}\nReviewGPT first-reviewed head: ${reviewedHead}\n`,
    )).toThrow("ambiguous ReviewGPT baseline");

    const body = [
      "## Why this PR exists",
      "Repair trusted developer friction.",
      "## User goal / user-visible behavior",
      "Complete the repair.",
      "## User experience",
      "No member-facing claim.",
      "## Invariants",
      "Preserve authority.",
      "## Non-obvious affected surfaces",
      "None.",
      "## Architecture and reuse",
      "- Existing systems reused: repository checks.",
      "- New logic: bounded repair.",
      "- New abstractions: no new service.",
      "- Complexity intentionally avoided: no queue.",
      "## Changelog",
      "Changelog: not applicable",
      "## Hot reply path impact",
      "Not applicable.",
      "## Preliminary specialist lenses",
      "Coverage: applicable.",
      "## Verification",
      "Parent-owned checks.",
      "## Change shape",
      "Source and tests only.",
      "ReviewGPT context sensitivity: sensitive",
      "Frog autofix issue: #42",
    ].join("\n\n");
    expect(() => validatePullRequestBody(body, 42, "<HOME>", "<USER>"))
      .not.toThrow();
    expect(() => validatePullRequestBody(`${body}\nFixes #43`, 42, "<HOME>", "<USER>"))
      .toThrow("issue relationship");
    for (const relationship of [
      "Closes #43",
      "fix cobuildwithus/murph#43",
      "Resolved https://github.com/cobuildwithus/murph/issues/43.",
      "CLOSES https://github.com/cobuildwithus/murph/issues/42",
    ]) {
      expect(() => validatePullRequestBody(
        `${body}\n${relationship}`,
        42,
        "<HOME>",
        "<USER>",
      )).toThrow("issue relationship");
    }
    expect(() => validatePullRequestBody(
      `${body}\nThe regression is fixed without an issue relationship.`,
      42,
      "<HOME>",
      "<USER>",
    )).not.toThrow();
  });

  it("rejects unusable patches and publishes an empty neutral handoff tree", () => {
    const root = mkdtempSync(path.join(tmpdir(), "frog-empty-handoff-"));
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    try {
      git("init", "--quiet");
      git("config", "user.name", "Automation");
      git("config", "user.email", "automation@example.invalid");
      writeFileSync(path.join(root, "tracked.txt"), "main\n");
      git("add", "tracked.txt");
      git("commit", "--quiet", "-m", "main");
      git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
      writeFileSync(path.join(root, "tracked.txt"), "candidate\n");
      writeFileSync(path.join(root, "candidate.txt"), "must not persist\n");
      const rejectedPatch = path.join(root, "rejected.patch");
      writeFileSync(rejectedPatch, "not a patch\n");
      expect(() => applyImplementationPatch(root, rejectedPatch))
        .toThrow(TerminalPrePullRequestFailure);

      const head = createEmptyRepairHandoffCommit(root, 42);
      expect(git("rev-parse", `${head}^{tree}`))
        .toBe(git("rev-parse", "origin/main^{tree}"));
      expect(git("status", "--porcelain")).toBe("");
      expect(git("show", "-s", "--format=%an <%ae>", head))
        .toBe("Frog Autofix <frog-autofix@users.noreply.github.com>");
      expect(existsSync(path.join(root, "candidate.txt"))).toBe(false);
      expect(readFileSync(path.join(root, "tracked.txt"), "utf8")).toBe("main\n");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
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
    let groupState: "alive" | "dead" = "alive";
    const resultPromise = superviseOwnedWorker(child, (pid) => started.push(pid), 100, 10, {
      clearTimer: (timer) => {
        (timer as { cleared: boolean }).cleared = true;
      },
      setTimer: (callback) => {
        const timer = { callback, cleared: false };
        timers.push(timer);
        return timer;
      },
      processGroupState: () => groupState,
      signalProcessGroup: (pid, signal) => signals.push([pid, signal]),
    });
    expect(started).toEqual([42]);
    timers[0]?.callback();
    expect(signals).toEqual([[-42, "SIGTERM"]]);
    timers[1]?.callback();
    expect(signals).toEqual([[-42, "SIGTERM"], [-42, "SIGKILL"]]);
    (child as unknown as EventEmitter).emit("exit", 143);
    let settled = false;
    void resultPromise.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    groupState = "dead";
    timers.find((timer, index) => index > 1 && !timer.cleared)?.callback();
    await expect(resultPromise).resolves.toEqual({ status: 143, timedOut: true });
    expect(timers.slice(0, 2).every((timer) => timer.cleared)).toBe(true);
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
      processGroupState: () => "dead" as const,
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
    timers[1]?.callback();
    expect(signals).toEqual([[-8, "SIGTERM"]]);
    (graceful as unknown as EventEmitter).emit("exit", 143);
    await expect(gracefulResult).resolves.toEqual({ status: 143, timedOut: true });
    expect(signals).toEqual([[-8, "SIGTERM"]]);
    expect(timers.at(-1)?.cleared).toBe(true);
  });

  it("bounds a real leader-first command until its exact process group disappears", () => {
    const descendant = [
      "process.on('SIGTERM',()=>{});",
      "setInterval(()=>{},1000);",
    ].join("");
    const leader = [
      "const{spawn}=require('node:child_process');",
      `const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});`,
      "process.stdout.write(String(child.pid));",
      "process.on('SIGTERM',()=>process.exit(0));",
      "setInterval(()=>{},1000);",
    ].join("");
    const result = spawnSync(process.execPath, [
      path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(repositoryRoot, "scripts", "frog-autofix-command.ts"),
      "150",
      repositoryRoot,
      "--",
      process.execPath,
      "-e",
      leader,
    ], { encoding: "utf8", timeout: 5_000 });
    expect(result.error).toBeUndefined();
    const envelope = JSON.parse(result.stdout) as {
      status: number;
      stdout: string;
      timedOut: boolean;
    };
    expect(envelope.timedOut).toBe(true);
    const descendantPid = Number(envelope.stdout);
    expect(Number.isSafeInteger(descendantPid)).toBe(true);
    const reapDeadline = Date.now() + 2_000;
    let disappeared = false;
    while (Date.now() < reapDeadline) {
      try {
        process.kill(descendantPid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          disappeared = true;
          break;
        }
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    expect(disappeared).toBe(true);
  });

  it("waits for exact child termination when lock identity recording fails", async () => {
    class FakeChild extends EventEmitter {
      pid = 42;
    }
    const child = new FakeChild() as unknown as ChildProcess;
    const timers: Array<{ callback: () => void; cleared: boolean }> = [];
    const signals: Array<[number, string]> = [];
    const startError = new Error("worker identity unavailable");
    let groupState: "alive" | "dead" = "alive";
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
      processGroupState: () => groupState,
      signalProcessGroup: (pid, signal) => signals.push([pid, signal]),
    });
    expect(signals).toEqual([[-42, "SIGTERM"]]);
    let settled = false;
    void resultPromise.finally(() => {
      settled = true;
    }).catch(() => undefined);
    await Promise.resolve();
    expect(settled).toBe(false);
    timers[1]?.callback();
    expect(signals).toEqual([[-42, "SIGTERM"], [-42, "SIGKILL"]]);
    (child as unknown as EventEmitter).emit("exit", 137);
    groupState = "dead";
    timers.find((timer, index) => index > 1 && !timer.cleared)?.callback();
    await expect(resultPromise).rejects.toBe(startError);
    expect(settled).toBe(true);
  });

});
