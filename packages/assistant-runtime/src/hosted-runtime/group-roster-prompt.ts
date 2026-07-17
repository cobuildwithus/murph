import type {
  HostedRuntimeGroupToolPort,
} from "./platform.ts";

interface HostedBackgroundGroupMemberGrantRow {
  grantedProjectionScopeKeys: string[];
  memberId: string;
}

type HostedBackgroundGroupAuthorityResponse = Awaited<
  ReturnType<HostedRuntimeGroupToolPort["request"]>
>;

/**
 * Pure formatter over the pass-local share-authority snapshot owned by the
 * workspace phase. It performs no network or filesystem work, so the roster
 * always renders the same snapshot that filtered the landed shared store.
 */
export function buildHostedBackgroundGroupRosterPrompt(input: {
  authority: HostedBackgroundGroupAuthorityResponse | null;
}): string | null {
  const response = input.authority;
  if (
    !response
    || response.action !== "read_share_authority"
    || response.result.status !== "ok"
    || response.result.memberIds.length === 0
  ) {
    return null;
  }

  const scopeKeysByMemberId = new Map(
    response.result.memberIds.map((memberId) => [memberId, new Set<string>()]),
  );
  for (const share of response.result.shares) {
    scopeKeysByMemberId.get(share.memberId)?.add(share.projectionScopeKey);
  }
  const members = [...scopeKeysByMemberId]
    .map(([memberId, projectionScopeKeys]): HostedBackgroundGroupMemberGrantRow => ({
      grantedProjectionScopeKeys: [...projectionScopeKeys].sort(),
      memberId,
    }))
    .sort((left, right) => left.memberId.localeCompare(right.memberId));

  return [
    "Current group membership and grants for this scheduled turn:",
    "The rows below are the authoritative current group membership and grant snapshot. A grant is permission to share; it is not proof that matching data has arrived.",
    JSON.stringify(members, null, 2),
    "",
    "Use this read-only context when handling group challenges:",
    "- Join shared vault data to these members by `memberId`, but do not quote opaque member IDs in user-facing messages.",
    "- Treat only `grantedProjectionScopeKeys` as grant authority. Selector projection kinds are never broad grants.",
    "- For challenge logic, count only participants recorded as `in` on the challenge page. Do not infer challenge participation from group membership or grants.",
    "- Do not call `murph.group post_join_offer` or attempt any other mutating group action during this scheduled turn.",
  ].join("\n");
}
