import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import type { ReactNode } from "react"

import { cn } from "@/src/lib/utils"

function Slider({
  className,
  trackClassName,
  indicatorClassName,
  thumbClassName,
  children,
  defaultValue,
  value,
  min = 0,
  max = 100,
  getAriaLabel,
  getAriaValueText,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  ...props
}: SliderPrimitive.Root.Props & {
  // Track decorations (e.g. discrete tick marks) render inside the Track, above
  // the Indicator fill.
  children?: ReactNode
  trackClassName?: string
  indicatorClassName?: string
  thumbClassName?: string
  getAriaLabel?: SliderPrimitive.Thumb.Props["getAriaLabel"]
  getAriaValueText?: SliderPrimitive.Thumb.Props["getAriaValueText"]
}) {
  // A scalar value/defaultValue is a single-thumb slider; only an array value
  // means a range. The upstream shadcn template fell back to [min, max], which
  // rendered two thumbs for a single number.
  const thumbCount = Array.isArray(value)
    ? value.length
    : Array.isArray(defaultValue)
      ? defaultValue.length
      : 1

  return (
    <SliderPrimitive.Root
      className={cn(
        "data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full",
        className,
      )}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            "relative grow overflow-hidden rounded-full bg-muted select-none data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1",
            trackClassName,
          )}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn(
              "bg-primary select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full",
              indicatorClassName,
            )}
          />
          {children}
        </SliderPrimitive.Track>
        {Array.from({ length: thumbCount }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
            getAriaLabel={getAriaLabel}
            getAriaValueText={getAriaValueText}
            className={cn(
              "relative block size-3 shrink-0 rounded-full border border-ring bg-background ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50",
              thumbClassName,
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
