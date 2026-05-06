import { backfillHostedBillingSnapshots } from "../src/lib/hosted-onboarding/stripe-billing-snapshot-backfill";

interface HostedBillingSnapshotBackfillCliOptions {
  apply: boolean;
  limit?: number;
}

export function parseHostedBillingSnapshotBackfillCliArgs(
  args: readonly string[],
): HostedBillingSnapshotBackfillCliOptions {
  const options: HostedBillingSnapshotBackfillCliOptions = {
    apply: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg === "--dry-run" || arg === "--dryrun") {
      options.apply = false;
      continue;
    }

    if (arg === "--limit") {
      const rawLimit = args[index + 1];
      if (!rawLimit) {
        throw new Error("--limit requires a numeric value.");
      }
      options.limit = parseHostedBillingSnapshotBackfillLimit(rawLimit);
      index += 1;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      options.limit = parseHostedBillingSnapshotBackfillLimit(
        arg.slice("--limit=".length),
      );
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseHostedBillingSnapshotBackfillCliArgs(process.argv.slice(2));
  const summary = await backfillHostedBillingSnapshots(options);
  console.log(JSON.stringify(summary, null, 2));
}

function parseHostedBillingSnapshotBackfillLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new Error("--limit must be an integer between 1 and 1000.");
  }

  return parsed;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
