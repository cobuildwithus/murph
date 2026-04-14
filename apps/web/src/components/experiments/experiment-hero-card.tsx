import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/src/components/ui/badge";
import { cn } from "@/src/lib/utils";

interface ExperimentHeroCardProps {
  id: string;
  title: string;
  category: string;
  image: string;
  matchPercent?: number;
  durationDays: number;
  studyCount: number;
  className?: string;
}

export function ExperimentHeroCard({
  id,
  title,
  category,
  image,
  matchPercent,
  durationDays,
  studyCount,
  className,
}: ExperimentHeroCardProps) {
  return (
    <Link
      href={`/experiments/${id}`}
      className={cn(
        "group flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card",
        className
      )}
    >
      <div className="relative h-56 w-full overflow-hidden rounded-t-xl outline-1 -outline-offset-1 outline-black/5 md:h-64">
        <Image
          src={image}
          alt=""
          fill
          className="object-cover"
        />
      </div>
      <div className="flex flex-col gap-2 p-5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {category}
          </span>
          {matchPercent && (
            <Badge variant="outline" className="text-[11px]">
              {matchPercent}% match
            </Badge>
          )}
        </div>
        <span className="font-serif text-lg font-semibold text-foreground">
          {title}
        </span>
        <span className="text-xs text-muted-foreground">
          {durationDays} days · {studyCount} studies
        </span>
      </div>
    </Link>
  );
}
