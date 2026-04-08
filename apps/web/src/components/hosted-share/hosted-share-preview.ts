import type { HostedSharePreview } from "@/src/lib/hosted-share/service";

export function formatHostedSharePreviewSummary(preview: HostedSharePreview): string {
  return [
    preview.counts.foods ? formatHostedSharePreviewCount(preview.counts.foods, "food") : null,
    preview.counts.protocols ? formatHostedSharePreviewCount(preview.counts.protocols, "protocol") : null,
    preview.counts.recipes ? formatHostedSharePreviewCount(preview.counts.recipes, "recipe") : null,
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

export function describeHostedSharePreview(preview: HostedSharePreview): string {
  if (preview.kinds.length === 0) {
    return "Shared bundle";
  }

  if (preview.kinds.length === 1) {
    return `Shared ${preview.kinds[0]} bundle`;
  }

  return "Shared bundle";
}

function formatHostedSharePreviewCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
