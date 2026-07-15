"use client";

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
  badge?: React.ReactNode;
  className?: string;
  description: React.ReactNode;
  id: string;
  meta?: React.ReactNode;
  title: React.ReactNode;
};

function ChoiceCard({
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
        "h-full cursor-pointer rounded-xl border-border bg-card p-0 transition-[border-color,background-color] duration-200 ease-out hover:border-primary/35 hover:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-data-checked:border-primary/50 has-data-checked:bg-primary/10 has-data-checked:ring-1 has-data-checked:ring-primary/15 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-55 data-[disabled=true]:hover:border-border data-[disabled=true]:hover:bg-card",
        className,
      )}
      data-disabled={disabled ? "true" : undefined}
      htmlFor={id}
    >
      <Field
        className="h-full items-start gap-3 p-4 sm:p-5"
        data-disabled={disabled ? "true" : undefined}
        orientation="horizontal"
      >
        <RadioGroupItem
          aria-describedby={[descriptionId, metaId].filter(Boolean).join(" ")}
          aria-labelledby={titleId}
          disabled={disabled}
          id={id}
          {...props}
        />
        <FieldContent className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldTitle
              id={titleId}
              className="text-base font-semibold text-foreground"
            >
              {title}
            </FieldTitle>
            {badge}
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
