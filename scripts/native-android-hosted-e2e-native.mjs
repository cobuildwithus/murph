import {
  HTTP_TIMEOUT_MS,
  POLL_MS,
  assertRecord,
  assertSafeId,
  assertSha,
  fetchJson,
  isRecord,
  normalizeHttpsOrigin,
  requiredEnv,
  requiredString,
  runBoundedCommand,
  sleep,
} from "./native-ios-hosted-e2e-support.mjs";

export const NATIVE_ANDROID_HOSTED_E2E_CONTRACT_VERSION = "1";

const GITHUB_API_VERSION = "2026-03-10";
const ANDROID_TIMEOUT_MS = 85 * 60_000;
export const PRIVATE_ANDROID_DISPATCH_TTL_SECONDS = 30 * 60;
export const PRIVATE_ANDROID_JOB_TIMEOUT_SECONDS = 55 * 60;
export const PRIVATE_ANDROID_TERMINAL_GRACE_SECONDS = 2 * 60;
const PRODUCTION_ALIAS_TIMEOUT_MS = 2 * 60_000;
const PRIVATE_RUN_CANCEL_GRACE_MS = 30_000;
const PRIVATE_RUN_FORCE_CANCEL_TIMEOUT_MS = 2 * 60_000;
const PRODUCTION_ALIAS_MAX_OUTPUT_CHARS = 200;

export function buildDispatchInputs({
  androidSha,
  androidTag,
  correlationId,
  dispatchExpiresAt,
  mode,
  webBaseUrl,
  webSha,
}) {
  assertSha(androidSha, "Android SHA");
  const safeAndroidTag = safeTag(androidTag);
  assertSafeId(correlationId, "correlation id", 120);
  if (!Number.isSafeInteger(dispatchExpiresAt) || dispatchExpiresAt < 1_000_000_000) {
    throw new Error("dispatch expiry must be an epoch-second integer.");
  }
  assertSha(webSha, "web SHA");
  const identityLifecycle = mode === "pr"
    ? "orchestrator_owned_reset"
    : mode === "production_canary"
      ? "non_destructive_existing_identity"
      : null;
  if (!identityLifecycle) throw new Error("mode must be pr or production_canary.");
  const normalizedWebBaseUrl = normalizeHttpsOrigin(webBaseUrl);
  const hostname = new URL(normalizedWebBaseUrl).hostname;
  if (mode === "pr") {
    if (hostname === "vercel.app" || !hostname.endsWith(".vercel.app")) {
      throw new Error("PR mode requires an exact non-root Vercel origin.");
    }
  } else if (normalizedWebBaseUrl !== "https://www.withmurph.ai") {
    throw new Error("Production canary requires the exact Murph production origin.");
  }
  return {
    android_sha: androidSha,
    android_tag: safeAndroidTag,
    contract_version: NATIVE_ANDROID_HOSTED_E2E_CONTRACT_VERSION,
    correlation_id: correlationId,
    dispatch_expires_at: String(dispatchExpiresAt),
    identity_lifecycle: identityLifecycle,
    mode,
    web_base_url: normalizedWebBaseUrl,
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
    throw new Error("PR head changed before private Android dispatch.");
  }
  return true;
}

export function inspectPrivateDispatchTag(raw, { expectedSha, ref }) {
  assertRecord(raw, "private Android tag");
  if (
    !isRecord(raw.object)
    || raw.ref !== `refs/tags/${ref}`
    || raw.object.type !== "commit"
  ) {
    throw new Error("Private Android dispatch ref must be a protected lightweight tag.");
  }
  const sha = requiredString(raw.object.sha, "private Android tag SHA");
  assertSha(sha, "private Android tag SHA");
  assertSha(expectedSha, "reviewed private Android SHA");
  if (sha !== expectedSha) {
    throw new Error("Private Android tag does not resolve to the reviewed pinned SHA.");
  }
  return sha;
}

export function inspectCurrentProductionSha(currentSha, expectedSha) {
  assertSha(currentSha, "current production alias SHA");
  assertSha(expectedSha, "requested production deployment SHA");
  if (currentSha !== expectedSha) {
    throw new Error("Production alias no longer resolves to the requested deployment SHA.");
  }
  return true;
}

export function inspectPrivateRun(raw, { runId, sha }) {
  assertRecord(raw, "private Android run");
  if (raw.id !== runId || raw.event !== "workflow_dispatch" || raw.head_sha !== sha) {
    throw new Error("Private Android result does not match the dispatched workflow revision.");
  }
  return {
    complete: raw.status === "completed",
    conclusion: raw.conclusion === null ? null : String(raw.conclusion ?? ""),
  };
}

export async function dispatchAndWait({
  correlationId,
  mode,
  prHead = null,
  webBaseUrl,
  webSha,
}) {
  const token = requiredEnv("NATIVE_ANDROID_E2E_GITHUB_TOKEN");
  const repository = safeRepository(requiredEnv("NATIVE_ANDROID_E2E_ANDROID_REPOSITORY"));
  const workflow = safeWorkflow(requiredEnv("NATIVE_ANDROID_E2E_ANDROID_WORKFLOW"));
  const ref = safeTag(requiredEnv("NATIVE_ANDROID_E2E_ANDROID_REF"));
  const encodedRepository = repository.split("/").map(encodeURIComponent).join("/");

  const tag = await fetchJson(
    `https://api.github.com/repos/${encodedRepository}/git/ref/tags/${ref.split("/").map(encodeURIComponent).join("/")}`,
    { headers: githubHeaders(token) },
    "private Android tag lookup",
  );
  const expectedSha = inspectPrivateDispatchTag(tag, {
    expectedSha: requiredEnv("NATIVE_ANDROID_E2E_ANDROID_EXPECTED_SHA"),
    ref,
  });
  if (mode === "production_canary") await proveCurrentProductionAlias(webSha);
  if (mode === "pr") {
    if (!isRecord(prHead)) throw new Error("PR head revalidation inputs are required.");
    await revalidateExactPrHead({ ...prHead, expectedSha: webSha });
  }

  const dispatchExpiresAt =
    Math.floor(Date.now() / 1000) + PRIVATE_ANDROID_DISPATCH_TTL_SECONDS;
  const receipt = await fetchJson(
    `https://api.github.com/repos/${encodedRepository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      body: JSON.stringify({
        inputs: buildDispatchInputs({
          androidSha: expectedSha,
          androidTag: ref,
          correlationId,
          dispatchExpiresAt,
          mode,
          webBaseUrl,
          webSha,
        }),
        ref,
      }),
      headers: { ...githubHeaders(token), "content-type": "application/json" },
      method: "POST",
    },
    "private Android workflow dispatch",
  );
  assertRecord(receipt, "workflow dispatch receipt");
  const runId = receipt.workflow_run_id;
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    throw new Error("Private Android dispatch did not return workflow_run_id.");
  }

  const runUrl = `https://api.github.com/repos/${encodedRepository}/actions/runs/${runId}`;
  let terminal = false;
  try {
    const deadline = Date.now() + ANDROID_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const run = inspectPrivateRun(await fetchJson(
        runUrl,
        { headers: githubHeaders(token) },
        "private Android workflow status",
      ), { runId, sha: expectedSha });
      if (run.complete) {
        terminal = true;
        if (run.conclusion !== "success") {
          throw new Error(
            `Private Android E2E completed with ${run.conclusion || "no conclusion"}.`,
          );
        }
        console.log(`::notice::native-android-e2e stage=android_${mode} result=success`);
        return;
      }
      await sleep(POLL_MS);
    }
    throw new Error("Private Android E2E timed out.");
  } catch (primaryError) {
    if (!terminal) {
      try {
        await cancelAndWaitForPrivateRun({
          encodedRepository,
          expectedSha,
          runId,
          runUrl,
          token,
        });
      } catch (cancellationError) {
        await holdPrivateRunExecutionFence({
          deadlineMs: privateRunExecutionFenceDeadlineMs(dispatchExpiresAt),
          expectedSha,
          runId,
          runUrl,
          token,
        });
        throw new AggregateError(
          [primaryError, cancellationError],
          "Private Android E2E failed and cancellation could not be attested; hosted cleanup remained fenced through the dispatch lease and private job timeout.",
        );
      }
    }
    throw primaryError;
  }
}


export function privateRunExecutionFenceDeadlineMs(dispatchExpiresAt) {
  if (!Number.isSafeInteger(dispatchExpiresAt) || dispatchExpiresAt < 1_000_000_000) {
    throw new Error("dispatch expiry must be an epoch-second integer.");
  }
  return (
    dispatchExpiresAt
    + PRIVATE_ANDROID_JOB_TIMEOUT_SECONDS
    + PRIVATE_ANDROID_TERMINAL_GRACE_SECONDS
  ) * 1000;
}

export function inspectPrivateRunActionStatus(status, label) {
  if (status !== 202 && status !== 409) {
    throw new Error(`${label} failed with HTTP ${status}.`);
  }
  return true;
}

async function cancelAndWaitForPrivateRun({
  encodedRepository,
  expectedSha,
  runId,
  runUrl,
  token,
}) {
  await requestPrivateRunAction({
    label: "private Android workflow cancellation",
    token,
    url: `https://api.github.com/repos/${encodedRepository}/actions/runs/${runId}/cancel`,
  });
  if (await waitForPrivateRunTerminal({
    deadlineMs: Date.now() + PRIVATE_RUN_CANCEL_GRACE_MS,
    expectedSha,
    runId,
    runUrl,
    token,
  })) {
    return;
  }

  await requestPrivateRunAction({
    label: "private Android workflow force-cancellation",
    token,
    url: `https://api.github.com/repos/${encodedRepository}/actions/runs/${runId}/force-cancel`,
  });
  if (!await waitForPrivateRunTerminal({
    deadlineMs: Date.now() + PRIVATE_RUN_FORCE_CANCEL_TIMEOUT_MS,
    expectedSha,
    runId,
    runUrl,
    token,
  })) {
    throw new Error("Private Android workflow did not become terminal after force-cancellation.");
  }
}

async function requestPrivateRunAction({ label, token, url }) {
  const response = await fetch(url, {
    headers: githubHeaders(token),
    method: "POST",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  try {
    inspectPrivateRunActionStatus(response.status, label);
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }
}

async function waitForPrivateRunTerminal({
  deadlineMs,
  expectedSha,
  runId,
  runUrl,
  token,
}) {
  while (Date.now() < deadlineMs) {
    const run = inspectPrivateRun(await fetchJson(
      runUrl,
      { headers: githubHeaders(token) },
      "private Android workflow cancellation status",
    ), { runId, sha: expectedSha });
    if (run.complete) return true;
    await sleep(POLL_MS);
  }
  return false;
}

async function holdPrivateRunExecutionFence({
  deadlineMs,
  expectedSha,
  runId,
  runUrl,
  token,
}) {
  while (Date.now() < deadlineMs) {
    try {
      const run = inspectPrivateRun(await fetchJson(
        runUrl,
        { headers: githubHeaders(token) },
        "private Android workflow fallback fence status",
      ), { runId, sha: expectedSha });
      if (run.complete) return;
    } catch {
      // Cancellation/status failure is exactly why this hard fence exists.
      // Keep the shared identity/deployment lock until no run that passed the
      // dispatch lease can remain executable under the private job timeout.
    }
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs > 0) await sleep(Math.min(POLL_MS, remainingMs));
  }
}

async function revalidateExactPrHead({ expectedSha, prNumber, repository, token }) {
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    throw new Error("PR number must be a positive integer.");
  }
  const safeWebRepository = safeRepository(repository);
  requiredString(token, "Web GitHub token");
  const encodedRepository = safeWebRepository.split("/").map(encodeURIComponent).join("/");
  inspectExactPrHead(await fetchJson(
    `https://api.github.com/repos/${encodedRepository}/pulls/${prNumber}`,
    { headers: githubHeaders(token) },
    "Web PR head revalidation",
  ), { expectedSha, prNumber });
  console.log("::notice::native-android-e2e stage=pr_head_revalidate result=success");
}

async function proveCurrentProductionAlias(expectedSha) {
  const childEnv = { ...process.env };
  delete childEnv.NATIVE_ANDROID_E2E_GITHUB_TOKEN;
  const currentSha = (await runBoundedCommand({
    argv: [
      "--dir",
      "apps/web",
      "exec",
      "tsx",
      "scripts/resolve-vercel-production-alias-sha.ts",
    ],
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
    "user-agent": "murph-native-android-hosted-e2e",
    "x-github-api-version": GITHUB_API_VERSION,
  };
}

function safeRepository(value) {
  assertSafeId(
    value,
    "GitHub repository",
    200,
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
  );
  return value;
}

function safeWorkflow(value) {
  assertSafeId(value, "private Android workflow", 180, /^[A-Za-z0-9._-]+$/u);
  return value;
}

function safeTag(value) {
  assertSafeId(value, "private Android tag", 180, /^[A-Za-z0-9._/-]+$/u);
  if (
    value.startsWith("refs/")
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("..")
    || value.includes("//")
    || value.includes("@{")
    || value.endsWith(".lock")
  ) {
    throw new Error("private Android ref must be a safe lightweight tag name.");
  }
  return value;
}
