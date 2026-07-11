import type { Metadata } from "next";
import {
  HABITAT_DECLINED_VALUE,
  type HabitatIndicatorValue,
} from "@murphai/contracts";

import { PageHeader } from "@/src/components/ui/page-header";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { CategoryDiorama } from "./category-diorama";
import { deriveCategoryNote, overallGrade } from "./category-notes";
import { CategoryShelf } from "./category-shelf";
import { CategoryCard, EnvironmentHero } from "./environment-components";
import { MOCK_HABITAT_VALUES, resolveHabitatScene } from "./home-model";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Environment — Murph",
  description:
    "What Murph knows about your home, and what to check next.",
});

function isKnownValue(value: HabitatIndicatorValue | undefined): boolean {
  return (
    value !== undefined && value !== null && value !== HABITAT_DECLINED_VALUE
  );
}

function contextValue(value: HabitatIndicatorValue | undefined): string {
  if (!isKnownValue(value)) return "Not known";
  return String(value).replaceAll("_", " ");
}

export default function EnvironmentPage() {
  const scene = resolveHabitatScene(MOCK_HABITAT_VALUES);
  const notes = scene.categories.map((category) =>
    deriveCategoryNote(category, MOCK_HABITAT_VALUES),
  );
  const noteByCategoryId = new Map(notes.map((note) => [note.id, note]));
  const homeFacts = [
    MOCK_HABITAT_VALUES["home-location"]?.location,
    MOCK_HABITAT_VALUES["home-location"]?.area_type,
    MOCK_HABITAT_VALUES["allergens-home"]?.pets_at_home,
  ];
  const known =
    notes.reduce((sum, note) => sum + note.known, 0) +
    homeFacts.filter(isKnownValue).length;
  const total =
    notes.reduce((sum, note) => sum + note.total, 0) + homeFacts.length;
  const grade = overallGrade(notes);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
      <PageHeader
        eyebrow="Habitat"
        title="Your environment"
        description="What Murph knows about your home, and what to check next."
      />

      <EnvironmentHero
        grade={grade}
        known={known}
        total={total}
        context={{
          location: contextValue(
            MOCK_HABITAT_VALUES["home-location"]?.location,
          ),
          areaType: contextValue(
            MOCK_HABITAT_VALUES["home-location"]?.area_type,
          ),
          weather: "24°C · Sunny",
          nights: "Quiet",
          outdoorAir: "PM2.5 low",
          pets: contextValue(
            MOCK_HABITAT_VALUES["allergens-home"]?.pets_at_home,
          ),
        }}
      />

      <div className="space-y-6">
        {scene.categories.map((category) => {
          const note = noteByCategoryId.get(category.id);
          return note ? (
            <CategoryCard
              key={category.id}
              category={category}
              note={note}
              visual={
                category.presentation === "vignette" ? (
                  <CategoryDiorama category={category} note={note} />
                ) : (
                  <CategoryShelf category={category} note={note} />
                )
              }
            />
          ) : null;
        })}
      </div>
    </div>
  );
}
