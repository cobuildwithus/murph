import "server-only";

import { assessBrowserVaultReplicaFreshness } from "@murphai/hosted-execution";
import { parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/parsers";
import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { readHostedBrowserVaultReplicaState } from "../hosted-workspace/store";
import { getPrisma } from "../prisma";
import { assertBrowserVaultMemberAuthority } from "./authority";
import { decodeReadyBrowserVaultSession, parseBrowserVaultSessionResponse } from "./loader";

const HOME_LABS_TIMEOUT_MS = 2_000;

/** One advisory core read. Unknown data must not invite an unnecessary upload. */
export async function readHomeLabBiomarkers(member: { id: string } | null): Promise<boolean | null> {
  if (!member) return false;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loadHomeLabBiomarkers(member.id, controller.signal),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, HOME_LABS_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Replica errors can contain private object locations; expose no raw error.
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function loadHomeLabBiomarkers(memberId: string, signal: AbortSignal) {
  await assertBrowserVaultMemberAuthority({ memberId, prisma: getPrisma() });
  signal.throwIfAborted();
  const workspace = await readHostedBrowserVaultReplicaState({ userId: memberId });
  signal.throwIfAborted();
  const replicaRef = parseHostedBrowserVaultReplicaRef(
    workspace?.browserVaultReplicaRef ?? null,
    "Home lab replica",
  );
  // No published replica is the existing empty-session state for new members.
  if (!replicaRef) return false;
  const control = readHostedExecutionControlClientIfConfigured(HOME_LABS_TIMEOUT_MS);
  if (!control) return null;
  const keys = await generateHostedUserRecipientKeyPair();
  signal.throwIfAborted();
  const response = await control.createBrowserVaultSession({
    browserPublicKeyJwk: keys.publicKeyJwk,
    replicaRef,
    requestedShards: ["core"],
    userId: memberId,
  });
  signal.throwIfAborted();
  const session = parseBrowserVaultSessionResponse({
    ...response,
    freshness: assessBrowserVaultReplicaFreshness({
      now: new Date().toISOString(), replicaRef,
    }).freshness,
    refreshPending: false,
    deviceSyncImportPending: false,
    workspaceVersion: workspace?.version ?? null,
  });
  if (session.state !== "ready") return null;
  const { client } = await decodeReadyBrowserVaultSession({
    session,
    privateKeyJwk: keys.privateKeyJwk,
    expectedMemberId: memberId,
    requestedShards: ["core"],
    signal,
  });
  signal.throwIfAborted();
  return client.replica.hasLabBiomarkers;
}
