import { assessBrowserVaultReplicaFreshness } from "@murphai/hosted-execution";
import { parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/parsers";
import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";
import { after } from "next/server";

import { assertBrowserVaultMemberAuthority } from "@/src/lib/browser-vault/authority";
import { decodeBrowserVaultCoreSession } from "@/src/lib/browser-vault/loader";
import { prepareHomepageBrowserVaultBestEffort } from "@/src/lib/browser-vault/homepage-preparation-worker";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { projectCompanionEnvironmentReport } from "@/src/lib/environment/companion-report";
import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { requireActivePrivyMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { readHostedBrowserVaultReplicaState } from "@/src/lib/hosted-workspace/store";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuthFromBearerToken(request, prisma);
  const authority = { memberId: auth.member.id, prisma };
  await assertBrowserVaultMemberAuthority(authority);
  const workspace = await readHostedBrowserVaultReplicaState({
    prisma, userId: auth.member.id,
  });
  const replicaRef = parseHostedBrowserVaultReplicaRef(
    workspace?.browserVaultReplicaRef ?? null,
    "Companion environment replica ref",
  );
  const freshness = assessBrowserVaultReplicaFreshness({ now: new Date(), replicaRef });
  if (freshness.shouldRefresh) {
    after(async () => {
      try {
        await prepareHomepageBrowserVaultBestEffort({ memberId: auth.member.id });
      } catch {
        // Optional refresh never logs member data or delays the read.
      }
    });
  }
  if (!replicaRef) {
    await assertBrowserVaultMemberAuthority(authority);
    return jsonOk({ schema: "murph.companion.environment.v1", state: "preparing" });
  }
  const control = readHostedExecutionControlClientIfConfigured();
  if (!control) throw unavailable();
  let report;
  try {
    const keys = await generateHostedUserRecipientKeyPair();
    const session = await control.createBrowserVaultSession({
      browserPublicKeyJwk: keys.publicKeyJwk,
      replicaRef,
      requestedShards: ["core"],
      userId: auth.member.id,
    });
    const client = await decodeBrowserVaultCoreSession({
      sessionValue: { ...session, freshness: freshness.freshness },
      privateKeyJwk: keys.privateKeyJwk,
      expectedMemberId: auth.member.id,
      signal: request.signal,
    });
    report = projectCompanionEnvironmentReport({
      client,
      generatedAt: replicaRef.generatedAt,
      freshness: freshness.freshness,
      imperial: new URL(request.url).searchParams.get("units") === "imperial",
    });
  } catch {
    // Decoder errors can contain private payload fragments; never forward them.
    throw unavailable();
  }
  await assertBrowserVaultMemberAuthority(authority);
  return jsonOk(report);
});

function unavailable() {
  return hostedOnboardingError({
    code: "COMPANION_ENVIRONMENT_UNAVAILABLE",
    message: "Your environment report is temporarily unavailable. Please try again.",
    httpStatus: 503,
    retryable: true,
  });
}
