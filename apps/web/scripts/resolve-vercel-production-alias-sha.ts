export interface VercelAliasShaEnvironment {
  HOSTED_WEB_PRODUCTION_BASE_URL?: string;
  HOSTED_WEB_VERCEL_PROJECT_ID?: string;
  HOSTED_WEB_VERCEL_TEAM_ID?: string;
  HOSTED_WEB_VERCEL_TOKEN?: string;
}

export interface VercelProductionDeploymentInput {
  deploymentUrl: string;
  expectedGitSha: string;
}

export interface VerifiedVercelProductionDeployment {
  deploymentId: string;
  gitSha: string;
  productionDomainCount: number;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

interface VercelAliasDeploymentRef {
  kind: "id" | "url";
  value: string;
}

type FetchLike = (
  input: string,
  init?: {
    headers?: HeadersInit;
    signal?: AbortSignal;
  },
) => Promise<FetchResponse>;

const VERCEL_API_TIMEOUT_MS = 15_000;

const PROTECTED_PRODUCTION_DEPLOYMENT_TYPES = new Set([
  "all_except_custom_domains",
  "prod_deployment_urls_and_all_previews",
]);

// Keep this workflow helper on direct REST calls: the GitHub deployment_status job
// needs only Vercel's alias, deployment, and project endpoints, and the response
// contracts are pinned by focused tests without adding SDK/runtime setup to the
// deploy gate.
function extractVercelAliasDeploymentRef(
  aliasResponse: unknown,
): VercelAliasDeploymentRef | undefined {
  if (!isRecord(aliasResponse)) {
    return undefined;
  }

  const deploymentId = readString(aliasResponse.deploymentId);
  if (deploymentId !== undefined) {
    return { kind: "id", value: deploymentId };
  }

  if (!isRecord(aliasResponse.deployment)) {
    return undefined;
  }

  const nestedDeploymentId = readString(aliasResponse.deployment.id);
  if (nestedDeploymentId !== undefined) {
    return { kind: "id", value: nestedDeploymentId };
  }

  const deploymentUrl = readString(aliasResponse.deployment.url);
  return deploymentUrl === undefined
    ? undefined
    : { kind: "url", value: deploymentUrl };
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

  const deploymentUrl = buildVercelDeploymentUrl(deploymentRef.value, environment);
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

export async function verifyVercelProductionDeploymentProtection(
  environment: VercelAliasShaEnvironment = readProcessVercelAliasShaEnvironment(),
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const token = readRequiredEnvironment(
    environment,
    "HOSTED_WEB_VERCEL_TOKEN",
  );
  const aliasResponse = await fetchVercelJson(
    buildVercelAliasUrl(environment, false),
    token,
    fetchImpl,
    "alias",
  );
  const deploymentRef = extractVercelAliasDeploymentRef(aliasResponse);
  if (deploymentRef === undefined) {
    throw new Error("Vercel alias response did not include a deployment id or url.");
  }
  const deploymentResponse = await fetchVercelJson(
    buildVercelDeploymentUrl(deploymentRef.value, environment),
    token,
    fetchImpl,
    "deployment",
  );
  const configuredProjectId = readRequiredEnvironment(environment, "HOSTED_WEB_VERCEL_PROJECT_ID");
  const actualProjectId = extractVercelDeploymentProjectId(deploymentResponse);
  if (actualProjectId !== configuredProjectId) {
    throw new Error("Vercel production alias resolves to a different project than HOSTED_WEB_VERCEL_PROJECT_ID.");
  }
  const projectUrl = buildVercelProjectUrl(actualProjectId, environment);
  const projectResponse = await fetchVercelJson(
    projectUrl,
    token,
    fetchImpl,
    "project",
  );
  const deploymentType = extractVercelDeploymentProtectionType(projectResponse);

  if (
    deploymentType === undefined
    || !PROTECTED_PRODUCTION_DEPLOYMENT_TYPES.has(deploymentType)
  ) {
    throw new Error(
      "Vercel Standard or All Except Custom Domains protection must protect generated production deployment URLs before the strict app-session cutover.",
    );
  }

  return deploymentType;
}

export async function verifyVercelProductionDeployment(
  environment: VercelAliasShaEnvironment,
  input: VercelProductionDeploymentInput,
  fetchImpl: FetchLike = fetch,
): Promise<VerifiedVercelProductionDeployment> {
  const verifiedCandidate = await verifyVercelProductionDeploymentCandidate(
    environment,
    input,
    fetchImpl,
  );
  const token = readRequiredEnvironment(
    environment,
    "HOSTED_WEB_VERCEL_TOKEN",
  );
  const configuredProjectId = readRequiredEnvironment(
    environment,
    "HOSTED_WEB_VERCEL_PROJECT_ID",
  );

  const productionDomains = await listVercelProductionDomains(
    configuredProjectId,
    environment,
    token,
    fetchImpl,
  );
  if (productionDomains.length === 0) {
    throw new Error("Vercel project does not have any production custom domains.");
  }

  const configuredProductionHost = resolveAliasHost(
    readRequiredEnvironment(environment, "HOSTED_WEB_PRODUCTION_BASE_URL"),
  ).toLowerCase();
  if (!productionDomains.includes(configuredProductionHost)) {
    throw new Error("HOSTED_WEB_PRODUCTION_BASE_URL is not a configured Vercel production custom domain.");
  }

  const resolvedDeploymentIds = await Promise.all(
    productionDomains.map(async (domain) => {
      const aliasResponse = await fetchVercelJson(
        buildVercelAliasLookupUrl(domain, environment),
        token,
        fetchImpl,
        "production domain alias",
      );
      return resolveVercelAliasDeploymentId(
        aliasResponse,
        environment,
        token,
        fetchImpl,
      );
    }),
  );
  const mismatchCount = resolvedDeploymentIds.filter(
    (deploymentId) => deploymentId !== verifiedCandidate.deploymentId,
  ).length;
  if (mismatchCount > 0) {
    throw new Error(
      `${mismatchCount} of ${productionDomains.length} Vercel production custom domains do not resolve to the exact deployment.`,
    );
  }

  return {
    deploymentId: verifiedCandidate.deploymentId,
    gitSha: verifiedCandidate.gitSha,
    productionDomainCount: productionDomains.length,
  };
}

async function resolveVercelAliasDeploymentId(
  aliasResponse: unknown,
  environment: VercelAliasShaEnvironment,
  token: string,
  fetchImpl: FetchLike,
): Promise<string | undefined> {
  const deploymentRef = extractVercelAliasDeploymentRef(aliasResponse);
  if (deploymentRef === undefined) {
    return undefined;
  }
  if (deploymentRef.kind === "id") {
    return deploymentRef.value;
  }

  const deploymentResponse = await fetchVercelJson(
    buildVercelDeploymentUrl(deploymentRef.value, environment),
    token,
    fetchImpl,
    "production domain deployment",
  );
  return extractVercelDeploymentId(deploymentResponse);
}

async function verifyVercelProductionDeploymentCandidate(
  environment: VercelAliasShaEnvironment,
  input: VercelProductionDeploymentInput,
  fetchImpl: FetchLike,
): Promise<{ deploymentId: string; gitSha: string }> {
  const token = readRequiredEnvironment(
    environment,
    "HOSTED_WEB_VERCEL_TOKEN",
  );
  const configuredProjectId = readRequiredEnvironment(
    environment,
    "HOSTED_WEB_VERCEL_PROJECT_ID",
  );
  const deploymentHost = resolveExactDeploymentHost(input.deploymentUrl);
  const expectedGitSha = resolveExpectedGitSha(input.expectedGitSha);
  const deploymentResponse = await fetchVercelJson(
    buildVercelDeploymentUrl(
      deploymentHost,
      environment,
    ),
    token,
    fetchImpl,
    "deployment",
  );
  const deploymentId = extractVercelDeploymentId(deploymentResponse);
  const deploymentProjectId = extractVercelDeploymentProjectId(deploymentResponse);

  if (deploymentId === undefined) {
    throw new Error("Vercel deployment response did not include an id.");
  }
  if (deploymentProjectId !== configuredProjectId) {
    throw new Error("Vercel deployment belongs to a different project than HOSTED_WEB_VERCEL_PROJECT_ID.");
  }
  if (extractVercelDeploymentGitSha(deploymentResponse) !== expectedGitSha) {
    throw new Error("Vercel deployment gitSource.sha does not match DEPLOYED_SHA.");
  }
  if (extractVercelDeploymentTarget(deploymentResponse) !== "production") {
    throw new Error("Vercel deployment is not a production deployment.");
  }
  if (extractVercelDeploymentReadyState(deploymentResponse) !== "READY") {
    throw new Error("Vercel production deployment is not ready.");
  }

  return {
    deploymentId,
    gitSha: expectedGitSha,
  };
}

async function listVercelProductionDomains(
  projectId: string,
  environment: VercelAliasShaEnvironment,
  token: string,
  fetchImpl: FetchLike,
): Promise<string[]> {
  const domains = new Set<string>();
  const seenCursors = new Set<number>();
  let cursor: number | undefined;

  do {
    const response = await fetchVercelJson(
      buildVercelProjectDomainsUrl(projectId, environment, cursor),
      token,
      fetchImpl,
      "project domains",
    );
    if (!isRecord(response) || !Array.isArray(response.domains)) {
      throw new Error("Vercel project domains response did not include a domains array.");
    }
    for (const domain of response.domains) {
      if (!isRecord(domain)) {
        throw new Error("Vercel project domains response included an invalid domain.");
      }
      if (!isOptionalString(domain.gitBranch) || !isOptionalString(domain.customEnvironmentId)) {
        throw new Error("Vercel project domains response included an invalid environment binding.");
      }
      if (domain.gitBranch != null || domain.customEnvironmentId != null) {
        continue;
      }
      const name = readString(domain.name);
      if (name === undefined) {
        throw new Error("Vercel production project domain did not include a name.");
      }
      domains.add(name.toLowerCase());
    }

    cursor = extractVercelPaginationCursor(response);
    if (cursor !== undefined) {
      if (seenCursors.has(cursor)) {
        throw new Error("Vercel project domains pagination repeated a cursor.");
      }
      seenCursors.add(cursor);
    }
  } while (cursor !== undefined);

  return [...domains].sort();
}

function extractVercelPaginationCursor(response: Record<string, unknown>): number | undefined {
  if (!isRecord(response.pagination) || response.pagination.next == null) {
    return undefined;
  }
  const cursor = response.pagination.next;
  if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error("Vercel project domains response included an invalid pagination cursor.");
  }
  return cursor;
}

function extractVercelDeploymentProtectionType(
  projectResponse: unknown,
): string | undefined {
  if (!isRecord(projectResponse) || !isRecord(projectResponse.ssoProtection)) {
    return undefined;
  }

  return readString(projectResponse.ssoProtection.deploymentType);
}

function extractVercelDeploymentProjectId(response: unknown): string | undefined {
  if (!isRecord(response)) return undefined;
  return readString(response.projectId) ?? (isRecord(response.project) ? readString(response.project.id) : undefined);
}

function extractVercelDeploymentId(response: unknown): string | undefined {
  return isRecord(response) ? readString(response.id) : undefined;
}

function extractVercelDeploymentTarget(response: unknown): string | undefined {
  return isRecord(response) ? readString(response.target) : undefined;
}

function extractVercelDeploymentReadyState(response: unknown): string | undefined {
  return isRecord(response) ? readString(response.readyState) : undefined;
}

function buildVercelAliasUrl(
  environment: VercelAliasShaEnvironment,
  includeProjectId = true,
): string {
  const productionBaseUrl = readRequiredEnvironment(
    environment,
    "HOSTED_WEB_PRODUCTION_BASE_URL",
  );
  const aliasHost = resolveAliasHost(productionBaseUrl);
  const url = new URL(`https://api.vercel.com/v4/aliases/${aliasHost}`);
  if (includeProjectId) {
    url.searchParams.set("projectId", readRequiredEnvironment(environment, "HOSTED_WEB_VERCEL_PROJECT_ID"));
  }
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

function buildVercelProjectUrl(
  projectId: string,
  environment: VercelAliasShaEnvironment,
): string {
  const url = new URL(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`,
  );
  appendTeamId(url, environment.HOSTED_WEB_VERCEL_TEAM_ID);

  return url.toString();
}

function buildVercelProjectDomainsUrl(
  projectId: string,
  environment: VercelAliasShaEnvironment,
  cursor?: number,
): string {
  const url = new URL(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/domains`,
  );
  url.searchParams.set("limit", "100");
  if (cursor !== undefined) {
    url.searchParams.set("until", String(cursor));
  }
  appendTeamId(url, environment.HOSTED_WEB_VERCEL_TEAM_ID);
  return url.toString();
}

function buildVercelAliasLookupUrl(
  domain: string,
  environment: VercelAliasShaEnvironment,
): string {
  const url = new URL(
    `https://api.vercel.com/v4/aliases/${encodeURIComponent(domain)}`,
  );
  url.searchParams.set(
    "projectId",
    readRequiredEnvironment(environment, "HOSTED_WEB_VERCEL_PROJECT_ID"),
  );
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

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, VERCEL_API_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers,
      signal: controller.signal,
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
  } catch (error) {
    if (timedOut) {
      throw new Error(`Vercel ${label} request timed out after ${VERCEL_API_TIMEOUT_MS}ms.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveExactDeploymentHost(deploymentUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(deploymentUrl);
  } catch {
    throw new Error("HOSTED_WEB_VERCEL_DEPLOYMENT_URL must be an absolute HTTPS deployment URL.");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username.length > 0
    || parsed.password.length > 0
    || (parsed.pathname !== "/" && parsed.pathname !== "")
    || parsed.search.length > 0
    || parsed.hash.length > 0
  ) {
    throw new Error("HOSTED_WEB_VERCEL_DEPLOYMENT_URL must be an origin-only HTTPS deployment URL.");
  }
  return parsed.hostname;
}

function resolveExpectedGitSha(value: string): string {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error("DEPLOYED_SHA must be an exact lowercase 40-character Git SHA.");
  }
  return value;
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

export function readProcessVercelAliasShaEnvironment(): VercelAliasShaEnvironment {
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

function isOptionalString(value: unknown): value is string | null | undefined {
  return value == null || (typeof value === "string" && value.length > 0);
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
