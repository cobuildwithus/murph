import "server-only";

import { deviceSyncError, isDeviceSyncError } from "@murphai/device-syncd/errors";
import { isDeviceSyncAppConnectReturn } from "@murphai/device-syncd/types";

import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import {
  buildHostedDeviceSyncAppCompletionProof,
  readHostedDeviceSyncAppCompletionProofError,
} from "./browser-callback-proof";
import {
  companionConnectRowActions,
  readCompanionConnectSources,
  resolveCompanionConnectRows,
} from "./companion-connect-sources";
import {
  reportHostedDeviceCallbackRejection,
  reportHostedDeviceConnectFailure,
} from "./connect-failure-alert";
import type { ConnectSource } from "./connect-source-types";
import { connectSourcePath } from "./connect-sources";
import {
  assertHostedDeviceConnectSourceOffered,
  beginHostedDeviceSyncConnectionForMember,
  resolveHostedConnectSourceTarget,
} from "./hosted-connect-start";
import { createHostedDeviceSyncPublicIngressService } from "./public-ingress-service";

// The provider's return query is a handful of short fields; anything longer
// is not one the bridge forwarded.
const COMPANION_CONNECT_QUERY_MAX_LENGTH = 2_048;
const COMPANION_CONNECT_PROOF_MAX_LENGTH = 256;
const COMPANION_CONNECT_PROVIDER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const COMPANION_CONNECT_SYNC_BUCKET_MS = 60_000;

type CompanionConnectList = Awaited<ReturnType<typeof readCompanionConnectSources>>;

/**
 * Starts a web sign-in for the Murph app. The member and app session come from
 * the bearer credential; the provider's return goes to the app's fixed bridge
 * named by `appReturn`, never to a URL from the request. The reconnect target
 * is the server's own row for this member.
 */
export async function startCompanionConnection(input: {
  appReturn: unknown;
  auth: HostedNativeMemberAuth;
  request: Request;
  sourceId: string;
}): Promise<{ authorizationUrl: string; completionProof: string; provider: string }> {
  if (!isDeviceSyncAppConnectReturn(input.appReturn)) {
    throw deviceSyncError({
      code: "COMPANION_CONNECT_REQUEST_INVALID",
      httpStatus: 400,
      message: "The connect request is not valid.",
      retryable: false,
    });
  }
  const row = (await resolveCompanionConnectRows(input.auth.member))
    .find((candidate) => candidate.id === input.sourceId);
  if (!row || connectSourcePath(row.id) !== "web") {
    throw companionConnectSourceNotConfiguredError();
  }
  const target = resolveHostedConnectSourceTarget(row.id, {
    connectTarget: row.connectTarget ?? null,
    provider: row.connectProvider ?? null,
    sourceProviderSlug: null,
  });
  assertHostedDeviceConnectSourceOffered(target);
  const started = await beginHostedDeviceSyncConnectionForMember({
    appReturn: input.appReturn,
    memberId: input.auth.member.id,
    request: input.request,
    returnTo: null,
    target,
  });

  return {
    authorizationUrl: started.authorizationUrl,
    completionProof: buildHostedDeviceSyncAppCompletionProof({
      memberId: input.auth.member.id,
      provider: target.provider,
      sessionId: input.auth.sessionId,
      state: started.state,
    }),
    provider: target.provider,
  };
}

/**
 * Finishes a connection the same app session started. The proof is checked
 * before the pending state is read, consumed or discarded, including when the
 * provider reports an error; a failed proof changes nothing. A state the
 * website started carries no app proof and cannot be finished here.
 */
export async function completeCompanionConnection(input: {
  auth: HostedNativeMemberAuth;
  body: Record<string, unknown>;
  request: Request;
}): Promise<CompanionConnectList> {
  const provider = typeof input.body.provider === "string" ? input.body.provider : "";
  const rawQuery = typeof input.body.query === "string" ? input.body.query : "";
  const completionProof = typeof input.body.completionProof === "string"
    ? input.body.completionProof
    : "";
  if (
    !COMPANION_CONNECT_PROVIDER_PATTERN.test(provider)
    || rawQuery.length === 0
    || rawQuery.length > COMPANION_CONNECT_QUERY_MAX_LENGTH
    || completionProof.length === 0
    || completionProof.length > COMPANION_CONNECT_PROOF_MAX_LENGTH
  ) {
    throw deviceSyncError({
      code: "COMPANION_CONNECT_REQUEST_INVALID",
      httpStatus: 400,
      message: "The connect request is not valid.",
      retryable: false,
    });
  }

  const memberId = input.auth.member.id;
  const query = new URLSearchParams(rawQuery);
  const proofError = readHostedDeviceSyncAppCompletionProofError({
    completionProof,
    memberId,
    provider,
    sessionId: input.auth.sessionId,
    state: query.get("murph_state") ?? query.get("state"),
  });
  if (proofError) {
    reportHostedDeviceCallbackRejection({ errorCode: proofError, memberId, provider });
    throw deviceSyncError({
      code: "CALLBACK_PROOF_INVALID",
      httpStatus: 400,
      message: "This connection was not started by this app session.",
      retryable: false,
    });
  }

  try {
    await createHostedDeviceSyncPublicIngressService(input.request)
      .handleConnectionCallback(provider, { expectedOwnerId: memberId, query });
  } catch (error) {
    if (isDeviceSyncError(error)) {
      if (error.code === "OAUTH_STATE_INVALID") {
        // As on the website: a spent or expired admission proves neither
        // success nor failure. The app reads the list for the truth.
        reportHostedDeviceCallbackRejection({ errorCode: error.code, memberId, provider });
      } else if (error.code !== "OAUTH_STATE_REPLAYED") {
        await reportHostedDeviceConnectFailure({
          connectSourceId: typeof error.details?.connectSourceId === "string"
            ? error.details.connectSourceId
            : null,
          errorCode: error.code,
          httpStatus: error.httpStatus ?? null,
          memberId,
          provider,
        });
      }
    }
    throw error;
  }

  return readCompanionConnectSources(input.auth.member);
}

/**
 * Stops one source. It re-reads the member's row at the tap: when removing no
 * longer means this one source (a reset that would disconnect the shared
 * account, a Fitbit migration), it answers a conflict and changes nothing.
 */
export async function disconnectCompanionConnectSource(input: {
  auth: HostedNativeMemberAuth;
  request: Request;
  sourceId: string;
}): Promise<CompanionConnectList> {
  const row = await requireCompanionConnectedRow(input, "remove", { toDisconnect: true });
  await createHostedDeviceSyncPublicIngressService(input.request).disconnectConnectionSource(
    input.auth.member.id,
    row.disconnectConnectionId,
    row.disconnectSourceProviderSlug ?? "",
  );

  return readCompanionConnectSources(input.auth.member);
}

/** Queues one re-sync of the connection behind a connected source. */
export async function syncCompanionConnectSource(input: {
  auth: HostedNativeMemberAuth;
  request: Request;
  sourceId: string;
}): Promise<{ status: "queued" }> {
  const row = await requireCompanionConnectedRow(input, "sync");
  const bucketAt = Math.floor(Date.now() / COMPANION_CONNECT_SYNC_BUCKET_MS)
    * COMPANION_CONNECT_SYNC_BUCKET_MS;
  await createHostedDeviceSyncPublicIngressService(input.request).queueConnectionManualReconcile(
    input.auth.member.id,
    row.disconnectConnectionId,
    (connectedAt) => new Date(Math.max(bucketAt, new Date(connectedAt).getTime())).toISOString(),
  );

  return { status: "queued" };
}

async function requireCompanionConnectedRow(
  input: { auth: HostedNativeMemberAuth; sourceId: string },
  action: "remove" | "sync",
  options: { toDisconnect?: true } = {},
): Promise<ConnectSource & { disconnectConnectionId: string }> {
  const row = (await resolveCompanionConnectRows(input.auth.member, options))
    .find((candidate) => candidate.id === input.sourceId);
  const connectionId = row?.disconnectConnectionId;
  if (!row || !connectionId || connectSourcePath(row.id) !== "web") {
    throw deviceSyncError({
      code: "CONNECTION_SOURCE_NOT_FOUND",
      httpStatus: 404,
      message: "This source is not connected.",
      retryable: false,
    });
  }
  if (!companionConnectRowActions(row).includes(action)) {
    throw deviceSyncError({
      code: "COMPANION_CONNECT_REFRESH_REQUIRED",
      httpStatus: 409,
      message: "This source changed. Refresh the list.",
      retryable: false,
    });
  }

  return { ...row, disconnectConnectionId: connectionId };
}

function companionConnectSourceNotConfiguredError() {
  return deviceSyncError({
    code: "HOSTED_DEVICE_CONNECT_SOURCE_NOT_CONFIGURED",
    httpStatus: 404,
    message: "Hosted device connect source is not configured.",
    retryable: false,
  });
}
