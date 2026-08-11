import "server-only";

import { createMemberOwnedProviderSetupService } from "./service";
import { listMemberOwnedProviderSetupRegistrations } from "./registry";
import type { MemberOwnedProviderSetupProjectionMap } from "./types";

export async function readMemberOwnedProviderSetupProjections(
  memberId: string,
): Promise<MemberOwnedProviderSetupProjectionMap> {
  const entries = await Promise.all(
    listMemberOwnedProviderSetupRegistrations().map(async (registration) => {
      const provider = registration.coordinates.provider;
      const setup = await createMemberOwnedProviderSetupService(provider).read(
        memberId,
      );
      return [provider, {
        presentation: registration.presentation,
        setup,
      }] as const;
    }),
  );
  return Object.fromEntries(entries) as MemberOwnedProviderSetupProjectionMap;
}
