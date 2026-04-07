import {
  buildHostedExecutionAssistantCronTickDispatch,
  parseHostedExecutionDispatchRequest,
  parseHostedExecutionOutboxPayload,
  parseHostedExecutionSharePack,
  readHostedEmailCapabilities,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
} from "@murphai/device-syncd/hosted-runtime";

import {
  createHostedEmailUserAddress,
  readHostedEmailConfig,
} from "../hosted-email.ts";
import { parseHostedUserEnvUpdate } from "../user-env.ts";
import { createHostedPendingUsageDirtyUserStore } from "../usage-store.ts";
import { createHostedShareStore } from "../share-store.ts";
import { json, notFound } from "../json.ts";
import {
  decodeRouteParam,
  readCachedJsonObject,
  readCachedOptionalJsonObject,
  requireUserRunnerStubMethod,
  resolveHostedExecutionUserCryptoContext,
  resolveUserRunnerStub,
  type WorkerRouteContext,
} from "./shared.ts";

export async function handleManualRunRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  await readCachedOptionalJsonObject(context);
  const userId = decodeRouteParam(encodedUserId);
  const dispatch = createManualRunDispatch(userId);
  const status = await (await resolveUserRunnerStub(context.env, userId)).dispatch(dispatch);

  return isBackpressuredStatus(status, dispatch.eventId)
    ? json(status, 429)
    : json(status);
}

export async function handleStatusRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = await resolveUserRunnerStub(context.env, userId);
  return json(await stub.status());
}

export async function handleUserEnvRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = await resolveUserRunnerStub(context.env, userId);

  if (context.request.method === "GET") {
    return json(await stub.getUserEnvStatus());
  }

  if (context.request.method === "PUT") {
    return json(
      await stub.updateUserEnv(parseHostedUserEnvUpdate(await readCachedJsonObject(context))),
    );
  }

  return json(await stub.clearUserEnv());
}

export async function handleUserDeviceSyncRuntimeRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = await resolveUserRunnerStub(context.env, userId);

  if (context.request.method === "GET") {
    return json(
      await requireUserRunnerStubMethod(stub, "getDeviceSyncRuntimeSnapshot")({
        request: parseHostedExecutionDeviceSyncRuntimeSnapshotRequest({
          connectionId: normalizeNullableSearchString(context.url.searchParams.get("connectionId")),
          provider: normalizeNullableSearchString(context.url.searchParams.get("provider")),
          userId,
        }, userId),
      }),
    );
  }

  return json(
    await requireUserRunnerStubMethod(stub, "applyDeviceSyncRuntimeUpdates")({
      request: parseHostedExecutionDeviceSyncRuntimeApplyRequest(
        await readCachedJsonObject(context),
        userId,
      ),
    }),
  );
}

export async function handleUserEmailAddressRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const capabilities = readHostedEmailCapabilities(
    context.env as unknown as Readonly<Record<string, string | undefined>>,
  );
  if (!capabilities.ingressReady || !capabilities.senderIdentity) {
    return json({
      error: "Hosted email ingress is not configured.",
    }, 503);
  }

  const config = readHostedEmailConfig(
    context.env as unknown as Readonly<Record<string, string | undefined>>,
  );
  const address = await createHostedEmailUserAddress({
    bucket: context.env.BUNDLES,
    config,
    key: context.environment.platformEnvelopeKey,
    keyId: context.environment.platformEnvelopeKeyId,
    keysById: context.environment.platformEnvelopeKeysById,
    userId,
  });

  return json({
    address,
    identityId: capabilities.senderIdentity,
    userId,
  });
}

export async function handlePendingUsageUsersRoute(
  context: WorkerRouteContext,
): Promise<Response> {
  const limit = readPendingUsageLimit(context.url.searchParams.get("limit"));
  return json(await createHostedPendingUsageDirtyUserStore({
    bucket: context.env.BUNDLES,
    key: context.environment.platformEnvelopeKey,
    keyId: context.environment.platformEnvelopeKeyId,
    keysById: context.environment.platformEnvelopeKeysById,
  }).listDirtyUsers(
    limit === null ? undefined : { limit },
  ));
}

export async function handlePendingUsageRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const stub = await resolveUserRunnerStub(context.env, decodeRouteParam(encodedUserId));

  if (context.request.method === "GET") {
    const limit = readPendingUsageLimit(context.url.searchParams.get("limit"));
    return json(await requireUserRunnerStubMethod(stub, "readPendingUsage")(
      limit === null ? undefined : { limit },
    ));
  }

  const usageIds = parsePendingUsageDeleteRequest(await readCachedJsonObject(context));
  await requireUserRunnerStubMethod(stub, "deletePendingUsage")({ usageIds });
  return json({ ok: true, usageIds });
}

export async function handleUserDispatchPayloadRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = await resolveUserRunnerStub(context.env, userId);

  if (context.request.method === "PUT") {
    const dispatch = parseHostedExecutionDispatchRequest(await readCachedJsonObject(context));

    if (dispatch.event.userId !== userId) {
      return json({
        error: "Stored dispatch payload userId does not match the route user.",
      }, 400);
    }

    return json(await requireUserRunnerStubMethod(stub, "storeDispatchPayload")({ dispatch }));
  }

  const payload = requireHostedExecutionRouteOutboxPayloadUser(
    parseHostedExecutionOutboxPayload(await readCachedJsonObject(context)),
    userId,
  );
  await requireUserRunnerStubMethod(stub, "deleteStoredDispatchPayload")({ payload });
  return json({
    dispatchRef: payload.storage === "reference" ? payload.dispatchRef : null,
    ok: true,
    userId,
  });
}

export async function handleUserStoredDispatchRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = await resolveUserRunnerStub(context.env, userId);
  const payload = requireHostedExecutionRouteOutboxPayloadUser(
    parseHostedExecutionOutboxPayload(await readCachedJsonObject(context)),
    userId,
  );
  const result = await requireUserRunnerStubMethod(stub, "dispatchStoredPayload")({ payload });
  return result.event.state === "backpressured" ? json(result, 429) : json(result);
}

export async function handleSharePackRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
  encodedShareId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const shareId = decodeRouteParam(encodedShareId);
  const ownerCrypto = await resolveHostedExecutionUserCryptoContext({
    bucket: context.env.BUNDLES,
    environment: context.environment,
    userId,
  });
  const store = createHostedShareStore({
    bucket: context.env.BUNDLES,
    key: ownerCrypto.rootKey,
    keyId: ownerCrypto.rootKeyId,
    keysById: ownerCrypto.keysById,
    ownerUserId: userId,
  });

  if (context.request.method === "GET") {
    const pack = await store.readSharePack(shareId);
    return pack ? json(pack) : notFound();
  }

  if (context.request.method === "DELETE") {
    await store.deleteSharePack(shareId);
    return json({ ok: true, shareId, userId });
  }

  const pack = parseHostedExecutionSharePack(await readCachedJsonObject(context));
  return json(await store.writeSharePack(shareId, pack));
}

export async function handleUserCryptoContextRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = await resolveUserRunnerStub(context.env, userId);
  return json(await stub.provisionManagedUserCrypto(userId));
}

function createManualRunDispatch(userId: string): ReturnType<typeof buildHostedExecutionAssistantCronTickDispatch> {
  return buildHostedExecutionAssistantCronTickDispatch({
    eventId: `manual:${Date.now()}`,
    occurredAt: new Date().toISOString(),
    reason: "manual",
    userId,
  });
}

function requireHostedExecutionRouteOutboxPayloadUser(
  payload: ReturnType<typeof parseHostedExecutionOutboxPayload>,
  userId: string,
) {
  const payloadUserId = payload.storage === "inline"
    ? payload.dispatch.event.userId
    : payload.dispatchRef.userId;

  if (payloadUserId !== userId) {
    throw new TypeError("Hosted execution outbox payload userId does not match the route user.");
  }

  return payload;
}

function parsePendingUsageDeleteRequest(value: Record<string, unknown>): string[] {
  const usageIds = value.usageIds;

  if (
    !Array.isArray(usageIds)
    || usageIds.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    throw new TypeError("usageIds must be a string array of non-empty values.");
  }

  return usageIds.map((usageId) => usageId.trim());
}

function readPendingUsageLimit(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError("limit must be a non-negative integer.");
  }

  return parsed;
}

function normalizeNullableSearchString(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isMissingHostedUserCryptoContext(error: unknown, userId: string): boolean {
  return error instanceof Error
    && error.message.includes(`Hosted user root key envelope ${userId} is missing.`);
}

function isBackpressuredStatus(
  status: { backpressuredEventIds?: string[] },
  eventId: string,
): boolean {
  return status.backpressuredEventIds?.includes(eventId) ?? false;
}
