import "server-only";

import {
  assessBrowserVaultReplicaFreshness,
} from "@murphai/hosted-execution";
import {
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";

import { readHostedBrowserVaultReplicaState } from "@/src/lib/hosted-workspace/store";
import { getPrisma } from "@/src/lib/prisma";

import { assertBrowserVaultMemberAuthority } from "./authority";

export async function prepareHomepageBrowserVaultBestEffort(input: {
  memberId: string;
}): Promise<void> {
  const prisma = getPrisma();
  await assertBrowserVaultMemberAuthority({
    memberId: input.memberId,
    prisma,
  });

  const workspace = await readHostedBrowserVaultReplicaState({
    prisma,
    userId: input.memberId,
  });
  const replicaRef = readHomepageBrowserVaultReplicaRef(
    workspace?.browserVaultReplicaRef ?? null,
  );
  const freshness = assessBrowserVaultReplicaFreshness({
    now: new Date(),
    replicaRef,
  });

  if (!freshness.shouldRefresh) {
    return;
  }

  const { signalHostedBrowserVaultRefreshRuntime } = await import(
    "@/src/lib/hosted-orchestration/signal-runtime"
  );
  await signalHostedBrowserVaultRefreshRuntime({
    prisma,
    userId: input.memberId,
  });
}

function readHomepageBrowserVaultReplicaRef(value: unknown) {
  try {
    return parseHostedBrowserVaultReplicaRef(
      value,
      "Homepage browser-vault preparation workspace replica ref",
    );
  } catch {
    return null;
  }
}
