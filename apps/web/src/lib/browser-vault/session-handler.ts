import {
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import {
  assessBrowserVaultReplicaFreshness,
} from "@murphai/hosted-execution";
import { parseHostedUserRecipientPublicKeyJwk } from "@murphai/runtime-state";
import { after } from "next/server";

import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import {
  signalHostedBrowserVaultRefreshRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import {
  requireHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { readHostedWorkspace } from "@/src/lib/hosted-workspace/store";
import { getPrisma } from "@/src/lib/prisma";

import { PrismaHostedDirtyConnectionStore } from "../device-sync/prisma-store/dirty-connections";
import { browserVaultReplicaRefsMatch } from "./ref";
import { assertBrowserVaultMemberAuthority } from "./authority";

const BROWSER_VAULT_SESSION_REQUEST_BODY_LIMIT_BYTES = 16 * 1024;

export function createBrowserVaultSessionRoute() {
  return withJsonError(async (request: Request) => {
    assertHostedOnboardingMutationOrigin(request);
    const prisma = getPrisma();
    const auth = await requireHostedAppSessionFromRequest(request);
    await assertBrowserVaultMemberAuthority({
      memberId: auth.member.id,
      prisma,
    });
    const body = await readHostedOnboardingJsonObject(request, {
      limitBytes: BROWSER_VAULT_SESSION_REQUEST_BODY_LIMIT_BYTES,
      tooLargeErrorCode: "BROWSER_VAULT_SESSION_BODY_TOO_LARGE",
      tooLargeErrorMessage: "Browser vault session request body is too large.",
    });
    const browserPublicKeyJwk = parseHostedUserRecipientPublicKeyJwk(
      body.browserPublicKeyJwk,
      "Browser vault session request browserPublicKeyJwk",
    );
    const knownReplicaRef = parseHostedBrowserVaultReplicaRef(
      body.knownReplicaRef ?? null,
      "Browser vault session request knownReplicaRef",
    );
    const requestRefresh = readOptionalRequestRefresh(body.requestRefresh);
    const [workspace, deviceSyncImportPending] = await Promise.all([
      readHostedWorkspace({ userId: auth.member.id }),
      new PrismaHostedDirtyConnectionStore(prisma).hasPendingDirtyConnectionForUser(
        auth.member.id,
      ).catch(() => false),
    ]);

    const replicaRef = parseHostedBrowserVaultReplicaRef(
      workspace?.browserVaultReplicaRef ?? null,
      "Hosted browser vault session workspace replica ref",
    );
    const workspaceVersion = workspace?.version ?? null;
    const freshnessAssessment = assessBrowserVaultReplicaFreshness({
      now: new Date().toISOString(),
      replicaRef,
    });
    const freshness = freshnessAssessment.freshness;
    let refreshScheduled = false;
    const scheduleRefreshAfterResponse = () => {
      if (refreshScheduled) {
        return;
      }
      refreshScheduled = true;
      scheduleAfterResponseOrFireAndForget(() =>
        scheduleBrowserVaultRefreshBestEffort({ userId: auth.member.id }),
      );
    };

    if (freshnessAssessment.shouldRefresh || requestRefresh) {
      scheduleRefreshAfterResponse();
    }

    if (!replicaRef) {
      return emptyBrowserVaultSession({
        deviceSyncImportPending,
        memberId: auth.member.id,
        refreshPending: true,
        workspaceVersion,
      });
    }

    if (browserVaultReplicaRefsMatch(knownReplicaRef, replicaRef)) {
      return jsonOk({
        deviceSyncImportPending,
        encryptedReplica: null,
        freshness,
        memberId: auth.member.id,
        replicaAad: null,
        replicaKeyEnvelope: null,
        replicaRef,
        refreshPending: freshnessAssessment.shouldRefresh,
        state: "not_modified",
        workspaceVersion,
      });
    }

    const client = readHostedExecutionControlClientIfConfigured();

    if (!client) {
      throw hostedOnboardingError({
        code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
        message: "Hosted execution control plane is not configured.",
        httpStatus: 503,
      });
    }

    try {
      return jsonOk(
        {
          ...(await client.createBrowserVaultSession({
            browserPublicKeyJwk,
            replicaRef,
            userId: auth.member.id,
          })),
          deviceSyncImportPending,
          freshness,
          refreshPending: freshnessAssessment.shouldRefresh,
          workspaceVersion,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message === "Hosted execution browser vault replica was not found.") {
        scheduleRefreshAfterResponse();
        return emptyBrowserVaultSession({
          deviceSyncImportPending,
          memberId: auth.member.id,
          refreshPending: true,
          workspaceVersion,
        });
      }

      if (error instanceof TypeError) {
        throw hostedOnboardingError({
          code: "HOSTED_EXECUTION_CONTROL_INVALID_RESPONSE",
          message: "Hosted execution control plane returned an invalid browser vault session.",
          httpStatus: 502,
        });
      }

      throw error;
    }
  });
}

function scheduleAfterResponseOrFireAndForget(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

function emptyBrowserVaultSession(input: {
  deviceSyncImportPending?: boolean;
  memberId: string;
  refreshPending?: boolean;
  workspaceVersion?: string | null;
}) {
  return jsonOk({
    deviceSyncImportPending: input.deviceSyncImportPending ?? false,
    encryptedReplica: null,
    freshness: "stale" as const,
    memberId: input.memberId,
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    refreshPending: input.refreshPending ?? false,
    state: "empty" as const,
    workspaceVersion: input.workspaceVersion ?? null,
  });
}

async function scheduleBrowserVaultRefreshBestEffort(input: {
  userId: string;
}): Promise<void> {
  try {
    await signalHostedBrowserVaultRefreshRuntime({
      userId: input.userId,
    });
  } catch {
    // Browser-vault freshness is a best-effort derived read-model refresh.
  }
}

function readOptionalRequestRefresh(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw hostedOnboardingError({
      code: "BROWSER_VAULT_SESSION_INVALID_REQUEST",
      message: "Browser vault session request refresh flag must be a boolean.",
      httpStatus: 400,
    });
  }
  return value;
}
