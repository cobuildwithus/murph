import "server-only";

import { randomUUID } from "node:crypto";
import { companionMealIdSchema, type CompanionMeal, type CompanionMealsProjection } from "@murphai/contracts";
import { assessBrowserVaultReplicaFreshness, createHostedMediaReferenceId } from "@murphai/hosted-execution";
import { parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/parsers";
import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";
import { assertHostedNativeMemberAuthCurrentTx } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { decodeReadyBrowserVaultSession, parseBrowserVaultSessionResponse } from "../browser-vault/loader";
import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { requireActiveHostedMemberAuthFromBearerToken } from "../hosted-onboarding/request-auth";
import { readHostedWorkspace } from "../hosted-workspace/store";
import { submitMemberAction } from "../member-actions/submit";
import { getPrisma } from "../prisma";
import { readRawBodyBuffer } from "../http";
import { recoverCompanionMealUploadIds } from "./companion-meal-upload-links";

export function mealApiError(code: string, httpStatus: number, message: string) {
  return hostedOnboardingError({ code, httpStatus, message, retryable: httpStatus === 503 });
}

function projectionUnavailable() {
  return mealApiError("MEALS_PROJECTION_UNAVAILABLE", 503, "Saved meals are temporarily unavailable.");
}

export async function readCompanionMeals(request: Request, recoverUploadIds = true) {
  const prisma = getPrisma();
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request, prisma);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  const snapshot = await loadSavedMeals(auth.member.id, request.signal);
  if (recoverUploadIds) await recoverCompanionMealUploadIds({
    memberId: auth.member.id, prisma, projection: snapshot.projection, entities: snapshot.entities,
  });
  // External ciphertext loading cannot preserve access after consent/session loss.
  await assertHostedNativeMemberAuthCurrentTx(auth, prisma);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  return { auth, prisma, savedAt: snapshot.savedAt, projection: snapshot.projection };
}

async function loadSavedMeals(memberId: string, signal: AbortSignal): Promise<{
  savedAt: string;
  projection: CompanionMealsProjection;
  entities: Array<{ family: string; kind: string; attributes: Record<string, unknown> }>;
}> {
  try {
    const workspace = await readHostedWorkspace({ userId: memberId });
    const replicaRef = parseHostedBrowserVaultReplicaRef(workspace?.browserVaultReplicaRef ?? null, "Companion meals replica");
    const control = readHostedExecutionControlClientIfConfigured();
    // A generation-17 Meals projection is also evidence that this member's
    // runtime has the meal.delete consumer. Never enqueue against legacy data.
    if (!replicaRef || (replicaRef.generation ?? 0) < 17 || !control) throw projectionUnavailable();
    const keys = await generateHostedUserRecipientKeyPair();
    const session = parseBrowserVaultSessionResponse({
      ...await control.createBrowserVaultSession({
        browserPublicKeyJwk: keys.publicKeyJwk, replicaRef, requestedShards: ["core"], userId: memberId,
      }),
      freshness: assessBrowserVaultReplicaFreshness({ now: new Date().toISOString(), replicaRef }).freshness,
      refreshPending: false,
      deviceSyncImportPending: false,
      workspaceVersion: workspace?.version ?? null,
    });
    if (session.state !== "ready") throw projectionUnavailable();
    const loaded = await decodeReadyBrowserVaultSession({ session, privateKeyJwk: keys.privateKeyJwk, expectedMemberId: memberId, signal });
    const replica = loaded.client.replica;
    if (!replica.meals || (replica.generation ?? 0) < 17) throw projectionUnavailable();
    return { savedAt: replica.generatedAt, projection: structuredClone(replica.meals), entities: replica.entities };
  } catch {
    // Do not log decrypt errors, meal contents, signed URLs, or private paths.
    throw projectionUnavailable();
  }
}

export function readMealPage(requestUrl: string) {
  const params = new URL(requestUrl).searchParams;
  if ([...params.keys()].some(key => !["cursor", "limit"].includes(key))
    || params.getAll("cursor").length > 1 || params.getAll("limit").length > 1) {
    throw mealApiError("MEALS_INVALID_REQUEST", 400, "Use one cursor and limit.");
  }
  const cursor = params.get("cursor");
  if (cursor !== null && (!/^\d{4}-\d{2}-\d{2}$/u.test(cursor)
    || !Number.isFinite(Date.parse(`${cursor}T00:00:00Z`))
    || new Date(`${cursor}T00:00:00Z`).toISOString().slice(0, 10) !== cursor)) {
    throw mealApiError("MEALS_INVALID_CURSOR", 400, "The meals cursor is invalid.");
  }
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 7 : Number(rawLimit);
  if ((rawLimit !== null && !/^\d{1,2}$/u.test(rawLimit)) || !Number.isInteger(limit) || limit < 1 || limit > 31) {
    throw mealApiError("MEALS_INVALID_REQUEST", 400, "Limit must be between 1 and 31 days.");
  }
  return { cursor, limit };
}

export function requireProjectedMeal(projection: CompanionMealsProjection, id: string) {
  const valid = companionMealIdSchema.safeParse(id);
  const meal = valid.success ? projection.days.find(day => day.meals.some(meal => meal.id === id))?.meals.find(meal => meal.id === id) : undefined;
  if (!meal) throw mealApiError("MEAL_NOT_FOUND", 404, "That meal is not available.");
  return meal;
}

export async function queueCompanionMealRemoval(request: Request, id: string) {
  const { auth, prisma, projection } = await readCompanionMeals(request, false);
  requireProjectedMeal(projection, id);
  try {
    await readRawBodyBuffer(request, { limitBytes: 0 });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw mealApiError("MEALS_INVALID_REQUEST", 400, "Meal removal does not accept a body.");
  }
  try {
    const result = await submitMemberAction({
      memberId: auth.member.id,
      prisma,
      assertCurrentAuthorityTx: async tx => {
        await assertHostedNativeMemberAuthCurrentTx(auth, tx);
        await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: tx });
      },
      request: {
        action: { kind: "meal.delete", version: 1, mealId: id },
        actionId: randomUUID(), requestedAt: new Date().toISOString(), schemaVersion: 1,
      },
    });
    if (result.dedupeConflict) throw new Error("Action identity collision.");
    return { accepted: true as const, actionId: result.actionId };
  } catch (error) {
    if (isHostedOnboardingError(error) && (error.httpStatus === 401 || error.httpStatus === 403)) throw error;
    throw mealApiError("MEAL_REMOVAL_UNAVAILABLE", 503, "Meal removal is temporarily unavailable.");
  }
}

/** Sign only meals selected for this response, then recheck live owner authority. */
export async function presentCompanionMeals(state: Awaited<ReturnType<typeof readCompanionMeals>>, meals: CompanionMeal[]) {
  const descriptors = new Map<string, { mediaId: string; sha256: string; byteSize: number }>();
  for (const meal of meals) {
    if (!meal.thumbnail) continue;
    const mediaId = createHostedMediaReferenceId({ ...meal.thumbnail, mediaKind: "image" });
    descriptors.set(mediaId, { mediaId, sha256: meal.thumbnail.sha256, byteSize: meal.thumbnail.byteSize });
  }
  const control = readHostedExecutionControlClientIfConfigured();
  const deliveries = descriptors.size && control
    ? await control.mealThumbnailDeliveries({ userId: state.auth.member.id, photos: [...descriptors.values()] }) : null;
  const urls = new Map(deliveries?.map(delivery => [delivery.mediaId, delivery.url]) ?? []);
  if (descriptors.size && control) {
    await assertHostedNativeMemberAuthCurrentTx(state.auth, state.prisma);
    await assertBrowserVaultMemberAuthority({ memberId: state.auth.member.id, prisma: state.prisma });
  }
  return meals.map(({ thumbnail, ...meal }) => {
    const url = thumbnail ? urls.get(createHostedMediaReferenceId({ ...thumbnail, mediaKind: "image" })) : undefined;
    return { ...meal, photo: url && thumbnail ? { url, width: thumbnail.width, height: thumbnail.height } : null };
  });
}
