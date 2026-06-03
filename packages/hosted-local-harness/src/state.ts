import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { HostedLocalProfile } from "./profiles.ts";
import { hostedLocalHarnessRepoRoot } from "./repo.ts";

export type HostedLocalHarnessStateStatus =
  | "created"
  | "starting"
  | "ready"
  | "running"
  | "complete"
  | "failed"
  | "stopped";

export interface HostedLocalHarnessState {
  artifactDir: string;
  command: readonly string[];
  createdAt: string;
  cwd: string;
  env: Record<string, string>;
  mode: HostedLocalProfile["mode"];
  profile: HostedLocalProfile["name"];
  profileDescription: string;
  runId: string;
  statePath: string;
  status: HostedLocalHarnessStateStatus;
  updatedAt: string;
  version: 1;
  webBaseUrl?: string | null;
  workerBaseUrl?: string | null;
}

export interface CreateHostedLocalStateInput {
  command: readonly string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  profile: HostedLocalProfile;
  runIdSuffix?: string | null;
  status?: HostedLocalHarnessStateStatus;
}

const hostedLocalEnvPrefixAllowlist = [
  "DATABASE_URL",
  "HOSTED_",
  "LINQ_",
  "MURPH_",
  "NEXT_",
  "NODE_ENV",
  "PRIVY_",
  "TELEGRAM_",
  "VERCEL_",
  "VITEST",
] as const;

const secretKeyPattern =
  /(API[_-]?KEY|AUTH|COOKIE|CREDENTIAL|DATABASE_URL|DSN|ENCRYPTION|JWK|KEY|PASSWORD|PRIVATE|SECRET|SESSION|TOKEN)/iu;
const identifierOrPayloadKeyPattern =
  /(^|[_-])(ACCOUNT|ADDRESS|BODY|CHAT|CONTACT|EMAIL|EVENT|FROM|ID|IDENTITY|INBOX|LINQ|MAIL|MEMBER|MESSAGE|PAYLOAD|PHONE|RAW|RECIPIENT|ROUTE|SENDER|TELEGRAM|THREAD|USER|WORKSPACE)([_-]|$)/iu;
const commandSensitiveKeyPattern =
  /(^|[-_])(api[-_]?key|auth|contact|credential|database-url|dsn|email|encryption|from|id|inbox|jwk|key|linq|mail|member|message|password|phone|private|raw|recipient|sender|secret|session|telegram|thread|token|user)(=|$)/iu;
const commandSensitiveHeaderPattern =
  /(?:^|[\s=])(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]/iu;
const commandBearerValuePattern =
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/iu;
const commandSensitiveHeaderFlagNames = new Set(["-H", "--header", "--authorization"]);
const hostedLocalArtifactRoot = path.join(".artifacts", "hosted-local");

export async function createHostedLocalHarnessState(
  input: CreateHostedLocalStateInput,
): Promise<HostedLocalHarnessState> {
  const { resolveHostedLocalDevConfig } = await import(
    "./dev-hosted-local/config.ts"
  );
  const config = tryResolveHostedLocalDevConfig(resolveHostedLocalDevConfig, input.env);
  const createdAt = new Date().toISOString();
  const runId = buildHostedLocalRunId(input.profile.name, input.runIdSuffix);
  const artifactDir = path.join(hostedLocalArtifactRoot, runId);
  const statePath = path.join(artifactDir, "state.json");
  await mkdir(resolveHostedLocalRepoPath(artifactDir), { recursive: true });
  const state: HostedLocalHarnessState = {
    artifactDir,
    command: redactHostedLocalCommand(input.command),
    createdAt,
    cwd: formatHostedLocalStatePath(input.cwd ?? hostedLocalHarnessRepoRoot),
    env: redactHostedLocalEnvironment(input.env),
    mode: input.profile.mode,
    profile: input.profile.name,
    profileDescription: input.profile.description,
    runId,
    statePath,
    status: input.status ?? "created",
    updatedAt: createdAt,
    version: 1,
    workerBaseUrl: config ? formatWorkerBaseUrl(config) : null,
    webBaseUrl: config ? formatWebBaseUrl(config) : null,
  };
  await writeHostedLocalHarnessState(state);
  return state;
}

export async function updateHostedLocalHarnessState(
  state: HostedLocalHarnessState,
  patch: Partial<
    Pick<HostedLocalHarnessState, "status" | "webBaseUrl" | "workerBaseUrl">
  >,
): Promise<HostedLocalHarnessState> {
  const updated: HostedLocalHarnessState = {
    ...state,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeHostedLocalHarnessState(updated);
  return updated;
}

export async function writeHostedLocalHarnessState(
  state: HostedLocalHarnessState,
): Promise<void> {
  const statePath = resolveHostedLocalRepoPath(state.statePath);
  await mkdir(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tempPath, statePath);
}

export function applyHostedLocalStateEnv(input: {
  env: NodeJS.ProcessEnv;
  state: HostedLocalHarnessState;
}): NodeJS.ProcessEnv {
  return {
    ...input.env,
    MURPH_HOSTED_LOCAL_ARTIFACT_DIR: resolveHostedLocalRepoPath(input.state.artifactDir),
    MURPH_HOSTED_LOCAL_RUN_ID: input.state.runId,
    MURPH_HOSTED_LOCAL_STATE_PATH: resolveHostedLocalRepoPath(input.state.statePath),
  };
}

function buildHostedLocalRunId(
  profileName: HostedLocalProfile["name"],
  suffix: string | null | undefined,
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const profileSlug = slug(profileName);
  const suffixSlug = suffix ? `-${slug(suffix)}` : "";
  const randomSlug = randomUUID().replace(/-/gu, "").slice(0, 10);
  return `${timestamp}-${profileSlug}${suffixSlug}-${randomSlug}`;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "hosted-local";
}

function redactHostedLocalEnvironment(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      continue;
    }
    if (!shouldIncludeHostedLocalEnvKey(key)) {
      continue;
    }
    redacted[key] = shouldRedactHostedLocalEnvValue(key)
      ? "[redacted]"
      : redactHostedLocalStateValue(value);
  }
  return Object.fromEntries(Object.entries(redacted).sort(([left], [right]) => left.localeCompare(right)));
}

function shouldIncludeHostedLocalEnvKey(key: string): boolean {
  return hostedLocalEnvPrefixAllowlist.some((prefix) => key === prefix || key.startsWith(prefix));
}

function shouldRedactHostedLocalEnvValue(key: string): boolean {
  return secretKeyPattern.test(key) || identifierOrPayloadKeyPattern.test(key);
}

function redactHostedLocalCommand(command: readonly string[]): readonly string[] {
  const redactedCommand: string[] = [];
  let redactNext = false;

  for (const entry of command) {
    const redacted = redactHostedLocalStateValue(entry);
    if (redactNext) {
      redactedCommand.push("[redacted]");
      redactNext = false;
      continue;
    }

    if (isSplitSensitiveHeaderFlag(redacted)) {
      redactedCommand.push(redacted);
      redactNext = true;
      continue;
    }

    if (isSensitiveHostedLocalCommandValue(redacted)) {
      redactedCommand.push("[redacted]");
      redactNext = isSplitSensitiveCommandFlag(redacted);
      continue;
    }

    redactedCommand.push(redacted);
  }

  return redactedCommand;
}

function isSplitSensitiveCommandFlag(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith("-") && !normalized.includes("=");
}

function isSplitSensitiveHeaderFlag(value: string): boolean {
  return commandSensitiveHeaderFlagNames.has(value.trim());
}

function isSensitiveHostedLocalCommandValue(value: string): boolean {
  return (
    commandSensitiveKeyPattern.test(value) ||
    commandSensitiveHeaderPattern.test(value) ||
    commandBearerValuePattern.test(value) ||
    value.trim().toLowerCase().startsWith("--authorization=") ||
    value.trim().toLowerCase().startsWith("-hauthorization:")
  );
}

function resolveHostedLocalRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.join(hostedLocalHarnessRepoRoot, value);
}

function formatHostedLocalStatePath(value: string): string {
  const resolved = path.resolve(value);
  const relative = path.relative(hostedLocalHarnessRepoRoot, resolved);
  if (!relative) {
    return ".";
  }
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }
  return "<outside-repo>";
}

function redactHostedLocalStateValue(value: string): string {
  return value
    .split(hostedLocalHarnessRepoRoot).join("<REPO_ROOT>")
    .split(os.homedir()).join("<HOME_DIR>");
}

function tryResolveHostedLocalDevConfig(
  resolveHostedLocalDevConfig: typeof import("./dev-hosted-local/config.ts").resolveHostedLocalDevConfig,
  env: NodeJS.ProcessEnv,
): import("./dev-hosted-local/types.ts").HostedLocalDevConfig | null {
  try {
    return resolveHostedLocalDevConfig(env);
  } catch {
    return null;
  }
}

function formatWorkerBaseUrl(
  config: import("./dev-hosted-local/types.ts").HostedLocalDevConfig,
): string {
  const host = formatHostedLocalListenHost(config.workerHost);
  return `${config.workerProtocol}://${host}:${config.workerPort}`;
}

function formatWebBaseUrl(
  config: import("./dev-hosted-local/types.ts").HostedLocalDevConfig,
): string | null {
  if (config.skipWeb) {
    return null;
  }
  const host = formatHostedLocalListenHost(config.webHost);
  return `http://${host}:${config.webPort}`;
}

function formatHostedLocalListenHost(host: string): string {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}
