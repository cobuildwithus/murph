import { appendFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MAX_CHANGED_FILES = 3_000;
const MAX_GIT_OUTPUT_BYTES = 4 * 1_024 * 1_024;
const PAGE_SIZE = 100;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SAFE_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/u;
const SUPPORTED_STATUSES = new Set(["added", "modified", "removed", "renamed"]);

export function isSafeRepositoryPath(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 1_024
    || !SAFE_PATH_PATTERN.test(value)
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("//")
  ) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "." && segment !== "..");
}

export function isEligibleMarkdownDocumentationPath(value) {
  if (!isSafeRepositoryPath(value) || !value.endsWith(".md")) return false;
  return value.startsWith("agent-docs/research/")
    || value.startsWith("docs/incidents/")
    || value.startsWith("docs/release-notes/");
}

export function classifyChangedFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_CHANGED_FILES) {
    return { markdownOnly: false, reason: "invalid-file-inventory" };
  }

  const filenames = new Set();
  for (const file of files) {
    if (!isRecord(file) || !SUPPORTED_STATUSES.has(file.status)) {
      return { markdownOnly: false, reason: "unsupported-file-status" };
    }
    if (!isSafeRepositoryPath(file.filename) || filenames.has(file.filename)) {
      return { markdownOnly: false, reason: "unsafe-or-duplicate-path" };
    }
    filenames.add(file.filename);

    if (!isEligibleMarkdownDocumentationPath(file.filename)) {
      return { markdownOnly: false, reason: "ineligible-path" };
    }

    if (file.status === "renamed") {
      if (!isEligibleMarkdownDocumentationPath(file.previous_filename)) {
        return { markdownOnly: false, reason: "ineligible-rename-source" };
      }
    } else if (file.previous_filename !== undefined && file.previous_filename !== null) {
      return { markdownOnly: false, reason: "unexpected-previous-path" };
    }
  }
  return { markdownOnly: true, reason: "eligible-markdown-docs" };
}

export function parseGitNameStatus(output) {
  if (
    typeof output !== "string"
    || output.length === 0
    || Buffer.byteLength(output, "utf8") > MAX_GIT_OUTPUT_BYTES
    || !output.endsWith("\0")
  ) {
    return null;
  }

  const fields = output.split("\0");
  fields.pop();
  if (fields.length % 2 !== 0) return null;

  const statusByCode = new Map([
    ["A", "added"],
    ["D", "removed"],
    ["M", "modified"],
  ]);
  const files = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = statusByCode.get(fields[index]);
    const filename = fields[index + 1];
    if (!status || typeof filename !== "string") return null;
    files.push({ filename, status });
    if (files.length > MAX_CHANGED_FILES) return null;
  }
  return files;
}

export function classifyCurrentVercelBuild({
  env = process.env,
  runGit = runGitCommand,
} = {}) {
  try {
    if (env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development") {
      if (
        typeof env.VERCEL_TARGET_ENV === "string"
        && env.VERCEL_TARGET_ENV !== env.VERCEL_ENV
      ) {
        return { reason: "custom-environment", skipBuild: false };
      }
      return { reason: "non-production", skipBuild: true };
    }
    if (
      env.VERCEL_ENV !== "production"
      || env.VERCEL_GIT_COMMIT_REF !== "main"
      || !SHA_PATTERN.test(env.VERCEL_GIT_PREVIOUS_SHA ?? "")
      || !SHA_PATTERN.test(env.VERCEL_GIT_COMMIT_SHA ?? "")
      || env.VERCEL_GIT_PREVIOUS_SHA === env.VERCEL_GIT_COMMIT_SHA
    ) {
      return { reason: "invalid-vercel-context", skipBuild: false };
    }

    const repositoryRoot = requireGitOutput(runGit, ["rev-parse", "--show-toplevel"]).trim();
    if (repositoryRoot.length === 0 || repositoryRoot.includes("\0")) {
      return { reason: "invalid-repository-root", skipBuild: false };
    }

    const currentSha = env.VERCEL_GIT_COMMIT_SHA;
    const previousSha = env.VERCEL_GIT_PREVIOUS_SHA;
    const headSha = requireGitOutput(runGit, ["-C", repositoryRoot, "rev-parse", "HEAD"]).trim();
    if (headSha !== currentSha) {
      return { reason: "current-commit-mismatch", skipBuild: false };
    }

    requireGitSuccess(runGit, ["-C", repositoryRoot, "cat-file", "-e", `${previousSha}^{commit}`]);
    requireGitSuccess(runGit, ["-C", repositoryRoot, "merge-base", "--is-ancestor", previousSha, currentSha]);
    const inventory = parseGitNameStatus(requireGitOutput(runGit, [
      "-C",
      repositoryRoot,
      "diff",
      "--name-status",
      "-z",
      "--no-ext-diff",
      "--no-renames",
      "--diff-filter=ACDMRTUXB",
      previousSha,
      currentSha,
      "--",
    ]));
    if (!inventory) {
      return { reason: "invalid-git-inventory", skipBuild: false };
    }
    const result = classifyChangedFiles(inventory);
    return { reason: result.reason, skipBuild: result.markdownOnly };
  } catch {
    return { reason: "classifier-unavailable", skipBuild: false };
  }
}

export async function classifyCurrentPullRequest({
  env = process.env,
  fetchImpl = fetch,
  readEvent = readEventPayload,
} = {}) {
  try {
    const context = await readContext(env, readEvent);
    if (!context.ok) return context.result;

    const current = await fetchJson(
      fetchImpl,
      `${context.apiRoot}/repos/${context.repository}/pulls/${context.number}`,
      context.token,
    );
    const currentResult = validateCurrentPullRequest(context, current);
    if (!currentResult.ok) return currentResult.result;

    const changedFiles = current.changed_files;
    if (
      !Number.isSafeInteger(changedFiles)
      || changedFiles < 1
      || changedFiles > MAX_CHANGED_FILES
    ) {
      return { markdownOnly: false, reason: "invalid-changed-file-count" };
    }

    const files = [];
    const filenames = new Set();
    const pageCount = Math.ceil(changedFiles / PAGE_SIZE);
    for (let page = 1; page <= pageCount; page += 1) {
      const pageFiles = await fetchJson(
        fetchImpl,
        `${context.apiRoot}/repos/${context.repository}/pulls/${context.number}/files?per_page=${PAGE_SIZE}&page=${page}`,
        context.token,
      );
      if (!Array.isArray(pageFiles) || pageFiles.length === 0 || pageFiles.length > PAGE_SIZE) {
        return { markdownOnly: false, reason: "invalid-file-page" };
      }
      for (const file of pageFiles) {
        if (!isRecord(file) || typeof file.filename !== "string" || filenames.has(file.filename)) {
          return { markdownOnly: false, reason: "invalid-file-page" };
        }
        filenames.add(file.filename);
        files.push(file);
      }
      if (files.length > changedFiles) {
        return { markdownOnly: false, reason: "file-count-mismatch" };
      }
    }
    if (files.length !== changedFiles) {
      return { markdownOnly: false, reason: "file-count-mismatch" };
    }
    const result = classifyChangedFiles(files);
    if (!result.markdownOnly) return result;

    const confirmedCurrent = await fetchJson(
      fetchImpl,
      `${context.apiRoot}/repos/${context.repository}/pulls/${context.number}`,
      context.token,
    );
    const confirmedResult = validateCurrentPullRequest(context, confirmedCurrent);
    if (!confirmedResult.ok) return confirmedResult.result;
    return result;
  } catch {
    return { markdownOnly: false, reason: "classifier-unavailable" };
  }
}

async function readContext(env, readEvent) {
  if (env.GITHUB_EVENT_NAME !== "pull_request") {
    return rejectedContext("not-pull-request");
  }
  if (
    typeof env.GITHUB_EVENT_PATH !== "string"
    || typeof env.GITHUB_TOKEN !== "string"
    || env.GITHUB_TOKEN.length === 0
    || typeof env.GITHUB_REPOSITORY !== "string"
    || !SAFE_REPOSITORY_PATTERN.test(env.GITHUB_REPOSITORY)
  ) {
    return rejectedContext("invalid-actions-context");
  }

  const event = await readEvent(env.GITHUB_EVENT_PATH);
  if (!isRecord(event) || !isRecord(event.pull_request) || !isRecord(event.repository)) {
    return rejectedContext("invalid-event-payload");
  }
  if (!new Set(["opened", "reopened", "ready_for_review"]).has(event.action)) {
    return rejectedContext("unsupported-event-action");
  }

  const pullRequest = event.pull_request;
  const number = event.number;
  if (
    !Number.isSafeInteger(number)
    || number < 1
    || pullRequest.number !== number
    || event.repository.full_name !== env.GITHUB_REPOSITORY
    || !matchingPullRequestIdentity(pullRequest, pullRequest)
    || pullRequest.base.repo.full_name !== env.GITHUB_REPOSITORY
    || !SAFE_REPOSITORY_PATTERN.test(pullRequest.head.repo.full_name)
    || !Number.isSafeInteger(pullRequest.changed_files)
    || pullRequest.state !== "open"
    || pullRequest.draft !== false
    || env.GITHUB_REF !== `refs/pull/${number}/merge`
    || env.GITHUB_BASE_REF !== pullRequest.base.ref
    || env.GITHUB_HEAD_REF !== pullRequest.head.ref
    || env.GITHUB_SHA !== pullRequest.merge_commit_sha
  ) {
    return rejectedContext("event-context-mismatch");
  }

  const apiRoot = env.GITHUB_API_URL ?? "https://api.github.com";
  if (apiRoot !== "https://api.github.com") {
    return rejectedContext("unsupported-api-root");
  }

  return {
    apiRoot,
    eventPullRequest: pullRequest,
    number,
    ok: true,
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN,
  };
}

function validateCurrentPullRequest(context, current) {
  if (
    !isRecord(current)
    || current.number !== context.number
    || current.state !== "open"
    || current.draft !== false
    || !matchingPullRequestIdentity(context.eventPullRequest, current)
    || current.merge_commit_sha !== context.eventPullRequest.merge_commit_sha
    || current.changed_files !== context.eventPullRequest.changed_files
  ) {
    return rejectedContext("current-pull-request-mismatch");
  }
  return { ok: true };
}

function matchingPullRequestIdentity(expected, actual) {
  if (!isRecord(expected) || !isRecord(actual)) return false;
  if (!isRecord(expected.base) || !isRecord(expected.head)) return false;
  if (!isRecord(actual.base) || !isRecord(actual.head)) return false;
  if (!isRecord(expected.base.repo) || !isRecord(expected.head.repo)) return false;
  if (!isRecord(actual.base.repo) || !isRecord(actual.head.repo)) return false;
  return SHA_PATTERN.test(expected.base.sha)
    && SHA_PATTERN.test(expected.head.sha)
    && SHA_PATTERN.test(expected.merge_commit_sha)
    && actual.base.sha === expected.base.sha
    && actual.base.ref === expected.base.ref
    && actual.base.repo.full_name === expected.base.repo.full_name
    && actual.head.sha === expected.head.sha
    && actual.head.ref === expected.head.ref
    && actual.head.repo.full_name === expected.head.repo.full_name;
}

async function fetchJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response || response.ok !== true) throw new Error("GitHub request failed");
  return response.json();
}

async function readEventPayload(eventPath) {
  return JSON.parse(await readFile(eventPath, "utf8"));
}

function rejectedContext(reason) {
  return { ok: false, result: { markdownOnly: false, reason } };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runGitCommand(args) {
  return spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function requireGitSuccess(runGit, args) {
  const result = runGit(args);
  if (!isRecord(result) || result.status !== 0) throw new Error("Git command failed");
  return result;
}

function requireGitOutput(runGit, args) {
  const result = requireGitSuccess(runGit, args);
  if (typeof result.stdout !== "string") throw new Error("Git output unavailable");
  return result.stdout;
}

async function main() {
  if (process.argv[2] === "--vercel") {
    const result = classifyCurrentVercelBuild();
    console.log(
      result.skipBuild
        ? "Vercel build skipped by the repository documentation policy."
        : `Vercel build retained (${result.reason}).`,
    );
    process.exitCode = result.skipBuild ? 0 : 1;
    return;
  }

  const result = await classifyCurrentPullRequest();
  const outputPath = process.env.GITHUB_OUTPUT;
  if (typeof outputPath === "string" && outputPath.length > 0) {
    await appendFile(
      outputPath,
      `markdown_only=${result.markdownOnly ? "true" : "false"}\nreason=${result.reason}\n`,
    );
  }
  console.log(
    result.markdownOnly
      ? "Exact pull-request inventory contains only eligible Markdown documentation."
      : `Full verification retained (${result.reason}).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
