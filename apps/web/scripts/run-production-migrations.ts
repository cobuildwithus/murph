import { spawn, type SpawnOptions } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOSTED_WEB_PRISMA_MIGRATIONS_DIR = path.join(APP_ROOT, "prisma", "migrations");

export const hostedWebPrismaPredeployDestructiveMigrationBaseline =
  "20260707170000_drop_stale_linq_recency_columns";

const destructivePredeploySqlPatterns = [
  { label: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/iu },
  { label: "DROP CONSTRAINT", pattern: /\bDROP\s+CONSTRAINT\b/iu },
  { label: "DROP INDEX", pattern: /\bDROP\s+INDEX\b/iu },
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/iu },
  { label: "DROP TYPE", pattern: /\bDROP\s+TYPE\b/iu },
  { label: "DROP VIEW", pattern: /\bDROP\s+(?:MATERIALIZED\s+)?VIEW\b/iu },
] as const;

export const hostedWebProductionMigrationCommand = {
  command: resolvePnpmCommand(),
  args: ["--dir", "apps/web", "prisma:migrate:deploy"],
} as const;

export const hostedWebProductionPrismaGenerateCommand = {
  command: resolvePnpmCommand(),
  args: ["--dir", "apps/web", "prisma:generate"],
} as const;

export const hostedWebProductionLinqLineSyncCommand = {
  command: resolvePnpmCommand(),
  args: ["--dir", "apps/web", "linq:sync-lines", "--", "--skip-provider-inventory"],
} as const;

export type HostedWebProductionMigrationEnvironment = Record<string, string | undefined>;

export type HostedWebProductionMigrationRunner = (
  command: string,
  args: readonly string[],
) => Promise<void>;

export interface HostedWebProductionMigrationOptions {
  prismaMigrationsDir?: string;
}

export interface HostedWebPredeployDestructiveMigration {
  migrationId: string;
  reason: string;
  sqlPath: string;
}

export function shouldRunHostedWebProductionMigrations(
  environment: HostedWebProductionMigrationEnvironment,
): boolean {
  return (
    environment.VERCEL === "1" &&
    environment.VERCEL_ENV === "production" &&
    environment.VERCEL_GIT_COMMIT_REF === "main"
  );
}

export async function runHostedWebProductionMigrationsIfNeeded(
  environment: HostedWebProductionMigrationEnvironment = process.env,
  runCommand: HostedWebProductionMigrationRunner = runCommandInherited,
  options: HostedWebProductionMigrationOptions = {},
): Promise<"ran" | "skipped"> {
  if (!shouldRunHostedWebProductionMigrations(environment)) {
    console.log("Skipping hosted web production migrations outside main-branch Vercel production deploys.");
    return "skipped";
  }

  await assertHostedWebPrismaPredeployMigrationsAreExpandOnly(
    options.prismaMigrationsDir,
  );

  console.log("Applying pending hosted web Prisma migrations.");
  await runCommand(
    hostedWebProductionMigrationCommand.command,
    hostedWebProductionMigrationCommand.args,
  );
  console.log("Regenerating hosted web Prisma client for post-migration tasks.");
  await runCommand(
    hostedWebProductionPrismaGenerateCommand.command,
    hostedWebProductionPrismaGenerateCommand.args,
  );
  console.log("Syncing hosted Linq DB home-line inventory.");
  await runCommand(
    hostedWebProductionLinqLineSyncCommand.command,
    hostedWebProductionLinqLineSyncCommand.args,
  );
  return "ran";
}

export async function assertHostedWebPrismaPredeployMigrationsAreExpandOnly(
  migrationsDir = HOSTED_WEB_PRISMA_MIGRATIONS_DIR,
): Promise<void> {
  const destructiveMigrations =
    await findHostedWebPrismaPredeployDestructiveMigrations(migrationsDir);

  if (destructiveMigrations.length === 0) {
    return;
  }

  const summary = destructiveMigrations
    .map((migration) => `${migration.migrationId} (${migration.reason})`)
    .join(", ");

  throw new Error(
    `Destructive hosted web Prisma migration(s) cannot run in the Vercel predeploy path after ${hostedWebPrismaPredeployDestructiveMigrationBaseline}: ${summary}. Move contract SQL to apps/web/prisma/contract-migrations so it runs after the production deployment is promoted.`,
  );
}

export async function findHostedWebPrismaPredeployDestructiveMigrations(
  migrationsDir = HOSTED_WEB_PRISMA_MIGRATIONS_DIR,
): Promise<HostedWebPredeployDestructiveMigration[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const violations: HostedWebPredeployDestructiveMigration[] = [];

  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name <= hostedWebPrismaPredeployDestructiveMigrationBaseline
    ) {
      continue;
    }

    const sqlPath = path.join(migrationsDir, entry.name, "migration.sql");
    const sql = stripSqlComments(await readFile(sqlPath, "utf8"));
    const destructivePattern = destructivePredeploySqlPatterns.find(({ pattern }) =>
      pattern.test(sql),
    );

    if (destructivePattern !== undefined) {
      violations.push({
        migrationId: entry.name,
        reason: destructivePattern.label,
        sqlPath,
      });
    }
  }

  return violations;
}

async function main(): Promise<void> {
  await runHostedWebProductionMigrationsIfNeeded();
}

function runCommandInherited(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: resolveRepoRoot(),
      env: process.env,
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

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gmu, "").replace(/\/\*[\s\S]*?\*\//gu, "");
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
