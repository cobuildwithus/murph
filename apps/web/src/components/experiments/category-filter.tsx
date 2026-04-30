"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";

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
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-full sm:w-52">
        <SelectValue placeholder="All categories" />
      </SelectTrigger>
      <SelectContent>
        {categoryOptions.map((category) => (
          <SelectItem key={category} value={category}>
            {category}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
