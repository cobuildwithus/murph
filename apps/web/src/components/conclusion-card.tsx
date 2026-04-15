import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/src/lib/utils";

const conclusionCardVariants = cva(
  "flex flex-col gap-3 rounded-xl border p-6",
  {
    variants: {
      variant: {
        positive: "border-primary/12 bg-primary/4",
        neutral: "border-secondary/25 bg-card/90",
        insight: "border-secondary/25 bg-card/90",
        recommendation: "border-primary/12 bg-primary/6",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

const accentVariants = cva("", {
  variants: {
    variant: {
      positive: "text-ring",
      neutral: "text-muted-foreground/70",
      insight: "text-muted-foreground/70",
      recommendation: "text-ring",
    },
  },
  defaultVariants: { variant: "neutral" },
});

interface ConclusionCardProps
  extends VariantProps<typeof conclusionCardVariants> {
  title: string;
  items: { icon: string; text: string }[];
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
      <span
        className={cn(
          "font-mono text-[10px]/3 uppercase tracking-widest",
          accentVariants({ variant })
        )}
      >
        {title}
      </span>
      <div className="flex flex-col gap-2.5">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2.5">
            <span
              className={cn("shrink-0 text-[13px]/4", accentVariants({ variant }))}
            >
              {item.icon}
            </span>
            <span className="text-[13px]/5 text-foreground">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { conclusionCardVariants };
