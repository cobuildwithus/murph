import { type PrismaClient } from "@prisma/client";

import {
  createHostedLegacyWearableCompactionStore,
  LEGACY_WEARABLE_COMPACTION_REPORT_SCHEMA,
  parseHostedLegacyWearableCompactionArgs,
  runHostedLegacyWearableCompactionTrigger,
  type LegacyWearableCompactionReport,
} from "@/scripts/trigger-legacy-wearable-compaction";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

const ONE_SHOT_RUN_ID = "hosted-legacy-wearable-compaction-2026-05-23";
const ONE_SHOT_NONCE_HASH =
  "hosted_legacy_wearable_compaction_2026_05_23_once";
const ONE_SHOT_USER_ID = "hosted-system";
const ROUTE_PATH =
  "/api/internal/hosted-workspace/legacy-wearable-compaction/cron";
const ONE_SHOT_MARKER_TTL_MS = 7 * 24 * 60 * 60_000;

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const prisma = getPrisma();
  const claimed = await claimOneShotRun(prisma, new Date());

  if (!claimed) {
    return jsonOk({
      alreadyRan: true,
      runId: ONE_SHOT_RUN_ID,
      schema: `${LEGACY_WEARABLE_COMPACTION_REPORT_SCHEMA}.cron.v1`,
    });
  }

  try {
    const report = await runHostedLegacyWearableCompactionTrigger({
      options: parseHostedLegacyWearableCompactionArgs([
        "--execute",
        "--force-existing-wake",
      ]),
      store: createHostedLegacyWearableCompactionStore(prisma),
    });

    console.info(JSON.stringify(createCronLogReport(report)));

    return jsonOk({
      alreadyRan: false,
      report,
      runId: ONE_SHOT_RUN_ID,
      schema: `${LEGACY_WEARABLE_COMPACTION_REPORT_SCHEMA}.cron.v1`,
    });
  } catch (error) {
    await releaseOneShotRunClaim(prisma);
    throw error;
  }
});

async function claimOneShotRun(
  prisma: PrismaClient,
  now: Date,
): Promise<boolean> {
  try {
    await prisma.hostedWebInternalRequestNonce.create({
      data: {
        expiresAt: new Date(now.getTime() + ONE_SHOT_MARKER_TTL_MS),
        method: "GET",
        nonceHash: ONE_SHOT_NONCE_HASH,
        path: ROUTE_PATH,
        search: "",
        userId: ONE_SHOT_USER_ID,
      },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return false;
    }
    throw error;
  }
}

async function releaseOneShotRunClaim(prisma: PrismaClient): Promise<void> {
  await prisma.hostedWebInternalRequestNonce.deleteMany({
    where: {
      nonceHash: ONE_SHOT_NONCE_HASH,
    },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "P2002",
  );
}

function createCronLogReport(report: LegacyWearableCompactionReport) {
  return {
    mode: report.mode,
    runId: ONE_SHOT_RUN_ID,
    schema: `${LEGACY_WEARABLE_COMPACTION_REPORT_SCHEMA}.cron-log.v1`,
    targets: report.targets.map((target) => ({
      before: target.before,
      scheduledWakeReason: target.scheduledWakeReason,
      signalAccepted: target.signalAccepted,
      status: target.status,
      target: target.target,
      versionAfterSchedule: target.versionAfterSchedule,
      versionBefore: target.versionBefore,
    })),
    totals: report.totals,
    wait: report.wait,
  };
}
