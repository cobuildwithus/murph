import { createHmac } from "node:crypto";

import {
  resolveVercelProductionAliasSha,
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
  configured: boolean;
  deferred: number;
  scanned: number;
  terminalSkipped: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface RolloutDependencies {
  fetchImpl?: FetchLike;
}

const PRODUCER_ENV = "HOSTED_GROUP_JOIN_CONFIRMATION_PRODUCER_ENABLED";
const ROLLOUT_TOKEN_ENV = "HOSTED_GROUP_JOIN_CONFIRMATION_ROLLOUT_TOKEN";
const ROLLOUT_TOKEN_CONTEXT = "hosted-group-join-confirmation-rollout-v1";
const REQUEST_TIMEOUT_MS = 30_000;
const DRAIN_LIMIT = 25;
const DRAIN_MAX_PAGES = 10_000;

const EMPTY_ROLLOUT_RESULT: HostedGroupJoinConfirmationRolloutResult = {
  appended: 0,
  configured: true,
  deferred: 0,
  scanned: 0,
  terminalSkipped: 0,
};

export async function completeHostedGroupJoinConfirmationRollout(
  environment: HostedGroupJoinConfirmationRolloutEnvironment =
    readProcessRolloutEnvironment(),
  dependencies: RolloutDependencies = {},
): Promise<HostedGroupJoinConfirmationRolloutResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
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

  const productionSha = await resolveVercelProductionAliasSha(environment, fetchImpl);
  assertExpectedProduction(productionSha, expectedSha);
  const status = await readRolloutStatus(environment, fetchImpl, rolloutToken);

  if (!status.authorized) {
    await upsertProductionEnvironmentVariable({
      environment,
      fetchImpl,
      key: ROLLOUT_TOKEN_ENV,
      type: "sensitive",
      value: rolloutToken,
    });
    if (status.enabled) {
      throw new Error(
        "Group join confirmation rollout is enabled without current route authority; the token was repaired for the next normal production release.",
      );
    }
  }

  if (!status.enabled) {
    await upsertProductionEnvironmentVariable({
      environment,
      fetchImpl,
      key: PRODUCER_ENV,
      type: "plain",
      value: "1",
    });

    // Vercel does not expose a conditional production promotion operation.
    // Leave alias ownership with the normal release path: the next production
    // deployment captures this configuration and its post-deploy workflow drains.
    return EMPTY_ROLLOUT_RESULT;
  }

  const drained = await drainEligibleConfirmations({
    environment,
    fetchImpl,
    rolloutToken,
  });

  return { ...drained, configured: false };
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
}): Promise<Omit<HostedGroupJoinConfirmationRolloutResult, "configured">> {
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
  productionSha: string,
  expectedSha: string,
): void {
  if (productionSha !== expectedSha) {
    throw new Error(
      `Vercel production alias is ${productionSha}, not the expected deployment ${expectedSha}.`,
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
