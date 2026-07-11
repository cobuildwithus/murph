import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { HostedPhoneCallPrivateContentBackfillMode } from "../src/lib/phone-calls/private-content-backfill";

interface HostedPhoneCallPrivateContentBackfillScriptOptions {
  batchSize: number | undefined;
  help: boolean;
  mode: HostedPhoneCallPrivateContentBackfillMode;
}

const usage = `
Usage:
  NODE_OPTIONS=--conditions=react-server \\
    vercel env run --environment=production -- \\
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/backfill-hosted-phone-call-private-content.ts [--batch-size 50]

  # Perform one bounded batch only after the replacement alias is proven and
  # the configured prior-function drain has elapsed:
  NODE_OPTIONS=--conditions=react-server \\
    vercel env run --environment=production -- \\
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/backfill-hosted-phone-call-private-content.ts --apply [--batch-size 50]

Options:
  --apply                 Encrypt and scrub one post-drain batch. Before the final
                          alias proof and prior-function drain, use dry-run only.
  --batch-size <1..100>   Maximum rows in this invocation (default: 50).
  --help                  Print this message.

Output contains counts only. It never includes call ids, member ids, plaintext,
or ciphertext. Applying before the final alias proof and prior-function drain is
unsafe because warm previous functions may still require plaintext. After drain,
repeat apply batches until selectedRows and hasMore are both zero.
`;

async function main(): Promise<void> {
  const options = parseHostedPhoneCallPrivateContentBackfillScriptOptions(
    process.argv.slice(2),
  );
  if (options.help) {
    console.log(usage.trim());
    return;
  }
  assertReactServerCondition();

  const [
    { createPrismaClient },
    { createHostedPhoneCallCrypto },
    {
      backfillHostedPhoneCallPrivateContent,
      createHostedPhoneCallPrivateContentBackfillStore,
    },
  ] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/phone-calls/crypto"),
    import("../src/lib/phone-calls/private-content-backfill"),
  ]);
  const databaseUrl = normalizeRequiredEnv("DATABASE_URL", process.env.DATABASE_URL);
  const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });

  try {
    const summary = await backfillHostedPhoneCallPrivateContent({
      batchSize: options.batchSize,
      crypto: createHostedPhoneCallCrypto(prisma),
      mode: options.mode,
      store: createHostedPhoneCallPrivateContentBackfillStore(prisma),
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

export function parseHostedPhoneCallPrivateContentBackfillScriptOptions(
  argv: readonly string[],
): HostedPhoneCallPrivateContentBackfillScriptOptions {
  let apply = false;
  let batchSize: number | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--apply":
        apply = true;
        break;
      case "--batch-size": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) {
          throw new Error("--batch-size requires an integer from 1 through 100.");
        }
        batchSize = Number(value);
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
          throw new Error("--batch-size requires an integer from 1 through 100.");
        }
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
    console.error("Hosted phone-call private-content backfill failed.");
    process.exitCode = 1;
  });
}
