import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KNOWN_POOLER_PORTS = new Set(["6432", "6543"]);

export const hostedWebPrismaMigrateDeployCommand = {
  command: resolvePnpmCommand(),
  args: ["--dir", "apps/web", "exec", "prisma", "migrate", "deploy"],
} as const;

export type HostedWebMigrationEnvironment = Record<string, string | undefined>;

export type HostedWebMigrationRunner = (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) => Promise<void>;

export interface HostedWebMigrationDatabaseUrl {
  source: "DIRECT_DATABASE_URL" | "DATABASE_URL";
  url: string;
}

export function resolveHostedWebMigrationDatabaseUrl(
  environment: HostedWebMigrationEnvironment,
): HostedWebMigrationDatabaseUrl {
  const directDatabaseUrl = nonEmptyEnv(environment.DIRECT_DATABASE_URL);

  if (directDatabaseUrl !== undefined) {
    assertDirectMigrationDatabaseUrl(directDatabaseUrl, "DIRECT_DATABASE_URL");
    return { source: "DIRECT_DATABASE_URL", url: directDatabaseUrl };
  }

  if (shouldRequireDirectDatabaseUrl(environment)) {
    throw new Error(
      "DIRECT_DATABASE_URL is required for hosted web production migrations. Set it to the direct Postgres endpoint, not the pooled runtime DATABASE_URL.",
    );
  }

  const databaseUrl = nonEmptyEnv(environment.DATABASE_URL);
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required when DIRECT_DATABASE_URL is not set.");
  }

  assertDirectMigrationDatabaseUrl(databaseUrl, "DATABASE_URL");
  return { source: "DATABASE_URL", url: databaseUrl };
}

export function assertDirectMigrationDatabaseUrl(
  databaseUrl: string,
  source: "DIRECT_DATABASE_URL" | "DATABASE_URL",
): void {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    return;
  }

  if (
    (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
    KNOWN_POOLER_PORTS.has(parsed.port)
  ) {
    throw new Error(
      `${source} points at known pooled Postgres port ${parsed.port}; use the direct database endpoint for Prisma migrations.`,
    );
  }
}

export async function runHostedWebPrismaMigrateDeploy(
  environment: HostedWebMigrationEnvironment = process.env,
  runCommand: HostedWebMigrationRunner = runCommandInherited,
): Promise<void> {
  const migrationDatabaseUrl = resolveHostedWebMigrationDatabaseUrl(environment);
  console.log(`Applying hosted web Prisma migrations with ${migrationDatabaseUrl.source}.`);
  await runCommand(
    hostedWebPrismaMigrateDeployCommand.command,
    hostedWebPrismaMigrateDeployCommand.args,
    {
      ...process.env,
      ...environment,
      DATABASE_URL: migrationDatabaseUrl.url,
    },
  );
}

async function main(): Promise<void> {
  loadHostedWebEnvFiles();
  await runHostedWebPrismaMigrateDeploy();
}

function loadHostedWebEnvFiles(): void {
  for (const envPath of [".env.local", ".env"]) {
    const absoluteEnvPath = path.join(CONFIG_DIR, envPath);

    if (existsSync(absoluteEnvPath)) {
      process.loadEnvFile(absoluteEnvPath);
    }
  }
}

function shouldRequireDirectDatabaseUrl(environment: HostedWebMigrationEnvironment): boolean {
  return (
    environment.MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS === "1" ||
    (environment.VERCEL === "1" && environment.VERCEL_ENV === "production")
  );
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function runCommandInherited(
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

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with ${formatExitStatus(code, signal)}.`));
    });
  });
}

function resolveRepoRoot(): URL {
  return new URL("../../../", import.meta.url);
}

function resolvePnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function formatExitStatus(code: number | null, signal: NodeJS.Signals | null): string {
  if (code !== null) {
    return `exit code ${code}`;
  }

  return signal === null ? "unknown status" : `signal ${signal}`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
