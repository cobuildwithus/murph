import { cn } from "@/src/lib/utils";

export interface SegmentedControlOption<T extends string> {
  label: string;
  value: T;
}

export function SegmentedControl<T extends string>(props: {
  "aria-label": string;
  className?: string;
  itemClassName?: string;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SegmentedControlOption<T>>;
  value: T;
}) {
  const {
    "aria-label": ariaLabel,
    className,
    itemClassName,
    onValueChange,
    options,
    value,
  } = props;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex w-full items-center gap-1 rounded-lg border border-border bg-muted p-1",
        className,
      )}
    >
      {options.map((option) => {
        const selected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "h-8 flex-1 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              selected && "bg-background text-foreground shadow-[0_1px_2px_rgba(26,31,22,0.06)]",
              itemClassName,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
