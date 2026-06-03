import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedUserRecipientPublicKeyJwk,
  wrapHostedBrowserSessionKey,
} from "@murphai/runtime-state";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import {
  getHostedBrowserVaultReplicaStorageKeyId,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import {
  CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";

import {
  createBrowserVaultReplicaAadFields,
  createHostedBrowserVaultReplicaStore,
  HostedBrowserVaultReplicaOwnershipError,
  HostedBrowserVaultReplicaRootKeyUnavailableError,
} from "../../browser-vault-store.ts";
import {
  json,
} from "../../json.ts";
import {
  readCachedRequestText,
  resolveHostedExecutionUserCryptoContext,
  type WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import {
  requireBoundInternalRouteUser,
} from "../auth.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";
import {
  buildWorkerRouteLogDetails,
} from "../route-utils/log-details.ts";
import {
  parseJsonValue,
  requireJsonRecord,
} from "../route-utils/json-body.ts";
import {
  decodeRouteParam,
} from "../route-utils/route-params.ts";

export const browserVaultRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "browser-vault-session");
    },
    async handle(context, params) {
      return handleBrowserVaultSessionRoute(context, params.userId);
    },
    match: (pathname) => matchCloudflareHostedControlUserRoutePath("browserVaultSession", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.browserVaultSession.method],
    name: "browser-vault-session",
    wrongMethodResponse: "method-not-allowed",
  },
];

export async function handleBrowserVaultSessionRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let body;
  try {
    body = parseBrowserVaultSessionRequest(parseJsonValue(await readCachedRequestText(context)));
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "browser-vault-session-request-invalid",
        routeName: "browser-vault-session",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker browser-vault session route rejected an invalid request body.",
      phase: "failed",
      userId,
    });
    throw error;
  }
  const crypto = await resolveHostedExecutionUserCryptoContext({
    bucket: context.env.BUNDLES,
    domain: "runtime",
    environment: context.environment,
    userId,
  });
  const replicaStore = createHostedBrowserVaultReplicaStore({
    bucket: context.env.BUNDLES,
    rootKey: crypto.rootKey,
    rootKeyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    resolveRootKeyById: crypto.resolveKeyById,
    userId,
  });
  let replicaEnvelope;
  try {
    replicaEnvelope = await replicaStore.readBrowserVaultReplicaEnvelope(body.replicaRef);
  } catch (error) {
    if (error instanceof HostedBrowserVaultReplicaOwnershipError || error instanceof HostedBrowserVaultReplicaRootKeyUnavailableError) {
      replicaEnvelope = null;
    } else {
      throw error;
    }
  }

  if (!replicaEnvelope) {
    return json({
      code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
      error: "Browser vault replica was not found.",
    }, 404);
  }
  const replicaStorageKeyId = getHostedBrowserVaultReplicaStorageKeyId(body.replicaRef);
  if (replicaEnvelope.keyId !== replicaStorageKeyId) {
    return json({
      code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
      error: "Browser vault replica was not found.",
    }, 404);
  }

  let replicaKey;
  try {
    replicaKey = await replicaStore.deriveBrowserVaultReplicaKey(body.replicaRef);
  } catch (error) {
    if (error instanceof HostedBrowserVaultReplicaRootKeyUnavailableError) {
      return json({
        code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
        error: "Browser vault replica was not found.",
      }, 404);
    }

    throw error;
  }
  const replicaKeyEnvelope = await wrapHostedBrowserSessionKey({
    keyBytes: replicaKey,
    keyId: replicaStorageKeyId,
    publicKeyJwk: body.browserPublicKeyJwk,
    purpose: "browser-vault-replica",
    userId,
  });

  return json({
    encryptedReplica: replicaEnvelope,
    replicaAad: createBrowserVaultReplicaAadFields({
      ref: body.replicaRef,
      userId,
    }),
    replicaKeyEnvelope,
    replicaRef: body.replicaRef,
    state: "ready",
  });
}

export function parseBrowserVaultSessionRequest(value: unknown): {
  browserPublicKeyJwk: ReturnType<typeof parseHostedUserRecipientPublicKeyJwk>;
  replicaRef: HostedBrowserVaultReplicaRef;
} {
  const record = requireJsonRecord(value, "Browser vault session request");

  const replicaRef = parseHostedBrowserVaultReplicaRef(
    record.replicaRef,
    "Browser vault session request replicaRef",
  );

  if (!replicaRef) {
    throw new TypeError("Browser vault session request replicaRef must not be null.");
  }

  return {
    browserPublicKeyJwk: parseHostedUserRecipientPublicKeyJwk(
      record.browserPublicKeyJwk,
      "Browser vault session request browserPublicKeyJwk",
    ),
    replicaRef,
  };
}
