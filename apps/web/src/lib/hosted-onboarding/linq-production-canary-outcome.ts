import "server-only";

import { isContractId } from "@murphai/contracts";
import { assessBrowserVaultReplicaFreshness, parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/browser-vault";
import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";

import { assertBrowserVaultMemberAuthority } from "@/src/lib/browser-vault/authority";
import { decodeReadyBrowserVaultSession, parseBrowserVaultSessionResponse } from "@/src/lib/browser-vault/loader";
import { browserVaultReplicaRefsMatch } from "@/src/lib/browser-vault/ref";
import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { readHostedMailboxLatestPendingConversationItem } from "@/src/lib/hosted-mailbox/store";
import { readHostedWorkspace, readHostedWorkspaceBrowserVaultSourceStateHash } from "@/src/lib/hosted-workspace/store";

import { hostedOnboardingError } from "./errors";
import { readHostedLinqProductionCanaryMemberId } from "./linq-production-canary";
import { LINQ_PRODUCTION_CANARY_GOAL_TITLE, type LinqProductionCanaryOutcome } from "./linq-production-canary-contract";
import type { HostedOnboardingReadClient } from "./shared";

const NOT_READY: LinqProductionCanaryOutcome = {
  ready: false,
  totalGoalCount: 0,
  matchingGoalCount: 0,
  matchingGoalIdCount: 0,
};

/** Observe published canonical state only; never refresh, wake, or select another member. */
export async function readHostedLinqProductionCanaryOutcome(input: {
  prisma: HostedOnboardingReadClient;
}): Promise<LinqProductionCanaryOutcome> {
  let stage:
    | "member_lookup"
    | "initial_authority"
    | "initial_readiness"
    | "control_configuration"
    | "key_generation"
    | "session_request"
    | "session_parsing"
    | "decryption"
    | "final_readiness"
    | "final_authority"
    | "goal_counting" = "member_lookup";
  try {
    const { prisma } = input;
    const memberId = await readHostedLinqProductionCanaryMemberId({ prisma });
    if (!memberId) return { ...NOT_READY };
    stage = "initial_authority";
    await assertBrowserVaultMemberAuthority({ memberId, prisma });
    stage = "initial_readiness";
    // Delivery can precede checkpoint. Consumption is committed with the canonical
    // checkpoint, so an earlier publication cannot stand in for the replying turn.
    if (await readHostedMailboxLatestPendingConversationItem({ afterSeq: 0, prisma, userId: memberId })) {
      return { ...NOT_READY };
    }

    const workspace = await readHostedWorkspace({ prisma, userId: memberId });
    if (!workspace) return { ...NOT_READY };
    const replicaRef = parseHostedBrowserVaultReplicaRef(workspace.browserVaultReplicaRef);
    const sourceHash = readHostedWorkspaceBrowserVaultSourceStateHash(workspace.snapshotRef);
    if (!replicaRef || !sourceHash || assessBrowserVaultReplicaFreshness({
      currentSourceHash: sourceHash,
      replicaRef,
    }).freshness !== "fresh") return { ...NOT_READY };

    stage = "control_configuration";
    const control = readHostedExecutionControlClientIfConfigured(10_000);
    if (!control) throw new Error("Canary control is not configured.");
    stage = "key_generation";
    const keys = await generateHostedUserRecipientKeyPair();
    // This existing control operation reads R2 and wraps the replica key in memory;
    // it does not persist a session grant or schedule a replica refresh/runtime wake.
    stage = "session_request";
    const sessionResponse = await control.createBrowserVaultSession({
      browserPublicKeyJwk: keys.publicKeyJwk,
      replicaRef,
      requestedShards: ["core"],
      userId: memberId,
    });
    stage = "session_parsing";
    const session = parseBrowserVaultSessionResponse(sessionResponse);
    if (session.state !== "ready" || !browserVaultReplicaRefsMatch(session.replicaRef, replicaRef)) {
      return { ...NOT_READY };
    }
    stage = "decryption";
    const decoded = await decodeReadyBrowserVaultSession({
      session,
      privateKeyJwk: keys.privateKeyJwk,
      expectedMemberId: memberId,
      requestedShards: ["core"],
    });
    if (!decoded.shards.core) return { ...NOT_READY };

    stage = "final_readiness";
    // Fail closed if a checkpoint, publication, reset, or access change raced the read.
    if (await readHostedMailboxLatestPendingConversationItem({ afterSeq: 0, prisma, userId: memberId })) {
      return { ...NOT_READY };
    }
    const current = await readHostedWorkspace({ prisma, userId: memberId });
    if (!current || current.version !== workspace.version
      || readHostedWorkspaceBrowserVaultSourceStateHash(current.snapshotRef) !== sourceHash
      || !browserVaultReplicaRefsMatch(parseHostedBrowserVaultReplicaRef(current.browserVaultReplicaRef), replicaRef)
      || await readHostedLinqProductionCanaryMemberId({ prisma }) !== memberId) {
      return { ...NOT_READY };
    }
    stage = "final_authority";
    await assertBrowserVaultMemberAuthority({ memberId, prisma });

    stage = "goal_counting";
    const allGoals = decoded.shards.core.entities.filter((entity) => entity.family === "goal");
    const goals = allGoals.filter((entity) => entity.title === LINQ_PRODUCTION_CANARY_GOAL_TITLE);
    return {
      ready: true,
      totalGoalCount: allGoals.length,
      matchingGoalCount: goals.length,
      matchingGoalIdCount: new Set(goals.filter((entity) =>
        entity.recordClass === "bank" && entity.kind === "goal" && isContractId(entity.id, "goal"))
        .map((entity) => entity.id)).size,
    };
  } catch {
    // Never inspect the exception: decryption/control failures can contain private data.
    try {
      console.warn("Hosted Linq production canary outcome read failed.", { stage });
    } catch {
      // Diagnostic failure must not replace the generic unavailable error.
    }
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_PRODUCTION_CANARY_OUTCOME_UNAVAILABLE",
      httpStatus: 503,
      message: "The production canary outcome is unavailable.",
    });
  }
}
