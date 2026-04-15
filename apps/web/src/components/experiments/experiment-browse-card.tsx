import Image from "next/image";
import Link from "next/link";
import { cn } from "@/src/lib/utils";

interface ExperimentBrowseCardProps {
  id: string;
  title: string;
  category: string;
  image: string;
  matchPercent?: number;
  durationDays: number;
  studyCount: number;
  className?: string;
}

export function ExperimentBrowseCard({
  id,
  title,
  category,
  image,
  matchPercent,
  durationDays,
  studyCount,
  className,
}: ExperimentBrowseCardProps) {
  return (
    <Link
      href={`/experiments/${id}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl",
        className
      )}
    >
      <div className="relative h-40 w-full overflow-hidden rounded-xl outline-1 -outline-offset-1 outline-black/5">
        <Image
          src={image}
          alt=""
          fill
          className="object-cover"
        />
      </div>
      <div className="flex flex-col gap-1.5 pt-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            {category}
          </span>
          {matchPercent && (
            <span className="text-[11px] text-muted-foreground">
              {matchPercent}%
            </span>
          )}
        </div>
        <span className="font-serif text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="text-xs text-muted-foreground">
          {durationDays} days · {studyCount} studies
        </span>
      </div>
    </Link>
  );
}
