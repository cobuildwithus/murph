import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { HostedVaultShareRecentDateBackfillMode } from "../src/lib/hosted-vault-share/recent-date-generation-backfill";

interface ScriptOptions {
  batchSize: number | undefined;
  grantedBefore: Date | null;
  help: boolean;
  mode: HostedVaultShareRecentDateBackfillMode;
}

const usage = `
Usage:
  NODE_OPTIONS=--conditions=react-server \\
    vercel env run --environment=production -- \\
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/backfill-hosted-vault-share-recent-date-generations.ts \\
    --granted-before <consumer-deploy-ISO> [--batch-size 25]

  # Apply one bounded batch only after the new runtime consumer and narrow Web
  # pending-reader plus opaque-generation-fence compatibility release are deployed:
  NODE_OPTIONS=--conditions=react-server \\
    vercel env run --environment=production -- \\
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/backfill-hosted-vault-share-recent-date-generations.ts \\
    --apply --granted-before <consumer-deploy-ISO> [--batch-size 25]

Options:
  --apply                    Rotate legacy materialized or orphaned-pending
                             recent-date grants and append their durable projection
                             work atomically.
  --batch-size <1..100>      Maximum grantors in this invocation (default: 25).
  --granted-before <ISO>     Required stable cutoff captured after the new runtime
                             consumer and Web pending-reader/generation-fence
                             compatibility release; reuse it for every batch.
  --help                     Print this message.

Output contains counts only. It never includes member, group, grant, or mailbox
identifiers. Repeat apply batches with the exact same cutoff until selectedGrantors
and hasMore are both zero, then confirm the durable maintenance backlog drains before
deploying the Web consent copy and reaffirmation/atomic-admission writers.
`;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage.trim());
    return;
  }
  if (!options.grantedBefore) {
    throw new Error("--granted-before is required.");
  }
  assertReactServerCondition();
  const [{ createPrismaClient }, backfillModule] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/hosted-vault-share/recent-date-generation-backfill"),
  ]);
  const databaseUrl = normalizeRequiredEnv("DATABASE_URL", process.env.DATABASE_URL);
  const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
  try {
    const summary = await backfillModule.backfillHostedVaultShareRecentDateGenerations({
      batchSize: options.batchSize,
      grantedBefore: options.grantedBefore,
      mode: options.mode,
      store: backfillModule.createHostedVaultShareRecentDateBackfillStore(prisma),
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

export function parseOptions(argv: readonly string[]): ScriptOptions {
  let apply = false;
  let batchSize: number | undefined;
  let grantedBefore: Date | null = null;
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
      case "--granted-before": {
        const value = argv[++index];
        const parsed = value ? new Date(value) : new Date(Number.NaN);
        if (!value || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
          throw new Error("--granted-before requires an exact ISO timestamp.");
        }
        grantedBefore = parsed;
        break;
      }
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg ?? ""}`);
    }
  }
  return {
    batchSize,
    grantedBefore,
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
    console.error("Hosted vault-share recent-date backfill failed.");
    process.exitCode = 1;
  });
}
