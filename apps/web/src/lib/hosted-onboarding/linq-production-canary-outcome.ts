import "server-only";

import { readCloudflareHostedControlHttpError } from "@murphai/cloudflare-hosted-control/client";
import { isContractId } from "@murphai/contracts";
import { assessBrowserVaultReplicaFreshness, parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/browser-vault";
import { isHostedWorkspaceSnapshotV2Ref, parseHostedExecutionSnapshotRef } from "@murphai/hosted-execution/parsers";
import { buildHostedWorkspaceSnapshotV2FingerprintSha256 } from "@murphai/hosted-execution/workspace-snapshot-v2";
import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";

import { decodeReadyBrowserVaultSession, parseBrowserVaultSessionResponse } from "@/src/lib/browser-vault/loader";
import { browserVaultReplicaRefsMatch } from "@/src/lib/browser-vault/ref";
import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { readHostedMailboxLatestPendingConversationItem } from "@/src/lib/hosted-mailbox/store";
import { readHostedLinqProductionCanaryLatencyDiagnostics } from "@/src/lib/hosted-runtime-latency/store";
import { readHostedWorkspace } from "@/src/lib/hosted-workspace/store";

import { HostedOnboardingError, hostedOnboardingError } from "./errors";
import { readHostedLinqProductionCanaryMemberId } from "./linq-production-canary";
import type { LinqProductionCanaryDiagnostics, LinqProductionCanaryOutcome } from "./linq-production-canary-contract";
import { assertActiveHostedMemberAccessAllowed, readHostedRuntimeAiAccessDecision } from "./member-access";
import type { HostedOnboardingReadClient } from "./shared";

const NOT_READY: LinqProductionCanaryOutcome = {
  ready: false,
  totalGoalCount: 0,
  matchingGoalCount: 0,
  matchingGoalIdCount: 0,
};

type CanaryOutcomeReadStage =
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
  | "goal_counting";

/** Observe published canonical state and bounded timing; never refresh, wake, or select another member. */
export async function readHostedLinqProductionCanaryOutcome(input: {
  prisma: HostedOnboardingReadClient;
}): Promise<LinqProductionCanaryOutcome> {
  let stage: CanaryOutcomeReadStage = "member_lookup";
  try {
    const { prisma } = input;
    const memberId = await readHostedLinqProductionCanaryMemberId({ prisma });
    if (!memberId) return { ...NOT_READY, diagnostics: unavailableCanaryDiagnostics() };
    stage = "initial_authority";
    await assertCanaryRuntimeAuthority({ memberId, prisma });
    // Sample only the authorized identity. Canonical readiness is checked after
    // this read, and even a not-ready response must pass the final authority gate.
    const diagnostics = await readHostedLinqProductionCanaryLatencyDiagnostics({ prisma, memberId })
      .catch(unavailableCanaryDiagnostics);
    const outcome = await readCanaryCanonicalGoalOutcome({
      prisma, memberId, setStage: (next) => { stage = next; },
    });
    stage = "final_readiness";
    if (await readHostedLinqProductionCanaryMemberId({ prisma }) !== memberId) {
      return { ...NOT_READY, diagnostics: unavailableCanaryDiagnostics() };
    }
    stage = "final_authority";
    await assertCanaryRuntimeAuthority({ memberId, prisma });
    return { ...outcome, diagnostics };
  } catch (error) {
    // Classify only authority/session-request failures; never log the caught value.
    try {
      console.warn("Hosted Linq production canary outcome read failed.", {
        stage, ...readAuthorityFailureDiagnostic(stage, error),
        ...readSessionRequestFailureDiagnostic(stage, error),
      });
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

function unavailableCanaryDiagnostics(): LinqProductionCanaryDiagnostics {
  return { status: "unavailable", failedTurnMatched: false, truncated: false, traces: [] };
}

async function readCanaryCanonicalGoalOutcome(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
  setStage: (stage: CanaryOutcomeReadStage) => void;
}): Promise<LinqProductionCanaryOutcome> {
  const { memberId, prisma, setStage } = input;
  setStage("initial_readiness");
  // Delivery can precede checkpoint. Consumption is committed with the canonical
  // checkpoint, so an earlier publication cannot stand in for the replying turn.
  if (await readHostedMailboxLatestPendingConversationItem({ afterSeq: 0, prisma, userId: memberId })) {
    return { ...NOT_READY };
  }

  const workspace = await readHostedWorkspace({ prisma, userId: memberId });
  if (!workspace) return { ...NOT_READY };
  const replicaRef = parseHostedBrowserVaultReplicaRef(workspace.browserVaultReplicaRef);
  const checkpointFingerprint = readCanaryCheckpointFingerprint(workspace.snapshotRef, memberId);
  // The runtime owns canonical-content hashing. An archive fingerprint is a
  // different identity; Web follows the published replica's generation/age policy.
  if (!replicaRef || !checkpointFingerprint
    || assessBrowserVaultReplicaFreshness({ replicaRef }).freshness !== "fresh") {
    return { ...NOT_READY };
  }

  setStage("control_configuration");
  const control = readHostedExecutionControlClientIfConfigured(10_000);
  if (!control) throw new Error("Canary control is not configured.");
  setStage("key_generation");
  const keys = await generateHostedUserRecipientKeyPair();
  // This existing control operation reads R2 and wraps the replica key in memory;
  // it does not persist a session grant or schedule a replica refresh/runtime wake.
  setStage("session_request");
  const sessionResponse = await control.createBrowserVaultSession({
    browserPublicKeyJwk: keys.publicKeyJwk,
    replicaRef,
    requestedShards: ["core"],
    userId: memberId,
  });
  setStage("session_parsing");
  const session = parseBrowserVaultSessionResponse(sessionResponse);
  if (session.state !== "ready" || !browserVaultReplicaRefsMatch(session.replicaRef, replicaRef)) {
    return { ...NOT_READY };
  }
  setStage("decryption");
  const decoded = await decodeReadyBrowserVaultSession({
    session,
    privateKeyJwk: keys.privateKeyJwk,
    expectedMemberId: memberId,
    requestedShards: ["core"],
  });
  if (!decoded.shards.core) return { ...NOT_READY };

  setStage("final_readiness");
  // Fail closed if a checkpoint, publication, reset, or access change raced the read.
  if (await readHostedMailboxLatestPendingConversationItem({ afterSeq: 0, prisma, userId: memberId })) {
    return { ...NOT_READY };
  }
  const current = await readHostedWorkspace({ prisma, userId: memberId });
  if (!current || current.version !== workspace.version
    || readCanaryCheckpointFingerprint(current.snapshotRef, memberId) !== checkpointFingerprint
    || !browserVaultReplicaRefsMatch(parseHostedBrowserVaultReplicaRef(current.browserVaultReplicaRef), replicaRef)) {
    return { ...NOT_READY };
  }
  setStage("goal_counting");
  const allGoals = decoded.shards.core.entities.filter((entity) => entity.family === "goal");
  const goals = allGoals.filter((entity) => entity.status === "active");
  return {
    ready: true,
    totalGoalCount: allGoals.length,
    matchingGoalCount: goals.length,
    matchingGoalIdCount: new Set(goals.filter((entity) =>
      entity.recordClass === "bank" && entity.kind === "goal" && isContractId(entity.id, "goal"))
      .map((entity) => entity.id)).size,
  };
}

function readCanaryCheckpointFingerprint(value: unknown, memberId: string): string | null {
  const ref = parseHostedExecutionSnapshotRef(value, "Canary workspace snapshot ref");
  if (!isHostedWorkspaceSnapshotV2Ref(ref) || ref.userId !== memberId) return null;
  return buildHostedWorkspaceSnapshotV2FingerprintSha256(ref);
}

async function assertCanaryRuntimeAuthority(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<void> {
  await assertActiveHostedMemberAccessAllowed(input);
  // This fixed-account counts observer follows the iMessage runtime's policy.
  // Signup does not create browser launch grants; explicit withdrawal still
  // denies processing. Normal Browser Vault sessions keep their stricter gate.
  const access = await readHostedRuntimeAiAccessDecision(input);
  if (!access.allowed) {
    throw hostedOnboardingError({
      code: access.reason === "health_data_consent_withdrawn"
        ? "HOSTED_CONSENT_REQUIRED" : "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "The production canary runtime is not authorized.",
    });
  }
}

function readSessionRequestFailureDiagnostic(stage: string, error: unknown): {
  sessionRequestFailureReason: "http" | "timeout" | "abort" | "other";
  httpStatus?: number;
} | undefined {
  if (stage !== "session_request") return undefined;
  try {
    if (typeof error === "object" && error !== null) {
      // Preserve the helper's local instance check without reading code/status getters.
      const http = readCloudflareHostedControlHttpError(Object.create(Object.getPrototypeOf(error), {
        code: { value: undefined },
        status: { value: Object.getOwnPropertyDescriptor(error, "status")?.value },
      }));
      if (http) return {
        sessionRequestFailureReason: "http",
        ...(typeof http.status === "number" && Number.isFinite(http.status) ? { httpStatus: http.status } : {}),
      };
      if (typeof DOMException !== "undefined" && error instanceof DOMException) {
        // This native, brand-checked accessor ignores the input's name/code getters.
        const code: unknown = Object.getOwnPropertyDescriptor(DOMException.prototype, "code")?.get?.call(error);
        if (code === DOMException.TIMEOUT_ERR) return { sessionRequestFailureReason: "timeout" };
        if (code === DOMException.ABORT_ERR) return { sessionRequestFailureReason: "abort" };
      }
    }
  } catch {
    // Hostile reflection must not suppress the warning or replace the generic 503.
  }
  return { sessionRequestFailureReason: "other" };
}

function readAuthorityFailureDiagnostic(stage: string, error: unknown): {
  authorityFailureReason: "access_required" | "member_suspended" | "consent_required" | "other";
} | undefined {
  if (stage !== "initial_authority" && stage !== "final_authority") return undefined;
  try {
    if (error instanceof HostedOnboardingError) {
      switch (error.code) {
        case "HOSTED_ACCESS_REQUIRED": return { authorityFailureReason: "access_required" };
        case "HOSTED_MEMBER_SUSPENDED": return { authorityFailureReason: "member_suspended" };
        case "HOSTED_CONSENT_REQUIRED": return { authorityFailureReason: "consent_required" };
      }
    }
  } catch {
    // Hostile prototype/code access must not prevent the warning or generic 503.
  }
  return { authorityFailureReason: "other" };
}
