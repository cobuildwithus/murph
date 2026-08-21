import { createPrivateKey, sign } from "node:crypto";

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
const TOKEN_REFRESH_SKEW_MS = 2 * 60_000;

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
}, {
  fetchImpl = fetch,
  fetchJsonImpl = fetchJson,
  now = Date.now,
  sleepImpl = sleep,
  tokenSupplier: suppliedTokenSupplier = null,
} = {}) {
  const repository = safeRepository(requiredEnv("NATIVE_ANDROID_E2E_ANDROID_REPOSITORY"));
  const workflow = safeWorkflow(requiredEnv("NATIVE_ANDROID_E2E_ANDROID_WORKFLOW"));
  const ref = safeTag(requiredEnv("NATIVE_ANDROID_E2E_ANDROID_REF"));
  const encodedRepository = repository.split("/").map(encodeURIComponent).join("/");
  const tokenSupplier = suppliedTokenSupplier ?? createGitHubAppTokenSupplierFromEnv({
    fetchJsonImpl,
    now,
    repository,
  });

  const tag = await fetchJsonImpl(
    `https://api.github.com/repos/${encodedRepository}/git/ref/tags/${ref.split("/").map(encodeURIComponent).join("/")}`,
    { headers: githubHeaders(await tokenSupplier()) },
    "private Android tag lookup",
  );
  const expectedSha = inspectPrivateDispatchTag(tag, {
    expectedSha: requiredEnv("NATIVE_ANDROID_E2E_ANDROID_EXPECTED_SHA"),
    ref,
  });
  if (mode === "production_canary") await proveCurrentProductionAlias(webSha);
  if (mode === "pr") {
    if (!isRecord(prHead)) throw new Error("PR head revalidation inputs are required.");
    await revalidateExactPrHead({ ...prHead, expectedSha: webSha }, fetchJsonImpl);
  }

  const dispatchExpiresAt =
    Math.floor(now() / 1000) + PRIVATE_ANDROID_DISPATCH_TTL_SECONDS;
  const runId = await requestPrivateDispatch({
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
    deadlineMs: privateRunExecutionFenceDeadlineMs(dispatchExpiresAt),
    fetchImpl,
    now,
    sleepImpl,
    tokenSupplier,
    url: `https://api.github.com/repos/${encodedRepository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
  });

  const runUrl = `https://api.github.com/repos/${encodedRepository}/actions/runs/${runId}`;
  let terminal = false;
  try {
    const deadline = now() + ANDROID_TIMEOUT_MS;
    while (now() < deadline) {
      const run = inspectPrivateRun(await fetchJsonImpl(
        runUrl,
        { headers: githubHeaders(await tokenSupplier()) },
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
      await sleepImpl(POLL_MS);
    }
    throw new Error("Private Android E2E timed out.");
  } catch (primaryError) {
    if (!terminal) {
      try {
        await cancelAndWaitForPrivateRun({
          encodedRepository,
          expectedSha,
          fetchImpl,
          fetchJsonImpl,
          now,
          runId,
          runUrl,
          sleepImpl,
          tokenSupplier,
        });
      } catch (cancellationError) {
        await holdPrivateRunExecutionFence({
          deadlineMs: privateRunExecutionFenceDeadlineMs(dispatchExpiresAt),
          expectedSha,
          fetchJsonImpl,
          now,
          runId,
          runUrl,
          sleepImpl,
          tokenSupplier,
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

export function createGitHubAppTokenSupplier({
  appId,
  createJwt = createGitHubAppJwt,
  fetchJsonImpl = fetchJson,
  now = Date.now,
  privateKey,
  repository,
}) {
  if (!/^[1-9][0-9]*$/u.test(appId)) {
    throw new Error("GitHub App id must be a positive integer.");
  }
  if (
    typeof privateKey !== "string"
    || privateKey.length < 256
    || privateKey.length > 20_000
    || privateKey.includes("\0")
  ) {
    throw new Error("GitHub App private key was invalid.");
  }
  const safePrivateRepository = safeRepository(repository);
  const [owner, name] = safePrivateRepository.split("/");
  let installationId = null;
  let token = null;
  let expiresAtMs = 0;

  return async () => {
    if (token && expiresAtMs - now() > TOKEN_REFRESH_SKEW_MS) return token;
    const jwt = createJwt({ appId, now, privateKey });
    if (installationId === null) {
      const installation = await fetchJsonImpl(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/installation`,
        { headers: githubAppHeaders(jwt) },
        "private Android GitHub App installation lookup",
      );
      assertRecord(installation, "private Android GitHub App installation");
      if (!Number.isSafeInteger(installation.id) || installation.id <= 0) {
        throw new Error("Private Android GitHub App installation id was invalid.");
      }
      installationId = installation.id;
    }
    const credential = await fetchJsonImpl(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        body: JSON.stringify({
          permissions: { actions: "write", contents: "read" },
          repositories: [name],
        }),
        headers: { ...githubAppHeaders(jwt), "content-type": "application/json" },
        method: "POST",
      },
      "private Android GitHub App token mint",
    );
    assertRecord(credential, "private Android GitHub App token");
    token = requiredString(credential.token, "private Android GitHub App token");
    expiresAtMs = Date.parse(credential.expires_at);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs - now() <= TOKEN_REFRESH_SKEW_MS) {
      token = null;
      throw new Error("Private Android GitHub App token expiry was invalid.");
    }
    return token;
  };
}

export function createGitHubAppJwt({ appId, now = Date.now, privateKey }) {
  if (!/^[1-9][0-9]*$/u.test(appId)) {
    throw new Error("GitHub App id must be a positive integer.");
  }
  const issuedAt = Math.floor(now() / 1000) - 60;
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({ exp: issuedAt + 9 * 60, iat: issuedAt, iss: appId });
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(privateKey));
  return `${unsigned}.${signature.toString("base64url")}`;
}

function createGitHubAppTokenSupplierFromEnv({ fetchJsonImpl, now, repository }) {
  const appId = requiredEnv("NATIVE_ANDROID_E2E_GITHUB_APP_ID");
  const privateKey = requiredEnv("NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY");
  delete process.env.NATIVE_ANDROID_E2E_GITHUB_APP_ID;
  delete process.env.NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY;
  return createGitHubAppTokenSupplier({
    appId,
    fetchJsonImpl,
    now,
    privateKey,
    repository,
  });
}

async function requestPrivateDispatch({
  body,
  deadlineMs,
  fetchImpl,
  now,
  sleepImpl,
  tokenSupplier,
  url,
}) {
  const token = await tokenSupplier();
  let response;
  try {
    response = await fetchImpl(url, {
      body,
      headers: { ...githubHeaders(token), "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    return fenceUnreceiptedDispatch({ cause: error, deadlineMs, now, sleepImpl });
  }
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    if (status >= 400 && status < 500 && ![408, 425, 429].includes(status)) {
      throw new Error(`Private Android workflow dispatch failed with HTTP ${status}.`);
    }
    return fenceUnreceiptedDispatch({
      cause: new Error(`Private Android workflow dispatch returned ambiguous HTTP ${status}.`),
      deadlineMs,
      now,
      sleepImpl,
    });
  }
  let receipt;
  try {
    receipt = await response.json();
  } catch (error) {
    return fenceUnreceiptedDispatch({ cause: error, deadlineMs, now, sleepImpl });
  }
  if (!isRecord(receipt) || !Number.isSafeInteger(receipt.workflow_run_id) || receipt.workflow_run_id <= 0) {
    return fenceUnreceiptedDispatch({
      cause: new Error("Private Android dispatch did not return workflow_run_id."),
      deadlineMs,
      now,
      sleepImpl,
    });
  }
  return receipt.workflow_run_id;
}

async function fenceUnreceiptedDispatch({ cause, deadlineMs, now, sleepImpl }) {
  await holdUnreceiptedDispatchFence({ deadlineMs, now, sleepImpl });
  throw new Error(
    "Private Android dispatch receipt was uncertain; hosted cleanup remained fenced through the dispatch lease and private job timeout.",
    { cause },
  );
}

export async function holdUnreceiptedDispatchFence({ deadlineMs, now = Date.now, sleepImpl = sleep }) {
  while (now() < deadlineMs) {
    await sleepImpl(Math.min(POLL_MS, deadlineMs - now()));
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
  fetchImpl,
  fetchJsonImpl,
  now,
  runId,
  runUrl,
  sleepImpl,
  tokenSupplier,
}) {
  await requestPrivateRunAction({
    fetchImpl,
    label: "private Android workflow cancellation",
    tokenSupplier,
    url: `https://api.github.com/repos/${encodedRepository}/actions/runs/${runId}/cancel`,
  });
  if (await waitForPrivateRunTerminal({
    deadlineMs: now() + PRIVATE_RUN_CANCEL_GRACE_MS,
    expectedSha,
    fetchJsonImpl,
    now,
    runId,
    runUrl,
    sleepImpl,
    tokenSupplier,
  })) {
    return;
  }

  await requestPrivateRunAction({
    fetchImpl,
    label: "private Android workflow force-cancellation",
    tokenSupplier,
    url: `https://api.github.com/repos/${encodedRepository}/actions/runs/${runId}/force-cancel`,
  });
  if (!await waitForPrivateRunTerminal({
    deadlineMs: now() + PRIVATE_RUN_FORCE_CANCEL_TIMEOUT_MS,
    expectedSha,
    fetchJsonImpl,
    now,
    runId,
    runUrl,
    sleepImpl,
    tokenSupplier,
  })) {
    throw new Error("Private Android workflow did not become terminal after force-cancellation.");
  }
}

async function requestPrivateRunAction({ fetchImpl, label, tokenSupplier, url }) {
  const response = await fetchImpl(url, {
    headers: githubHeaders(await tokenSupplier()),
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
  fetchJsonImpl,
  now,
  runId,
  runUrl,
  sleepImpl,
  tokenSupplier,
}) {
  while (now() < deadlineMs) {
    const run = inspectPrivateRun(await fetchJsonImpl(
      runUrl,
      { headers: githubHeaders(await tokenSupplier()) },
      "private Android workflow cancellation status",
    ), { runId, sha: expectedSha });
    if (run.complete) return true;
    await sleepImpl(POLL_MS);
  }
  return false;
}

async function holdPrivateRunExecutionFence({
  deadlineMs,
  expectedSha,
  fetchJsonImpl,
  now,
  runId,
  runUrl,
  sleepImpl,
  tokenSupplier,
}) {
  while (now() < deadlineMs) {
    try {
      const run = inspectPrivateRun(await fetchJsonImpl(
        runUrl,
        { headers: githubHeaders(await tokenSupplier()) },
        "private Android workflow fallback fence status",
      ), { runId, sha: expectedSha });
      if (run.complete) return;
    } catch {
      // Cancellation/status failure is exactly why this hard fence exists.
      // Keep the shared identity/deployment lock until no run that passed the
      // dispatch lease can remain executable under the private job timeout.
    }
    const remainingMs = deadlineMs - now();
    if (remainingMs > 0) await sleepImpl(Math.min(POLL_MS, remainingMs));
  }
}

async function revalidateExactPrHead(
  { expectedSha, prNumber, repository, token },
  fetchJsonImpl = fetchJson,
) {
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    throw new Error("PR number must be a positive integer.");
  }
  const safeWebRepository = safeRepository(repository);
  requiredString(token, "Web GitHub token");
  const encodedRepository = safeWebRepository.split("/").map(encodeURIComponent).join("/");
  inspectExactPrHead(await fetchJsonImpl(
    `https://api.github.com/repos/${encodedRepository}/pulls/${prNumber}`,
    { headers: githubHeaders(token) },
    "Web PR head revalidation",
  ), { expectedSha, prNumber });
  console.log("::notice::native-android-e2e stage=pr_head_revalidate result=success");
}

async function proveCurrentProductionAlias(expectedSha) {
  const childEnv = { ...process.env };
  delete childEnv.NATIVE_ANDROID_E2E_GITHUB_APP_ID;
  delete childEnv.NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY;
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

function githubAppHeaders(jwt) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${jwt}`,
    "user-agent": "murph-native-android-hosted-e2e",
    "x-github-api-version": GITHUB_API_VERSION,
  };
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
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
