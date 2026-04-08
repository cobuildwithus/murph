import type { HostedSharePageData } from "@/src/lib/hosted-share/service";

export function buildHostedShareStatusUrl(shareCode: string, inviteCode?: string | null): string {
  const basePath = `/api/hosted-share/${encodeURIComponent(shareCode)}/status`;

  if (!inviteCode) {
    return basePath;
  }

  return `${basePath}?invite=${encodeURIComponent(inviteCode)}`;
}

export function resolveShareLinkTitle(data: HostedSharePageData): string {
  switch (data.stage) {
    case "invalid":
      return "That share link is not valid";
    case "expired":
      return "That share link expired";
    case "signin":
      return "Import a shared bundle";
    case "processing":
      return "Import in progress";
    case "consumed":
      return "Bundle already imported";
    case "ready":
    default:
      return "Add this bundle to your vault";
  }
}

export function resolveShareLinkSubtitle(data: HostedSharePageData): string {
  switch (data.stage) {
    case "invalid":
      return "Ask for a fresh Murph share link.";
    case "expired":
      return "Ask for a fresh Murph share link.";
    case "signin":
      return data.inviteCode
        ? "This link keeps the shared bundle attached while you finish hosted setup."
        : "Finish hosted setup on this device, then return here to import the bundle.";
    case "processing":
      return "The shared bundle has been queued for import into your hosted vault.";
    case "consumed":
      return "This one-time bundle has already been added.";
    case "ready":
    default:
      return "This copies the shared bundle into your own hosted vault.";
  }
}
