import { spawn, type SpawnOptions } from "node:child_process";

import {
  buildHostedGroupUsageFundingLocatorForRuntimeMember,
  buildHostedGroupUsageFundingPath,
  buildHostedGroupUsageFundingUrl,
  readHostedGroupUsageFundingLocatorRuntimeMemberId,
} from "../src/lib/hosted-groups/group-usage-funding-locator";
import { readHostedAppSessionHmacKey } from "../src/lib/hosted-onboarding/app-session-config";
import { readHostedPublicBaseUrl } from "../src/lib/hosted-web/public-url";

export const hostedRuntimeLogProductionMigrationCommand = {
  command: resolvePnpmCommand(),
  args: ["--dir", "apps/web", "runtime-logs:migrate:deploy"],
} as const;

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

const HOSTED_GROUP_FUNDING_PREFLIGHT_MEMBER_ID =
  "hosted_group_funding_preflight";

export function shouldRunHostedWebProductionMigrations(
  environment: HostedWebProductionMigrationEnvironment,
): boolean {
  return (
    environment.VERCEL === "1" &&
    environment.VERCEL_ENV === "production" &&
    environment.VERCEL_GIT_COMMIT_REF === "main"
  );
}

export function assertHostedGroupFundingRecoveryConfiguration(
  environment: HostedWebProductionMigrationEnvironment,
): void {
  readHostedAppSessionHmacKey(environment);

  const publicBaseUrl = readHostedPublicBaseUrl(environment);
  if (!publicBaseUrl) {
    throw new TypeError(
      "A hosted public base URL is required for group funding recovery.",
    );
  }
  const trustedOrigin = new URL(publicBaseUrl);
  if (trustedOrigin.protocol !== "https:") {
    throw new TypeError(
      "The hosted public base URL for group funding recovery must use HTTPS.",
    );
  }

  const locator = buildHostedGroupUsageFundingLocatorForRuntimeMember(
    HOSTED_GROUP_FUNDING_PREFLIGHT_MEMBER_ID,
    environment,
  );
  const fundingUrl = locator
    ? buildHostedGroupUsageFundingUrl({
        environment,
        joinCode: locator,
        publicBaseUrl,
      })
    : null;
  const parsedMemberId = locator
    ? readHostedGroupUsageFundingLocatorRuntimeMemberId(locator, environment)
    : null;
  if (
    !locator
    || !fundingUrl
    || parsedMemberId !== HOSTED_GROUP_FUNDING_PREFLIGHT_MEMBER_ID
  ) {
    throw new TypeError(
      "The hosted group funding recovery signing authority is unusable.",
    );
  }

  const parsedFundingUrl = new URL(fundingUrl);
  if (
    parsedFundingUrl.origin !== trustedOrigin.origin
    || parsedFundingUrl.pathname !== buildHostedGroupUsageFundingPath(locator)
    || parsedFundingUrl.search
    || parsedFundingUrl.hash
  ) {
    throw new TypeError(
      "The hosted public base URL cannot produce a trusted group funding recovery URL.",
    );
  }
}

export async function runHostedWebProductionMigrationsIfNeeded(
  environment: HostedWebProductionMigrationEnvironment = process.env,
  runCommand: HostedWebProductionMigrationRunner = runCommandInherited,
): Promise<"ran" | "skipped"> {
  if (!shouldRunHostedWebProductionMigrations(environment)) {
    console.log("Skipping hosted web production migrations outside main-branch Vercel production deploys.");
    return "skipped";
  }

  assertHostedGroupFundingRecoveryConfiguration(environment);

  console.log("Applying pending hosted runtime log database migrations.");
  await runCommand(
    hostedRuntimeLogProductionMigrationCommand.command,
    hostedRuntimeLogProductionMigrationCommand.args,
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

async function main(): Promise<void> {
  await runHostedWebProductionMigrationsIfNeeded();
}

function runCommandInherited(
  command: string,
  args: readonly string[],
): Promise<void> {
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
