"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { useIsMobile } from "@/src/hooks/use-mobile";
import { cn } from "@/src/lib/utils";

import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "./drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

interface ResponsiveSelectOption {
  label: string;
  value: string;
}

interface ResponsiveSelectProps {
  ariaLabel: string;
  className?: string;
  onValueChange: (value: string) => void;
  options: ResponsiveSelectOption[];
  placeholder?: string;
  value: string;
}

export function ResponsiveSelect({
  ariaLabel,
  className,
  onValueChange,
  options,
  placeholder,
  value,
}: ResponsiveSelectProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <DrawerSelect
        ariaLabel={ariaLabel}
        className={className}
        onValueChange={onValueChange}
        options={options}
        placeholder={placeholder}
        value={value}
      />
    );
  }

  return (
    <Select value={value} onValueChange={(v) => v && onValueChange(v)}>
      <SelectTrigger aria-label={ariaLabel} size="sm" className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DrawerSelect({
  ariaLabel,
  className,
  onValueChange,
  options,
  placeholder,
  value,
}: ResponsiveSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedLabel =
    options.find((o) => o.value === value)?.label ?? placeholder ?? "";

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          aria-label={`${ariaLabel}: ${selectedLabel}`}
          type="button"
          className={cn(
            "flex w-full items-center justify-between gap-1.5 rounded-lg border border-border bg-card py-2 pr-2 pl-3 text-sm whitespace-nowrap select-none h-12 md:h-8",
            className,
          )}
        >
          <span className="flex-1 text-left truncate">{selectedLabel}</span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerTitle className="sr-only">{ariaLabel}</DrawerTitle>
        <div className="flex flex-col py-3 pb-12">
          {options.map((option) => (
            <button
              aria-pressed={option.value === value}
              key={option.value}
              type="button"
              className={cn(
                "flex items-center gap-3 px-5 py-3.5 text-left text-base transition-colors active:bg-muted",
                option.value === value
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
              onClick={() => {
                onValueChange(option.value);
                setOpen(false);
              }}
            >
              <span className="flex-1">{option.label}</span>
              {option.value === value && (
                <CheckIcon className="size-4 shrink-0 text-foreground" />
              )}
            </button>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
