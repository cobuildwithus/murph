"use client";

import { CheckIcon } from "lucide-react";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/src/components/ui/field";
import { RadioGroupItem } from "@/src/components/ui/radio-group";
import { cn } from "@/src/lib/utils";

type ChoiceCardProps = Omit<
  React.ComponentProps<typeof RadioGroupItem>,
  "aria-describedby" | "aria-labelledby" | "id" | "title"
> & {
  artwork?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
  description: React.ReactNode;
  id: string;
  meta?: React.ReactNode;
  title: React.ReactNode;
};

function ChoiceCard({
  artwork,
  badge,
  className,
  description,
  disabled,
  id,
  meta,
  title,
  ...props
}: ChoiceCardProps) {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const metaId = meta ? `${id}-meta` : null;

  return (
    <FieldLabel
      className={cn(
        "group/choice-card relative isolate h-full cursor-pointer overflow-hidden rounded-xl border-border bg-card p-0 transition-[border-color,background-color] duration-200 ease-out hover:border-primary/35 hover:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-data-checked:border-primary/50 has-data-checked:bg-primary/10 has-data-checked:ring-1 has-data-checked:ring-primary/15 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:hover:border-border data-[disabled=true]:hover:bg-card",
        artwork && "min-h-44",
        className,
      )}
      data-disabled={disabled ? "true" : undefined}
      htmlFor={id}
    >
      {artwork ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-0 w-3/4"
        >
          {artwork}
        </span>
      ) : null}
      <Field
        className="relative z-10 h-full gap-3 p-4 sm:p-5"
      >
        <RadioGroupItem
          aria-describedby={[descriptionId, metaId].filter(Boolean).join(" ")}
          aria-labelledby={titleId}
          disabled={disabled}
          id={id}
          className="sr-only"
          {...props}
        />
        <FieldContent className={cn("gap-2", disabled && "opacity-55")}>
          <div className="flex items-start justify-between gap-3">
            <FieldTitle
              id={titleId}
              className="text-base font-semibold text-foreground"
            >
              {title}
            </FieldTitle>
            <div className="flex shrink-0 items-center gap-2">
              {badge}
              <span
                aria-hidden="true"
                className="flex size-5 items-center justify-center rounded-full border border-border text-transparent transition-colors group-has-data-checked/choice-card:border-primary group-has-data-checked/choice-card:bg-primary group-has-data-checked/choice-card:text-primary-foreground"
              >
                <CheckIcon className="size-3" strokeWidth={2.4} />
              </span>
            </div>
          </div>
          <FieldDescription id={descriptionId} className="text-pretty">
            {description}
          </FieldDescription>
          {meta ? (
            <div
              id={metaId ?? undefined}
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
            >
              {meta}
            </div>
          ) : null}
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}

export { ChoiceCard };
export type { ChoiceCardProps };
