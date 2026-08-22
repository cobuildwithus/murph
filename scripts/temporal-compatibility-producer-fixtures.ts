import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  projectHostedRuntimeReconciliationFactsWireResponse,
  type HostedRuntimeReconciliationFactsWireResponse,
} from "../packages/hosted-execution/src/reconciliation-facts-wire.ts";
import {
  HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS,
  HOSTED_RUNTIME_SYSTEM_MAILBOX_FRONTIER_CLASSES,
  type HostedRuntimeReconciliationFacts,
} from "../packages/hosted-execution/src/orchestration-control.ts";

export function buildTemporalCompatibilityProducerFixtures():
  HostedRuntimeReconciliationFactsWireResponse[] {
  const frontierVariants = [
    ...HOSTED_RUNTIME_SYSTEM_MAILBOX_FRONTIER_CLASSES,
    null,
    undefined,
  ] as const;
  return [
    projectHostedRuntimeReconciliationFactsWireResponse({
      blocked: null,
      environmentInterviewPending: false,
      mailboxLag: [],
      workspace: null,
    }),
    ...HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS.map((reason, index) => {
      const systemMailboxFrontier = frontierVariants[index];
      return projectHostedRuntimeReconciliationFactsWireResponse({
        blocked: {
          reason,
          retryAt: index % 2 === 0 ? "2026-01-01T00:02:00.000Z" : null,
        },
        environmentInterviewPending: index % 2 === 1,
        mailboxLag: [{
          importedSeq: String(index),
          lag: String(index + 1),
          lane: index % 2 === 0 ? "conversation" : "system",
          maxSeq: String(index + 1),
          ...(index === 0
            ? { maxUpdatedAt: "2026-01-01T00:00:00.000Z" }
            : {}),
        }],
        workspace: {
          hostedMailboxSystemHandledThroughSeq: String(index),
          inboxMediaRetentionWakeAt: index % 2 === 0
            ? "2026-01-01T00:00:00.000Z"
            : null,
          nextWakeAt: index % 2 === 0
            ? "2026-01-01T00:01:00.000Z"
            : null,
          nextWakeReason: index % 2 === 0 ? "assistant_delivery" : null,
          ...(systemMailboxFrontier === undefined
            ? {}
            : { systemMailboxFrontier }),
          version: index % 2 === 0 ? "1" : null,
        },
      });
    }),
  ];
}

export async function writeTemporalCompatibilityProducerFixtures(
  outputPath: string,
): Promise<void> {
  if (outputPath.length === 0) {
    throw new Error("Temporal compatibility fixture output path is required.");
  }
  await writeFile(
    outputPath,
    `${JSON.stringify(buildTemporalCompatibilityProducerFixtures())}\n`,
    "utf8",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flag, outputPath, ...rest] = process.argv.slice(2);
  if (flag !== "--output" || !outputPath || rest.length > 0) {
    console.error("Expected --output <path>.");
    process.exitCode = 1;
  } else {
    writeTemporalCompatibilityProducerFixtures(outputPath).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
