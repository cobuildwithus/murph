interface Options {
  apply: boolean;
  batchSize?: number;
  help: boolean;
}

const usage = `
Usage:
  pnpm --dir apps/web mailbox:backfill-accepted-allowance -- [--apply] [--batch-size <count>]

Options:
  --apply               Materialize and bind provable legacy periods.
  --batch-size <count>  Process 1-1000 rows per batch (default: 100).
  --help                Print this message.

Without --apply, the command performs the readiness count only. It exits
nonzero while any retained nonterminal conversation row remains unbound.
`;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage.trim());
    return;
  }

  const [
    { backfillHostedAcceptedConversationAllowancePeriods },
    { createPrismaClient },
    { resolveHostedWebMigrationDatabaseUrl },
  ] = await Promise.all([
    import("../src/lib/hosted-mailbox/accepted-conversation-backfill"),
    import("../src/lib/prisma"),
    import("./run-prisma-migrate-deploy"),
  ]);
  const migrationDatabase = resolveHostedWebMigrationDatabaseUrl({
    ...process.env,
    MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS: "1",
  });
  const prisma = createPrismaClient({
    databaseUrl: migrationDatabase.url,
    poolMax: 1,
  });
  try {
    const result = await backfillHostedAcceptedConversationAllowancePeriods({
      apply: options.apply,
      ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
      prisma,
    });
    console.log(
      `Hosted accepted conversation allowance readiness: scanned=${result.scanned} bound=${result.bound} failed=${result.failed} remaining=${result.remaining}.`,
    );
    if (result.failed > 0 || result.remaining > 0) {
      throw new Error(
        "Hosted accepted conversation replay is not ready; keep the replay rollout gate disabled.",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

function parseOptions(argv: readonly string[]): Options {
  const options: Options = {
    apply: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--apply":
        options.apply = true;
        break;
      case "--batch-size": {
        const value = argv[index + 1];
        if (!value || !/^[1-9][0-9]*$/u.test(value)) {
          throw new TypeError("--batch-size requires a positive integer.");
        }
        options.batchSize = Number(value);
        index += 1;
        break;
      }
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new TypeError(`Unknown option: ${arg ?? "<missing>"}`);
    }
  }
  return options;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
