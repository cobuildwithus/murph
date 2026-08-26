import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  classifyChangedFiles,
  classifyCurrentPullRequest,
  classifyCurrentVercelBuild,
  isEligibleMarkdownDocumentationPath,
  isSafeRepositoryPath,
  parseGitNameStatus,
} from "./ci-markdown-docs-scope.mjs";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const MERGE_SHA = "c".repeat(40);
const REPOSITORY = "example/repository";

function pullRequest(overrides = {}) {
  return {
    base: {
      ref: "main",
      repo: { full_name: REPOSITORY },
      sha: BASE_SHA,
    },
    changed_files: 1,
    draft: false,
    head: {
      ref: "docs-update",
      repo: { full_name: REPOSITORY },
      sha: HEAD_SHA,
    },
    merge_commit_sha: MERGE_SHA,
    number: 42,
    state: "open",
    ...overrides,
  };
}

function eventPayload(overrides = {}) {
  const current = pullRequest(overrides.pullRequest);
  return {
    action: "ready_for_review",
    number: 42,
    pull_request: current,
    repository: { full_name: REPOSITORY },
    ...overrides.event,
  };
}

function actionsEnv(overrides = {}) {
  return {
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_BASE_REF: "main",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: "/synthetic/event.json",
    GITHUB_HEAD_REF: "docs-update",
    GITHUB_REF: "refs/pull/42/merge",
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_SHA: MERGE_SHA,
    GITHUB_TOKEN: "synthetic-token",
    ...overrides,
  };
}

function file(filename, status = "modified", extra = {}) {
  return { filename, status, ...extra };
}

function response(value, ok = true) {
  return { json: async () => value, ok };
}

function vercelEnv(overrides = {}) {
  return {
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_COMMIT_SHA: HEAD_SHA,
    VERCEL_GIT_PREVIOUS_SHA: BASE_SHA,
    ...overrides,
  };
}

function gitRunner({ head = HEAD_SHA, inventory = "M\0README.md\0" } = {}) {
  const calls = [];
  const runGit = (args) => {
    calls.push(args);
    if (args.join(" ") === "rev-parse --show-toplevel") {
      return { status: 0, stdout: "/synthetic/repository\n" };
    }
    if (args.at(-2) === "rev-parse" && args.at(-1) === "HEAD") {
      return { status: 0, stdout: `${head}\n` };
    }
    if (args.includes("cat-file") || args.includes("merge-base")) {
      return { status: 0, stdout: "" };
    }
    if (args.includes("diff")) return { status: 0, stdout: inventory };
    return { status: 1, stdout: "" };
  };
  return { calls, runGit };
}

async function classify({
  current = pullRequest(),
  env = actionsEnv(),
  event = eventPayload(),
  finalCurrent = current,
  pages = [[file("README.md")]],
} = {}) {
  const requests = [];
  let currentRequestCount = 0;
  const fetchImpl = async (url) => {
    requests.push(url);
    if (!url.includes("/files?")) {
      currentRequestCount += 1;
      return response(currentRequestCount === 1 ? current : finalCurrent);
    }
    const page = Number(new URL(url).searchParams.get("page"));
    return response(pages[page - 1] ?? []);
  };
  const result = await classifyCurrentPullRequest({
    env,
    fetchImpl,
    readEvent: async () => event,
  });
  return { requests, result };
}

test("allows only the narrow documentation roots", () => {
  for (const path of [
    "AGENTS.md",
    "ARCHITECTURE.md",
    "README.md",
    "docs/contracts/invariant.md",
    "agent-docs/operations/workflow.md",
    "apps/web/README.md",
    "apps/cloudflare/DEPLOY.md",
    "packages/core/README.md",
  ]) {
    assert.equal(isEligibleMarkdownDocumentationPath(path), true, path);
  }
  for (const path of [
    ".agents/skills/frog/SKILL.md",
    "agent-docs/generated/catalog.md",
    "agent-docs/prompts/reviewer.md",
    "apps/web/changelog/README.md",
    "apps/web/docs/README.md",
    "packages/core/DEPLOY.md",
    "scripts/README.md",
    "docs/runtime.json",
  ]) {
    assert.equal(isEligibleMarkdownDocumentationPath(path), false, path);
  }
});

test("rejects unsafe or ambiguous repository paths", () => {
  for (const path of [
    "docs/../README.md",
    "docs//README.md",
    "/docs/README.md",
    "docs/README.md/",
    "docs\\README.md",
    "docs/private note.md",
  ]) {
    assert.equal(isSafeRepositoryPath(path), false, path);
  }
});

test("accepts additions, modifications, deletions, and eligible renames", () => {
  assert.deepEqual(classifyChangedFiles([
    file("docs/added.md", "added"),
    file("README.md", "modified"),
    file("agent-docs/removed.md", "removed"),
    file("packages/core/README.md", "renamed", {
      previous_filename: "packages/query/README.md",
    }),
  ]), { markdownOnly: true, reason: "eligible-markdown-docs" });
});

test("validates both sides of a rename", () => {
  assert.deepEqual(classifyChangedFiles([
    file("docs/renamed.md", "renamed", { previous_filename: "apps/web/runtime.ts" }),
  ]), { markdownOnly: false, reason: "ineligible-rename-source" });
});

test("rejects unsupported status, duplicate paths, and mixed changes", () => {
  assert.equal(classifyChangedFiles([file("README.md", "copied")]).markdownOnly, false);
  assert.equal(classifyChangedFiles([file("README.md"), file("README.md")]).markdownOnly, false);
  assert.equal(classifyChangedFiles([file("README.md"), file("package.json")]).markdownOnly, false);
});

test("traverses every changed-file page and requires the exact count", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => file(`docs/page-${index}.md`));
  const secondPage = [file("agent-docs/final.md")];
  const current = pullRequest({ changed_files: 101 });
  const event = eventPayload({ pullRequest: { changed_files: 101 } });
  const { requests, result } = await classify({ current, event, pages: [firstPage, secondPage] });
  assert.deepEqual(result, { markdownOnly: true, reason: "eligible-markdown-docs" });
  assert.equal(requests.filter((url) => url.includes("/files?")).length, 2);

  const mismatch = await classify({ current, event, pages: [firstPage, []] });
  assert.deepEqual(mismatch.result, { markdownOnly: false, reason: "invalid-file-page" });
});

test("rejects changed-file inventories above GitHub's complete 3000-file boundary", async () => {
  const { requests, result } = await classify({
    current: pullRequest({ changed_files: 3_001 }),
    event: eventPayload({ pullRequest: { changed_files: 3_001 } }),
  });
  assert.deepEqual(result, { markdownOnly: false, reason: "invalid-changed-file-count" });
  assert.equal(requests.filter((url) => url.includes("/files?")).length, 0);
});

test("fails closed when the event no longer names the current exact PR", async () => {
  for (const input of [
    { current: pullRequest({ head: { ...pullRequest().head, sha: "d".repeat(40) } }) },
    { env: actionsEnv({ GITHUB_REF: "refs/heads/main" }) },
    { env: actionsEnv({ GITHUB_SHA: "d".repeat(40) }) },
    { current: pullRequest({ draft: true }) },
    { current: pullRequest({ changed_files: 2 }) },
    { event: eventPayload({ event: { action: "synchronize" } }) },
  ]) {
    assert.equal((await classify(input)).result.markdownOnly, false);
  }
});

test("revalidates the exact PR after pagination before returning Markdown-only", async () => {
  for (const finalCurrent of [
    pullRequest({ head: { ...pullRequest().head, sha: "d".repeat(40) } }),
    pullRequest({ changed_files: 2 }),
    pullRequest({ merge_commit_sha: "d".repeat(40) }),
  ]) {
    const { requests, result } = await classify({ finalCurrent });
    assert.deepEqual(result, {
      markdownOnly: false,
      reason: "current-pull-request-mismatch",
    });
    assert.equal(requests.filter((url) => url.includes("/files?")).length, 1);
    assert.equal(requests.filter((url) => !url.includes("/files?")).length, 2);
  }
});

test("fails closed on an unavailable GitHub response without exposing response data", async () => {
  const result = await classifyCurrentPullRequest({
    env: actionsEnv(),
    fetchImpl: async () => response({ private: "provider response" }, false),
    readEvent: async () => eventPayload(),
  });
  assert.deepEqual(result, { markdownOnly: false, reason: "classifier-unavailable" });
});

test("parses a complete no-rename Git inventory and rejects ambiguous statuses", () => {
  assert.deepEqual(
    parseGitNameStatus("A\0docs/new.md\0M\0README.md\0D\0docs/old.md\0"),
    [
      file("docs/new.md", "added"),
      file("README.md", "modified"),
      file("docs/old.md", "removed"),
    ],
  );
  assert.equal(parseGitNameStatus("R100\0apps/web/runtime.ts\0docs/runtime.md\0"), null);
  assert.equal(parseGitNameStatus("M\0README.md"), null);
});

test("skips only exact production main inventories containing eligible Markdown", () => {
  const eligible = gitRunner({
    inventory: "D\0packages/core/README.md\0A\0packages/query/README.md\0M\0docs/guide.md\0",
  });
  assert.deepEqual(
    classifyCurrentVercelBuild({ env: vercelEnv(), runGit: eligible.runGit }),
    { reason: "eligible-markdown-docs", skipBuild: true },
  );
  assert.deepEqual(
    eligible.calls.find((args) => args.includes("diff"))?.slice(-3),
    [BASE_SHA, HEAD_SHA, "--"],
  );

  const mixed = gitRunner({ inventory: "M\0README.md\0M\0apps/web/app/page.tsx\0" });
  assert.deepEqual(
    classifyCurrentVercelBuild({ env: vercelEnv(), runGit: mixed.runGit }),
    { reason: "ineligible-path", skipBuild: false },
  );
});

test("preserves preview skipping and fails production classification closed", () => {
  assert.deepEqual(classifyCurrentVercelBuild({
    env: vercelEnv({ VERCEL_ENV: "preview" }),
    runGit: () => {
      throw new Error("preview classification must not run Git");
    },
  }), { reason: "non-production", skipBuild: true });

  for (const input of [
    { env: vercelEnv({ VERCEL_GIT_COMMIT_REF: "release" }), runGit: gitRunner().runGit },
    { env: vercelEnv({ VERCEL_GIT_PREVIOUS_SHA: "" }), runGit: gitRunner().runGit },
    { env: vercelEnv(), runGit: gitRunner({ head: MERGE_SHA }).runGit },
    { env: vercelEnv(), runGit: () => ({ status: 1, stdout: "" }) },
  ]) {
    assert.equal(classifyCurrentVercelBuild(input).skipBuild, false);
  }
});

test("Vercel executes the shared repository classifier from the Web root", async () => {
  const config = JSON.parse(await readFile(
    new URL("../apps/web/vercel.json", import.meta.url),
    "utf8",
  ));
  assert.equal(
    config.ignoreCommand,
    "node ../../scripts/ci-markdown-docs-scope.mjs --vercel",
  );
});
