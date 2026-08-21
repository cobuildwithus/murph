#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPOSITORY = "cobuildwithus/murph";
const REPO_HYGIENE_WORKFLOW_FILE = "repo-hygiene.yml";
const REPO_HYGIENE_WORKFLOW_NAME = "Repo Hygiene";
const REPO_HYGIENE_WORKFLOW_PATH = ".github/workflows/repo-hygiene.yml";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const USAGE = "Usage: node scripts/native-ios-hosted-e2e-retry.mjs --pr <number>.";

export function parseNativeIosHostedE2eRetryArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--pr" || !/^[1-9][0-9]*$/u.test(argv[1])) {
    throw new Error(USAGE);
  }
  const prNumber = Number(argv[1]);
  if (!Number.isSafeInteger(prNumber)) throw new Error(USAGE);
  return { prNumber };
}

export function inspectRetryableNativeIosPullRequest(
  value,
  { expectedHeadRef, expectedHeadSha, expectedPrNumber } = {},
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GitHub returned an invalid pull request payload.");
  }
  if (value.number !== expectedPrNumber) {
    throw new Error("GitHub returned a different pull request than requested.");
  }
  if (value.state !== "open") {
    throw new Error(`PR #${expectedPrNumber} is not open.`);
  }
  if (value.head?.repo?.full_name !== REPOSITORY || value.user?.type !== "User") {
    throw new Error(
      "Native hosted E2E retries require an open same-repository human-authored PR.",
    );
  }
  const headRef = value.head?.ref;
  const headSha = value.head?.sha;
  if (typeof headRef !== "string" || headRef.length === 0 || headRef.length > 255) {
    throw new Error("The pull request does not expose a bounded head ref.");
  }
  if (typeof headSha !== "string" || !SHA_PATTERN.test(headSha)) {
    throw new Error("The pull request does not expose an exact lowercase Git SHA.");
  }
  if (expectedHeadRef && headRef !== expectedHeadRef) {
    throw new Error("The pull request head ref changed before the retry could be submitted.");
  }
  if (expectedHeadSha && headSha !== expectedHeadSha) {
    throw new Error("The pull request head changed before the retry could be submitted.");
  }
  return { headRef, headSha };
}

export function selectRetryableRepoHygieneRun(
  value,
  { headRef, headSha, prNumber },
) {
  if (typeof headRef !== "string" || headRef.length === 0 || headRef.length > 255) {
    throw new Error("Expected a bounded head ref.");
  }
  if (!SHA_PATTERN.test(headSha)) throw new Error("Expected an exact lowercase Git SHA.");
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) throw new Error(USAGE);
  const pages = Array.isArray(value) ? value : [value];
  const runs = pages.flatMap((page) => Array.isArray(page?.workflow_runs)
    ? page.workflow_runs
    : []);
  const owners = runs.filter((run) => (
    Number.isSafeInteger(run?.id)
    && run.id > 0
    && run.name === REPO_HYGIENE_WORKFLOW_NAME
    && run.path === REPO_HYGIENE_WORKFLOW_PATH
    && run.event === "pull_request"
    && run.head_branch === headRef
    && run.head_sha === headSha
    && run.repository?.full_name === REPOSITORY
    && run.head_repository?.full_name === REPOSITORY
    && Array.isArray(run.pull_requests)
    && (run.pull_requests.length === 0
      || run.pull_requests.some((pullRequest) => pullRequest?.number === prNumber))
  ));
  if (owners.some((run) => run.status !== "completed")) {
    throw new Error("Repo Hygiene already has an active exact-head run; let it complete.");
  }
  const eligible = owners.filter((run) => run.conclusion === "success");
  if (eligible.length === 0) {
    throw new Error("No successful exact-head Repo Hygiene run is available to retry.");
  }
  return eligible.reduce((latest, run) => run.id > latest.id ? run : latest);
}

export async function retryNativeIosHostedE2e({ prNumber, request = requestGitHubApi }) {
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) throw new Error(USAGE);
  const prEndpoint = `repos/${REPOSITORY}/pulls/${prNumber}`;
  const initial = inspectRetryableNativeIosPullRequest(
    await request({ endpoint: prEndpoint, method: "GET" }),
    { expectedPrNumber: prNumber },
  );
  const runsEndpoint = [
    `repos/${REPOSITORY}/actions/workflows/${REPO_HYGIENE_WORKFLOW_FILE}/runs`,
    `?event=pull_request&branch=${encodeURIComponent(initial.headRef)}`,
    `&head_sha=${initial.headSha}&per_page=100`,
  ].join("");
  const run = selectRetryableRepoHygieneRun(
    await request({ endpoint: runsEndpoint, method: "GET", paginate: true }),
    { headRef: initial.headRef, headSha: initial.headSha, prNumber },
  );

  inspectRetryableNativeIosPullRequest(
    await request({ endpoint: prEndpoint, method: "GET" }),
    {
      expectedHeadRef: initial.headRef,
      expectedHeadSha: initial.headSha,
      expectedPrNumber: prNumber,
    },
  );
  await request({
    endpoint: `repos/${REPOSITORY}/actions/runs/${run.id}/rerun`,
    method: "POST",
  });
  return { headSha: initial.headSha, prNumber, repoHygieneRunId: run.id };
}

function requestGitHubApi({ endpoint, method, paginate = false }) {
  const args = ["api", endpoint, "--method", method];
  if (paginate) args.push("--paginate", "--slurp");
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error?.code === "ENOENT") {
    throw new Error("GitHub CLI (gh) is required for the native hosted E2E retry helper.");
  }
  if (result.error) throw new Error("Unable to execute GitHub CLI.");
  if (result.status !== 0) {
    throw new Error(`GitHub API ${method} request failed with exit code ${result.status}.`);
  }
  if (method !== "GET") return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("GitHub returned invalid JSON to the native hosted E2E retry helper.");
  }
}

async function main(argv) {
  const { prNumber } = parseNativeIosHostedE2eRetryArgs(argv);
  const result = await retryNativeIosHostedE2e({ prNumber });
  console.log([
    `Restarted exact-head Repo Hygiene run ${result.repoHygieneRunId}`,
    `for PR #${result.prNumber} at ${result.headSha}; its successful completion`,
    "will create fresh applicable native iOS and Android waiters.",
  ].join(" "));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
