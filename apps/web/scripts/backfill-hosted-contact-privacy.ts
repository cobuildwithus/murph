import process from "node:process";

import { getPrisma } from "../src/lib/prisma";
import {
  backfillHostedContactPrivacyRotation,
} from "../src/lib/hosted-onboarding/contact-privacy-rotation";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  const prisma = getPrisma();

  try {
    const result = await backfillHostedContactPrivacyRotation({
      dryRun: !options.write,
      memberIds: options.memberIds,
      prisma,
    });

    console.log(JSON.stringify(result, null, 2));

    if (options.write && result.outboxBlockingEventCount > 0) {
      process.exitCode = 1;
      console.error(
        "Hosted contact-privacy rotation refused write mode because lookup-bearing hosted execution events are still queued.",
      );
      return;
    }

    if (options.write && result.blockers.length > 0) {
      process.exitCode = 1;
      console.error(
        "Hosted contact-privacy rotation refused write mode because one or more stored lookup keys cannot be re-derived from encrypted owner-table data.",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

function parseArgs(argv: readonly string[]) {
  const memberIds: string[] = [];
  let help = false;
  let write = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--write") {
      write = true;
      continue;
    }

    if (arg === "--member-id") {
      const memberId = argv[index + 1];

      if (!memberId) {
        throw new TypeError("--member-id requires a value.");
      }

      memberIds.push(memberId);
      index += 1;
      continue;
    }

    throw new TypeError(`Unsupported argument: ${arg}`);
  }

  return {
    help,
    memberIds,
    write,
  };
}

function printUsage(): void {
  console.log(
    [
      "Usage: pnpm --dir apps/web exec tsx scripts/backfill-hosted-contact-privacy.ts [--write] [--member-id <id> ...]",
      "",
      "Dry-run is the default. Use --write only after hosted onboarding webhooks are paused and the hosted execution outbox is drained for lookup-bearing events.",
    ].join("\n"),
  );
}

void main().catch((error: unknown) => {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
});
