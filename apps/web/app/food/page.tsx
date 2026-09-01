import type { Metadata } from "next";

import { FoodLabelLab } from "@/src/components/food-label-lab/food-label-lab";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

const FOOD_DESCRIPTION =
  "Compare branded foods by nutrition, exact product tests, and known evidence gaps.";

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    alternates: { canonical: "/food" },
    description: FOOD_DESCRIPTION,
    openGraph: { type: "website" },
    title: "Food comparison | Murph",
  }),
  referrer: "no-referrer",
  robots: { follow: true, index: true },
};

export default function FoodPage() {
  return <FoodLabelLab />;
}
