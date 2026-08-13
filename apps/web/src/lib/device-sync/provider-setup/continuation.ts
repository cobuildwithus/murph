import "server-only";

import { createHash } from "node:crypto";

import {
  assertHostedProviderSetupContinuationAllowedRuntime,
  signalHostedProviderSetupContinuationRuntime,
} from "../../hosted-orchestration/signal-runtime";
import { getPrisma } from "../../prisma";

export type MemberOwnedProviderSetupContinuationInput = {
  memberId: string;
} & (
  | {
      handoffId: null;
      provider: string;
      runId: null;
      setupId: string;
      setupVersion: number;
    }
  | {
      handoffId: string;
      runId: string;
      setupId: string;
    }
);

export async function requestMemberOwnedProviderSetupContinuation(
  input: MemberOwnedProviderSetupContinuationInput,
): Promise<void> {
  const providerSetup = "provider" in input
    ? {
        handoffId: null,
        provider: input.provider,
        runId: null,
        setupId: input.setupId,
        setupVersion: input.setupVersion,
      }
    : await resolveHandoffProviderSetupContinuation(input);
  const eventId = buildMemberOwnedProviderSetupContinuationEventId({
    memberId: input.memberId,
    providerSetup,
  });
  await signalHostedProviderSetupContinuationRuntime({
    eventId,
    providerSetup,
    userId: input.memberId,
  });
}

export async function assertMemberOwnedProviderSetupContinuationAllowed(
  memberId: string,
): Promise<void> {
  await assertHostedProviderSetupContinuationAllowedRuntime({ userId: memberId });
}

export function buildMemberOwnedProviderSetupContinuationEventId(input: {
  memberId: string;
  providerSetup: {
    handoffId: string | null;
    provider: string;
    runId: string | null;
    setupId: string;
    setupVersion: number;
  };
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      memberId: input.memberId,
      providerSetup: input.providerSetup,
    }), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `runtime-control:provider-setup-continuation:${digest}`;
}

async function resolveHandoffProviderSetupContinuation(input: {
  handoffId: string;
  memberId: string;
  runId: string;
  setupId: string;
}) {
  const setup = await getPrisma().deviceProviderSetup.findFirst({
    select: {
      provider: true,
      version: true,
    },
    where: {
      active: true,
      id: input.setupId,
      memberId: input.memberId,
    },
  });
  if (!setup) {
    throw new Error("Member-owned provider setup continuation is unavailable.");
  }
  return {
    handoffId: input.handoffId,
    provider: setup.provider,
    runId: input.runId,
    setupId: input.setupId,
    setupVersion: setup.version,
  };
}
