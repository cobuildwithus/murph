import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/src/components/ui/badge";
import { cn } from "@/src/lib/utils";

type ExperimentCardStatusVariant =
  | "default"
  | "secondary"
  | "outline"
  | "destructive";

interface ExperimentBrowseCardProps {
  id: string;
  title: string;
  category: string;
  image: string;
  href?: string | null;
  privateBadgeLabel?: string;
  matchPercent?: number;
  durationDays?: number;
  metadata?: string;
  statusLabel?: string;
  statusVariant?: ExperimentCardStatusVariant;
  description?: string;
  className?: string;
  imageSizes?: string;
}

const BROWSE_CARD_IMAGE_SIZES =
  "(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

export function ExperimentBrowseCard({
  id,
  title,
  category,
  image,
  href,
  privateBadgeLabel,
  matchPercent,
  durationDays,
  metadata,
  statusLabel,
  statusVariant = "secondary",
  description,
  className,
  imageSizes = BROWSE_CARD_IMAGE_SIZES,
}: ExperimentBrowseCardProps) {
  const resolvedHref = href === undefined ? `/experiments/${id}` : href;
  const isInteractive = resolvedHref !== null;
  const cardContent = (
    <>
      <div className="relative h-40 w-full overflow-hidden rounded-xl outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10">
        <Image
          src={image}
          alt=""
          fill
          sizes={imageSizes}
          className={cn(
            "object-cover",
            isInteractive
              ? "transition-transform duration-300 group-hover:scale-[1.03]"
              : ""
          )}
        />
      </div>
      <div className="flex flex-col gap-1.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            {category}
          </span>
          <div className="flex items-center gap-1.5">
            {privateBadgeLabel ? (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                {privateBadgeLabel}
              </Badge>
            ) : null}
            {statusLabel ? (
              <Badge variant={statusVariant} className="h-4 px-1.5 text-[10px]">
                {statusLabel}
              </Badge>
            ) : null}
            {typeof matchPercent === "number" ? (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {matchPercent}%
              </span>
            ) : null}
          </div>
        </div>
        <span className="font-serif text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="text-xs text-muted-foreground">
          {metadata ?? (typeof durationDays === "number" ? `${durationDays} days` : "Protocol")}
        </span>
        {description ? (
          <span className="line-clamp-2 text-xs text-pretty text-muted-foreground/80">
            {description}
          </span>
        ) : null}
        {!isInteractive ? (
          <span className="text-[11px] text-muted-foreground/70">
            Private run only
          </span>
        ) : null}
      </div>
    </>
  );
  const cardClassName = cn(
    "group flex flex-col overflow-hidden",
    isInteractive ? "" : "cursor-default",
    className
  );

  if (resolvedHref === null) {
    return <article className={cardClassName}>{cardContent}</article>;
  }

  return (
    <Link href={resolvedHref} className={cardClassName}>
      {cardContent}
    </Link>
  );
}

