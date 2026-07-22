import type { Metadata } from "next";
import { Printer } from "lucide-react";
import {
  HABITAT_DECLINED_VALUE,
  type HabitatIndicatorValue,
} from "@murphai/contracts";

import { PageHeader } from "@/src/components/ui/page-header";
import { MURPH_TELEGRAM_URL } from "@/src/lib/murph-contact-routing";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { deriveCategoryNote, overallGrade } from "./category-notes";
import {
  CategoryCard,
  EnvironmentHero,
  NextChecksStrip,
  ShareEnvironmentButton,
  type NextCheckItem,
} from "./environment-components";
import {
  INDICATOR_SPRITES,
  MOCK_HABITAT_VALUES,
  resolveEnvironmentCoverage,
  resolveHabitatScene,
} from "./home-model";

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function buildNextChecks(
  scene: ReturnType<typeof resolveHabitatScene>,
  notes: ReturnType<typeof deriveCategoryNote>[],
): NextCheckItem[] {
  const spriteFor = (categoryId: string, indicatorId: string) =>
    scene.categories
      .find((category) => category.id === categoryId)
      ?.objects.find(
        (object) =>
          object.indicatorId === indicatorId && object.sprite && !object.decor,
      )?.sprite ?? INDICATOR_SPRITES[indicatorId];

  const unmet = notes
    .flatMap((note) =>
      note.rows
        .filter((row) => row.met === false)
        .map((row) => ({
          priority: PRIORITY_ORDER[row.priority],
          item: {
            fact: {
              indicatorId: row.indicatorId,
              label: row.label,
              kind: "unmet",
              value: row.value,
              target: row.target,
              detail: row.detail,
            },
            sprite: spriteFor(note.id, row.indicatorId),
            categoryTitle: note.title,
          } satisfies NextCheckItem,
        })),
    )
    .sort((a, b) => a.priority - b.priority)
    .map(({ item }) => item);

  const unknown = notes.flatMap((note) =>
    note.unknownFacts.map(
      (fact): NextCheckItem => ({
        fact: {
          indicatorId: fact.indicatorId,
          label: fact.label,
          kind: "unknown",
          value: null,
          target: null,
          detail: null,
        },
        sprite: spriteFor(note.id, fact.indicatorId),
        categoryTitle: note.title,
      }),
    ),
  );

  // Larger pool than the 3 visible cards so client-side dismissals backfill.
  return [...unmet.slice(0, 6), ...unknown.slice(0, 4)];
}

const ENVIRONMENT_OPEN_GRAPH_IMAGE = {
  alt: "My environment grade — Murph",
  height: 630,
  type: "image/png",
  url: "/environment/opengraph-image",
  width: 1200,
} as const;

export const metadata: Metadata = createMurphPageMetadata({
  title: "Environment — Murph",
  description:
    "What Murph knows about your home, and what to check next.",
  openGraph: { images: [ENVIRONMENT_OPEN_GRAPH_IMAGE] },
  twitter: { images: [ENVIRONMENT_OPEN_GRAPH_IMAGE] },
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
  const { known, total } = resolveEnvironmentCoverage(
    scene,
    MOCK_HABITAT_VALUES,
  );
  const grade = overallGrade(notes);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          eyebrow="Habitat"
          title="Your environment"
          description="What Murph knows about your home, and what to check next."
        />
        <div className="flex shrink-0 items-center gap-5 pb-1">
          <ShareEnvironmentButton />
          <a
            href="/environment/print"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Printer className="size-3.5" aria-hidden="true" />
            Print report
          </a>
        </div>
      </div>

      <EnvironmentHero
        grade={grade}
        known={known}
        total={total}
        notes={notes}
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
        }}
      />

      <NextChecksStrip
        items={buildNextChecks(scene, notes)}
        chatHref={MURPH_TELEGRAM_URL}
      />

      <div className="space-y-6">
        {scene.categories.map((category) => {
          const note = noteByCategoryId.get(category.id);
          return note ? (
            <CategoryCard
              key={category.id}
              category={category}
              note={note}
              chatHref={MURPH_TELEGRAM_URL}
            />
          ) : null;
        })}
      </div>
    </div>
  );
}
