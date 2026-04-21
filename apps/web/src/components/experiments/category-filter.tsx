"use client";

import { ToggleGroup, ToggleGroupItem } from "@/src/components/ui/toggle-group";

const DEFAULT_CATEGORIES = [
  "All",
  "Recovery",
  "Sleep",
  "Nutrition",
  "Exercise",
  "Breathwork",
  "Supplements",
] as const;

interface CategoryFilterProps {
  value: string;
  onChange: (value: string) => void;
  categories?: readonly string[];
}

export function CategoryFilter({ value, onChange, categories }: CategoryFilterProps) {
  const categoryOptions = categories && categories.length > 0
    ? ["All", ...categories.filter((category) => category !== "All")]
    : DEFAULT_CATEGORIES;

  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(nextValue) => {
        if (nextValue.length > 0) onChange(nextValue[0]);
      }}
      className="w-full justify-start overflow-x-auto rounded-2xl border-0 bg-secondary/20 p-0.5 sm:w-auto"
    >
      {categoryOptions.map((category) => (
        <ToggleGroupItem
          key={category}
          value={category}
          className="px-4 py-1.5 text-sm whitespace-nowrap first:rounded-l-full last:rounded-r-full data-[pressed]:bg-primary data-[pressed]:text-primary-foreground"
        >
          {category}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
