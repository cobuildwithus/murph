"use client";

import { ToggleGroup, ToggleGroupItem } from "@/src/components/ui/toggle-group";

const categories = [
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
}

export function CategoryFilter({ value, onChange }: CategoryFilterProps) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(v) => {
        if (v.length > 0) onChange(v[0]);
      }}
      className="rounded-full border-0 bg-secondary/20 p-0.5"
    >
      {categories.map((cat) => (
        <ToggleGroupItem
          key={cat}
          value={cat}
          className="px-4 py-1.5 text-sm first:rounded-l-full last:rounded-r-full data-[pressed]:bg-primary data-[pressed]:text-primary-foreground"
        >
          {cat}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
