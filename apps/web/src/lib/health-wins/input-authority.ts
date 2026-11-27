import { assertHostedNativeMemberAuthCurrentForRead, type HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { getPrisma } from "../prisma";

export async function withInputAuthority<T>(checkAuthority: () => Promise<void>, load: () => Promise<T>): Promise<T> {
  await checkAuthority();
  try {
    return await load();
  } finally {
    // Authority loss always wins, including after a timeout or a failed independent input.
    await checkAuthority();
  }
}

export function assertPrivateHealthAuthority(auth: HostedNativeMemberAuth) {
  return getPrisma().$transaction(async tx => {
    await assertHostedNativeMemberAuthCurrentForRead(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: tx });
  });
}
