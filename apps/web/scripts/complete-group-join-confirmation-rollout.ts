import { createHmac } from "node:crypto";

import {
  resolveVercelProductionDeployment,
  type VercelProductionDeployment,
} from "./resolve-vercel-production-alias-sha";

export interface HostedGroupJoinConfirmationRolloutEnvironment {
  DEPLOYED_SHA?: string;
  HOSTED_WEB_PRODUCTION_BASE_URL?: string;
  HOSTED_WEB_VERCEL_PROJECT_ID?: string;
  HOSTED_WEB_VERCEL_TEAM_ID?: string;
  HOSTED_WEB_VERCEL_TOKEN?: string;
}

export interface HostedGroupJoinConfirmationRolloutResult {
  appended: number;
  deferred: number;
  redeployed: boolean;
  scanned: number;
  terminalSkipped: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface RolloutDependencies {
  fetchImpl?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
}

const PRODUCER_ENV = "HOSTED_GROUP_JOIN_CONFIRMATION_PRODUCER_ENABLED";
const ROLLOUT_TOKEN_ENV = "HOSTED_GROUP_JOIN_CONFIRMATION_ROLLOUT_TOKEN";
const ROLLOUT_TOKEN_CONTEXT = "hosted-group-join-confirmation-rollout-v1";
const REQUEST_TIMEOUT_MS = 30_000;
const DEPLOYMENT_POLL_MS = 5_000;
const DEPLOYMENT_WAIT_MS = 15 * 60_000;
const DRAIN_LIMIT = 25;
const DRAIN_MAX_PAGES = 10_000;

export async function completeHostedGroupJoinConfirmationRollout(
  environment: HostedGroupJoinConfirmationRolloutEnvironment =
    readProcessRolloutEnvironment(),
  dependencies: RolloutDependencies = {},
): Promise<HostedGroupJoinConfirmationRolloutResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleep = dependencies.sleep ?? ((milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const expectedSha = readRequiredEnvironment(environment, "DEPLOYED_SHA");
  const token = readRequiredEnvironment(environment, "HOSTED_WEB_VERCEL_TOKEN");
  const projectId = readRequiredEnvironment(
    environment,
    "HOSTED_WEB_VERCEL_PROJECT_ID",
  );
  const rolloutToken = createHmac("sha256", token)
    .update(ROLLOUT_TOKEN_CONTEXT)
    .update("\0")
    .update(projectId)
    .digest("base64url");

  const production = await resolveVercelProductionDeployment(environment, fetchImpl);
  assertExpectedProduction(production, expectedSha);
  let redeployed = false;
  const status = await readRolloutStatus(environment, fetchImpl, rolloutToken);

  if (!status.enabled || !status.authorized) {
    await upsertProductionEnvironmentVariable({
      environment,
      fetchImpl,
      key: PRODUCER_ENV,
      type: "plain",
      value: "1",
    });
    await upsertProductionEnvironmentVariable({
      environment,
      fetchImpl,
      key: ROLLOUT_TOKEN_ENV,
      type: "sensitive",
      value: rolloutToken,
    });

    const current = await resolveVercelProductionDeployment(environment, fetchImpl);
    if (current.id !== production.id) {
      throw new Error("Vercel production alias changed before the rollout redeploy.");
    }
    assertExpectedProduction(current, expectedSha);

    const redeploymentId = await createProductionRedeployment({
      deployment: current,
      environment,
      fetchImpl,
    });
    await waitForProductionRedeployment({
      environment,
      expectedSha,
      fetchImpl,
      redeploymentId,
      sleep,
    });
    const enabledStatus = await readRolloutStatus(
      environment,
      fetchImpl,
      rolloutToken,
    );
    if (!enabledStatus.enabled || !enabledStatus.authorized) {
      throw new Error(
        "Redeployed production did not enable and authorize the group join confirmation rollout.",
      );
    }
    redeployed = true;
  }

  const drained = await drainEligibleConfirmations({
    environment,
    fetchImpl,
    rolloutToken,
  });

  return { ...drained, redeployed };
}

async function upsertProductionEnvironmentVariable(input: {
  environment: HostedGroupJoinConfirmationRolloutEnvironment;
  fetchImpl: FetchLike;
  key: string;
  type: "plain" | "sensitive";
  value: string;
}): Promise<void> {
  const projectId = readRequiredEnvironment(input.environment, "HOSTED_WEB_VERCEL_PROJECT_ID");
  const url = new URL(
    `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env`,
  );
  url.searchParams.set("upsert", "true");
  appendTeamId(url, input.environment.HOSTED_WEB_VERCEL_TEAM_ID);
  await requestJson(url.toString(), {
    body: JSON.stringify({
      key: input.key,
      target: ["production"],
      type: input.type,
      value: input.value,
    }),
    environment: input.environment,
    fetchImpl: input.fetchImpl,
    label: `Vercel ${input.key} environment update`,
    method: "POST",
  });
}

async function createProductionRedeployment(input: {
  deployment: VercelProductionDeployment;
  environment: HostedGroupJoinConfirmationRolloutEnvironment;
  fetchImpl: FetchLike;
}): Promise<string> {
  const url = new URL("https://api.vercel.com/v13/deployments");
  url.searchParams.set("forceNew", "1");
  appendTeamId(url, input.environment.HOSTED_WEB_VERCEL_TEAM_ID);
  const response = await requestJson(url.toString(), {
    body: JSON.stringify({
      deploymentId: input.deployment.id,
      name: input.deployment.name,
      target: "production",
    }),
    environment: input.environment,
    fetchImpl: input.fetchImpl,
    label: "Vercel production redeploy",
    method: "POST",
  });
  const deploymentId = readRecordString(response, "id");
  if (!deploymentId) {
    throw new Error("Vercel redeploy response did not include an id.");
  }
  return deploymentId;
}

async function waitForProductionRedeployment(input: {
  environment: HostedGroupJoinConfirmationRolloutEnvironment;
  expectedSha: string;
  fetchImpl: FetchLike;
  redeploymentId: string;
  sleep: (milliseconds: number) => Promise<void>;
}): Promise<VercelProductionDeployment> {
  const expiresAt = Date.now() + DEPLOYMENT_WAIT_MS;
  while (Date.now() < expiresAt) {
    const deployment = await readDeployment(input.redeploymentId, input.environment, input.fetchImpl);
    const readyState = readRecordString(deployment, "readyState")
      ?? readRecordString(deployment, "status");
    if (readyState === "ERROR" || readyState === "CANCELED") {
      throw new Error(`Vercel rollout redeploy ended in ${readyState}.`);
    }
    if (readyState === "READY") {
      const production = await resolveVercelProductionDeployment(
        input.environment,
        input.fetchImpl,
      );
      if (production.id === input.redeploymentId) {
        assertExpectedProduction(production, input.expectedSha);
        return production;
      }
    }
    await input.sleep(DEPLOYMENT_POLL_MS);
  }
  throw new Error(`Vercel rollout redeploy timed out after ${DEPLOYMENT_WAIT_MS}ms.`);
}

async function readDeployment(
  deploymentId: string,
  environment: HostedGroupJoinConfirmationRolloutEnvironment,
  fetchImpl: FetchLike,
): Promise<unknown> {
  const url = new URL(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}`,
  );
  appendTeamId(url, environment.HOSTED_WEB_VERCEL_TEAM_ID);
  return requestJson(url.toString(), {
    environment,
    fetchImpl,
    label: "Vercel rollout deployment status",
    method: "GET",
  });
}

async function readRolloutStatus(
  environment: HostedGroupJoinConfirmationRolloutEnvironment,
  fetchImpl: FetchLike,
  rolloutToken: string,
): Promise<{ authorized: boolean; enabled: boolean }> {
  const response = await requestPublicJson(
    buildRolloutUrl(environment),
    {
      fetchImpl,
      headers: { authorization: `Bearer ${rolloutToken}` },
      label: "group join confirmation rollout status",
      method: "GET",
    },
  );
  if (
    !isRecord(response)
    || typeof response.authorized !== "boolean"
    || typeof response.enabled !== "boolean"
  ) {
    throw new Error("Group join confirmation rollout status response was invalid.");
  }
  return { authorized: response.authorized, enabled: response.enabled };
}

async function drainEligibleConfirmations(input: {
  environment: HostedGroupJoinConfirmationRolloutEnvironment;
  fetchImpl: FetchLike;
  rolloutToken: string;
}): Promise<Omit<HostedGroupJoinConfirmationRolloutResult, "redeployed">> {
  let cursor: string | null = null;
  let appended = 0;
  let deferred = 0;
  let scanned = 0;
  let terminalSkipped = 0;

  for (let page = 0; page < DRAIN_MAX_PAGES; page += 1) {
    const response = await requestPublicJson(buildRolloutUrl(input.environment), {
      body: JSON.stringify({ cursor, limit: DRAIN_LIMIT }),
      fetchImpl: input.fetchImpl,
      headers: { authorization: `Bearer ${input.rolloutToken}` },
      label: "group join confirmation rollout drain",
      method: "POST",
    });
    const result = parseDrainResponse(response);
    appended += result.appended;
    deferred += result.deferred;
    scanned += result.scanned;
    terminalSkipped += result.terminalSkipped;
    if (result.nextCursor === null) {
      return { appended, deferred, scanned, terminalSkipped };
    }
    cursor = result.nextCursor;
  }
  throw new Error(`Group join confirmation rollout exceeded ${DRAIN_MAX_PAGES} drain pages.`);
}

function parseDrainResponse(value: unknown): {
  appended: number;
  deferred: number;
  nextCursor: string | null;
  scanned: number;
  terminalSkipped: number;
} {
  if (!isRecord(value)) {
    throw new Error("Group join confirmation rollout drain response was invalid.");
  }
  const nextCursor = value.nextCursor;
  if (
    !isCount(value.appended)
    || !isCount(value.deferred)
    || !isCount(value.scanned)
    || !isCount(value.terminalSkipped)
    || (nextCursor !== null && typeof nextCursor !== "string")
  ) {
    throw new Error("Group join confirmation rollout drain response was invalid.");
  }
  return {
    appended: value.appended,
    deferred: value.deferred,
    nextCursor,
    scanned: value.scanned,
    terminalSkipped: value.terminalSkipped,
  };
}

async function requestJson(
  url: string,
  input: {
    body?: string;
    environment: HostedGroupJoinConfirmationRolloutEnvironment;
    fetchImpl: FetchLike;
    label: string;
    method: "GET" | "POST";
  },
): Promise<unknown> {
  return requestPublicJson(url, {
    body: input.body,
    fetchImpl: input.fetchImpl,
    headers: {
      authorization: `Bearer ${readRequiredEnvironment(
        input.environment,
        "HOSTED_WEB_VERCEL_TOKEN",
      )}`,
    },
    label: input.label,
    method: input.method,
  });
}

async function requestPublicJson(
  url: string,
  input: {
    body?: string;
    fetchImpl: FetchLike;
    headers?: HeadersInit;
    label: string;
    method: "GET" | "POST";
  },
): Promise<unknown> {
  const headers = new Headers(input.headers);
  headers.set("accept", "application/json");
  if (input.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const response = await input.fetchImpl(url, {
    ...(input.body === undefined ? {} : { body: input.body }),
    headers,
    method: input.method,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${input.label} failed with HTTP ${response.status}.`);
  }
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch (error) {
    throw new Error(`${input.label} response was not valid JSON.`, { cause: error });
  }
}

function assertExpectedProduction(
  deployment: VercelProductionDeployment,
  expectedSha: string,
): void {
  if (deployment.sha !== expectedSha) {
    throw new Error(
      `Vercel production alias is ${deployment.sha}, not the expected deployment ${expectedSha}.`,
    );
  }
}

function buildRolloutUrl(
  environment: HostedGroupJoinConfirmationRolloutEnvironment,
): string {
  return new URL(
    "/api/internal/hosted-groups/join-confirmations/rollout",
    readRequiredEnvironment(environment, "HOSTED_WEB_PRODUCTION_BASE_URL"),
  ).toString();
}

function appendTeamId(url: URL, teamId: string | undefined): void {
  if (teamId) {
    url.searchParams.set("teamId", teamId);
  }
}

function readRequiredEnvironment(
  environment: HostedGroupJoinConfirmationRolloutEnvironment,
  key: keyof HostedGroupJoinConfirmationRolloutEnvironment,
): string {
  const value = environment[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required to complete the group join confirmation rollout.`);
  }
  return value.trim();
}

function readProcessRolloutEnvironment(): HostedGroupJoinConfirmationRolloutEnvironment {
  return {
    DEPLOYED_SHA: process.env.DEPLOYED_SHA,
    HOSTED_WEB_PRODUCTION_BASE_URL: process.env.HOSTED_WEB_PRODUCTION_BASE_URL,
    HOSTED_WEB_VERCEL_PROJECT_ID: process.env.HOSTED_WEB_VERCEL_PROJECT_ID,
    HOSTED_WEB_VERCEL_TEAM_ID: process.env.HOSTED_WEB_VERCEL_TEAM_ID,
    HOSTED_WEB_VERCEL_TOKEN: process.env.HOSTED_WEB_VERCEL_TOKEN,
  };
}

function readRecordString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  completeHostedGroupJoinConfirmationRollout()
    .then((result) => {
      console.log("Hosted group join confirmation rollout complete.", result);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
