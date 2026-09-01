import Image from "next/image";

import { getComparisonLogoAsset } from "@/src/lib/comparisons/logo-assets";
import { cn } from "@/src/lib/utils";

// These official marks are supplied as white or very light artwork. Give them
// a dark paper surface instead of recoloring the brand asset.
const LIGHT_MARK_LOGO_SLUGS = new Set([
  "calm",
  "eight-sleep",
  "humanity",
  "juggernautai",
  "ladder",
  "mito-health",
  "parsley-health",
]);

export function ComparisonLogo({
  className,
  decorative = false,
  imageClassName,
  name,
  priority = false,
  slug,
}: {
  className?: string;
  decorative?: boolean;
  imageClassName?: string;
  name: string;
  priority?: boolean;
  slug: string;
}) {
  const asset = getComparisonLogoAsset(slug);
  const useDarkSurface = asset && LIGHT_MARK_LOGO_SLUGS.has(slug);

  return (
    <span
      className={cn(
        "flex min-h-0 min-w-0 items-center justify-center overflow-hidden",
        className,
        useDarkSurface ? "bg-[#2a2520]" : "bg-[#f5f0e8]",
      )}
      data-comparison-logo={slug}
    >
      {asset ? (
        <Image
          alt={decorative ? "" : asset.alt}
          className={cn(
            "h-auto w-auto max-h-full max-w-full object-contain",
            imageClassName,
          )}
          height={Math.max(1, Math.round(asset.height ?? 96))}
          priority={priority}
          src={asset.path}
          width={Math.max(1, Math.round(asset.width ?? 96))}
        />
      ) : (
        <span className="text-center text-sm font-semibold leading-tight text-current">
          {name}
        </span>
      )}
    </span>
  );
}
