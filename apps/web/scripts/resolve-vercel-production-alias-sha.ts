interface VercelAliasShaEnvironment {
  HOSTED_WEB_PRODUCTION_BASE_URL?: string;
  HOSTED_WEB_VERCEL_PROJECT_ID?: string;
  HOSTED_WEB_VERCEL_TEAM_ID?: string;
  HOSTED_WEB_VERCEL_TOKEN?: string;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type FetchLike = (
  input: string,
  init?: { headers?: HeadersInit },
) => Promise<FetchResponse>;

// Keep this workflow helper on direct REST calls: the GitHub deployment_status job
// needs only Vercel's alias and deployment endpoints, and the response contract is
// pinned by focused tests without adding SDK/runtime setup to the deploy gate.
function extractVercelAliasDeploymentRef(
  aliasResponse: unknown,
): string | undefined {
  if (!isRecord(aliasResponse)) {
    return undefined;
  }

  const deploymentId = readString(aliasResponse.deploymentId);
  if (deploymentId !== undefined) {
    return deploymentId;
  }

  if (!isRecord(aliasResponse.deployment)) {
    return undefined;
  }

  return (
    readString(aliasResponse.deployment.id) ??
    readString(aliasResponse.deployment.url)
  );
}

function extractVercelDeploymentGitSha(
  deploymentResponse: unknown,
): string | undefined {
  if (!isRecord(deploymentResponse) || !isRecord(deploymentResponse.gitSource)) {
    return undefined;
  }

  return readString(deploymentResponse.gitSource.sha);
}

export async function resolveVercelProductionAliasSha(
  environment: VercelAliasShaEnvironment = readProcessVercelAliasShaEnvironment(),
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const token = readRequiredEnvironment(
    environment,
    "HOSTED_WEB_VERCEL_TOKEN",
  );
  const aliasUrl = buildVercelAliasUrl(environment);

  const aliasResponse = await fetchVercelJson(aliasUrl, token, fetchImpl, "alias");
  const deploymentRef = extractVercelAliasDeploymentRef(aliasResponse);
  if (deploymentRef === undefined) {
    throw new Error("Vercel alias response did not include a deployment id or url.");
  }

  const deploymentUrl = buildVercelDeploymentUrl(deploymentRef, environment);
  const deploymentResponse = await fetchVercelJson(
    deploymentUrl,
    token,
    fetchImpl,
    "deployment",
  );
  const gitSha = extractVercelDeploymentGitSha(deploymentResponse);
  if (gitSha === undefined) {
    throw new Error("Vercel deployment response did not include gitSource.sha.");
  }

  return gitSha;
}

function buildVercelAliasUrl(
  environment: VercelAliasShaEnvironment,
): string {
  const productionBaseUrl = readRequiredEnvironment(
    environment,
    "HOSTED_WEB_PRODUCTION_BASE_URL",
  );
  const projectId = readRequiredEnvironment(
    environment,
    "HOSTED_WEB_VERCEL_PROJECT_ID",
  );
  const aliasHost = resolveAliasHost(productionBaseUrl);
  const url = new URL(`https://api.vercel.com/v4/aliases/${aliasHost}`);
  url.searchParams.set("projectId", projectId);
  appendTeamId(url, environment.HOSTED_WEB_VERCEL_TEAM_ID);

  return url.toString();
}

function buildVercelDeploymentUrl(
  deploymentRef: string,
  environment: VercelAliasShaEnvironment,
): string {
  const url = new URL(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentRef)}`,
  );
  url.searchParams.set("withGitRepoInfo", "true");
  appendTeamId(url, environment.HOSTED_WEB_VERCEL_TEAM_ID);

  return url.toString();
}

async function fetchVercelJson(
  url: string,
  token: string,
  fetchImpl: FetchLike,
  label: string,
): Promise<unknown> {
  const headers = new Headers();
  headers.set("authorization", ["Bearer", token].join(" "));

  const response = await fetchImpl(url, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Vercel ${label} request failed with HTTP ${response.status}.`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Vercel ${label} response was not valid JSON.`);
  }
}

function readRequiredEnvironment(
  environment: VercelAliasShaEnvironment,
  key: keyof VercelAliasShaEnvironment,
): string {
  const value = environment[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required to verify the current Vercel deployment.`);
  }

  return value;
}

function resolveAliasHost(productionBaseUrl: string): string {
  const aliasHost = productionBaseUrl
    .replace(/^https?:\/\//u, "")
    .split("/")[0]
    ?.trim();

  if (aliasHost === undefined || aliasHost.length === 0) {
    throw new Error("HOSTED_WEB_PRODUCTION_BASE_URL must include a host.");
  }

  return aliasHost;
}

function appendTeamId(url: URL, teamId: string | undefined): void {
  if (teamId !== undefined && teamId.length > 0) {
    url.searchParams.set("teamId", teamId);
  }
}

function readProcessVercelAliasShaEnvironment(): VercelAliasShaEnvironment {
  return {
    HOSTED_WEB_PRODUCTION_BASE_URL: process.env.HOSTED_WEB_PRODUCTION_BASE_URL,
    HOSTED_WEB_VERCEL_PROJECT_ID: process.env.HOSTED_WEB_VERCEL_PROJECT_ID,
    HOSTED_WEB_VERCEL_TEAM_ID: process.env.HOSTED_WEB_VERCEL_TEAM_ID,
    HOSTED_WEB_VERCEL_TOKEN: process.env.HOSTED_WEB_VERCEL_TOKEN,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  resolveVercelProductionAliasSha()
    .then((sha) => {
      process.stdout.write(sha);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
