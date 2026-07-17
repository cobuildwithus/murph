"use client";

import { ResponsiveSelect } from "@/src/components/ui/responsive-select";

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
    <ResponsiveSelect
      ariaLabel="Experiment category"
      value={value}
      onValueChange={onChange}
      placeholder="All categories"
      options={categoryOptions.map((category) => ({
        label: category,
        value: category,
      }))}
      className="w-full sm:w-52"
    />
  );
}
