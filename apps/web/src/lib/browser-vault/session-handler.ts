import {
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import { parseHostedUserRecipientPublicKeyJwk } from "@murphai/runtime-state";
import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import {
  requireActiveHostedAppSessionFromRequest,
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
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

import { browserVaultReplicaRefsMatch } from "./ref";

const BROWSER_VAULT_SESSION_REQUEST_BODY_LIMIT_BYTES = 16 * 1024;

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
    const workspace = await readHostedWorkspace({ userId: auth.member.id });
    const replicaRef = parseHostedBrowserVaultReplicaRef(
      workspace?.browserVaultReplicaRef ?? null,
      "Hosted browser vault session workspace replica ref",
    );
    const workspaceVersion = workspace?.version ?? null;
    const freshness = replicaRef ? "fresh" as const : "stale" as const;

    if (!replicaRef) {
      return emptyBrowserVaultSession({
        refreshPending: true,
        workspaceVersion,
      });
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
          refreshPending: false,
          workspaceVersion,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message === "Hosted execution browser vault replica was not found.") {
        return emptyBrowserVaultSession({
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
