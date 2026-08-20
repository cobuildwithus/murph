import {
  NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
  POLL_MS,
  assertRecord,
  assertSafeId,
  assertSha,
  fetchJson,
  normalizeHttpsOrigin,
  requiredEnv,
  requiredString,
  isRecord,
  runBoundedCommand,
  sleep,
} from "./native-ios-hosted-e2e-support.mjs";

const GITHUB_API_VERSION = "2026-03-10";
const IOS_TIMEOUT_MS = 60 * 60_000;
const PRODUCTION_ALIAS_TIMEOUT_MS = 2 * 60_000;
const PRODUCTION_ALIAS_MAX_OUTPUT_CHARS = 200;

export function buildDispatchInputs({ correlationId, mode, webBaseUrl, webSha }) {
  assertSafeId(correlationId, "correlation id", 120);
  assertSha(webSha, "web SHA");
  const identityLifecycle = mode === "pr"
    ? "orchestrator_owned_reset"
    : mode === "production_canary"
      ? "non_destructive_existing_identity"
      : null;
  if (!identityLifecycle) throw new Error("mode must be pr or production_canary.");
  return {
    contract_version: NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
    correlation_id: correlationId,
    identity_lifecycle: identityLifecycle,
    mode,
    web_base_url: normalizeHttpsOrigin(webBaseUrl),
    web_sha: webSha,
  };
}

export function inspectExactPrHead(raw, { expectedSha, prNumber }) {
  assertRecord(raw, "Web PR");
  if (raw.number !== prNumber || !isRecord(raw.head)) {
    throw new Error("Web PR head revalidation returned an unexpected pull request.");
  }
  const currentSha = requiredString(raw.head.sha, "Web PR head SHA");
  assertSha(currentSha, "Web PR head SHA");
  assertSha(expectedSha, "expected Web PR head SHA");
  if (currentSha !== expectedSha) {
    throw new Error("PR head changed before private iOS dispatch.");
  }
  return true;
}

export async function revalidateExactPrHead({ expectedSha, prNumber, repository, token }) {
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    throw new Error("PR number must be a positive integer.");
  }
  assertSafeId(
    repository,
    "GitHub repository",
    200,
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
  );
  requiredString(token, "Web GitHub token");
  const encodedRepository = repository.split("/").map(encodeURIComponent).join("/");
  inspectExactPrHead(await fetchJson(
    `https://api.github.com/repos/${encodedRepository}/pulls/${prNumber}`,
    { headers: githubHeaders(token) },
    "Web PR head revalidation",
  ), { expectedSha, prNumber });
  console.log("::notice::native-ios-e2e stage=pr_head_revalidate result=success");
}

export function inspectPrivateDispatchTag(raw, { expectedSha, ref }) {
  assertRecord(raw, "private iOS tag");
  if (!isRecord(raw.object) || raw.ref !== `refs/tags/${ref}` || raw.object.type !== "commit") {
    throw new Error("Private iOS dispatch ref must be a protected lightweight tag.");
  }
  const sha = requiredString(raw.object.sha, "private iOS tag SHA");
  assertSha(sha, "private iOS tag SHA");
  assertSha(expectedSha, "reviewed private iOS SHA");
  if (sha !== expectedSha) throw new Error("Private iOS tag does not resolve to the reviewed pinned SHA.");
  return sha;
}

export function inspectCurrentProductionSha(currentSha, expectedSha) {
  assertSha(currentSha, "current production alias SHA");
  assertSha(expectedSha, "requested production deployment SHA");
  if (currentSha !== expectedSha) throw new Error("Production alias no longer resolves to the requested deployment SHA.");
  return true;
}

export function inspectPrivateRun(raw, { runId, sha }) {
  assertRecord(raw, "private iOS run");
  if (raw.id !== runId || raw.event !== "workflow_dispatch" || raw.head_sha !== sha) {
    throw new Error("Private iOS result does not match the dispatched workflow revision.");
  }
  return {
    complete: raw.status === "completed",
    conclusion: raw.conclusion === null ? null : String(raw.conclusion ?? ""),
  };
}

export async function dispatchAndWait({ correlationId, mode, prHead = null, webBaseUrl, webSha }) {
  const token = requiredEnv("NATIVE_IOS_E2E_GITHUB_TOKEN");
  const repository = requiredEnv("NATIVE_IOS_E2E_IOS_REPOSITORY");
  const workflow = requiredEnv("NATIVE_IOS_E2E_IOS_WORKFLOW");
  const ref = safeTag(requiredEnv("NATIVE_IOS_E2E_IOS_REF"));

  const tag = await fetchJson(
    `https://api.github.com/repos/${repository}/git/ref/tags/${ref.split("/").map(encodeURIComponent).join("/")}`,
    { headers: githubHeaders(token) },
    "private iOS tag lookup",
  );
  const expectedSha = inspectPrivateDispatchTag(tag, {
    expectedSha: requiredEnv("NATIVE_IOS_E2E_IOS_EXPECTED_SHA"),
    ref,
  });
  if (mode === "production_canary") await proveCurrentProductionAlias(webSha);
  if (mode === "pr") {
    if (!isRecord(prHead)) throw new Error("PR head revalidation inputs are required.");
    await revalidateExactPrHead({ ...prHead, expectedSha: webSha });
  }

  const receipt = await fetchJson(
    `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      body: JSON.stringify({ inputs: buildDispatchInputs({ correlationId, mode, webBaseUrl, webSha }), ref }),
      headers: { ...githubHeaders(token), "content-type": "application/json" },
      method: "POST",
    },
    "private iOS workflow dispatch",
  );
  assertRecord(receipt, "workflow dispatch receipt");
  const runId = receipt.workflow_run_id;
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error("Private iOS dispatch did not return workflow_run_id.");

  const deadline = Date.now() + IOS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const run = inspectPrivateRun(await fetchJson(
      `https://api.github.com/repos/${repository}/actions/runs/${runId}`,
      { headers: githubHeaders(token) },
      "private iOS workflow status",
    ), { runId, sha: expectedSha });
    if (run.complete) {
      if (run.conclusion !== "success") throw new Error(`Private iOS E2E completed with ${run.conclusion || "no conclusion"}.`);
      console.log(`::notice::native-ios-e2e stage=ios_${mode} result=success`);
      return;
    }
    await sleep(POLL_MS);
  }
  throw new Error("Private iOS E2E timed out.");
}

async function proveCurrentProductionAlias(expectedSha) {
  const childEnv = { ...process.env };
  delete childEnv.NATIVE_IOS_E2E_GITHUB_TOKEN;
  const currentSha = (await runBoundedCommand({
    argv: ["--dir", "apps/web", "exec", "tsx", "scripts/resolve-vercel-production-alias-sha.ts"],
    captureStdout: true,
    command: "pnpm",
    env: childEnv,
    label: "Production alias verification",
    maxOutputChars: PRODUCTION_ALIAS_MAX_OUTPUT_CHARS,
    timeoutMs: PRODUCTION_ALIAS_TIMEOUT_MS,
  })).trim();
  inspectCurrentProductionSha(currentSha, expectedSha);
}

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "murph-native-ios-hosted-e2e",
    "x-github-api-version": GITHUB_API_VERSION,
  };
}

function safeTag(value) {
  assertSafeId(value, "private iOS tag", 180, /^[A-Za-z0-9._/-]+$/u);
  if (value.startsWith("refs/") || value.includes("..") || value.includes("//") || value.endsWith(".lock")) {
    throw new Error("private iOS ref must be a safe lightweight tag name.");
  }
  return value;
}
