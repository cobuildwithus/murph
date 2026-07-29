export function buildHostedGroupJoinUrl(input: {
  inviteCode?: string | null;
  joinCode: string;
  publicBaseUrl: string | null;
}): string | null {
  if (!input.publicBaseUrl) {
    return null;
  }
  const joinUrl = `${input.publicBaseUrl.replace(/\/+$/u, "")}/groups/join/${encodeURIComponent(input.joinCode)}`;
  const inviteCode = input.inviteCode?.trim() ?? "";
  return inviteCode
    ? `${joinUrl}?invite=${encodeURIComponent(inviteCode)}`
    : joinUrl;
}
