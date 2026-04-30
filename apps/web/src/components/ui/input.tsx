import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/src/lib/utils"

const inputVariants = cva(
  "w-full min-w-0 border border-border bg-card text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      size: {
        default: "h-10 rounded-lg px-3 py-2",
        lg: "h-11 rounded-2xl px-4 py-2.5",
        xl: "h-14 rounded-2xl px-5 py-3.5 text-base md:text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function Input({
  className,
  inputSize,
  type,
  ...props
}: React.ComponentProps<"input"> &
  Omit<VariantProps<typeof inputVariants>, "size"> & {
    inputSize?: VariantProps<typeof inputVariants>["size"];
  }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputVariants({ size: inputSize, className }))}
      {...props}
    />
  )
}

export { Input }
