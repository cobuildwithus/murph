import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HOSTED_USAGE_ADVISORY_RECHECK_CAMPAIGN,
  type HostedUsageAdvisoryRecheckMode,
} from "../src/lib/hosted-ops/runtime-recheck-rollout";

export interface HostedUsageAdvisoryRecheckScriptOptions {
  help: boolean;
  mode: HostedUsageAdvisoryRecheckMode;
}

const usage = `
Usage:
  NODE_OPTIONS=--conditions=react-server \\
    vercel env run --environment=production -- \\
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/recheck-usage-advisory-workflows.ts

  NODE_OPTIONS=--conditions=react-server \\
    vercel env run --environment=production -- \\
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/recheck-usage-advisory-workflows.ts \\
      --apply --campaign ${HOSTED_USAGE_ADVISORY_RECHECK_CAMPAIGN}

Options:
  --apply                 Signal every active hosted workspace. Without this, preview only.
  --campaign <key>        Exact fixed rollout confirmation; required with --apply.
  --help                  Print this message.
`;

async function main(): Promise<void> {
  const options = parseHostedUsageAdvisoryRecheckScriptOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage.trim());
    return;
  }
  assertReactServerCondition();

  const [{ createPrismaClient }, { recheckHostedUsageAdvisoryWorkflows }] =
    await Promise.all([
      import("../src/lib/prisma"),
      import("../src/lib/hosted-ops/runtime-recheck-rollout"),
    ]);
  const databaseUrl = normalizeRequiredEnv("DATABASE_URL", process.env.DATABASE_URL);
  const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });

  try {
    const summary = await recheckHostedUsageAdvisoryWorkflows({
      mode: options.mode,
      prisma,
    });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failedSignalCount > 0) {
      throw new Error("One or more hosted runtime recheck signals failed.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

export function parseHostedUsageAdvisoryRecheckScriptOptions(
  argv: readonly string[],
): HostedUsageAdvisoryRecheckScriptOptions {
  let apply = false;
  let campaign: string | null = null;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--apply":
        apply = true;
        break;
      case "--campaign":
        campaign = normalizeRequiredArgument(arg, argv[++i]);
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg ?? ""}`);
    }
  }

  if (
    !help
    && apply
    && campaign !== HOSTED_USAGE_ADVISORY_RECHECK_CAMPAIGN
  ) {
    throw new Error(
      `--apply requires --campaign ${HOSTED_USAGE_ADVISORY_RECHECK_CAMPAIGN}.`,
    );
  }
  if (!help && !apply && campaign) {
    throw new Error("--campaign is only valid with --apply.");
  }

  return {
    help,
    mode: apply ? "apply" : "dry-run",
  };
}

function normalizeRequiredArgument(name: string, value: string | undefined): string {
  const normalized = normalizeNullableString(value);
  if (!normalized || normalized.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return normalized;
}

function normalizeRequiredEnv(name: string, value: string | null | undefined): string {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new Error(`${name} must be present in the command environment.`);
  }
  return normalized;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function assertReactServerCondition(): void {
  const values = [
    ...process.execArgv,
    ...(process.env.NODE_OPTIONS ?? "").split(/\s+/u),
  ];
  if (
    values.includes("--conditions=react-server") ||
    (values.includes("--conditions") && values.includes("react-server"))
  ) {
    return;
  }
  throw new Error("Run with NODE_OPTIONS=--conditions=react-server.");
}

function isDirectInvocation(): boolean {
  const entryPath = process.argv[1];
  return Boolean(entryPath && resolve(entryPath) === fileURLToPath(import.meta.url));
}

if (isDirectInvocation()) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
