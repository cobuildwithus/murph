import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  HostedThreadRouteAccountProjectionBackfillMode,
} from "../src/lib/hosted-routing/thread-route-account-projection-backfill";

interface HostedThreadRouteAccountProjectionScriptOptions {
  batchSize: number | undefined;
  check: boolean;
  help: boolean;
  mode: HostedThreadRouteAccountProjectionBackfillMode;
}

const usage = `
Usage:
  NODE_OPTIONS=--conditions=react-server \\
    vercel env run --environment=production -- \\
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/backfill-hosted-thread-route-account-projections.ts [--batch-size 50]

  # Apply one bounded, idempotent batch only after the production alias is
  # proven on the new build and the prior-function drain has elapsed:
  NODE_OPTIONS=--conditions=react-server \\
    vercel env run --environment=production -- \\
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/backfill-hosted-thread-route-account-projections.ts --apply [--batch-size 50]

  # Fail unless every Linq/Telegram thread route has a projected account key:
  NODE_OPTIONS=--conditions=react-server \\
    vercel env run --environment=production -- \\
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/backfill-hosted-thread-route-account-projections.ts --check

Options:
  --apply                 Project one bounded batch. Dry-run is the default.
  --batch-size <1..100>   Maximum rows in this invocation (default: 50).
  --check                 Count-only readiness check; exits nonzero when pending.
  --help                  Print this message.

Output contains aggregate counts only. It never includes thread ids, member ids,
account keys, plaintext, or ciphertext. Dry-run after the additive migration and
new application build are live. Apply only after the final production-alias proof
and prior-function drain, repeat until remainingRows is zero, then run --check.
`;

async function main(): Promise<void> {
  const options = parseHostedThreadRouteAccountProjectionScriptOptions(
    process.argv.slice(2),
  );
  if (options.help) {
    console.log(usage.trim());
    return;
  }
  assertReactServerCondition();

  const [
    { createPrismaClient },
    {
      backfillHostedThreadRouteAccountProjections,
      createHostedThreadRouteAccountProjectionBackfillStore,
      readHostedThreadRouteAccountProjectionReadiness,
    },
  ] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/hosted-routing/thread-route-account-projection-backfill"),
  ]);
  const databaseUrl = normalizeRequiredEnv("DATABASE_URL", process.env.DATABASE_URL);
  const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });

  try {
    const store = createHostedThreadRouteAccountProjectionBackfillStore(prisma);
    if (options.check) {
      const readiness = await readHostedThreadRouteAccountProjectionReadiness({ store });
      console.log(JSON.stringify(readiness, null, 2));
      if (!readiness.complete) {
        process.exitCode = 1;
      }
      return;
    }

    const summary = await backfillHostedThreadRouteAccountProjections({
      batchSize: options.batchSize,
      mode: options.mode,
      prisma,
      store,
    });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.invalidRows > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

export function parseHostedThreadRouteAccountProjectionScriptOptions(
  argv: readonly string[],
): HostedThreadRouteAccountProjectionScriptOptions {
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
        if (!value || value.startsWith("--")) {
          throw new Error("--batch-size requires an integer from 1 through 100.");
        }
        batchSize = Number(value);
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
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
  const values = [
    ...process.execArgv,
    ...(process.env.NODE_OPTIONS ?? "").split(/\s+/u),
  ];
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
    console.error("Hosted thread route account projection backfill failed.");
    process.exitCode = 1;
  });
}
