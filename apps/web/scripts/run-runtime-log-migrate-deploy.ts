import { spawn, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";

import pg from "pg";

import {
  verifyHostedWebMigrationOwner,
  withHostedWebMigrationOwner,
} from "./hosted-web-migration-owner";
import {
  assertDirectMigrationDatabaseUrl,
  normalizeHostedWebMigrationDatabaseUrl,
} from "./run-prisma-migrate-deploy";

export interface HostedRuntimeLogMigrationEnvironment {
  [key: string]: string | undefined;
}

export interface HostedRuntimeLogMigrationDatabaseUrl {
  source:
    | "HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL"
    | "HOSTED_RUNTIME_LOG_DATABASE_URL";
  url: string;
}

export type HostedRuntimeLogMigrationRunner = (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) => Promise<void>;

export interface HostedRuntimeLogMigrateDeployOptions {
  verifyDatabaseEndpoints?: (input: {
    directDatabaseUrl: string;
    primaryDirectDatabaseUrl: string;
    runtimeDatabaseUrl: string;
  }) => Promise<void>;
  verifyMigrationOwner?: (databaseUrl: string) => Promise<void>;
}

export interface HostedRuntimeLogEndpointProbeResult {
  rows: Array<Record<string, unknown>>;
}

export interface HostedRuntimeLogEndpointProbeClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<HostedRuntimeLogEndpointProbeResult>;
}

export type HostedRuntimeLogEndpointProbeClientFactory = (
  databaseUrl: string,
) => HostedRuntimeLogEndpointProbeClient;

const HOSTED_RUNTIME_LOG_MAX_STATEMENT_TIMEOUT_MS = 10_000;

export const hostedRuntimeLogMigrateDeployCommand = {
  args: [
    "--dir",
    "apps/web",
    "exec",
    "prisma",
    "migrate",
    "deploy",
    "--config",
    "prisma.runtime-logs.config.ts",
  ],
  command: resolvePnpmCommand(),
} as const;

export function resolveHostedRuntimeLogMigrationDatabaseUrl(
  environment: HostedRuntimeLogMigrationEnvironment,
): HostedRuntimeLogMigrationDatabaseUrl {
  const direct = nonEmpty(environment.HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL);
  const runtime = nonEmpty(environment.HOSTED_RUNTIME_LOG_DATABASE_URL);
  const primaryUrls = [
    nonEmpty(environment.DATABASE_URL),
    nonEmpty(environment.DIRECT_DATABASE_URL),
  ].filter((value): value is string => value !== null);
  const production = environment.VERCEL_ENV === "production"
    || environment.MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS === "1";
  if (production && !runtime) {
    throw new Error(
      "HOSTED_RUNTIME_LOG_DATABASE_URL is required for production runtime-log migrations.",
    );
  }
  if (production && !direct) {
    throw new Error(
      "HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL is required for production runtime-log migrations.",
    );
  }
  if (production && !nonEmpty(environment.DIRECT_DATABASE_URL)) {
    throw new Error(
      "DIRECT_DATABASE_URL is required to verify that hosted runtime logs use a separate PostgreSQL cluster.",
    );
  }

  const source = direct
    ? "HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL" as const
    : "HOSTED_RUNTIME_LOG_DATABASE_URL" as const;
  const selected = direct ?? runtime;
  if (!selected) {
    throw new Error(
      "HOSTED_RUNTIME_LOG_DATABASE_URL is required for runtime-log migrations.",
    );
  }
  if (direct && runtime && !hostedRuntimeLogDatabaseNamesMatch(runtime, direct)) {
    throw new Error(
      "HOSTED_RUNTIME_LOG_DATABASE_URL and HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL must name the same database.",
    );
  }

  const normalized = normalizeHostedWebMigrationDatabaseUrl(selected);
  assertDirectMigrationDatabaseUrl(
    normalized,
    source === "HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL"
      ? "DIRECT_DATABASE_URL"
      : "DATABASE_URL",
  );

  if (primaryUrls.some((primary) =>
    databaseIdentity(primary) === databaseIdentity(normalized)
  )) {
    throw new Error(
      "The hosted runtime log database must be distinct from DATABASE_URL.",
    );
  }

  return { source, url: normalized };
}

export async function verifyHostedRuntimeLogDatabaseEndpoints(
  input: {
    directDatabaseUrl: string;
    primaryDirectDatabaseUrl: string;
    runtimeDatabaseUrl: string;
  },
  createClient: HostedRuntimeLogEndpointProbeClientFactory =
    createHostedRuntimeLogEndpointProbeClient,
): Promise<void> {
  await verifyHostedRuntimeLogPooledDirectIdentity({
    leftDatabaseUrl: normalizeHostedWebMigrationDatabaseUrl(
      input.runtimeDatabaseUrl,
    ),
    rightDatabaseUrl: normalizeHostedWebMigrationDatabaseUrl(
      input.directDatabaseUrl,
    ),
  }, createClient);

  const runtimeSystemIdentifier = await readPostgresSystemIdentifier(
    normalizeHostedWebMigrationDatabaseUrl(input.directDatabaseUrl),
    createClient,
  );
  const primarySystemIdentifier = await readPostgresSystemIdentifier(
    normalizeHostedWebMigrationDatabaseUrl(input.primaryDirectDatabaseUrl),
    createClient,
  );
  if (runtimeSystemIdentifier === primarySystemIdentifier) {
    throw new Error(
      "The hosted runtime log database resolved to the same PostgreSQL cluster as DIRECT_DATABASE_URL.",
    );
  }
}

async function verifyHostedRuntimeLogPooledDirectIdentity(
  input: {
    leftDatabaseUrl: string;
    rightDatabaseUrl: string;
  },
  createClient: HostedRuntimeLogEndpointProbeClientFactory,
): Promise<void> {
  const lockKey = randomBytes(8).readBigInt64BE().toString();
  const left = createClient(input.leftDatabaseUrl);
  const right = createClient(input.rightDatabaseUrl);
  let leftConnected = false;
  let rightConnected = false;
  let leftTransaction = false;
  let rightTransaction = false;

  try {
    await left.connect();
    leftConnected = true;
    await right.connect();
    rightConnected = true;
    const timeoutProbe = await left.query(
      `SELECT (
        current_setting('statement_timeout')::interval > interval '0 seconds'
        AND current_setting('statement_timeout')::interval
          <= ($1::bigint * interval '1 millisecond')
      ) AS "configured"`,
      [HOSTED_RUNTIME_LOG_MAX_STATEMENT_TIMEOUT_MS],
    );
    if (timeoutProbe.rows[0]?.configured !== true) {
      throw new Error(
        "HOSTED_RUNTIME_LOG_DATABASE_URL must use a role with statement_timeout set to a positive value no greater than 10 seconds.",
      );
    }
    await left.query("BEGIN");
    leftTransaction = true;
    await left.query(
      "SELECT pg_advisory_xact_lock($1::bigint)",
      [lockKey],
    );
    await right.query("BEGIN");
    rightTransaction = true;
    const probe = await right.query(
      "SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired",
      [lockKey],
    );
    const acquired = probe.rows[0]?.acquired;
    if (typeof acquired !== "boolean") {
      throw new Error(
        "Hosted runtime log database topology probe returned an invalid PostgreSQL response.",
      );
    }
    if (acquired !== false) {
      throw new Error(
        "HOSTED_RUNTIME_LOG_DATABASE_URL and HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL did not resolve to the same PostgreSQL database.",
      );
    }
  } finally {
    if (rightTransaction) {
      await right.query("ROLLBACK").catch(() => undefined);
    }
    if (leftTransaction) {
      await left.query("ROLLBACK").catch(() => undefined);
    }
    if (rightConnected) {
      await right.end().catch(() => undefined);
    }
    if (leftConnected) {
      await left.end().catch(() => undefined);
    }
  }
}

async function readPostgresSystemIdentifier(
  databaseUrl: string,
  createClient: HostedRuntimeLogEndpointProbeClientFactory,
): Promise<string> {
  const client = createClient(databaseUrl);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const result = await client.query(
      'SELECT system_identifier::text AS "systemIdentifier" FROM pg_control_system()',
    );
    const systemIdentifier = result.rows[0]?.systemIdentifier;
    if (
      typeof systemIdentifier !== "string"
      || !/^[0-9]+$/u.test(systemIdentifier)
    ) {
      throw new Error(
        "Hosted runtime log database cluster identity probe returned an invalid PostgreSQL response.",
      );
    }
    return systemIdentifier;
  } finally {
    if (connected) {
      await client.end().catch(() => undefined);
    }
  }
}

export async function runHostedRuntimeLogMigrateDeploy(
  environment: HostedRuntimeLogMigrationEnvironment = process.env,
  runCommand: HostedRuntimeLogMigrationRunner = runCommandInherited,
  options: HostedRuntimeLogMigrateDeployOptions = {},
): Promise<void> {
  const migration = resolveHostedRuntimeLogMigrationDatabaseUrl(environment);
  const runtimeDatabaseUrl = nonEmpty(
    environment.HOSTED_RUNTIME_LOG_DATABASE_URL,
  ) ?? migration.url;
  const directDatabaseUrl = nonEmpty(
    environment.HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL,
  ) ?? migration.url;
  const primaryDirectDatabaseUrl =
    nonEmpty(environment.DIRECT_DATABASE_URL)
    ?? nonEmpty(environment.DATABASE_URL);
  if (!primaryDirectDatabaseUrl) {
    throw new Error(
      "DIRECT_DATABASE_URL or DATABASE_URL is required to verify hosted runtime log database isolation.",
    );
  }
  await (
    options.verifyDatabaseEndpoints
    ?? verifyHostedRuntimeLogDatabaseEndpoints
  )({
    directDatabaseUrl,
    primaryDirectDatabaseUrl,
    runtimeDatabaseUrl,
  });
  const ownerDatabaseUrl = withHostedWebMigrationOwner(migration.url);
  await (options.verifyMigrationOwner ?? verifyHostedWebMigrationOwner)(
    ownerDatabaseUrl,
  );
  console.log(`Applying hosted runtime log migrations with ${migration.source}.`);
  await runCommand(
    hostedRuntimeLogMigrateDeployCommand.command,
    hostedRuntimeLogMigrateDeployCommand.args,
    {
      ...process.env,
      ...environment,
      HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL: ownerDatabaseUrl,
      HOSTED_RUNTIME_LOG_DATABASE_URL:
        nonEmpty(environment.HOSTED_RUNTIME_LOG_DATABASE_URL) ?? ownerDatabaseUrl,
    },
  );
}

function createHostedRuntimeLogEndpointProbeClient(
  databaseUrl: string,
): HostedRuntimeLogEndpointProbeClient {
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  return {
    async connect() {
      await client.connect();
    },
    async end() {
      await client.end();
    },
    async query(
      text: string,
      values?: readonly unknown[],
    ): Promise<HostedRuntimeLogEndpointProbeResult> {
      const result = await client.query<Record<string, unknown>>(
        text,
        values === undefined ? undefined : [...values],
      );
      return { rows: result.rows };
    },
  };
}

async function runCommandInherited(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: resolveRepoRoot(),
      env: environment,
      stdio: "inherit",
    } satisfies SpawnOptions);
    child.once("error", reject);
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `Hosted runtime log migration command failed (${signal ?? `exit ${String(code)}`}).`,
      ));
    });
  });
}

function hostedRuntimeLogDatabaseNamesMatch(
  runtimeUrl: string,
  directUrl: string,
): boolean {
  const runtimeName = readPostgresDatabaseName(runtimeUrl);
  const directName = readPostgresDatabaseName(directUrl);
  return runtimeName !== null
    && directName !== null
    && runtimeName === directName;
}

function readPostgresDatabaseName(value: string): string | null {
  const normalized = normalizeHostedWebMigrationDatabaseUrl(value);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return null;
    }
    const name = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

function databaseIdentity(value: string): string {
  const normalized = normalizeHostedWebMigrationDatabaseUrl(value);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return normalized;
    }
    const port = parsed.port || "5432";
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
    return `postgres://${parsed.hostname.toLowerCase()}:${port}/${databaseName}`;
  } catch {
    return normalized;
  }
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function resolveRepoRoot(): URL {
  return new URL("../../../", import.meta.url);
}

function resolvePnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  runHostedRuntimeLogMigrateDeploy().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
