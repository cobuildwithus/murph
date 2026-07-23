"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { HABITAT_DECLINED_VALUE } from "@murphai/contracts";
import {
  ArrowRight,
  BedDouble,
  BriefcaseBusiness,
  House,
  Lightbulb,
  MessageCircle,
  ShieldCheck,
  Wind,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { PageHeader } from "@/src/components/ui/page-header";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import { deriveCategoryNote, overallGrade } from "./category-notes";
import {
  CategoryCard,
  EnvironmentHero,
  NextChecksStrip,
  ShareEnvironmentButton,
  type NextCheckItem,
} from "./environment-components";
import { EnvironmentVoiceCapture } from "./environment-voice-capture";
import { selectEnvironmentHabitatValues } from "./habitat-values";
import {
  INDICATOR_SPRITES,
  type HabitatValues,
  resolveEnvironmentCoverage,
  resolveHabitatScene,
} from "./home-model";

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

const EMPTY_STATE_BENEFITS = [
  {
    icon: BedDouble,
    title: "Sleep conditions",
    text: "Temperature, darkness, noise, air and what changes through the night.",
  },
  {
    icon: Wind,
    title: "Air and light",
    text: "Ventilation, damp, smoke, daylight and the lighting you live with.",
  },
  {
    icon: BriefcaseBusiness,
    title: "Daily setup",
    text: "Your workspace, breaks, discomfort and the equipment already within reach.",
  },
] as const;

export default function EnvironmentPageClient({
  contactAction,
}: {
  contactAction: MurphContactOption | null;
}) {
  const { client, error, refresh, status } = useBrowserVault();
  const values = useMemo(
    () => (client ? selectEnvironmentHabitatValues(client) : {}),
    [client],
  );
  const scene = useMemo(() => resolveHabitatScene(values), [values]);
  const notes = useMemo(
    () =>
      scene.categories.map((category) => deriveCategoryNote(category, values)),
    [scene, values],
  );
  const grade = useMemo(() => overallGrade(notes), [notes]);
  const coverage = useMemo(
    () => resolveEnvironmentCoverage(scene, values),
    [scene, values],
  );
  const noteByCategoryId = useMemo(
    () => new Map(notes.map((note) => [note.id, note])),
    [notes],
  );
  const isEmpty = Object.values(values).every(
    (aspectValues) => Object.keys(aspectValues).length === 0,
  );
  const location = readableLocation(values);
  const conditions = useEnvironmentConditions(location);

  if (status === "loading") {
    return (
      <EnvironmentShell>
        <section
          className="rounded-xl border border-border bg-card p-8"
          aria-live="polite"
        >
          <p className="text-sm text-muted-foreground">
            Unlocking what Murph knows about your home…
          </p>
        </section>
      </EnvironmentShell>
    );
  }

  if (status === "error") {
    return (
      <EnvironmentShell>
        <Alert variant="destructive">
          <AlertTitle>Could not load your environment</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {error ??
                  "Murph could not unlock your private Habitat records right now."}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
              >
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </EnvironmentShell>
    );
  }

  if (isEmpty) {
    return (
      <EnvironmentShell actions={<ShareEnvironmentButton />}>
        <EnvironmentEmptyState contactAction={contactAction} />
      </EnvironmentShell>
    );
  }

  const nextChecks = buildNextChecks(scene, notes);
  const nightNoise = values["sleep-environment"]?.night_noise;

  return (
    <EnvironmentShell actions={<ShareEnvironmentButton />}>
      <EnvironmentHero
        grade={grade}
        known={coverage.known}
        total={coverage.total}
        notes={notes}
        context={{
          location: contextValue(values["home-location"]?.location),
          areaType: contextValue(values["home-location"]?.area_type),
          weather: conditions.weather,
          nights: contextValue(nightNoise),
          outdoorAir: conditions.outdoorAir,
        }}
      />

      {grade.letter === null || coverage.coverage < 100 ? (
        <EnvironmentCaptureCard
          contactAction={contactAction}
          known={coverage.known}
          total={coverage.total}
        />
      ) : null}

      {contactAction ? (
        <NextChecksStrip items={nextChecks} chatHref={contactAction.href} />
      ) : null}

      <div className="space-y-6">
        {scene.categories.map((category) => {
          const note = noteByCategoryId.get(category.id);
          return note ? (
            <CategoryCard
              key={category.id}
              category={category}
              note={note}
              chatHref={contactAction?.href ?? null}
            />
          ) : null;
        })}
      </div>
    </EnvironmentShell>
  );
}

function EnvironmentShell({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          eyebrow="Habitat"
          title="Your environment"
          description="What Murph knows about your home, and what to check next."
        />
        {actions ? (
          <div className="flex shrink-0 items-center gap-5 pb-1">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function EnvironmentEmptyState({
  contactAction,
}: {
  contactAction: MurphContactOption | null;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
        <div className="px-6 py-9 sm:px-10 sm:py-12">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Private to you
          </span>
          <h2 className="mt-5 max-w-xl font-serif text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
            Your surroundings shape your health every day.
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            Give Murph a quick tour of the place where you sleep, breathe and
            work. Murph will remember the useful details, spot the strongest
            levers, and avoid recommending things that do not fit your life.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <EnvironmentVoiceCapture contactAction={contactAction} />
            {contactAction ? (
              <Button
                size="lg"
                variant="outline"
                render={
                  <a
                    href={contactAction.href}
                    target={contactAction.target}
                    rel={contactAction.rel}
                  />
                }
                nativeButton={false}
              >
                <MessageCircle className="size-4" aria-hidden="true" />
                Tell Murph in chat
              </Button>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            About two minutes. No questionnaire, and missing information never
            lowers your grade.
          </p>
        </div>

        <div className="border-t border-border bg-muted/25 px-6 py-8 sm:px-8 lg:border-l lg:border-t-0">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <House className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-serif text-lg font-semibold text-foreground">
                What Murph learns
              </p>
              <p className="text-xs text-muted-foreground">
                Conditions and constraints, not a shopping list.
              </p>
            </div>
          </div>
          <div className="mt-6 space-y-5">
            {EMPTY_STATE_BENEFITS.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <div key={benefit.title} className="flex gap-3">
                  <Icon
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {benefit.title}
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                      {benefit.text}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function EnvironmentCaptureCard({
  contactAction,
  known,
  total,
}: {
  contactAction: MurphContactOption | null;
  known: number;
  total: number;
}) {
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-card px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lightbulb className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-serif text-lg font-semibold text-foreground">
            {known < total / 2
              ? "A little more context will make this useful"
              : "Fill the important gaps in one take"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Murph knows {known} of {total} core facts. Speak naturally while
            moving through five short topics; clear facts are saved
            automatically.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-3">
        <EnvironmentVoiceCapture compact contactAction={contactAction} />
        {contactAction ? (
          <Button
            size="sm"
            variant="ghost"
            render={
              <a
                href={contactAction.href}
                target={contactAction.target}
                rel={contactAction.rel}
              />
            }
            nativeButton={false}
          >
            Chat instead
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </section>
  );
}

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

  return [...unmet.slice(0, 6), ...unknown.slice(0, 4)];
}

function contextValue(value: unknown): string {
  if (value === HABITAT_DECLINED_VALUE) {
    return "Not known";
  }
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return "Not known";
  }
  return String(value).replaceAll("_", " ");
}

interface EnvironmentConditionsResponse {
  airQuality: {
    aqi: number;
    pm25: number;
  } | null;
  weather: {
    description: string;
    temperatureC: number;
  } | null;
}

function readableLocation(values: HabitatValues): string | null {
  const value = values["home-location"]?.location;
  return typeof value === "string" &&
    value !== HABITAT_DECLINED_VALUE &&
    value.trim().length > 0
    ? value.trim()
    : null;
}

function useEnvironmentConditions(location: string | null): {
  outdoorAir: string;
  weather: string;
} {
  const [result, setResult] = useState<{
    conditions: EnvironmentConditionsResponse | null;
    failed: boolean;
    location: string;
  } | null>(null);

  useEffect(() => {
    if (!location) {
      return;
    }

    const controller = new AbortController();
    void fetch("/api/environment/conditions", {
      body: JSON.stringify({ location }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Live environment conditions are unavailable.");
        }
        const value: unknown = await response.json();
        if (!isEnvironmentConditionsResponse(value)) {
          throw new Error("Live environment conditions were malformed.");
        }
        setResult({ conditions: value, failed: false, location });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setResult({ conditions: null, failed: true, location });
      });

    return () => controller.abort();
  }, [location]);

  if (!location) {
    return { outdoorAir: "Add your city", weather: "Add your city" };
  }
  if (!result || result.location !== location) {
    return { outdoorAir: "Checking…", weather: "Checking…" };
  }
  if (result.failed || !result.conditions) {
    return { outdoorAir: "Unavailable", weather: "Unavailable" };
  }
  const { conditions } = result;

  return {
    outdoorAir: conditions.airQuality
      ? `${airQualityLabel(conditions.airQuality.aqi)} · PM2.5 ${Math.round(
          conditions.airQuality.pm25,
        )} µg/m³`
      : "Unavailable",
    weather: conditions.weather
      ? `${Math.round(conditions.weather.temperatureC)}°C · ${sentenceCase(
          conditions.weather.description,
        )}`
      : "Unavailable",
  };
}

function isEnvironmentConditionsResponse(
  value: unknown,
): value is EnvironmentConditionsResponse {
  if (!isRecord(value)) {
    return false;
  }
  const weather = value.weather;
  const airQuality = value.airQuality;
  return (
    (weather === null ||
      (isRecord(weather) &&
        typeof weather.description === "string" &&
        typeof weather.temperatureC === "number" &&
        Number.isFinite(weather.temperatureC))) &&
    (airQuality === null ||
      (isRecord(airQuality) &&
        typeof airQuality.aqi === "number" &&
        Number.isFinite(airQuality.aqi) &&
        typeof airQuality.pm25 === "number" &&
        Number.isFinite(airQuality.pm25)))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function airQualityLabel(aqi: number): string {
  return (
    {
      1: "Good",
      2: "Fair",
      3: "Moderate",
      4: "Poor",
      5: "Very poor",
    }[aqi] ?? "Unknown"
  );
}

function sentenceCase(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0
    ? `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`
    : "Unavailable";
}
