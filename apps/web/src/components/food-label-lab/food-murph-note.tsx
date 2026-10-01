"use client";

import type { PublicProductDetail } from "@murphai/contracts";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { CheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { Fragment, type ReactElement, type ReactNode } from "react";

import { MurphGradeBadge } from "@/src/components/murph-grade-badge";
import { cn } from "@/src/lib/utils";

import { getFoodMurphNote, type FoodMurphGrade } from "./food-product-review";

const MURPH_GRADE_SCALE: readonly (readonly [FoodMurphGrade | "?", string])[] =
  [
    ["A", "No concerns. Strong protein or a lab result below its limit."],
    ["B", "No concerns found."],
    ["C", "Added sweetener or sugar substitute."],
    ["D", "High in fat, saturated fat, sugar, or sodium."],
    ["E", "Over a health limit, or a higher-concern ingredient."],
    ["?", "Not enough label data."],
  ];

export function FoodMurphGradeButton(input: {
  onOpen: () => void;
  product: PublicProductDetail;
}) {
  const note = getFoodMurphNote(input.product);
  const label = getFoodMurphGradeLabel(note.grade);

  return (
    <MurphGradeScaleTooltip
      align="start"
      trigger={
        <button
          type="button"
          data-food-murph-grade={input.product.productRef}
          aria-label={`${label}. Open product details.`}
          onClick={input.onOpen}
          className="flex min-h-12 w-full items-center px-4 py-3.5 text-left outline-none hover:bg-muted/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        />
      }
    >
      <MurphGradeBadge
        emptyGlyph="?"
        label={label}
        letter={note.grade}
        size="xs"
      />
    </MurphGradeScaleTooltip>
  );
}

export function FoodMurphNoteSummary(input: { product: PublicProductDetail }) {
  const note = getFoodMurphNote(input.product);
  const label = getFoodMurphGradeLabel(note.grade);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Summary</h3>
        <MurphGradeScaleTooltip
          align="end"
          trigger={
            <span
              tabIndex={0}
              className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <MurphGradeBadge
            emptyGlyph="?"
            label={label}
            letter={note.grade}
            size="sm"
          />
        </MurphGradeScaleTooltip>
      </div>
      <ul data-food-murph-summary className="mt-2.5 space-y-2">
        {note.reasons.map((reason) => {
          const Icon =
            reason.tone === "caution"
              ? TriangleAlertIcon
              : reason.tone === "positive"
              ? CheckIcon
              : InfoIcon;
          return (
            <li
              key={reason.id}
              className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2.5 text-base/7 text-foreground sm:text-sm/6"
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  "mt-1 size-4",
                  reason.tone === "caution"
                    ? "text-[#a5642a]"
                    : reason.tone === "positive"
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              />
              <span>{reason.text}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function MurphGradeScaleTooltip(input: {
  align: "start" | "end";
  children: ReactNode;
  trigger: ReactElement;
}) {
  return (
    <TooltipPrimitive.Provider delay={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger render={input.trigger}>
          {input.children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner
            side="top"
            align={input.align}
            sideOffset={8}
            className="isolate z-50"
          >
            <TooltipPrimitive.Popup
              data-food-murph-grade-scale
              className="w-72 origin-(--transform-origin) rounded-xl border border-border bg-popover p-4 shadow-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
            >
              <p className="text-sm font-semibold text-foreground">
                Murph grade
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                A quick read of the label and linked lab tests.
              </p>
              <dl className="mt-3 grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                {MURPH_GRADE_SCALE.map(([grade, meaning]) => (
                  <Fragment key={grade}>
                    <dt>
                      <MurphGradeBadge
                        emptyGlyph="?"
                        label={grade === "?" ? "No grade" : `Grade ${grade}`}
                        letter={grade === "?" ? null : grade}
                        size="xs"
                      />
                    </dt>
                    <dd className="text-xs text-foreground">{meaning}</dd>
                  </Fragment>
                ))}
              </dl>
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

function getFoodMurphGradeLabel(grade: FoodMurphGrade | null): string {
  return grade ? `Murph grade ${grade}` : "Murph grade unavailable";
}
