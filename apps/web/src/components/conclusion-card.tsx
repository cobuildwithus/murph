import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/src/lib/utils";

const conclusionCardVariants = cva("flex flex-col gap-3 rounded-xl border p-6", {
  variants: {
    variant: {
      positive: "border-primary/15 bg-primary/[0.04]",
      neutral: "border-border bg-card",
      insight: "border-border bg-card",
      recommendation: "border-primary/15 bg-primary/[0.06]",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
});

const labelVariants = cva("font-mono text-[10px] uppercase tracking-widest", {
  variants: {
    variant: {
      positive: "text-primary",
      neutral: "text-muted-foreground",
      insight: "text-muted-foreground",
      recommendation: "text-primary",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
});

const iconVariants = cva("shrink-0 text-sm", {
  variants: {
    variant: {
      positive: "text-primary",
      neutral: "text-muted-foreground",
      insight: "text-muted-foreground",
      recommendation: "text-primary",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
});

interface ConclusionItem {
  icon: string;
  text: string;
}

interface ConclusionCardProps extends VariantProps<typeof conclusionCardVariants> {
  title: string;
  items: ConclusionItem[];
  className?: string;
}

export function ConclusionCard({
  title,
  variant = "neutral",
  items,
  className,
}: ConclusionCardProps) {
  return (
    <div className={cn(conclusionCardVariants({ variant }), className)}>
      <span className={labelVariants({ variant })}>{title}</span>
      <div className="flex flex-col gap-2.5">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2.5">
            <span className={iconVariants({ variant })}>{item.icon}</span>
            <span className="text-sm leading-5 text-foreground">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { conclusionCardVariants, labelVariants, iconVariants };
