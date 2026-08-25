import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { HostedGroupMaterializationBackfillMode } from "../src/lib/hosted-groups/group-materialization-backfill";

interface ScriptOptions {
  batchSize: number | undefined;
  check: boolean;
  help: boolean;
  mode: HostedGroupMaterializationBackfillMode;
}

const usage = `
Usage:
  NODE_OPTIONS=--conditions=react-server \\
    vercel env run --environment=production -- \\
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/backfill-hosted-group-materialization.ts [--batch-size 50]

  # Apply one bounded, idempotent batch after the route-time materialization
  # build is live:
  NODE_OPTIONS=--conditions=react-server \\
    vercel env run --environment=production -- \\
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/backfill-hosted-group-materialization.ts --apply [--batch-size 50]

  # Fail unless every routed thread container has canonical group state:
  NODE_OPTIONS=--conditions=react-server \
    vercel env run --environment=production -- \
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \
    apps/web/scripts/backfill-hosted-group-materialization.ts --check

Options:
  --apply                 Materialize one bounded batch. Dry-run is the default.
  --batch-size <1..100>   Maximum routed containers in this invocation (default: 50).
  --check                 Count-only readiness check; exits nonzero when pending.
  --help                  Print this message.

Output contains aggregate counts only. It never includes thread, container,
member, or group identifiers. Repeat --apply until remainingRows is zero. A
nonzero failedRows count means at least one row remains eligible for a retry.
Re-running after completion is a no-op.
`;

async function main(): Promise<void> {
  const options = parseHostedGroupMaterializationScriptOptions(
    process.argv.slice(2),
  );
  if (options.help) {
    console.log(usage.trim());
    return;
  }
  assertReactServerCondition();

  const [{ createPrismaClient }, backfillModule] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/hosted-groups/group-materialization-backfill"),
  ]);
  const databaseUrl = normalizeRequiredEnv("DATABASE_URL", process.env.DATABASE_URL);
  const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });

  try {
    if (options.check) {
      const readiness =
        await backfillModule.readHostedGroupMaterializationReadiness({
          store: backfillModule.createHostedGroupMaterializationBackfillStore(prisma),
        });
      console.log(JSON.stringify(readiness, null, 2));
      if (!readiness.complete) {
        process.exitCode = 1;
      }
      return;
    }
    const summary = await backfillModule.backfillHostedGroupMaterialization({
      batchSize: options.batchSize,
      mode: options.mode,
      store: backfillModule.createHostedGroupMaterializationBackfillStore(prisma),
    });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failedRows > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

export function parseHostedGroupMaterializationScriptOptions(
  argv: readonly string[],
): ScriptOptions {
  let apply = false;
  let batchSize: number | undefined;
  let check = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--apply":
        apply = true;
        break;
      case "--batch-size": {
        const value = argv[++index];
        batchSize = Number(value);
        if (!value || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
          throw new Error("--batch-size requires an integer from 1 through 100.");
        }
        break;
      }
      case "--check":
        check = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg ?? ""}`);
    }
  }

  if (apply && check) {
    throw new Error("--apply and --check cannot be combined.");
  }
  if (check && batchSize !== undefined) {
    throw new Error("--batch-size is not used with --check.");
  }

  return {
    batchSize,
    check,
    help,
    mode: apply ? "apply" : "dry-run",
  };
}

function normalizeRequiredEnv(name: string, value: string | null | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${name} must be present in the command environment.`);
  }
  return normalized;
}

function assertReactServerCondition(): void {
  const values = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? "").split(/\s+/u)];
  if (
    values.includes("--conditions=react-server")
    || (values.includes("--conditions") && values.includes("react-server"))
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
  void main().catch(() => {
    console.error("Hosted group materialization backfill failed.");
    process.exitCode = 1;
  });
}
