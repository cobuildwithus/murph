import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const TEMPORAL_COMPATIBILITY_CONTRACT_VERSION = "1";
export const TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY = "cobuildwithus/murph-cloud";
export const TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW = "public-murph-integration.yml";
export const TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME = "Public Murph Integration";
export const TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH =
  ".github/workflows/public-murph-integration.yml";

const GITHUB_API_VERSION = "2026-03-10";
const HTTP_TIMEOUT_MS = 30_000;
const PRIVATE_RUN_TIMEOUT_MS = 60 * 60_000;
const CANCEL_GRACE_MS = 2 * 60_000;
const POLL_MS = 15_000;
const MAX_CHANGED_FILES = 3_000;
const MAX_PRODUCER_FIXTURE_BYTES = 32 * 1024;
const MAX_PRODUCER_FIXTURES = 16;
const PAGE_SIZE = 100;

const RELEVANT_PREFIXES = [
  "apps/cloudflare/",
  "apps/web/",
  "packages/assistant-runtime/",
  "packages/cloudflare-hosted-control/",
  "packages/contracts/",
  "packages/device-syncd/",
  "packages/hosted-execution/",
  "packages/hosted-local-harness/",
  "packages/hosted-orchestrator-temporal/",
  "packages/runtime-state/",
];

const RELEVANT_EXACT_PATHS = new Set([
  ".github/workflows/repo-hygiene.yml",
  ".github/workflows/temporal-compatibility.yml",
  ".github/temporal-compatibility-controller.json",
  ".nvmrc",
  "config/workspace-source-resolution.ts",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/check-hosted-local-cross-repo-ci.test.ts",
  "scripts/check-hosted-local-cross-repo-ci.ts",
  "scripts/check-hosted-temporal-orchestration-guards.test.ts",
  "scripts/check-hosted-temporal-orchestration-guards.ts",
  "scripts/hosted-local.ts",
  "scripts/hosted-orchestration-compatibility.mjs",
  "scripts/hosted-orchestration-compatibility.test.mjs",
  "scripts/setup-temporal-cli.sh",
  "scripts/temporal-compatibility-producer-fixtures.test.ts",
  "scripts/temporal-compatibility-producer-fixtures.ts",
  "scripts/temporal-dev-server.sh",
  "tsconfig.base.json",
]);

export function isTemporalCompatibilityRelevantPath(value) {
  const filePath = requiredString(value, "changed file path");
  return RELEVANT_EXACT_PATHS.has(filePath)
    || RELEVANT_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

export function inspectPullRequest(raw, {
  expectedBaseRef,
  expectedHeadSha,
  prNumber,
  repository,
}) {
  assertRecord(raw, "pull request");
  assertSafeId(expectedBaseRef, "expected public base ref", 255, /^[A-Za-z0-9._/-]+$/u);
  assertSha(expectedHeadSha, "expected public SHA");
  assertRepository(repository, "public repository");
  if (raw.number !== prNumber || raw.state !== "open" || !isRecord(raw.head)) {
    throw new Error("Public pull request identity is invalid or no longer open.");
  }
  const headSha = requiredString(raw.head.sha, "public pull request head SHA");
  assertSha(headSha, "public pull request head SHA");
  if (headSha !== expectedHeadSha) {
    throw new Error("Public pull request head changed after Repo Hygiene.");
  }
  const changedFiles = raw.changed_files;
  if (!Number.isSafeInteger(changedFiles) || changedFiles < 0) {
    throw new Error("Public pull request changed-file count is invalid.");
  }
  if (
    !isRecord(raw.base)
    || !isRecord(raw.base.repo)
    || raw.base.repo.full_name !== repository
  ) {
    throw new Error("Public pull request base repository is invalid.");
  }
  const baseRef = requiredString(raw.base.ref, "public pull request base ref");
  assertSafeId(baseRef, "public pull request base ref", 255, /^[A-Za-z0-9._/-]+$/u);
  const trusted = isRecord(raw.head.repo)
    && raw.head.repo.full_name === repository
    && isRecord(raw.user)
    && raw.user.type === "User";
  return {
    changedFiles,
    headSha,
    targetsDefaultBranch: baseRef === expectedBaseRef,
    trusted,
  };
}

export function inspectChangedFilePage(raw, { expectedCount, page }) {
  if (!Array.isArray(raw)) throw new Error("Changed-file page is malformed.");
  const isLastPage = page === Math.max(1, Math.ceil(expectedCount / PAGE_SIZE));
  const expectedLength = isLastPage
    ? expectedCount - PAGE_SIZE * (page - 1)
    : PAGE_SIZE;
  if (raw.length !== expectedLength) {
    throw new Error("Changed-file pagination is incomplete.");
  }
  return raw.map((entry) => {
    assertRecord(entry, "changed file");
    const filename = safeRepoPath(entry.filename, "changed filename");
    const previousFilename = entry.previous_filename === undefined
      ? null
      : safeRepoPath(entry.previous_filename, "previous changed filename");
    return { filename, previousFilename };
  });
}

export async function selectPullRequest({
  expectedBaseRef,
  expectedHeadSha,
  prNumber,
  repository,
  token,
}) {
  const encodedRepository = encodeRepository(repository);
  const pullRequest = inspectPullRequest(await fetchJson(
    `https://api.github.com/repos/${encodedRepository}/pulls/${prNumber}`,
    { headers: githubHeaders(token) },
    "public pull request lookup",
  ), { expectedBaseRef, expectedHeadSha, prNumber, repository });

  if (pullRequest.changedFiles > MAX_CHANGED_FILES) {
    return { ...pullRequest, selected: true };
  }

  const files = [];
  const pages = Math.max(1, Math.ceil(pullRequest.changedFiles / PAGE_SIZE));
  for (let page = 1; page <= pages; page += 1) {
    files.push(...inspectChangedFilePage(await fetchJson(
      `https://api.github.com/repos/${encodedRepository}/pulls/${prNumber}/files?per_page=${PAGE_SIZE}&page=${page}`,
      { headers: githubHeaders(token) },
      "public pull request changed-file lookup",
    ), { expectedCount: pullRequest.changedFiles, page }));
  }
  if (files.length !== pullRequest.changedFiles) {
    throw new Error("Changed-file pagination did not cover the declared file count.");
  }
  const selected = files.some(({ filename, previousFilename }) =>
    isTemporalCompatibilityRelevantPath(filename)
    || (previousFilename !== null && isTemporalCompatibilityRelevantPath(previousFilename)));
  return { ...pullRequest, selected };
}

export function buildDispatchInputs({ producerDigest, producerFixtures, publicSha, requestId }) {
  assertDigest(producerDigest, "producer fixture digest");
  const inspected = inspectProducerFixtures(producerFixtures);
  if (inspected.digest !== producerDigest) {
    throw new Error("Producer fixture digest does not match the canonical fixture payload.");
  }
  assertSha(publicSha, "public SHA");
  assertSafeId(requestId, "request id", 120);
  return {
    contract_version: TEMPORAL_COMPATIBILITY_CONTRACT_VERSION,
    mode: "temporal_compatibility",
    murph_sha: publicSha,
    producer_digest: producerDigest,
    producer_fixtures: inspected.serialized,
    request_id: requestId,
  };
}

export function inspectProducerFixtures(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_PRODUCER_FIXTURE_BYTES) {
    throw new Error("Temporal producer fixture artifact is missing or too large.");
  }
  let fixtures;
  try {
    fixtures = JSON.parse(value);
  } catch {
    throw new Error("Temporal producer fixture artifact is invalid JSON.");
  }
  if (
    !Array.isArray(fixtures)
    || fixtures.length === 0
    || fixtures.length > MAX_PRODUCER_FIXTURES
    || fixtures.some((fixture) => !isRecord(fixture))
  ) {
    throw new Error("Temporal producer fixture artifact is invalid.");
  }
  const serialized = JSON.stringify(fixtures);
  return {
    digest: createHash("sha256").update(serialized).digest("hex"),
    serialized,
  };
}

export function inspectControllerPolicy(raw) {
  assertRecord(raw, "Temporal compatibility controller policy");
  if (raw.contractVersion !== Number(TEMPORAL_COMPATIBILITY_CONTRACT_VERSION)) {
    throw new Error("Temporal compatibility controller policy version is invalid.");
  }
  const privateSha = requiredString(raw.privateSha, "private compatibility controller SHA");
  assertSha(privateSha, "private compatibility controller SHA");
  const privateRef = safeTag(requiredString(raw.privateRef, "private compatibility controller ref"));
  if (privateRef !== `temporal-compatibility-v1-${privateSha}`) {
    throw new Error("Private compatibility controller ref must bind its exact SHA.");
  }
  return { privateRef, privateSha };
}

export function inspectPrivateTag(raw, { expectedSha, ref }) {
  assertRecord(raw, "private compatibility tag");
  if (!isRecord(raw.object) || raw.ref !== `refs/tags/${ref}` || raw.object.type !== "commit") {
    throw new Error("Private compatibility ref must be an immutable lightweight tag.");
  }
  const sha = requiredString(raw.object.sha, "private compatibility tag SHA");
  assertSha(sha, "private compatibility tag SHA");
  assertSha(expectedSha, "reviewed private compatibility SHA");
  if (sha !== expectedSha) {
    throw new Error("Private compatibility tag does not resolve to the reviewed SHA.");
  }
  return sha;
}

export function inspectPrivateWorkflow(raw) {
  assertRecord(raw, "private compatibility workflow");
  if (
    raw.name !== TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME
    || raw.path !== TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH
    || raw.state !== "active"
    || !Number.isSafeInteger(raw.id)
    || raw.id <= 0
  ) {
    throw new Error("Private compatibility workflow identity is invalid.");
  }
  return raw.id;
}

export function inspectExactPublicHead(raw, {
  expectedBaseRef,
  expectedSha,
  prNumber,
  repository,
}) {
  const inspected = inspectPullRequest(raw, {
    expectedBaseRef,
    expectedHeadSha: expectedSha,
    prNumber,
    repository,
  });
  if (!inspected.trusted) {
    throw new Error("Public pull request is no longer a same-repository human-authored head.");
  }
  if (!inspected.targetsDefaultBranch) {
    throw new Error("Public pull request no longer targets the default branch.");
  }
  return inspected.headSha;
}

export function inspectDispatchReceipt(raw) {
  assertRecord(raw, "private workflow dispatch receipt");
  if (!Number.isSafeInteger(raw.workflow_run_id) || raw.workflow_run_id <= 0) {
    throw new Error("Private workflow dispatch did not return workflow_run_id.");
  }
  return raw.workflow_run_id;
}

export function inspectPrivateRun(raw, { privateRef, privateSha, runId, workflowId }) {
  assertRecord(raw, "private compatibility run");
  const repository = isRecord(raw.repository) ? raw.repository.full_name : null;
  const headRepository = isRecord(raw.head_repository) ? raw.head_repository.full_name : null;
  if (
    raw.id !== runId
    || raw.workflow_id !== workflowId
    || raw.name !== TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME
    || raw.path !== TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH
    || raw.event !== "workflow_dispatch"
    || raw.head_branch !== privateRef
    || raw.head_sha !== privateSha
    || raw.run_attempt !== 1
    || repository !== TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY
    || headRepository !== TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY
  ) {
    throw new Error("Private compatibility run identity is invalid.");
  }
  return {
    complete: raw.status === "completed",
    conclusion: raw.conclusion === null ? null : String(raw.conclusion ?? ""),
  };
}

export function supportedReaderDigest(readerShas) {
  if (!Array.isArray(readerShas) || readerShas.length === 0) {
    throw new Error("Supported-reader set must not be empty.");
  }
  const normalized = [...readerShas].map((sha) => {
    assertSha(sha, "supported reader SHA");
    return sha;
  }).sort();
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Supported-reader set contains a duplicate SHA.");
  }
  // Cross-repository wire format: sorted lowercase SHAs, one per line, with a
  // trailing newline. The private attestation must compute this exact digest.
  return createHash("sha256").update(`${normalized.join("\n")}\n`).digest("hex");
}

export function compatibilityProofDigest({ producerDigest, publicSha, readersDigest, requestId }) {
  assertDigest(producerDigest, "producer fixture digest");
  assertDigest(readersDigest, "supported-reader digest");
  assertSha(publicSha, "public SHA");
  assertSafeId(requestId, "request id", 120);
  return createHash("sha256")
    .update(`${publicSha}\n${requestId}\n${readersDigest}\n${producerDigest}\n`)
    .digest("hex");
}

export function buildReaderJobName(readerSha) {
  assertSha(readerSha, "supported reader SHA");
  return `Temporal compatibility reader [sha=${readerSha}]`;
}

export function buildAttestationJobName({ proofDigest }) {
  assertDigest(proofDigest, "compatibility proof digest");
  return `Temporal compatibility attestation [proof=${proofDigest}]`;
}

export function inspectAttestationJobs(jobs, {
  privateSha,
  producerDigest,
  publicSha,
  requestId,
  runId,
}) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error("Private compatibility run returned no jobs.");
  }
  const ids = new Set();
  const readers = [];
  const attestations = [];
  for (const raw of jobs) {
    assertRecord(raw, "private compatibility job");
    if (!Number.isSafeInteger(raw.id) || raw.id <= 0 || ids.has(raw.id)) {
      throw new Error("Private compatibility jobs contain an invalid or duplicate id.");
    }
    ids.add(raw.id);
    if (raw.run_id !== runId || raw.head_sha !== privateSha) {
      throw new Error("Private compatibility job is not bound to the accepted run.");
    }
    const name = requiredString(raw.name, "private compatibility job name");
    const readerMatch = /^Temporal compatibility reader \[sha=([0-9a-f]{40})\]$/u.exec(name);
    const attestationMatch = /^Temporal compatibility attestation \[proof=([0-9a-f]{64})\]$/u.exec(name);
    if (readerMatch || attestationMatch) {
      if (raw.status !== "completed" || raw.conclusion !== "success") {
        throw new Error("Private compatibility proof job did not complete successfully.");
      }
    } else if (name.startsWith("Temporal compatibility")) {
      throw new Error("Private compatibility run returned a malformed proof job.");
    }
    if (readerMatch) readers.push(readerMatch[1]);
    if (attestationMatch) attestations.push(attestationMatch[1]);
  }
  if (attestations.length !== 1) {
    throw new Error("Private compatibility run must return exactly one attestation job.");
  }
  if (!readers.includes(privateSha)) {
    throw new Error("Supported-reader proof omitted the pinned private controller revision.");
  }
  const digest = supportedReaderDigest(readers);
  const proofDigest = compatibilityProofDigest({
    producerDigest,
    publicSha,
    readersDigest: digest,
    requestId,
  });
  if (attestations[0] !== proofDigest) {
    throw new Error("Private compatibility attestation does not bind the requested proof.");
  }
  return { digest, proofDigest, readerCount: readers.length };
}

export function inspectJobPage(raw, { expectedTotal, page }) {
  assertRecord(raw, "private compatibility job page");
  if (!Number.isSafeInteger(raw.total_count) || raw.total_count < 0 || !Array.isArray(raw.jobs)) {
    throw new Error("Private compatibility job page is malformed.");
  }
  const total = expectedTotal === null ? raw.total_count : expectedTotal;
  if (raw.total_count !== total) {
    throw new Error("Private compatibility job count changed during pagination.");
  }
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const expectedLength = page === lastPage ? total - PAGE_SIZE * (page - 1) : PAGE_SIZE;
  if (raw.jobs.length !== expectedLength) {
    throw new Error("Private compatibility job pagination is incomplete.");
  }
  return { jobs: raw.jobs, total };
}

export async function listAllRunJobs({ runId, token }) {
  const jobs = [];
  let total = null;
  let pages = 1;
  for (let page = 1; page <= pages; page += 1) {
    const inspected = inspectJobPage(await fetchJson(
      `https://api.github.com/repos/${TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY}/actions/runs/${runId}/jobs?filter=latest&per_page=${PAGE_SIZE}&page=${page}`,
      { headers: githubHeaders(token) },
      "private compatibility job lookup",
    ), { expectedTotal: total, page });
    total = inspected.total;
    pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    jobs.push(...inspected.jobs);
  }
  if (jobs.length !== total) {
    throw new Error("Private compatibility jobs did not match the declared count.");
  }
  return jobs;
}

export async function runTemporalCompatibility({
  expectedBaseRef,
  expectedPrivateSha,
  privateToken,
  privateRef,
  producerDigest,
  producerFixtures,
  publicRepository,
  publicSha,
  publicToken,
  prNumber,
  requestId,
  sleepFn = sleep,
}) {
  assertRepository(publicRepository, "public repository");
  assertSafeId(expectedBaseRef, "expected public base ref", 255, /^[A-Za-z0-9._/-]+$/u);
  assertSha(publicSha, "public SHA");
  assertSafeId(requestId, "request id", 120);
  requiredString(privateToken, "private GitHub token");
  requiredString(publicToken, "public GitHub token");
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    throw new Error("Pull request number must be a positive integer.");
  }
  const inspectedPrivateRef = safeTag(privateRef);
  assertSha(expectedPrivateSha, "reviewed private compatibility SHA");
  const encodedPrivateRepository = encodeRepository(TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY);
  const privateSha = inspectPrivateTag(await fetchJson(
    `https://api.github.com/repos/${encodedPrivateRepository}/git/ref/tags/${inspectedPrivateRef.split("/").map(encodeURIComponent).join("/")}`,
    { headers: githubHeaders(privateToken) },
    "private compatibility tag lookup",
  ), { expectedSha: expectedPrivateSha, ref: inspectedPrivateRef });
  const workflowId = inspectPrivateWorkflow(await fetchJson(
    `https://api.github.com/repos/${encodedPrivateRepository}/actions/workflows/${encodeURIComponent(TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW)}`,
    { headers: githubHeaders(privateToken) },
    "private compatibility workflow lookup",
  ));
  const encodedPublicRepository = encodeRepository(publicRepository);
  inspectExactPublicHead(await fetchJson(
    `https://api.github.com/repos/${encodedPublicRepository}/pulls/${prNumber}`,
    { headers: githubHeaders(publicToken) },
    "public pull request revalidation",
  ), {
    expectedBaseRef,
    expectedSha: publicSha,
    prNumber,
    repository: publicRepository,
  });

  const runId = inspectDispatchReceipt(await fetchJson(
    `https://api.github.com/repos/${encodedPrivateRepository}/actions/workflows/${encodeURIComponent(TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW)}/dispatches`,
    {
      body: JSON.stringify({
        inputs: buildDispatchInputs({ producerDigest, producerFixtures, publicSha, requestId }),
        ref: inspectedPrivateRef,
        return_run_details: true,
      }),
      headers: { ...githubHeaders(privateToken), "content-type": "application/json" },
      method: "POST",
    },
    "private compatibility workflow dispatch",
  ));

  let terminal = false;
  try {
    const deadline = Date.now() + PRIVATE_RUN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const run = inspectPrivateRun(await readPrivateRun(runId, privateToken), {
        privateRef: inspectedPrivateRef,
        privateSha,
        runId,
        workflowId,
      });
      if (run.complete) {
        terminal = true;
        if (run.conclusion !== "success") {
          throw new Error(`Private compatibility run completed with ${run.conclusion || "no conclusion"}.`);
        }
        const proof = inspectAttestationJobs(await listAllRunJobs({ runId, token: privateToken }), {
          privateSha,
          producerDigest,
          publicSha,
          requestId,
          runId,
        });
        console.log(`::notice::temporal-compatibility result=success readers=${proof.readerCount} digest=${proof.digest}`);
        return proof;
      }
      await sleepFn(POLL_MS);
    }
    throw new Error("Private compatibility run timed out.");
  } catch (error) {
    if (!terminal) {
      try {
        await cancelAcceptedRun({
          privateRef: inspectedPrivateRef,
          privateSha,
          runId,
          sleepFn,
          token: privateToken,
          workflowId,
        });
      } catch (cancelError) {
        throw new AggregateError(
          [error, cancelError],
          "Temporal compatibility failed and the accepted private run could not be proven terminal.",
        );
      }
    }
    throw error;
  }
}

export async function cancelAcceptedRun({
  privateRef,
  privateSha,
  runId,
  sleepFn = sleep,
  token,
  workflowId,
}) {
  let ordinaryCancelFailed = false;
  try {
    await postRunControl(
      TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY,
      runId,
      "cancel",
      token,
    );
  } catch {
    ordinaryCancelFailed = true;
  }
  if (!ordinaryCancelFailed && await waitForTerminal({
    privateRef,
    privateSha,
    runId,
    sleepFn,
    timeoutMs: CANCEL_GRACE_MS,
    token,
    workflowId,
  })) return;
  await postRunControl(
    TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY,
    runId,
    "force-cancel",
    token,
  );
  if (!await waitForTerminal({
    privateRef,
    privateSha,
    runId,
    sleepFn,
    timeoutMs: CANCEL_GRACE_MS,
    token,
    workflowId,
  })) {
    throw new Error("Accepted private compatibility run did not become terminal after force-cancel.");
  }
}

async function waitForTerminal({
  privateRef,
  privateSha,
  runId,
  sleepFn,
  timeoutMs,
  token,
  workflowId,
}) {
  const attempts = Math.max(1, Math.ceil(timeoutMs / POLL_MS));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const run = inspectPrivateRun(await readPrivateRun(runId, token), {
      privateRef,
      privateSha,
      runId,
      workflowId,
    });
    if (run.complete) return true;
    await sleepFn(POLL_MS);
  }
  return false;
}

async function readPrivateRun(runId, token) {
  return fetchJson(
    `https://api.github.com/repos/${TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY}/actions/runs/${runId}`,
    { headers: githubHeaders(token) },
    "private compatibility run lookup",
  );
}

async function postRunControl(repository, runId, operation, token) {
  const encodedRepository = encodeRepository(repository);
  const response = await fetch(
    `https://api.github.com/repos/${encodedRepository}/actions/runs/${runId}/${operation}`,
    {
      headers: githubHeaders(token),
      method: "POST",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    },
  );
  if (response.status !== 202 && response.status !== 409) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Private compatibility ${operation} failed with HTTP ${response.status}.`);
  }
  await response.body?.cancel().catch(() => undefined);
}

async function runSelectCommand() {
  const expectedBaseRef = requiredEnv("EXPECTED_BASE_REF");
  const expectedHeadSha = requiredEnv("EXPECTED_HEAD_SHA");
  const prNumber = positiveInteger(requiredEnv("PR_NUMBER"), "pull request number");
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const token = requiredEnv("TEMPORAL_COMPATIBILITY_PUBLIC_GITHUB_TOKEN");
  delete process.env.TEMPORAL_COMPATIBILITY_PUBLIC_GITHUB_TOKEN;
  const selected = await selectPullRequest({
    expectedBaseRef,
    expectedHeadSha,
    prNumber,
    repository,
    token,
  });
  await writeOutputs({
    head_sha: selected.headSha,
    selected: String(selected.selected),
    targets_default_branch: String(selected.targetsDefaultBranch),
    trusted: String(selected.trusted),
  });
}

async function runCompatibilityCommand(args) {
  const publicToken = requiredEnv("TEMPORAL_COMPATIBILITY_PUBLIC_GITHUB_TOKEN");
  const privateToken = requiredEnv("TEMPORAL_COMPATIBILITY_PRIVATE_GITHUB_TOKEN");
  delete process.env.TEMPORAL_COMPATIBILITY_PUBLIC_GITHUB_TOKEN;
  delete process.env.TEMPORAL_COMPATIBILITY_PRIVATE_GITHUB_TOKEN;
  const policy = inspectControllerPolicy(JSON.parse(await readFile(requiredArg(args, "policy"), "utf8")));
  const producer = inspectProducerFixtures(await readFile(requiredArg(args, "fixtures"), "utf8"));
  await runTemporalCompatibility({
    expectedBaseRef: requiredEnv("EXPECTED_BASE_REF"),
    expectedPrivateSha: policy.privateSha,
    privateToken,
    privateRef: policy.privateRef,
    producerDigest: producer.digest,
    producerFixtures: producer.serialized,
    publicRepository: requiredEnv("GITHUB_REPOSITORY"),
    publicSha: requiredArg(args, "sha"),
    publicToken,
    prNumber: positiveInteger(requiredArg(args, "pr-number"), "pull request number"),
    requestId: requiredArg(args, "request-id"),
  });
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "select" && rest.length === 0) return runSelectCommand();
  const args = parseArgs(rest);
  if (command === "run") return runCompatibilityCommand(args);
  throw new Error("Expected select or run.");
}

async function fetchJson(url, init, label) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} failed with HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function githubHeaders(token) {
  requiredString(token, "GitHub token");
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "murph-temporal-compatibility",
    "x-github-api-version": GITHUB_API_VERSION,
  };
}

function encodeRepository(repository) {
  assertRepository(repository, "GitHub repository");
  return repository.split("/").map(encodeURIComponent).join("/");
}

function assertRepository(value, label) {
  assertSafeId(value, label, 200, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
}

function safeRepoPath(value, label) {
  const filePath = requiredString(value, label);
  if (filePath.startsWith("/") || filePath.includes("\\") || filePath.includes("\n") || filePath.includes("\r")) {
    throw new Error(`${label} is invalid.`);
  }
  return filePath;
}

function safeTag(value) {
  assertSafeId(value, "private compatibility tag", 180, /^[A-Za-z0-9._/-]+$/u);
  if (value.startsWith("refs/") || value.includes("..") || value.includes("//") || value.endsWith(".lock")) {
    throw new Error("Private compatibility ref must be a safe lightweight tag name.");
  }
  return value;
}

function assertSafeId(value, label, maxLength, pattern = /^[A-Za-z0-9._:-]+$/u) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || !pattern.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function assertSha(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be an exact lowercase Git SHA.`);
  }
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required.`);
  return value;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} is malformed.`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`${label} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function parseArgs(argv) {
  if (argv.length % 2 !== 0) throw new Error("Expected --key value arguments.");
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || argv[index + 1] === undefined) {
      throw new Error("Expected --key value arguments.");
    }
    args.set(key.slice(2), argv[index + 1]);
  }
  return args;
}

function requiredArg(args, name) {
  const value = args.get(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

async function writeOutputs(values) {
  const outputPath = requiredEnv("GITHUB_OUTPUT");
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join("");
  await appendFile(outputPath, lines, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
