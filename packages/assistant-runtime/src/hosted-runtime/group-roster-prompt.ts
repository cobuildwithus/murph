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

export async function buildHostedBackgroundGroupRosterPrompt(input: {
  groupToolPort: HostedRuntimeGroupToolPort | null | undefined;
  signal?: AbortSignal | null;
}): Promise<string | null> {
  if (!input.groupToolPort || input.signal?.aborted) {
    return null;
  }

  const response = await readHostedBackgroundGroupAuthority({
    groupToolPort: input.groupToolPort,
    signal: input.signal ?? null,
  });
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

async function readHostedBackgroundGroupAuthority(input: {
  groupToolPort: HostedRuntimeGroupToolPort;
  signal: AbortSignal | null;
}): Promise<HostedBackgroundGroupAuthorityResponse | null> {
  let abortListener: (() => void) | null = null;
  const aborted = input.signal
    ? new Promise<null>((resolve) => {
        abortListener = () => resolve(null);
        input.signal?.addEventListener("abort", abortListener, { once: true });
      })
    : null;
  if (input.signal?.aborted) {
    if (abortListener) {
      input.signal.removeEventListener("abort", abortListener);
    }
    return null;
  }

  const request = input.groupToolPort.request({ action: "read_share_authority" }).then(
    (response): HostedBackgroundGroupAuthorityResponse => response,
    (): null => null,
  );

  try {
    return aborted ? await Promise.race([request, aborted]) : await request;
  } finally {
    if (abortListener) {
      input.signal?.removeEventListener("abort", abortListener);
    }
  }
}
