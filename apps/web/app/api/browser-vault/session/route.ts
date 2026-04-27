import { parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/parsers";
import { parseHostedUserRecipientPublicKeyJwk } from "@murphai/runtime-state";

import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireActivePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import { readHostedWorkspace } from "@/src/lib/hosted-workspace/store";

export const POST = withJsonError(async (request: Request) => {
  const auth = await requireActivePrivyMemberAuth(request);
  const body = await readJsonObject(request);
  const browserPublicKeyJwk = parseHostedUserRecipientPublicKeyJwk(
    body.browserPublicKeyJwk,
    "Browser vault session request browserPublicKeyJwk",
  );
  const knownDataVersion = readOptionalString(body.knownDataVersion, "Browser vault session request knownDataVersion");
  const workspace = await readHostedWorkspace({ userId: auth.member.id });
  const replicaRef = parseHostedBrowserVaultReplicaRef(
    workspace?.browserVaultReplicaRef ?? null,
    "Hosted browser vault session workspace replica ref",
  );

  if (!replicaRef) {
    return emptyBrowserVaultSession();
  }

  const workspaceSnapshotHash = readHostedWorkspaceSnapshotHash(workspace?.snapshotRef ?? null);
  if (workspaceSnapshotHash && workspaceSnapshotHash !== replicaRef.sourceBundleHash) {
    return emptyBrowserVaultSession();
  }

  if (knownDataVersion && knownDataVersion === replicaRef.dataVersion) {
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

function emptyBrowserVaultSession() {
  return jsonOk({
    encryptedReplica: null,
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    state: "empty" as const,
  });
}

function readOptionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string when provided.`);
  }

  return value.length > 0 ? value : null;
}

function readHostedWorkspaceSnapshotHash(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const hash = Reflect.get(value, "hash");
  return typeof hash === "string" ? hash : null;
}
