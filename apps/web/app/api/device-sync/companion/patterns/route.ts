import { isCloudflareHostedControlBrowserVaultReplicaNotFoundError } from "@murphai/cloudflare-hosted-control/client";
import { assessBrowserVaultReplicaFreshness } from "@murphai/hosted-execution";
import { parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/parsers";
import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";

import { assertBrowserVaultMemberAuthority } from "@/src/lib/browser-vault/authority";
import { decodeReadyBrowserVaultSession, parseBrowserVaultSessionResponse } from "@/src/lib/browser-vault/loader";
import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedWorkspace } from "@/src/lib/hosted-workspace/store";
import { getPrisma } from "@/src/lib/prisma";

// Read the same saved query result as /patterns. No runtime wake, calculation,
// persistence, or raw source records in the native response.
export const GET = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request, prisma);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  const workspace = await readHostedWorkspace({ userId: auth.member.id });
  const replicaRef = parseHostedBrowserVaultReplicaRef(
    workspace?.browserVaultReplicaRef ?? null,
    "Companion Patterns replica ref",
  );
  if (!replicaRef) return jsonOk({ report: null, freshness: "stale" });
  const control = readHostedExecutionControlClientIfConfigured();
  if (!control) {
    throw hostedOnboardingError({ code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED", message: "Patterns is temporarily unavailable.", httpStatus: 503 });
  }
  const keys = await generateHostedUserRecipientKeyPair();
  try {
    const session = parseBrowserVaultSessionResponse({
      ...await control.createBrowserVaultSession({
        browserPublicKeyJwk: keys.publicKeyJwk,
        replicaRef,
        requestedShards: ["core"],
        userId: auth.member.id,
      }),
      freshness: assessBrowserVaultReplicaFreshness({ now: new Date().toISOString(), replicaRef }).freshness,
      refreshPending: false,
      deviceSyncImportPending: false,
      workspaceVersion: workspace?.version ?? null,
    });
    if (session.state !== "ready") return jsonOk({ report: null, freshness: "stale" });
    const loaded = await decodeReadyBrowserVaultSession({
      session,
      privateKeyJwk: keys.privateKeyJwk,
      expectedMemberId: auth.member.id,
      signal: request.signal,
    });
    // Recheck live access after the external read and before disclosing health data.
    await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
    return jsonOk({ report: loaded.client.replica.personalPatterns ?? null, freshness: session.freshness });
  } catch (error) {
    if (isCloudflareHostedControlBrowserVaultReplicaNotFoundError(error)) {
      return jsonOk({ report: null, freshness: "stale" });
    }
    throw error;
  }
});
