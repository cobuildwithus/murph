import "server-only";

import { companionDemographicsRequestSchema, memberActionIdV1Schema, validateMemoryDemographicsPatch } from "@murphai/contracts";
import { assessBrowserVaultReplicaFreshness } from "@murphai/hosted-execution";
import { parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/parsers";
import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";
import { assertHostedNativeMemberAuthCurrentTx } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { decodeReadyBrowserVaultSession, parseBrowserVaultSessionResponse } from "../browser-vault/loader";
import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { readHostedOnboardingJsonObject } from "../hosted-onboarding/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "../hosted-onboarding/request-auth";
import { readHostedWorkspace } from "../hosted-workspace/store";
import { readMemberActionStatus } from "../member-actions/outcome";
import { submitMemberAction } from "../member-actions/submit";
import { getPrisma } from "../prisma";

function demographicsError(code: string, httpStatus: number, message: string) {
  return hostedOnboardingError({ code, httpStatus, message, retryable: httpStatus === 503 });
}

async function requireDemographicsConsumer(memberId: string, signal: AbortSignal) {
  try {
    const workspace = await readHostedWorkspace({ userId: memberId });
    const replicaRef = parseHostedBrowserVaultReplicaRef(workspace?.browserVaultReplicaRef ?? null, "Demographics replica");
    const control = readHostedExecutionControlClientIfConfigured();
    if (!replicaRef || (replicaRef.generation ?? 0) < 18 || !control) throw new Error("Unavailable");
    const keys = await generateHostedUserRecipientKeyPair();
    const session = parseBrowserVaultSessionResponse({
      ...await control.createBrowserVaultSession({
        browserPublicKeyJwk: keys.publicKeyJwk, replicaRef, requestedShards: ["core"], userId: memberId,
      }),
      freshness: assessBrowserVaultReplicaFreshness({ now: new Date().toISOString(), replicaRef }).freshness,
      refreshPending: false, deviceSyncImportPending: false, workspaceVersion: workspace?.version ?? null,
    });
    if (session.state !== "ready") throw new Error("Unavailable");
    const loaded = await decodeReadyBrowserVaultSession({
      session, privateKeyJwk: keys.privateKeyJwk, expectedMemberId: memberId, signal,
    });
    if ((loaded.client.replica.generation ?? 0) < 18 || !loaded.client.replica.demographics) {
      throw new Error("Unavailable");
    }
  } catch {
    throw demographicsError("DEMOGRAPHICS_PROJECTION_UNAVAILABLE", 503, "Saved demographics are temporarily unavailable.");
  }
}

export async function queueCompanionDemographics(request: Request) {
  const prisma = getPrisma();
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request, prisma);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: 1024, tooLargeErrorCode: "DEMOGRAPHICS_INVALID_REQUEST",
    tooLargeErrorMessage: "The demographics request is too large.",
  });
  const parsed = companionDemographicsRequestSchema.safeParse(body);
  if (!parsed.success || new URL(request.url).searchParams.size !== 0) {
    throw demographicsError("DEMOGRAPHICS_INVALID_REQUEST", 400, "Supply a stable action identity, timestamp and demographic fields.");
  }
  const { actionId, requestedAt, ...fields } = parsed.data;
  let patch;
  try { patch = validateMemoryDemographicsPatch(fields); } catch {
    throw demographicsError("DEMOGRAPHICS_INVALID_REQUEST", 400, "The demographic fields are invalid.");
  }
  await requireDemographicsConsumer(auth.member.id, request.signal);
  try {
    const result = await submitMemberAction({
      memberId: auth.member.id, prisma,
      assertCurrentAuthorityTx: async tx => {
        await assertHostedNativeMemberAuthCurrentTx(auth, tx);
        await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: tx });
      },
      request: { actionId, requestedAt, schemaVersion: 1, action: { kind: "demographics.set", version: 1, patch } },
    });
    if (result.dedupeConflict) {
      throw demographicsError("MEMBER_ACTION_ID_CONFLICT", 409, "That action identity already belongs to a different request.");
    }
    return { accepted: true as const, actionId: result.actionId };
  } catch (error) {
    if (isHostedOnboardingError(error) && [401, 403, 409].includes(error.httpStatus)) throw error;
    throw demographicsError("DEMOGRAPHICS_SAVE_UNAVAILABLE", 503, "Saving demographics is temporarily unavailable.");
  }
}

export async function readCompanionMemberAction(request: Request, rawActionId: string) {
  const prisma = getPrisma();
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request, prisma);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  const parsed = memberActionIdV1Schema.safeParse(rawActionId);
  if (!parsed.success || new URL(request.url).searchParams.size !== 0) {
    throw demographicsError("MEMBER_ACTION_INVALID_REQUEST", 400, "The member action identity is invalid.");
  }
  const result = await readMemberActionStatus({ actionId: parsed.data, memberId: auth.member.id, prisma });
  await assertHostedNativeMemberAuthCurrentTx(auth, prisma);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  return result;
}
