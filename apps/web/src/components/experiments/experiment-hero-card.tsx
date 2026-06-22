import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/src/components/ui/badge";
import { cn } from "@/src/lib/utils";

type ExperimentCardStatusVariant = "default" | "secondary" | "outline" | "destructive";

interface ExperimentHeroCardProps {
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
  preload?: boolean;
}

const HERO_CARD_IMAGE_SIZES = "(min-width: 768px) 50vw, 100vw";

export function ExperimentHeroCard({
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
  preload = false,
}: ExperimentHeroCardProps) {
  const resolvedHref = href === undefined ? `/experiments/${id}` : href;
  const isInteractive = resolvedHref !== null;
  const cardContent = (
    <>
      <div className="relative h-56 w-full overflow-hidden rounded-t-xl outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10 md:h-64">
        <Image
          src={image}
          alt=""
          fill
          sizes={HERO_CARD_IMAGE_SIZES}
          preload={preload}
          className={cn(
            "object-cover",
            isInteractive ? "transition-transform duration-300 group-hover:scale-[1.03]" : "",
          )}
        />
      </div>
      <div className="flex flex-col gap-2 p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {category}
          </span>
          <div className="flex items-center gap-2">
            {privateBadgeLabel ? (
              <Badge variant="outline" className="text-[11px]">
                {privateBadgeLabel}
              </Badge>
            ) : null}
            {statusLabel ? (
              <Badge variant={statusVariant} className="text-[11px]">
                {statusLabel}
              </Badge>
            ) : null}
            {typeof matchPercent === "number" ? (
              <Badge variant="outline" className="text-[11px] tabular-nums">
                {matchPercent}% match
              </Badge>
            ) : null}
          </div>
        </div>
        <span className="font-serif text-lg font-semibold text-foreground">
          {title}
        </span>
        <span className="text-xs text-muted-foreground">
          {metadata ?? (typeof durationDays === "number" ? `${durationDays} days` : "Protocol")}
        </span>
        {description ? (
          <span className="line-clamp-3 text-sm text-pretty text-muted-foreground">
            {description}
          </span>
        ) : null}
        {!isInteractive ? (
          <span className="text-xs text-muted-foreground/70">
            Private run only
          </span>
        ) : null}
      </div>
    </>
  );
  const cardClassName = cn(
    "group flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card",
    isInteractive ? "" : "cursor-default",
    className,
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

