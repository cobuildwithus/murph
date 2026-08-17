import {
  HTTP_TIMEOUT_MS,
  NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
  NATIVE_IOS_HOSTED_E2E_LANE_MARKER,
  NATIVE_IOS_HOSTED_E2E_VERCEL_TARGET,
  POLL_MS,
  assertRecord,
  fetchJson,
  isRecord,
  normalizeHttpsOrigin,
  requiredEnv,
  requiredString,
  sleep,
} from "./native-ios-hosted-e2e-support.mjs";

const DEPLOY_TIMEOUT_MS = 25 * 60_000;
const JUNCTION_NAMESPACE_ENV_KEY = "JUNCTION_CLIENT_USER_ID_NAMESPACE";

export function inspectVercelCustomEnvironment(raw, { customEnvironmentId }) {
  assertRecord(raw, "Vercel custom environment");
  if (raw.id !== customEnvironmentId
      || raw.slug !== NATIVE_IOS_HOSTED_E2E_VERCEL_TARGET
      || raw.type === "production") {
    throw new Error("Vercel custom environment does not match the dedicated E2E target.");
  }
  return true;
}

export function inspectVercelJunctionNamespaceVariable(
  raw,
  { customEnvironmentId, environmentVariableId },
) {
  assertRecord(raw, "Vercel Junction namespace variable");
  const targets = Array.isArray(raw.target) ? raw.target : [raw.target];
  if (raw.id !== environmentVariableId
      || raw.key !== JUNCTION_NAMESPACE_ENV_KEY
      || raw.type !== "encrypted"
      || raw.decrypted !== true
      || targets.length !== 0
      || !Array.isArray(raw.customEnvironmentIds)
      || raw.customEnvironmentIds.length !== 1
      || raw.customEnvironmentIds[0] !== customEnvironmentId) {
    throw new Error("Vercel Junction namespace variable does not match the dedicated E2E target.");
  }
  return requiredString(raw.value, "Vercel Junction namespace variable value");
}

export function inspectVercelDeployment(raw, expected) {
  assertRecord(raw, "Vercel deployment");
  const id = requiredString(raw.id, "Vercel deployment id");
  const projectId = typeof raw.projectId === "string"
    ? raw.projectId
    : isRecord(raw.project) && typeof raw.project.id === "string"
      ? raw.project.id
      : "";
  if (projectId !== expected.projectId) throw new Error("Vercel deployment resolved to an unexpected project.");
  if (!isRecord(raw.customEnvironment) || raw.customEnvironment.id !== expected.customEnvironmentId) {
    throw new Error("Vercel deployment resolved to an unexpected custom environment.");
  }
  if (!isRecord(raw.gitSource) || raw.gitSource.sha !== expected.sha || raw.gitSource.ref !== expected.ref) {
    throw new Error("Vercel deployment does not match the requested PR source.");
  }
  if (raw.target === "production") throw new Error("PR E2E must not target Vercel production.");
  const state = String(raw.readyState ?? raw.status ?? "").toUpperCase();
  return {
    baseUrl: normalizeVercelUrl(requiredString(raw.url, "Vercel deployment URL")),
    failed: state === "ERROR" || state === "CANCELED",
    id,
    ready: state === "READY",
  };
}

export function inspectRetirableE2eDeployment(raw, { customEnvironmentId, projectId }) {
  assertRecord(raw, "Vercel active deployment");
  const resolvedProjectId = typeof raw.projectId === "string"
    ? raw.projectId
    : isRecord(raw.project) && typeof raw.project.id === "string"
      ? raw.project.id
      : "";
  if (resolvedProjectId !== projectId
      || !isRecord(raw.customEnvironment)
      || raw.customEnvironment.id !== customEnvironmentId
      || raw.target === "production"
      || !isRecord(raw.meta)
      || raw.meta.murphNativeIosE2e !== NATIVE_IOS_HOSTED_E2E_LANE_MARKER) {
    throw new Error("Dedicated Vercel E2E project has an unrelated active deployment; refusing destructive reset.");
  }
  return requiredString(raw.id, "Vercel active deployment id");
}

export function inspectPublicCandidateResponse({ baseUrl, location, responseUrl, status }) {
  const origin = normalizeHttpsOrigin(baseUrl);
  let reached;
  try {
    reached = new URL(responseUrl);
  } catch {
    throw new Error("Public E2E candidate returned an invalid response URL.");
  }
  if (reached.origin !== origin) throw new Error("Public E2E candidate crossed origins before native dispatch.");
  if (status === 401 || status === 403) {
    throw new Error("Public E2E candidate is protected and cannot be reached anonymously.");
  }
  if (status >= 300 && status < 400 && location) {
    let redirected;
    try {
      redirected = new URL(location, origin);
    } catch {
      throw new Error("Public E2E candidate returned an invalid redirect.");
    }
    if (redirected.origin !== origin) throw new Error("Public E2E candidate attempted a cross-origin redirect.");
  }
  if (status < 200 || status >= 300) throw new Error(`Public E2E candidate returned HTTP ${status}.`);
  return true;
}

export async function createE2eDeployment({ correlationId, ref, sha }) {
  const token = requiredEnv("NATIVE_IOS_E2E_VERCEL_TOKEN");
  const projectId = requiredEnv("NATIVE_IOS_E2E_VERCEL_PROJECT_ID");
  const repoId = Number(requiredEnv("GITHUB_REPOSITORY_ID"));
  if (!Number.isSafeInteger(repoId) || repoId <= 0) throw new Error("Vercel GitHub repository id must be a positive integer.");
  const created = await fetchJson(vercelUrl("https://api.vercel.com/v13/deployments"), {
    body: JSON.stringify({
      customEnvironmentSlugOrId: requiredEnv("NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID"),
      gitSource: { ref, repoId, sha, type: "github" },
      meta: {
        murphNativeIosE2e: NATIVE_IOS_HOSTED_E2E_LANE_MARKER,
        murphNativeIosE2eContract: NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
        murphNativeIosE2eCorrelationId: correlationId,
      },
      name: requiredEnv("NATIVE_IOS_E2E_VERCEL_PROJECT_NAME"),
      project: projectId,
      public: false,
    }),
    headers: vercelHeaders(token),
    method: "POST",
  }, "Vercel E2E deployment create");
  assertRecord(created, "Vercel create response");
  console.log("::notice::native-ios-e2e stage=web_deploy_create result=success");
  return { id: requiredString(created.id, "Vercel deployment id") };
}

export async function readE2eJunctionClientUserIdNamespace() {
  const token = requiredEnv("NATIVE_IOS_E2E_VERCEL_TOKEN");
  const projectId = requiredEnv("NATIVE_IOS_E2E_VERCEL_PROJECT_ID");
  const customEnvironmentId = requiredEnv("NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID");
  const environmentVariableId = requiredEnv(
    "NATIVE_IOS_E2E_VERCEL_JUNCTION_NAMESPACE_ENV_ID",
  );
  const namespace = inspectVercelJunctionNamespaceVariable(await fetchJson(vercelUrl(
    `https://api.vercel.com/v1/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(environmentVariableId)}`,
  ), { headers: vercelHeaders(token) }, "Vercel Junction namespace variable lookup"), {
    customEnvironmentId,
    environmentVariableId,
  });
  console.log("::notice::native-ios-e2e stage=junction_namespace_preflight result=success");
  return namespace;
}

export async function waitForE2eDeployment({ deploymentId, ref, sha }) {
  const expected = {
    customEnvironmentId: requiredEnv("NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID"),
    projectId: requiredEnv("NATIVE_IOS_E2E_VERCEL_PROJECT_ID"),
    ref,
    sha,
  };
  const token = requiredEnv("NATIVE_IOS_E2E_VERCEL_TOKEN");
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const readUrl = vercelUrl(`https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}`);
    readUrl.searchParams.set("withGitRepoInfo", "true");
    const deployment = inspectVercelDeployment(
      await fetchJson(readUrl, { headers: vercelHeaders(token) }, "Vercel E2E deployment read"),
      expected,
    );
    if (deployment.id !== deploymentId) throw new Error("Vercel returned an unexpected deployment id.");
    if (deployment.failed) throw new Error("Vercel E2E deployment failed.");
    if (deployment.ready) {
      console.log("::notice::native-ios-e2e stage=web_deploy_ready result=success");
      await provePublicCandidateReachability(deployment.baseUrl);
      return deployment.baseUrl;
    }
    await sleep(POLL_MS);
  }
  throw new Error("Vercel E2E deployment timed out.");
}

export async function retireE2eDeployments(candidateDeploymentId) {
  const token = requiredEnv("NATIVE_IOS_E2E_VERCEL_TOKEN");
  const projectId = requiredEnv("NATIVE_IOS_E2E_VERCEL_PROJECT_ID");
  const customEnvironmentId = requiredEnv("NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID");
  inspectVercelCustomEnvironment(await fetchJson(vercelUrl(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/custom-environments/${encodeURIComponent(customEnvironmentId)}`,
  ), { headers: vercelHeaders(token) }, "Vercel E2E custom environment lookup"), { customEnvironmentId });

  const ids = new Set(candidateDeploymentId ? [candidateDeploymentId] : []);
  for (const state of ["BUILDING", "INITIALIZING", "QUEUED", "READY", "BLOCKED"]) {
    const listUrl = vercelUrl("https://api.vercel.com/v6/deployments");
    listUrl.searchParams.set("projectId", projectId);
    listUrl.searchParams.set("state", state);
    listUrl.searchParams.set("limit", "100");
    const listed = await fetchJson(listUrl, { headers: vercelHeaders(token) }, "Vercel active E2E deployment list");
    assertRecord(listed, "Vercel deployment list");
    if (!Array.isArray(listed.deployments)) throw new Error("Vercel deployment list was invalid.");
    if (isRecord(listed.pagination) && listed.pagination.next != null) {
      throw new Error("Dedicated Vercel E2E project has too many active deployments to prove safe cleanup.");
    }
    for (const item of listed.deployments) {
      assertRecord(item, "Vercel listed deployment");
      ids.add(requiredString(item.uid ?? item.id, "Vercel listed deployment id"));
    }
  }

  const owned = [];
  for (const id of ids) {
    const readUrl = vercelUrl(`https://api.vercel.com/v13/deployments/${encodeURIComponent(id)}`);
    owned.push(inspectRetirableE2eDeployment(
      await fetchJson(readUrl, { headers: vercelHeaders(token) }, "Vercel active E2E deployment read"),
      { customEnvironmentId, projectId },
    ));
  }
  for (const id of owned) await deleteDeployment(id);
  console.log(`::notice::native-ios-e2e stage=web_retire_stale result=${owned.length === 0 ? "absent" : "success"}`);
}

async function provePublicCandidateReachability(baseUrl) {
  let response;
  try {
    response = await fetch(`${baseUrl}/`, {
      headers: { Accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Public E2E candidate was not reachable before native dispatch.");
  }
  try {
    inspectPublicCandidateResponse({
      baseUrl,
      location: response.headers.get("location"),
      responseUrl: response.url,
      status: response.status,
    });
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }
  console.log("::notice::native-ios-e2e stage=web_public_reachability result=success");
}

async function deleteDeployment(deploymentId) {
  const response = await fetch(vercelUrl(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}`,
  ), {
    headers: vercelHeaders(requiredEnv("NATIVE_IOS_E2E_VERCEL_TOKEN")),
    method: "DELETE",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok && response.status !== 404) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Vercel E2E deployment cleanup failed with HTTP ${response.status}.`);
  }
  await response.body?.cancel().catch(() => undefined);
  console.log("::notice::native-ios-e2e stage=web_retire result=success");
}

function vercelUrl(value) {
  const url = new URL(value);
  const teamId = process.env.NATIVE_IOS_E2E_VERCEL_TEAM_ID;
  if (teamId) url.searchParams.set("teamId", teamId);
  return url;
}

function vercelHeaders(token) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function normalizeVercelUrl(value) {
  return normalizeHttpsOrigin(/^https?:\/\//u.test(value) ? value : `https://${value}`);
}
