import {
  assessBrowserVaultReplicaFreshness,
} from "@murphai/hosted-execution";
import {
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import { parseHostedUserRecipientPublicKeyJwk } from "@murphai/runtime-state";
import { after } from "next/server";

import { PrismaHostedDirtyConnectionStore } from "@/src/lib/device-sync/prisma-store/dirty-connections";
import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { signalHostedBrowserVaultRefreshRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import {
  readHostedWorkspace,
  readHostedWorkspaceBrowserVaultSourceStateHash,
} from "@/src/lib/hosted-workspace/store";
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";
import {
  buildSettingsSensitiveActionBinding,
  consumeSensitiveActionChallenge,
  verifySensitiveActionChallenge,
} from "@/src/lib/sensitive-actions/server";

const SETTINGS_VAULT_EXPORT_BODY_LIMIT_BYTES = 16 * 1024;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: SETTINGS_VAULT_EXPORT_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "BROWSER_VAULT_SESSION_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Browser vault session request body is too large.",
  });
  const browserPublicKeyJwk = parseHostedUserRecipientPublicKeyJwk(
    body.browserPublicKeyJwk,
    "Settings vault export browserPublicKeyJwk",
  );

  // Verify the MFA-bound signature but do NOT consume the challenge yet:
  // the challenge stays valid through the workspace re-read and the replica
  // fetch, so a stale workspace or a Privy delay never burns the user's
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
    privyUserId: auth.privyUserId,
  });

  // Re-read workspace + pending dirty-connection state AFTER the slow
  // Privy/signature path. Fail closed on either lookup error so a transient
  // database problem cannot release a "complete" export.
  let workspace: Awaited<ReturnType<typeof readHostedWorkspace>>;
  let deviceSyncImportPending: boolean;
  try {
    [workspace, deviceSyncImportPending] = await Promise.all([
      readHostedWorkspace({ userId: auth.member.id }),
      new PrismaHostedDirtyConnectionStore(prisma).hasPendingDirtyConnectionForUser(
        auth.member.id,
      ),
    ]);
  } catch {
    scheduleBrowserVaultRefreshAfterResponse({ userId: auth.member.id });
    throw browserVaultSessionNotFreshError();
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

  if (
    !replicaRef
    || freshness.freshness !== "fresh"
    || freshness.shouldRefresh
    || deviceSyncImportPending
  ) {
    scheduleBrowserVaultRefreshAfterResponse({ userId: auth.member.id });
    throw browserVaultSessionNotFreshError();
  }

  const client = readHostedExecutionControlClientIfConfigured();
  if (!client) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
      httpStatus: 503,
      message: "Hosted execution control plane is not configured.",
    });
  }

  let session: Awaited<ReturnType<typeof client.createBrowserVaultSession>>;
  try {
    session = await client.createBrowserVaultSession({
      browserPublicKeyJwk,
      replicaRef,
      userId: auth.member.id,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Hosted execution browser vault replica was not found.") {
      scheduleBrowserVaultRefreshAfterResponse({ userId: auth.member.id });
      throw browserVaultSessionNotFreshError();
    }

    if (error instanceof TypeError) {
      throw hostedOnboardingError({
        code: "HOSTED_EXECUTION_CONTROL_INVALID_RESPONSE",
        httpStatus: 502,
        message: "Hosted execution control plane returned an invalid browser vault session.",
      });
    }

    throw error;
  }

  // Consume the challenge atomically only once the encrypted replica is in
  // hand. A failure here aborts the response without releasing the session.
  await consumeSensitiveActionChallenge({ challenge, prisma });

  return jsonOk({
    ...session,
    deviceSyncImportPending: false,
    freshness: freshness.freshness,
    refreshPending: false,
    workspaceVersion: workspace?.version ?? null,
  });
});

function browserVaultSessionNotFreshError() {
  return hostedOnboardingError({
    code: "BROWSER_VAULT_SESSION_NOT_FRESH",
    httpStatus: 409,
    message: "Your vault is still being prepared. Try the export again in a moment.",
    retryable: true,
  });
}

function scheduleBrowserVaultRefreshAfterResponse(input: { userId: string }): void {
  const task = async () => {
    try {
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
