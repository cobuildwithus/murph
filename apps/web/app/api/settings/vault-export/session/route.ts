import { CloudflareHostedControlMalformedResponseError } from "@murphai/cloudflare-hosted-control/client";
import { parseInput } from "@murphai/hosted-execution/request-input";
import {
  assessBrowserVaultReplicaFreshness,
} from "@murphai/hosted-execution";
import {
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
  HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/browser-vault";
import { parseHostedUserRecipientPublicKeyJwk, type HostedUserRecipientPublicKeyJwk } from "@murphai/runtime-state";
import { after } from "next/server";

import { PrismaHostedDirtyConnectionStore } from "@/src/lib/device-sync/prisma-store/dirty-connections";
import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { assertHostedAppSessionCurrentTx, requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { signalHostedBrowserVaultRefreshRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import {
  readHostedWorkspace,
  readHostedWorkspaceBrowserVaultSourceStateHash,
} from "@/src/lib/hosted-workspace/store";
import {
  assertHostedConsentScopeGranted,
  assertHostedLaunchRequiredConsentGranted,
  readHostedHealthDataConsentState,
} from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";
import {
  buildSettingsSensitiveActionBinding,
  consumeSensitiveActionChallenge,
  verifySensitiveActionChallenge,
} from "@/src/lib/sensitive-actions/server";

import { prepareRecordedActivityExport } from "@/src/lib/health-wins/activity-export";
import { prepareProgressShareExport } from '@/src/lib/game/progress/share-export';
import { progressEffect } from '@/src/lib/game/progress/http';

export const maxDuration = 300;
const SETTINGS_VAULT_EXPORT_BODY_LIMIT_BYTES = 16 * 1024;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  await readExportProcessingAllowed(auth.member.id, prisma);
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: SETTINGS_VAULT_EXPORT_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "BROWSER_VAULT_SESSION_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Browser vault session request body is too large.",
  });
  const browserPublicKeyJwk = parseInput(
    body.browserPublicKeyJwk,
    (value) => parseHostedUserRecipientPublicKeyJwk(
      value,
      "Settings vault export browserPublicKeyJwk",
    ),
  );
  const acceptsBucketedReplica = readSettingsVaultExportBucketCapability({
    requestedMetricBuckets: body.requestedMetricBuckets,
    requestedShards: body.requestedShards,
  });

  // Verify the MFA-bound signature but do NOT consume the challenge yet:
  // the challenge stays valid through the workspace re-read and the replica
  // fetch, so a stale workspace or an approval delay never burns the user's
  // one-time signature.
  const challenge = await verifySensitiveActionChallenge({
    authorization: body.authorization,
    bindingHash: buildSettingsSensitiveActionBinding({
      kind: "vault.export",
      memberId: auth.member.id,
      sessionId: auth.sessionId,
    }),
    kind: "vault.export",
    memberId: auth.member.id,
    prisma,

  });

  // Consent may change while the member completes the slow sensitive-action
  // proof. Re-read it before any freshness decision can wake processing.
  const processingAllowed = await readExportProcessingAllowed(auth.member.id, prisma);

  // Re-read the workspace AFTER the approval verification. Export the
  // newest retained replica even when newer source changes are still being
  // processed. Active members also request a refresh; withdrawn members never
  // restart processing.
  const workspace = await readHostedWorkspace({ userId: auth.member.id });

  let deviceSyncImportPending = true;
  try {
    deviceSyncImportPending =
      await new PrismaHostedDirtyConnectionStore(prisma)
        .hasPendingDirtyConnectionForUser(auth.member.id);
  } catch {
    // Keep the conservative pending state. A retained export remains useful
    // and already declares that recent unprocessed changes may be absent.
  }

  const replicaRef = parseHostedBrowserVaultReplicaRef(
    workspace?.browserVaultReplicaRef ?? null,
    "Settings vault export workspace replica ref",
  );
  const currentSourceHash = readHostedWorkspaceBrowserVaultSourceStateHash(
    workspace?.snapshotRef ?? null,
  );
  const freshness = assessBrowserVaultReplicaFreshness({
    currentSourceHash,
    now: new Date().toISOString(),
    replicaRef,
  });
  const refreshPending = freshness.shouldRefresh || deviceSyncImportPending;

  const assertCurrent = () => prisma.$transaction(tx => assertHostedAppSessionCurrentTx({
    memberId: auth.member.id, prisma: tx, request, sessionId: auth.sessionId, authProof: auth.authProof,
  }));
  // Older Settings clients only recognize picture records.
  const activityRecords = body.includeRecordedActivities === true
    ? await prepareRecordedActivityExport(auth.member.id, assertCurrent)
    : null;
  const session = replicaRef
    ? await fetchExportSession({ browserPublicKeyJwk, replicaRef, userId: auth.member.id }, acceptsBucketedReplica)
    : null;

  if (processingAllowed && (!session || refreshPending)) {
    scheduleBrowserVaultRefreshAfterResponse({ userId: auth.member.id });
  }
  if (!session && !activityRecords) {
    throw processingAllowed ? browserVaultSessionNotFreshError() : browserVaultRetainedReplicaUnavailableError();
  }
  const shareRecords = await progressEffect("prepare_share_export", () => prepareProgressShareExport(auth.member.id, assertCurrent));

  // Consume approval only after the retained export is ready to stream.
  await consumeSensitiveActionChallenge({
    challenge, prisma, session: { request, sessionId: auth.sessionId, authProof: auth.authProof },
  });

  // One record at a time keeps image bytes out of the bulk replica response buffer.
  const encoder = new TextEncoder();
  async function* exportRecords() {
    if (activityRecords) yield* activityRecords();
    yield* shareRecords();
  }
  const records = exportRecords();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({
        ...(session ?? { state: "no_replica", exportedAt: new Date().toISOString() }),
        deviceSyncImportPending, freshness: session ? freshness.freshness : "stale",
        refreshPending: refreshPending || !session, workspaceVersion: workspace?.version ?? null,
      }) + '\n'));
    },
    async pull(controller) {
      try {
        const next = await records.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch { controller.error(new Error('Data export could not finish. Try again.')); }
    },
    async cancel() { await records.return(); },
  }), { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});

async function fetchExportSession(input: {
  browserPublicKeyJwk: HostedUserRecipientPublicKeyJwk;
  replicaRef: HostedBrowserVaultReplicaRef;
  userId: string;
}, acceptsBucketedReplica: boolean) {
  const client = readHostedExecutionControlClientIfConfigured();
  if (!client) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
      httpStatus: 503,
      message: "Hosted execution control plane is not configured.",
    });
  }
  try {
    return acceptsBucketedReplica
      ? await client.createBrowserVaultExportSession(input)
      : await client.createBrowserVaultSession(input);
  } catch (error) {
    if (error instanceof Error && error.message === "Hosted execution browser vault replica was not found.") return null;
    if (error instanceof CloudflareHostedControlMalformedResponseError) {
      throw hostedOnboardingError({
        code: "HOSTED_EXECUTION_CONTROL_INVALID_RESPONSE",
        httpStatus: 502,
        message: "Hosted execution control plane returned an invalid browser vault session.",
      });
    }
    throw error;
  }
}

async function readExportProcessingAllowed(memberId: string, prisma: ReturnType<typeof getPrisma>) {
  const state = await readHostedHealthDataConsentState({ memberId, prisma });
  if (state === "granted") {
    await assertHostedLaunchRequiredConsentGranted({ memberId, prisma });
  } else if (state === "missing") {
    await assertHostedConsentScopeGranted({ memberId, prisma, scope: "launch.legal" });
  }
  return state === "granted";
}

function browserVaultSessionNotFreshError() {
  return hostedOnboardingError({
    code: "BROWSER_VAULT_SESSION_NOT_FRESH",
    httpStatus: 409,
    message: "Your vault is still being prepared. Try the export again in a moment.",
    retryable: true,
  });
}

function browserVaultRetainedReplicaUnavailableError() {
  return hostedOnboardingError({
    code: "BROWSER_VAULT_RETAINED_REPLICA_UNAVAILABLE",
    httpStatus: 409,
    message: "Murph does not have a retained dashboard export available yet. Try again later, or use Murph again to resume processing.",
    retryable: true,
  });
}

function scheduleBrowserVaultRefreshAfterResponse(input: { userId: string }): void {
  const task = async () => {
    try {
      const healthDataConsentState = await readHostedHealthDataConsentState({
        memberId: input.userId,
        prisma: getPrisma(),
      });
      if (healthDataConsentState !== "granted") {
        return;
      }
      await signalHostedBrowserVaultRefreshRuntime({ userId: input.userId });
    } catch {
      // Browser-vault freshness is a best-effort derived read-model refresh.
    }
  };

  try {
    after(task);
  } catch {
    void task();
  }
}

function readSettingsVaultExportBucketCapability(input: {
  requestedMetricBuckets: unknown;
  requestedShards: unknown;
}): boolean {
  if (
    input.requestedMetricBuckets === undefined
    && input.requestedShards === undefined
  ) {
    return false;
  }
  if (
    !hasExactStringMembers(
      input.requestedShards,
      HOSTED_BROWSER_VAULT_REPLICA_SHARD_KINDS,
    )
    || !hasExactStringMembers(
      input.requestedMetricBuckets,
      HOSTED_BROWSER_VAULT_REPLICA_METRIC_BUCKET_IDS,
    )
  ) {
    throw hostedOnboardingError({
      code: "BROWSER_VAULT_SESSION_INVALID_REQUEST",
      httpStatus: 400,
      message: "Settings vault export capability must include the complete replica.",
    });
  }
  return true;
}

function hasExactStringMembers(
  value: unknown,
  expected: readonly string[],
): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && new Set(value).size === expected.length
    && expected.every((entry) => value.includes(entry));
}
