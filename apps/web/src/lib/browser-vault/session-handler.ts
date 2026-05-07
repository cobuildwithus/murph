import {
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionSnapshotRef,
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
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
    const workspace = await readHostedWorkspace({ userId: auth.member.id });
    const replicaRef = parseHostedBrowserVaultReplicaRef(
      workspace?.browserVaultReplicaRef ?? null,
      "Hosted browser vault session workspace replica ref",
    );

    if (!replicaRef) {
      return emptyBrowserVaultSession();
    }

    const workspaceSnapshotHash = readHostedWorkspaceSnapshotHash(workspace?.snapshotRef ?? null);
    if (!workspaceSnapshotHash || workspaceSnapshotHash !== replicaRef.sourceBundleHash) {
      return emptyBrowserVaultSession();
    }

    if (browserVaultReplicaRefsMatch(knownReplicaRef, replicaRef)) {
      return jsonOk({
        encryptedReplica: null,
        replicaAad: null,
        replicaKeyEnvelope: null,
        replicaRef,
        state: "not_modified",
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
        await client.createBrowserVaultSession({
          browserPublicKeyJwk,
          replicaRef,
          userId: auth.member.id,
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "Hosted execution browser vault replica was not found.") {
        return emptyBrowserVaultSession();
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

function emptyBrowserVaultSession() {
  return jsonOk({
    encryptedReplica: null,
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    state: "empty" as const,
  });
}

function readHostedWorkspaceSnapshotHash(value: unknown): string | null {
  const snapshotRef = parseHostedExecutionSnapshotRef(
    value,
    "Hosted browser vault session workspace snapshotRef",
  );
  return readHostedExecutionSnapshotDeltaRef(snapshotRef)?.hash
    ?? readHostedExecutionSnapshotBaseRef(snapshotRef)?.hash
    ?? null;
}
