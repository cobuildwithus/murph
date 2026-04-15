import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/src/lib/utils";

const dotVariants = cva("shrink-0 rounded-full", {
  variants: {
    variant: {
      default: "size-2 bg-ring",
      outline: "size-2.5 border-2 border-ring bg-transparent",
      muted: "size-2 bg-secondary",
      primary: "size-2.5 bg-primary",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface TimelineEntryProps extends VariantProps<typeof dotVariants> {
  date: string;
  label?: string;
  title: string;
  description?: string;
  upcoming?: boolean;
  last?: boolean;
  className?: string;
}

export function TimelineEntry({
  date,
  label,
  title,
  description,
  variant = "default",
  upcoming = false,
  last = false,
  className,
}: TimelineEntryProps) {
  return (
    <div className={cn("flex gap-3", upcoming && "opacity-50", className)}>
      <div className="flex flex-col items-center gap-1">
        <div className={cn("mt-0.5", dotVariants({ variant }))} />
        {!last && <div className="min-h-4 w-px flex-1 bg-border" />}
      </div>
      <div className="flex flex-col gap-0.5 pb-1">
        <span className="text-xs text-muted-foreground">
          {date}
          {label && ` · ${label}`}
        </span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {description && (
          <span className="text-xs leading-4 text-muted-foreground">
            {description}
          </span>
        )}
      </div>
    </div>
  );
}

export { dotVariants };
