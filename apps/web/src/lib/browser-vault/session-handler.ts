import {
  parseHostedExecutionSnapshotRef,
  parseHostedBrowserVaultReplicaRef,
  readHostedBrowserVaultSourceStateHash,
} from "@murphai/hosted-execution/parsers";
import { parseHostedUserRecipientPublicKeyJwk } from "@murphai/runtime-state";

import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import {
  requireActiveHostedAppSessionFromRequest,
  requireHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedWorkspace } from "@/src/lib/hosted-workspace/store";
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

import { browserVaultReplicaRefsMatch } from "./ref";

export function createBrowserVaultSessionRoute(input: {
  requireActiveAccess: boolean;
}) {
  return withJsonError(async (request: Request) => {
    assertHostedOnboardingMutationOrigin(request);
    const prisma = getPrisma();
    const auth = input.requireActiveAccess
      ? await requireActiveHostedAppSessionFromRequest(request)
      : await requireHostedAppSessionFromRequest(request);
    await assertHostedLaunchRequiredConsentGranted({
      memberId: auth.member.id,
      prisma,
    });
    const body = await readJsonObject(request);
    const browserPublicKeyJwk = parseHostedUserRecipientPublicKeyJwk(
      body.browserPublicKeyJwk,
      "Browser vault session request browserPublicKeyJwk",
    );
    const knownReplicaRef = parseHostedBrowserVaultReplicaRef(
      body.knownReplicaRef ?? null,
      "Browser vault session request knownReplicaRef",
    );
    const acceptStaleReplica = body.acceptStaleReplica === true;
    const workspace = await readHostedWorkspace({ userId: auth.member.id });
    const replicaRef = parseHostedBrowserVaultReplicaRef(
      workspace?.browserVaultReplicaRef ?? null,
      "Hosted browser vault session workspace replica ref",
    );
    const snapshotRef = parseHostedExecutionSnapshotRef(
      workspace?.snapshotRef ?? null,
      "Hosted browser vault session workspace snapshot ref",
    );
    const sourceStateHash = readHostedBrowserVaultSourceStateHash(
      snapshotRef,
    );
    const workspaceVersion = workspace?.version ?? null;
    const freshness = replicaRef && sourceStateHash && replicaRef.sourceBundleHash === sourceStateHash
      ? "fresh" as const
      : "stale" as const;

    if (!replicaRef) {
      await scheduleBrowserVaultRefreshBestEffort({
        sourceStateHash,
        userId: auth.member.id,
      });
      return emptyBrowserVaultSession({
        refreshPending: sourceStateHash !== null,
        workspaceVersion,
      });
    }

    if (freshness === "stale") {
      await scheduleBrowserVaultRefreshBestEffort({
        sourceStateHash,
        userId: auth.member.id,
      });
      if (!acceptStaleReplica) {
        return emptyBrowserVaultSession({
          refreshPending: sourceStateHash !== null,
          workspaceVersion,
        });
      }
    }

    if (browserVaultReplicaRefsMatch(knownReplicaRef, replicaRef)) {
      return jsonOk({
        encryptedReplica: null,
        freshness,
        replicaAad: null,
        replicaKeyEnvelope: null,
        replicaRef,
        refreshPending: freshness === "stale",
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
          freshness,
          refreshPending: freshness === "stale",
          workspaceVersion,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message === "Hosted execution browser vault replica was not found.") {
        return emptyBrowserVaultSession({
          refreshPending: sourceStateHash !== null,
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

async function scheduleBrowserVaultRefreshBestEffort(input: {
  sourceStateHash: string | null;
  userId: string;
}): Promise<void> {
  if (!input.sourceStateHash) {
    return;
  }

  const client = readHostedExecutionControlClientIfConfigured();
  if (!client) {
    return;
  }

  try {
    await client.scheduleBrowserVaultRefresh({
      sourceStateHash: input.sourceStateHash,
      userId: input.userId,
    });
  } catch {
    // Dashboard freshness is a best-effort derived read-model refresh.
  }
}

function emptyBrowserVaultSession(input: {
  refreshPending?: boolean;
  workspaceVersion?: string | null;
} = {}) {
  return jsonOk({
    encryptedReplica: null,
    freshness: "stale" as const,
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    refreshPending: input.refreshPending ?? false,
    state: "empty" as const,
    workspaceVersion: input.workspaceVersion ?? null,
  });
}
