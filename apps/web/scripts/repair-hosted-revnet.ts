import { PrismaClient } from "@prisma/client";

import {
  HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS,
  listHostedRevnetRepairCandidates,
  replayHostedRevnetIssuanceById,
} from "../src/lib/hosted-onboarding/revnet-repair-service";

async function main() {
  const [command = "list", ...args] = process.argv.slice(2);
  const prisma = new PrismaClient();

  try {
    if (command === "list") {
      const candidates = await listHostedRevnetRepairCandidates({
        prisma,
      });

      if (candidates.length === 0) {
        console.log("No hosted RevNet repair candidates found.");
        return;
      }

      console.log(
        [
          "Hosted RevNet repair candidates:",
          `- stale submitting threshold: ${HOSTED_REVNET_REPAIR_SUBMITTING_STALE_MS / 1000}s`,
          "- rows in `broadcast_unknown_stale` or `repair_in_progress_stale` are listed for investigation first; do not replay them blindly.",
        ].join("\n"),
      );

      for (const candidate of candidates) {
        console.log(
          JSON.stringify(
            {
              failureCode: candidate.failureCode,
              id: candidate.id,
              idempotencyKey: candidate.idempotencyKey,
              memberId: candidate.memberId,
              payTxHash: candidate.payTxHash,
              repairCategory: candidate.repairCategory,
              replayAllowedWithoutForce: candidate.replayAllowedWithoutForce,
              status: candidate.status,
              updatedAt: candidate.updatedAt.toISOString(),
            },
            null,
            2,
          ),
        );
      }

      return;
    }

    if (command === "replay") {
      const issuanceId = args[0] ?? null;
      const allowUnknownBroadcastReplay = args.includes("--allow-unknown-broadcast-replay");

      if (!issuanceId) {
        throw new Error(
          "Usage: pnpm exec tsx apps/web/scripts/repair-hosted-revnet.ts replay <issuanceId> [--allow-unknown-broadcast-replay]",
        );
      }

      if (allowUnknownBroadcastReplay) {
        console.warn(
          "Warning: forcing replay for a stale submitting issuance. Use this only after verifying no broadcast happened.",
        );
      }

      const candidate = await replayHostedRevnetIssuanceById({
        allowUnknownBroadcastReplay,
        issuanceId,
        prisma,
      });

      console.log(
        JSON.stringify(
          {
            id: candidate.id,
            payTxHash: candidate.payTxHash,
            repairCategory: candidate.repairCategory,
            replayAllowedWithoutForce: candidate.replayAllowedWithoutForce,
            status: candidate.status,
            updatedAt: candidate.updatedAt.toISOString(),
          },
          null,
          2,
        ),
      );
      return;
    }

    throw new Error(
      "Usage: pnpm exec tsx apps/web/scripts/repair-hosted-revnet.ts [list|replay <issuanceId> [--allow-unknown-broadcast-replay]]",
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
