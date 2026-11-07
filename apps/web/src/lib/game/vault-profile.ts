import "server-only";

import type { GameProfile } from "@prisma/client";
import { assessBrowserVaultReplicaFreshness } from "@murphai/hosted-execution";
import { parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/parsers";
import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";
import { assertHostedNativeMemberAuthCurrentTx, type HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { decodeReadyBrowserVaultSession, parseBrowserVaultSessionResponse } from "../browser-vault/loader";
import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { readHostedWorkspace } from "../hosted-workspace/store";
import { getPrisma } from "../prisma";
import { parseGameCommand } from "./command";
import { openGameTexts, sealGameText, type GameSealTarget } from "./crypto";
import { moderateGameCommand } from "./moderation";

interface VaultGameProfileOptions {
  timeoutMs: number;
  /** The phone's zone, when the caller has one. Otherwise the vault's. */
  timeZone?: string | null;
}

/** Creates a missing profile from the vault. Callers own its failures. */
export async function adoptVaultGameProfile(
  auth: HostedNativeMemberAuth,
  options: VaultGameProfileOptions,
): Promise<(GameProfile & { firstName: string | null }) | null> {
  const memberId = auth.member.id;
  const candidate = await readVaultGameProfile(memberId, options);
  if (!candidate) return null;
  const target: GameSealTarget = { field: "first_name", memberId, rowId: memberId, table: "game_profile" };
  const firstNameEncrypted = await sealGameText(target, candidate.firstName);
  if (!firstNameEncrypted) return null;
  const adopted = await getPrisma().$transaction(async tx => {
    // Ciphertext I/O and sealing cannot preserve access after session, access or consent loss.
    await assertHostedNativeMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
    // A concurrent app save owns its row. Never upsert over it, even with the same name.
    const created = await tx.gameProfile.createMany({
      data: [{ memberId, firstNameEncrypted, timeZone: candidate.timeZone }], skipDuplicates: true,
    });
    return { profile: await tx.gameProfile.findUnique({ where: { memberId } }), created: created.count > 0 };
  });
  if (!adopted.profile) return null;
  // Reuse the name just sealed; only a raced save needs decryption.
  const [firstName] = adopted.created ? [candidate.firstName]
    : await openGameTexts([{ ...target, value: adopted.profile.firstNameEncrypted }]);
  return { ...adopted.profile, firstName: firstName ?? null };
}

/** Optional onboarding read. Late I/O can never create a profile. */
async function readVaultGameProfile(memberId: string, options: VaultGameProfileOptions) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loadVaultGameProfile(memberId, options.timeZone, controller.signal),
      new Promise<null>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(null); }, options.timeoutMs);
      }),
    ]);
  } catch {
    // Errors can contain private names, ciphertext locations or signed URLs.
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function loadVaultGameProfile(memberId: string, phoneTimeZone: string | null | undefined, signal: AbortSignal) {
  await assertBrowserVaultMemberAuthority({ memberId, prisma: getPrisma() });
  signal.throwIfAborted();
  const workspace = await readHostedWorkspace({ userId: memberId });
  signal.throwIfAborted();
  const replicaRef = parseHostedBrowserVaultReplicaRef(workspace?.browserVaultReplicaRef ?? null, "Game profile replica");
  if (!replicaRef) return null;
  const control = readHostedExecutionControlClientIfConfigured();
  if (!control) return null;
  const keys = await generateHostedUserRecipientKeyPair();
  signal.throwIfAborted();
  const session = parseBrowserVaultSessionResponse({
    ...await control.createBrowserVaultSession({
      browserPublicKeyJwk: keys.publicKeyJwk, replicaRef, requestedShards: ["core"], userId: memberId,
    }),
    freshness: assessBrowserVaultReplicaFreshness({ now: new Date().toISOString(), replicaRef }).freshness,
    refreshPending: false, deviceSyncImportPending: false, workspaceVersion: workspace?.version ?? null,
  });
  signal.throwIfAborted();
  if (session.state !== "ready") return null;
  const { client } = await decodeReadyBrowserVaultSession({
    session, privateKeyJwk: keys.privateKeyJwk, expectedMemberId: memberId, requestedShards: ["core"], signal,
  });
  signal.throwIfAborted();
  const firstName = client.replica.displayName;
  const timeZone = phoneTimeZone ?? client.replica.meals?.timeZone;
  if (!firstName || /\s/u.test(firstName) || !timeZone) return null;
  const command = parseGameCommand({ type: "setProfile", firstName, timeZone });
  moderateGameCommand(command);
  return command.type === "setProfile" && command.firstName && command.timeZone
    ? { firstName: command.firstName, timeZone: command.timeZone } : null;
}
