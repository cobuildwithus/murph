import { spawn, type SpawnOptions } from "node:child_process";

import { verifyVercelProductionDeploymentProtection } from "./resolve-vercel-production-alias-sha";

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
  environment: HostedWebProductionMigrationEnvironment,
) => Promise<void>;

export type HostedWebProductionDeploymentProtectionVerifier = (
  environment: HostedWebProductionMigrationEnvironment,
) => Promise<string>;

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
  verifyDeploymentProtection: HostedWebProductionDeploymentProtectionVerifier =
    verifyVercelProductionDeploymentProtection,
): Promise<"ran" | "skipped"> {
  if (!shouldRunHostedWebProductionMigrations(environment)) {
    console.log("Skipping hosted web production migrations outside main-branch Vercel production deploys.");
    return "skipped";
  }

  console.log("Verifying Vercel deployment protection before strict production cutover.");
  await verifyDeploymentProtection(environment);
  const commandEnvironment = { ...environment };
  delete commandEnvironment.HOSTED_WEB_VERCEL_TOKEN;
  delete process.env.HOSTED_WEB_VERCEL_TOKEN;

  console.log("Applying pending hosted web Prisma migrations.");
  await runCommand(
    hostedWebProductionMigrationCommand.command,
    hostedWebProductionMigrationCommand.args,
    commandEnvironment,
  );
  console.log("Regenerating hosted web Prisma client for post-migration tasks.");
  await runCommand(
    hostedWebProductionPrismaGenerateCommand.command,
    hostedWebProductionPrismaGenerateCommand.args,
    commandEnvironment,
  );
  console.log("Syncing hosted Linq DB home-line inventory.");
  await runCommand(
    hostedWebProductionLinqLineSyncCommand.command,
    hostedWebProductionLinqLineSyncCommand.args,
    commandEnvironment,
  );
  return "ran";
}

async function main(): Promise<void> {
  await runHostedWebProductionMigrationsIfNeeded();
}

function runCommandInherited(
  command: string,
  args: readonly string[],
  environment: HostedWebProductionMigrationEnvironment,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const childEnvironment = { ...process.env, ...environment };
    delete childEnvironment.HOSTED_WEB_VERCEL_TOKEN;
    const child = spawn(command, [...args], {
      cwd: resolveRepoRoot(),
      env: childEnvironment,
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
