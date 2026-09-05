import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyChangedFiles,
  classifyCurrentPullRequest,
  isEligibleMarkdownDocumentationPath,
  isSafeRepositoryPath,
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

async function classify({
  current = pullRequest(),
  env = actionsEnv(),
  event = eventPayload(),
  finalCurrent = current,
  pages = [[file("docs/release-notes/2026-08-25-update.md")]],
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

test("allows only dated release-note records", () => {
  for (const path of [
    "docs/release-notes/2026-03-12-vault-baseline-scaffold.md",
    "docs/release-notes/2026-03-16-device-provider-import-foundation.md",
  ]) {
    assert.equal(isEligibleMarkdownDocumentationPath(path), true, path);
  }
  for (const path of [
    "AGENTS.md",
    "ARCHITECTURE.md",
    "README.md",
    ".agents/skills/frog/SKILL.md",
    "docs/contracts/invariant.md",
    "agent-docs/operations/workflow.md",
    "agent-docs/generated/catalog.md",
    "agent-docs/prompts/reviewer.md",
    "agent-docs/research/2026-08-25-audit.md",
    "agent-docs/research/murph-age-autoresearch.md",
    "docs/incidents/2026-08-25-incident.md",
    "docs/release-notes/README.md",
    "docs/release-notes/change.md",
    "docs/release-notes/2026-08-25.md",
    "docs/release-notes/2026-8-25-change.md",
    "docs/release-notes/2026-08-25-Change.md",
    "docs/release-notes/archive/2026-08-25-change.md",
    "apps/web/README.md",
    "apps/cloudflare/DEPLOY.md",
    "apps/web/changelog/README.md",
    "apps/web/docs/README.md",
    "packages/core/README.md",
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
    file("docs/release-notes/2026-08-25-added.md", "added"),
    file("docs/release-notes/2026-08-24-updated.md", "modified"),
    file("docs/release-notes/2026-08-23-removed.md", "removed"),
    file("docs/release-notes/2026-08-22-renamed.md", "renamed", {
      previous_filename: "docs/release-notes/2026-08-21-old.md",
    }),
  ]), { markdownOnly: true, reason: "eligible-markdown-docs" });
});

test("validates both sides of a rename", () => {
  assert.deepEqual(classifyChangedFiles([
    file("docs/release-notes/2026-08-25-renamed.md", "renamed", {
      previous_filename: "apps/web/runtime.ts",
    }),
  ]), { markdownOnly: false, reason: "ineligible-rename-source" });
});

test("rejects unsupported status, duplicate paths, and mixed changes", () => {
  const eligible = "docs/release-notes/2026-08-25-change.md";
  assert.equal(classifyChangedFiles([file(eligible, "copied")]).markdownOnly, false);
  assert.equal(classifyChangedFiles([file(eligible), file(eligible)]).markdownOnly, false);
  assert.equal(classifyChangedFiles([file(eligible), file("package.json")]).markdownOnly, false);
});

test("traverses every changed-file page and requires the exact count", async () => {
  const firstPage = Array.from(
    { length: 100 },
    (_, index) => file(`docs/release-notes/2026-08-25-page-${index}.md`),
  );
  const secondPage = [file("docs/release-notes/2026-08-25-final.md")];
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
