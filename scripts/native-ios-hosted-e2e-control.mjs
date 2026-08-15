import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION = "1";
export const NATIVE_IOS_HOSTED_E2E_STATUS_CONTEXT = "Native iOS hosted E2E";
export const NATIVE_IOS_HOSTED_E2E_VERCEL_TARGET_ENV = "native-ios-e2e";

const GITHUB_API_VERSION = "2026-03-10";
const HTTP_TIMEOUT_MS = 15_000;
const VERCEL_DEPLOYMENT_TIMEOUT_MS = 25 * 60_000;
const IOS_WORKFLOW_TIMEOUT_MS = 60 * 60_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_PR_FILE_PAGES = 30;
const PR_FILES_PER_PAGE = 100;

const RELEVANT_PREFIXES = [
  "apps/web/app/api/device-sync/",
  "apps/web/app/api/internal/device-sync/",
  "apps/web/app/api/legal/",
  "apps/web/app/api/settings/device-sync/",
  "apps/web/app/api/settings/sensitive-action-challenge/",
  "apps/web/app/api/hosted-onboarding/",
  "apps/web/app/api/settings/privacy/delete/",
  "apps/web/prisma/migrations/",
  "apps/web/src/lib/device-sync/",
  "apps/web/src/lib/hosted-onboarding/",
  "apps/web/src/lib/hosted-privacy/",
  "apps/web/src/lib/hosted-web/",
  "apps/web/src/lib/legal/",
  "apps/web/src/lib/sensitive-actions/",
  "packages/contracts/",
  "packages/device-syncd/",
];

const RELEVANT_EXACT_PATHS = new Set([
  ".github/workflows/native-ios-hosted-e2e.yml",
  ".github/workflows/repo-hygiene.yml",
  ".nvmrc",
  "apps/web/next.config.ts",
  "apps/web/package.json",
  "apps/web/prisma/schema.prisma",
  "apps/web/proxy.ts",
  "apps/web/scripts/hosted-web-migration-owner.ts",
  "apps/web/scripts/run-native-ios-hosted-e2e-migrations.ts",
  "apps/web/scripts/run-prisma-migrate-deploy.ts",
  "apps/web/src/lib/http.ts",
  "apps/web/src/lib/prisma.ts",
  "apps/web/vercel.json",
  "package.json",
  "scripts/check-native-ios-hosted-e2e-ci.mjs",
  "scripts/check-native-ios-hosted-e2e-ci.test.ts",
  "scripts/native-ios-hosted-e2e-control.mjs",
  "scripts/native-ios-hosted-e2e-control.test.ts",
]);

/** @typedef {{ filename: string }} PullRequestFile */

/**
 * @param {readonly string[]} paths
 * @returns {{ matchedPaths: string[]; selected: boolean }}
 */
export function classifyNativeIosHostedE2ePaths(paths) {
  const matchedPaths = paths.filter((candidate) =>
    RELEVANT_EXACT_PATHS.has(candidate)
    || RELEVANT_PREFIXES.some((prefix) => candidate.startsWith(prefix)),
  );
  return {
    matchedPaths,
    selected: matchedPaths.length > 0,
  };
}

/**
 * @param {{
 *   correlationId: string;
 *   mode: "pr" | "production_canary";
 *   webBaseUrl: string;
 *   webDeploymentRef: string;
 *   webSha: string;
 * }} input
 */
export function buildNativeIosHostedE2eDispatchInputs(input) {
  assertCorrelationId(input.correlationId);
  assertSha(input.webSha, "web SHA");
  const webBaseUrl = normalizeHttpsBaseUrl(input.webBaseUrl);
  const webDeploymentRef = readBoundedToken(
    input.webDeploymentRef,
    "web deployment ref",
    180,
  );

  if (input.mode === "pr") {
    return {
      account_lifecycle: "user_owned_delete",
      contract_version: NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
      correlation_id: input.correlationId,
      mode: input.mode,
      web_base_url: webBaseUrl,
      web_deployment_ref: webDeploymentRef,
      web_environment: "native-ios-e2e",
      web_sha: input.webSha,
    };
  }

  if (input.mode === "production_canary") {
    return {
      account_lifecycle: "existing_identity_non_destructive",
      contract_version: NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
      correlation_id: input.correlationId,
      mode: input.mode,
      web_base_url: webBaseUrl,
      web_deployment_ref: webDeploymentRef,
      web_environment: "production",
      web_sha: input.webSha,
    };
  }

  throw new Error(`Unsupported native iOS E2E mode: ${String(input.mode)}.`);
}

/** @param {unknown} raw */
export function readVercelDeploymentId(raw) {
  if (!isRecord(raw)) {
    throw new Error("Vercel deployment response was not an object.");
  }
  const deploymentId = readString(raw.id);
  if (!deploymentId) {
    throw new Error("Vercel deployment response did not include id.");
  }
  return readBoundedToken(deploymentId, "Vercel deployment id", 180);
}

/**
 * @param {unknown} raw
 * @param {{ expectedCustomEnvironmentId: string; expectedProjectId: string; expectedRef: string; expectedSha: string }} expected
 * @returns {{ baseUrl: string; deploymentId: string; ready: boolean; terminalFailure: boolean }}
 */
export function inspectVercelE2eDeployment(raw, expected) {
  if (!isRecord(raw)) {
    throw new Error("Vercel deployment response was not an object.");
  }
  const deploymentId = readVercelDeploymentId(raw);
  const projectId = readString(raw.projectId)
    ?? (isRecord(raw.project) ? readString(raw.project.id) : undefined);
  if (projectId !== expected.expectedProjectId) {
    throw new Error("Vercel deployment resolved to an unexpected project.");
  }
  if (readString(raw.customEnvironmentId) !== expected.expectedCustomEnvironmentId) {
    throw new Error("Vercel deployment resolved to an unexpected custom environment.");
  }
  if (!isRecord(raw.gitSource)) {
    throw new Error("Vercel deployment response did not include gitSource.");
  }
  if (readString(raw.gitSource.sha) !== expected.expectedSha) {
    throw new Error("Vercel deployment does not match the requested PR SHA.");
  }
  if (readString(raw.gitSource.ref) !== expected.expectedRef) {
    throw new Error("Vercel deployment does not match the requested PR ref.");
  }
  if (readString(raw.target) === "production") {
    throw new Error("Native iOS PR E2E must never target a production Vercel deployment.");
  }

  const readyState = readString(raw.readyState) ?? readString(raw.status) ?? "";
  const terminalFailure = new Set(["CANCELED", "ERROR"]).has(readyState.toUpperCase());
  const ready = readyState.toUpperCase() === "READY";
  const url = readString(raw.url);
  if (!url) {
    throw new Error("Vercel deployment response did not include url.");
  }

  return {
    baseUrl: normalizeVercelDeploymentUrl(url),
    deploymentId,
    ready,
    terminalFailure,
  };
}

/**
 * @param {unknown} raw
 * @param {{ expectedEnvironmentId: string; expectedProjectId: string }} expected
 */
export function inspectVercelE2eCustomEnvironment(raw, expected) {
  if (!isRecord(raw)) {
    throw new Error("Vercel custom environment response was not an object.");
  }
  if (readString(raw.id) !== expected.expectedEnvironmentId) {
    throw new Error("Vercel custom environment id does not match protected configuration.");
  }
  if (readString(raw.slug) !== NATIVE_IOS_HOSTED_E2E_VERCEL_TARGET_ENV) {
    throw new Error("Vercel custom environment does not use the required native iOS E2E slug.");
  }
  if (readString(raw.projectId) !== expected.expectedProjectId) {
    throw new Error("Vercel custom environment belongs to an unexpected project.");
  }
}

/**
 * @param {unknown} raw
 * @returns {number}
 */
export function readWorkflowDispatchRunId(raw) {
  if (!isRecord(raw)) {
    throw new Error("GitHub workflow dispatch response was not an object.");
  }
  const runId = raw.workflow_run_id;
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    throw new Error("GitHub workflow dispatch response did not include workflow_run_id.");
  }
  return runId;
}

/**
 * @param {unknown} raw
 * @param {{ expectedRef: string; expectedSha: string }} expected
 */
export function inspectPrivateWorkflowDispatchTag(raw, expected) {
  if (!isRecord(raw) || !isRecord(raw.object)) {
    throw new Error("Private native iOS dispatch tag response was missing ref metadata.");
  }
  if (readString(raw.ref) !== `refs/tags/${expected.expectedRef}`) {
    throw new Error("Private native iOS dispatch ref did not resolve as the configured tag.");
  }
  if (readString(raw.object.type) !== "commit") {
    throw new Error("Private native iOS dispatch tag must be a lightweight commit tag.");
  }
  if (readString(raw.object.sha) !== expected.expectedSha) {
    throw new Error("Private native iOS dispatch tag does not match the approved commit SHA.");
  }
}

/**
 * @param {unknown} raw
 * @param {{ expectedHeadSha: string; expectedRunId: number }} expected
 * @returns {{ completed: boolean; conclusion: string | null }}
 */
export function inspectPrivateWorkflowRun(raw, expected) {
  if (!isRecord(raw)) {
    throw new Error("GitHub workflow run response was not an object.");
  }
  if (raw.id !== expected.expectedRunId) {
    throw new Error("GitHub returned an unexpected workflow run id.");
  }
  if (readString(raw.event) !== "workflow_dispatch") {
    throw new Error("Private native iOS result did not come from workflow_dispatch.");
  }
  if (readString(raw.head_sha) !== expected.expectedHeadSha) {
    throw new Error("Private native iOS workflow ran at an unexpected commit SHA.");
  }
  const status = readString(raw.status);
  const conclusion = raw.conclusion === null ? null : readString(raw.conclusion) ?? null;
  return {
    completed: status === "completed",
    conclusion,
  };
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Map<string, string>} */
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --key value arguments; received ${argv.join(" ")}.`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

/** @param {Map<string, string>} args @param {string} name */
function requiredArg(args, name) {
  const value = args.get(name);
  if (!value) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

/** @param {string} name */
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

/** @param {string} name */
function optionalEnv(name) {
  return process.env[name] || undefined;
}

/** @param {string} value @param {string} label */
function assertSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character Git SHA.`);
  }
}

/** @param {string} value */
function assertCorrelationId(value) {
  if (!/^[A-Za-z0-9._:-]{1,120}$/u.test(value)) {
    throw new Error("correlation id must be 1-120 characters from the safe identifier alphabet.");
  }
}

/** @param {string} value @param {string} label @param {number} maxLength */
function readBoundedToken(value, label, maxLength) {
  if (value.length === 0 || value.length > maxLength || /[\r\n\0]/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

/** @param {string} value */
function readPrivateWorkflowTagRef(value) {
  const ref = readBoundedToken(value, "iOS workflow tag", 180);
  if (
    !/^[A-Za-z0-9._/-]+$/u.test(ref)
    || ref.startsWith("/")
    || ref.endsWith("/")
    || ref.startsWith("refs/")
    || ref.includes("//")
    || ref.includes("..")
    || ref.endsWith(".lock")
  ) {
    throw new Error("NATIVE_IOS_E2E_IOS_REF must name a safe lightweight tag.");
  }
  return ref;
}

/** @param {string} value */
function normalizeHttpsBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("web base URL must be a valid URL.");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.pathname !== "/"
  ) {
    throw new Error("web base URL must be an origin-only HTTPS URL.");
  }
  return parsed.origin;
}

/** @param {string} value */
function normalizeVercelDeploymentUrl(value) {
  const candidate = /^https?:\/\//u.test(value) ? value : `https://${value}`;
  return normalizeHttpsBaseUrl(candidate);
}

/** @param {URL} url @param {string | undefined} teamId */
function appendTeamId(url, teamId) {
  if (teamId) {
    url.searchParams.set("teamId", teamId);
  }
}

/** @param {Response} response @param {string} label */
async function readJsonResponse(response, label) {
  if (!response.ok) {
    // Never echo provider response bodies from control-plane requests. HTTP
    // status plus the stage label is enough for the gate and keeps accidental
    // sensitive provider prose out of CI logs.
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} failed with HTTP ${response.status}.`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

/** @param {string} url @param {RequestInit} init @param {string} label */
async function fetchJson(url, init, label) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  return await readJsonResponse(response, label);
}

/** @param {number} milliseconds */
async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** @param {string} key @param {string | number | boolean} value */
async function writeGithubOutput(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is required for this command.");
  }
  const normalized = String(value);
  if (/\r|\n/u.test(normalized)) {
    throw new Error(`Output ${key} must be single-line.`);
  }
  await appendFile(outputPath, `${key}=${normalized}\n`, "utf8");
}

/** @param {string} token */
function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": "murph-native-ios-hosted-e2e-control",
  };
}

/** @param {string} token */
function vercelHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

/** @param {Map<string, string>} args */
async function resolvePr(args) {
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const githubToken = requiredEnv("GITHUB_TOKEN");
  const prNumber = requiredArg(args, "pr-number");
  const expectedHeadSha = requiredArg(args, "expected-head-sha");
  assertSha(expectedHeadSha, "workflow-run head SHA");
  if (!/^\d+$/u.test(prNumber)) {
    throw new Error("PR number must be numeric.");
  }

  const pull = await fetchJson(
    `https://api.github.com/repos/${repository}/pulls/${prNumber}`,
    { headers: githubHeaders(githubToken) },
    "GitHub pull request lookup",
  );
  if (!isRecord(pull) || !isRecord(pull.head) || !isRecord(pull.base)) {
    throw new Error("GitHub pull request response was missing head/base metadata.");
  }
  const headSha = readString(pull.head.sha);
  const baseSha = readString(pull.base.sha);
  const headRef = readString(pull.head.ref);
  const headRepository = isRecord(pull.head.repo) ? readString(pull.head.repo.full_name) : undefined;
  if (!headSha || !baseSha || !headRef || !headRepository) {
    throw new Error("GitHub pull request response was missing required head/base fields.");
  }
  assertSha(headSha, "PR head SHA");
  assertSha(baseSha, "PR base SHA");
  if (headSha !== expectedHeadSha) {
    throw new Error("Repo Hygiene workflow head is stale relative to the current PR head.");
  }

  /** @type {string[]} */
  const filenames = [];
  let hitFileLimit = false;
  for (let page = 1; page <= MAX_PR_FILE_PAGES; page += 1) {
    const files = await fetchJson(
      `https://api.github.com/repos/${repository}/pulls/${prNumber}/files?per_page=${PR_FILES_PER_PAGE}&page=${page}`,
      { headers: githubHeaders(githubToken) },
      "GitHub pull request files lookup",
    );
    if (!Array.isArray(files)) {
      throw new Error("GitHub pull request files response was not an array.");
    }
    for (const file of files) {
      if (!isRecord(file) || !readString(file.filename)) {
        throw new Error("GitHub pull request file entry did not include filename.");
      }
      filenames.push(file.filename);
    }
    if (files.length < PR_FILES_PER_PAGE) {
      break;
    }
    if (page === MAX_PR_FILE_PAGES) {
      hitFileLimit = true;
    }
  }

  const classification = classifyNativeIosHostedE2ePaths(filenames);
  const selected = hitFileLimit || classification.selected;
  const authorType = isRecord(pull.user) ? readString(pull.user.type) : undefined;
  const trusted = headRepository === repository && authorType === "User";
  const selectionReason = hitFileLimit
    ? "file_limit_fail_closed"
    : selected
      ? "relevant_paths"
      : "irrelevant_paths";

  await writeGithubOutput("base_sha", baseSha);
  await writeGithubOutput("head_ref", readBoundedToken(headRef, "PR head ref", 240));
  await writeGithubOutput("head_sha", headSha);
  await writeGithubOutput("matched_count", classification.matchedPaths.length);
  await writeGithubOutput("selected", selected);
  await writeGithubOutput("selection_reason", selectionReason);
  await writeGithubOutput("trusted", trusted);
}

/** @param {Map<string, string>} args */
async function setCommitStatus(args) {
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const githubToken = requiredEnv("GITHUB_TOKEN");
  const sha = requiredArg(args, "sha");
  const state = requiredArg(args, "state");
  const description = readBoundedToken(requiredArg(args, "description"), "status description", 140);
  assertSha(sha, "status SHA");
  if (!new Set(["error", "failure", "pending", "success"]).has(state)) {
    throw new Error("status state must be error, failure, pending, or success.");
  }
  const serverUrl = requiredEnv("GITHUB_SERVER_URL");
  const runId = requiredEnv("GITHUB_RUN_ID");
  const response = await fetch(`https://api.github.com/repos/${repository}/statuses/${sha}`, {
    body: JSON.stringify({
      context: NATIVE_IOS_HOSTED_E2E_STATUS_CONTEXT,
      description,
      state,
      target_url: `${serverUrl}/${repository}/actions/runs/${runId}`,
    }),
    headers: {
      ...githubHeaders(githubToken),
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`GitHub commit status update failed with HTTP ${response.status}.`);
  }
  await response.body?.cancel().catch(() => undefined);
}

/** @param {Map<string, string>} args */
async function deployPreview(args) {
  const token = requiredEnv("NATIVE_IOS_E2E_VERCEL_TOKEN");
  const projectId = requiredEnv("NATIVE_IOS_E2E_VERCEL_PROJECT_ID");
  const projectName = requiredEnv("NATIVE_IOS_E2E_VERCEL_PROJECT_NAME");
  const customEnvironmentId = readBoundedToken(
    requiredEnv("NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID"),
    "Vercel custom environment id",
    180,
  );
  const repositoryIdRaw = requiredEnv("NATIVE_IOS_E2E_VERCEL_GITHUB_REPOSITORY_ID");
  const teamId = optionalEnv("NATIVE_IOS_E2E_VERCEL_TEAM_ID");
  const sha = requiredArg(args, "sha");
  const ref = readBoundedToken(requiredArg(args, "ref"), "PR ref", 240);
  const correlationId = requiredArg(args, "correlation-id");
  assertSha(sha, "PR SHA");
  assertCorrelationId(correlationId);
  const repositoryId = Number(repositoryIdRaw);
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new Error("NATIVE_IOS_E2E_VERCEL_GITHUB_REPOSITORY_ID must be a positive integer.");
  }

  const customEnvironmentUrl = new URL(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/custom-environments/${encodeURIComponent(customEnvironmentId)}`,
  );
  appendTeamId(customEnvironmentUrl, teamId);
  const customEnvironment = await fetchJson(
    customEnvironmentUrl.toString(),
    { headers: vercelHeaders(token) },
    "Vercel native iOS E2E custom environment lookup",
  );
  inspectVercelE2eCustomEnvironment(customEnvironment, {
    expectedEnvironmentId: customEnvironmentId,
    expectedProjectId: projectId,
  });

  const createUrl = new URL("https://api.vercel.com/v13/deployments");
  appendTeamId(createUrl, teamId);
  const created = await fetchJson(
    createUrl.toString(),
    {
      body: JSON.stringify({
        customEnvironmentSlugOrId: customEnvironmentId,
        gitSource: {
          ref,
          repoId: repositoryId,
          sha,
          type: "github",
        },
        meta: {
          murphNativeIosE2e: "1",
          murphNativeIosE2eCorrelationId: correlationId,
          murphWebSha: sha,
        },
        name: projectName,
        project: projectId,
        public: false,
      }),
      headers: vercelHeaders(token),
      method: "POST",
    },
    "Vercel preview deployment create",
  );
  const deploymentId = readVercelDeploymentId(created);
  // Publish the exact newly-created id before provenance polling so the
  // workflow's always-run cleanup can retire it even if read-back fails closed.
  await writeGithubOutput("deployment_id", deploymentId);

  const deadline = Date.now() + VERCEL_DEPLOYMENT_TIMEOUT_MS;
  while (true) {
    const deploymentUrl = new URL(
      `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}`,
    );
    deploymentUrl.searchParams.set("withGitRepoInfo", "true");
    appendTeamId(deploymentUrl, teamId);
    const polled = await fetchJson(
      deploymentUrl.toString(),
      { headers: vercelHeaders(token) },
      "Vercel preview deployment status",
    );
    const latest = inspectVercelE2eDeployment(polled, {
      expectedCustomEnvironmentId: customEnvironmentId,
      expectedProjectId: projectId,
      expectedRef: ref,
      expectedSha: sha,
    });
    if (latest.deploymentId !== deploymentId) {
      throw new Error("Vercel deployment read-back returned an unexpected id.");
    }
    if (latest.ready) {
      await writeGithubOutput("base_url", latest.baseUrl);
      console.log("::notice::Exact hosted E2E Web deployment is ready.");
      return;
    }
    if (latest.terminalFailure) {
      throw new Error("Vercel preview deployment entered a terminal failure state.");
    }
    if (Date.now() >= deadline) {
      throw new Error("Vercel preview deployment did not become ready before the E2E deadline.");
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** @param {Map<string, string>} args */
async function deletePreview(args) {
  const token = requiredEnv("NATIVE_IOS_E2E_VERCEL_TOKEN");
  const teamId = optionalEnv("NATIVE_IOS_E2E_VERCEL_TEAM_ID");
  const deploymentId = readBoundedToken(requiredArg(args, "deployment-id"), "deployment id", 180);
  const url = new URL(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}`,
  );
  appendTeamId(url, teamId);
  const response = await fetch(url, {
    headers: vercelHeaders(token),
    method: "DELETE",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok && response.status !== 404) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Vercel preview deployment cleanup failed with HTTP ${response.status}.`);
  }
  await response.body?.cancel().catch(() => undefined);
  console.log("::notice::Hosted E2E preview deployment retired.");
}

/** @param {Map<string, string>} args */
async function dispatchAndWait(args) {
  const token = requiredEnv("NATIVE_IOS_E2E_GITHUB_TOKEN");
  const repository = requiredEnv("NATIVE_IOS_E2E_IOS_REPOSITORY");
  const workflow = readBoundedToken(requiredEnv("NATIVE_IOS_E2E_IOS_WORKFLOW"), "iOS workflow", 180);
  const ref = readPrivateWorkflowTagRef(requiredEnv("NATIVE_IOS_E2E_IOS_REF"));
  const expectedPrivateSha = requiredEnv("NATIVE_IOS_E2E_IOS_EXPECTED_SHA");
  assertSha(expectedPrivateSha, "expected private iOS SHA");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("NATIVE_IOS_E2E_IOS_REPOSITORY must be owner/repository.");
  }

  const tagPath = ref.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const dispatchTag = await fetchJson(
    `https://api.github.com/repos/${repository}/git/ref/tags/${tagPath}`,
    { headers: githubHeaders(token) },
    "private native iOS workflow dispatch tag",
  );
  inspectPrivateWorkflowDispatchTag(dispatchTag, {
    expectedRef: ref,
    expectedSha: expectedPrivateSha,
  });

  const mode = requiredArg(args, "mode");
  if (mode !== "pr" && mode !== "production_canary") {
    throw new Error("--mode must be pr or production_canary.");
  }
  const inputs = buildNativeIosHostedE2eDispatchInputs({
    correlationId: requiredArg(args, "correlation-id"),
    mode,
    webBaseUrl: requiredArg(args, "web-base-url"),
    webDeploymentRef: requiredArg(args, "web-deployment-ref"),
    webSha: requiredArg(args, "web-sha"),
  });

  const dispatchUrl = `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  const dispatchReceipt = await fetchJson(
    dispatchUrl,
    {
      body: JSON.stringify({ inputs, ref }),
      headers: {
        ...githubHeaders(token),
        "content-type": "application/json",
      },
      method: "POST",
    },
    "private native iOS workflow dispatch",
  );
  const runId = readWorkflowDispatchRunId(dispatchReceipt);
  await writeGithubOutput("ios_workflow_run_id", runId);
  console.log(`::notice::Private native iOS E2E workflow dispatched as run ${runId}.`);

  const deadline = Date.now() + IOS_WORKFLOW_TIMEOUT_MS;
  while (true) {
    const run = await fetchJson(
      `https://api.github.com/repos/${repository}/actions/runs/${runId}`,
      { headers: githubHeaders(token) },
      "private native iOS workflow status",
    );
    const inspected = inspectPrivateWorkflowRun(run, {
      expectedHeadSha: expectedPrivateSha,
      expectedRunId: runId,
    });
    if (inspected.completed) {
      await writeGithubOutput("ios_workflow_conclusion", inspected.conclusion ?? "unknown");
      if (inspected.conclusion !== "success") {
        throw new Error(
          `Private native iOS E2E workflow completed with ${inspected.conclusion ?? "no conclusion"}.`,
        );
      }
      console.log(`::notice::Private native iOS E2E run ${runId} completed successfully.`);
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error("Private native iOS E2E workflow did not complete before the gate deadline.");
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** @param {string[]} argv */
async function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  switch (command) {
    case "resolve-pr":
      await resolvePr(args);
      return;
    case "set-status":
      await setCommitStatus(args);
      return;
    case "deploy-preview":
      await deployPreview(args);
      return;
    case "delete-preview":
      await deletePreview(args);
      return;
    case "dispatch-and-wait":
      await dispatchAndWait(args);
      return;
    default:
      throw new Error(
        "Expected command: resolve-pr, set-status, deploy-preview, delete-preview, or dispatch-and-wait.",
      );
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
