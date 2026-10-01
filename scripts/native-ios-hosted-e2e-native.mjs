import {
  NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
  POLL_MS,
  assertRecord,
  assertSafeId,
  assertSha,
  fetchJson,
  requiredEnv,
  requiredString,
  isRecord,
  normalizeHttpsOrigin,
  resolveProductionCanaryWebSha,
  safeNativeTag,
  sleep,
} from "./native-ios-hosted-e2e-support.mjs";

const GITHUB_API_VERSION = "2026-03-10";
const IOS_TIMEOUT_MS = 60 * 60_000;
export function buildDispatchInputs({ correlationId, webBaseUrl, webSha }) {
  assertSafeId(correlationId, "correlation id", 120);
  assertSha(webSha, "web SHA");
  const normalizedWebBaseUrl = normalizeHttpsOrigin(webBaseUrl);
  if (normalizedWebBaseUrl !== "https://www.withmurph.ai") {
    throw new Error("Production canary requires the exact Murph production origin.");
  }
  return {
    contract_version: NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
    correlation_id: correlationId,
    identity_lifecycle: "non_destructive_existing_identity",
    mode: "production_canary",
    web_base_url: normalizedWebBaseUrl,
    web_sha: webSha,
  };
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

export async function dispatchAndWait(
  { correlationId, source, webBaseUrl, webSha },
  { resolveWebSha = resolveProductionCanaryWebSha } = {},
) {
  const token = requiredEnv("NATIVE_IOS_E2E_GITHUB_TOKEN");
  const repository = requiredEnv("NATIVE_IOS_E2E_IOS_REPOSITORY");
  const workflow = requiredEnv("NATIVE_IOS_E2E_IOS_WORKFLOW");
  const ref = safeNativeTag(source?.privateRef, "private iOS tag");
  const productionWebSha = await resolveWebSha({
    env: withoutPrivateToken(process.env),
    scheduledMainSha: webSha,
  });

  const tag = await fetchJson(
    `https://api.github.com/repos/${repository}/git/ref/tags/${ref.split("/").map(encodeURIComponent).join("/")}`,
    { headers: githubHeaders(token) },
    "private iOS tag lookup",
  );
  const expectedSha = inspectPrivateDispatchTag(tag, {
    expectedSha: source?.privateSha,
    ref,
  });

  const receipt = await fetchJson(
    `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      body: JSON.stringify({
        inputs: buildDispatchInputs({ correlationId, webBaseUrl, webSha: productionWebSha }),
        ref,
      }),
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
      console.log("::notice::native-ios-e2e stage=ios_production_canary result=success");
      return;
    }
    await sleep(POLL_MS);
  }
  throw new Error("Private iOS E2E timed out.");
}

function withoutPrivateToken(env) {
  const childEnv = { ...env };
  delete childEnv.NATIVE_IOS_E2E_GITHUB_TOKEN;
  return childEnv;
}

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "murph-native-ios-hosted-e2e",
    "x-github-api-version": GITHUB_API_VERSION,
  };
}
