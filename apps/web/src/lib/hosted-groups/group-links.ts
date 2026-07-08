export function buildHostedGroupJoinUrl(input: {
  joinCode: string;
  publicBaseUrl: string | null;
}): string | null {
  if (!input.publicBaseUrl) {
    return null;
  }
  return `${input.publicBaseUrl.replace(/\/+$/u, "")}/groups/join/${encodeURIComponent(input.joinCode)}`;
}
