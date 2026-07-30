"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { HABITAT_DECLINED_VALUE } from "@murphai/contracts";
import Image from "next/image";
import { ArrowRight, ShieldCheck } from "lucide-react";

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
import {
  buildEnvironmentVoiceScript,
  type EnvironmentVoiceScript,
} from "./environment-voice-script";
import { selectEnvironmentHabitatValues } from "./habitat-values";
import {
  INDICATOR_SPRITES,
  type HabitatValues,
  resolveEnvironmentCoverage,
  resolveHabitatScene,
} from "./home-model";

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

const EMPTY_HABITAT_VALUES: HabitatValues = {};
const EMPTY_HABITAT_SCENE = resolveHabitatScene(EMPTY_HABITAT_VALUES);

const EMPTY_CATEGORY_SUMMARIES: Readonly<Record<string, string>> = {
  sleep: "Temperature, darkness, noise and bedroom air.",
  air: "Ventilation, damp, smoke and drinking water.",
  light: "Morning daylight and evening lighting.",
  recovery: "The recovery tools and devices you already use.",
  workspace: "Sitting, screen setup, breaks and discomfort.",
};

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
  const coverage = useMemo(() => resolveEnvironmentCoverage(scene), [scene]);
  const location = readableLocation(values);
  const conditions = useEnvironmentConditions(location);
  const hasEnvironmentData = hasKnownHabitatValue(values);

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

  return (
    <EnvironmentShell
      actions={hasEnvironmentData ? <ShareEnvironmentButton /> : undefined}
    >
      {hasEnvironmentData ? (
        <EnvironmentReport
          values={values}
          scene={scene}
          notes={notes}
          grade={grade}
          coverage={coverage}
          contactAction={contactAction}
          conditions={conditions}
        />
      ) : (
        <EnvironmentEmptyState contactAction={contactAction} />
      )}
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
    <section
      aria-labelledby="environment-empty-title"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="grid lg:grid-cols-[6fr_5fr]">
        <div className="flex flex-col px-6 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
          <p className="flex items-center gap-2 text-base font-medium text-primary sm:text-sm">
            <ShieldCheck
              className="size-5 shrink-0 sm:size-4"
              aria-hidden="true"
            />
            Private to you
          </p>
          <h2
            id="environment-empty-title"
            className="mt-7 max-w-[19ch] text-balance font-serif text-4xl font-semibold leading-[1.04] tracking-[-0.03em] text-foreground"
          >
            See how your home supports your sleep, air and focus.
          </h2>
          <p className="mt-5 max-w-[58ch] text-pretty text-base leading-relaxed text-muted-foreground">
            Record a two-minute home tour. Murph will turn the clear details
            into your first personal report.
          </p>

          <div className="mt-8 flex flex-col items-start gap-4">
            <EnvironmentVoiceCapture
              triggerLabel="Start the 2-minute walkthrough"
            />
            {contactAction ? (
              <a
                href={contactAction.href}
                target={contactAction.target}
                rel={contactAction.rel}
                className="inline-flex min-h-11 items-center gap-1.5 text-base font-medium text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground sm:min-h-0 sm:text-sm"
              >
                Prefer typing? Use chat
                <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
              </a>
            ) : null}
          </div>

          <p className="mt-7 max-w-[58ch] text-pretty text-base text-muted-foreground sm:text-sm">
            Missing answers and optional equipment never lower your grade.
          </p>
        </div>

        <div className="border-t border-border bg-muted/20 px-6 py-7 sm:px-8 sm:py-9 lg:border-l lg:border-t-0 lg:px-8 lg:py-10">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Your report will cover
          </p>
          <div className="mt-4 divide-y divide-border">
            {EMPTY_HABITAT_SCENE.categories.map((category) => (
              <div
                key={category.id}
                className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
              >
                <Image
                  src={category.thumbnail.src}
                  alt=""
                  width={category.thumbnail.w}
                  height={category.thumbnail.h}
                  className="size-12 shrink-0 object-contain"
                />
                <div className="min-w-0 pt-0.5">
                  <h3 className="font-serif text-lg font-semibold tracking-[-0.02em] text-foreground">
                    {category.title}
                  </h3>
                  <p className="mt-0.5 text-pretty text-base leading-relaxed text-muted-foreground sm:text-sm">
                    {EMPTY_CATEGORY_SUMMARIES[category.id]}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function EnvironmentReport({
  values,
  scene,
  notes,
  grade,
  coverage,
  contactAction,
  conditions,
}: {
  values: HabitatValues;
  scene: ReturnType<typeof resolveHabitatScene>;
  notes: ReturnType<typeof deriveCategoryNote>[];
  grade: ReturnType<typeof overallGrade>;
  coverage: ReturnType<typeof resolveEnvironmentCoverage>;
  contactAction: MurphContactOption | null;
  conditions: { outdoorAir: string; weather: string };
}) {
  const nextChecks = buildNextChecks(scene, notes);
  const noteByCategoryId = new Map(notes.map((note) => [note.id, note]));
  const voiceScript = buildEnvironmentVoiceScript(notes, coverage.coverage);

  return (
    <>
      <EnvironmentHero
        grade={grade}
        known={coverage.known}
        total={coverage.total}
        notes={notes}
        context={{
          location: contextValue(values["home-location"]?.location),
          areaType: contextValue(values["home-location"]?.area_type),
          weather: conditions.weather,
          nights: contextValue(values["sleep-environment"]?.night_noise),
          outdoorAir: conditions.outdoorAir,
        }}
      />

      <EnvironmentCaptureCard
        contactAction={contactAction}
        coverage={coverage.coverage}
        known={coverage.known}
        script={voiceScript}
        total={coverage.total}
      />

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
    </>
  );
}

export function EnvironmentCaptureCard({
  contactAction,
  coverage,
  known,
  script,
  total,
}: {
  contactAction: MurphContactOption | null;
  coverage: number;
  known: number;
  script: EnvironmentVoiceScript;
  total: number;
}) {
  const updating = script.flow === "update";
  const missing = Math.max(0, total - known);
  const topicCount = script.topics.length;

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-card px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <h2 className="text-balance font-serif text-lg font-semibold text-foreground">
          {updating
            ? "Keep your environment current"
            : known === 0
              ? "Build your environment report in one take"
              : coverage < 50
                ? "Complete the picture"
                : "Fill the remaining gaps"}
        </h2>
        <p className="mt-1 max-w-[68ch] text-pretty text-base text-muted-foreground sm:text-sm">
          {updating
            ? "Record anything that changed. You do not need to repeat what Murph already knows."
            : known === 0
              ? "Walk through sleep, air, light, recovery and work. Murph saves only the clear details."
              : `Murph knows ${known} of ${total} core facts. This ${
                  topicCount === 1
                    ? "short recording covers the one remaining topic"
                    : `short recording covers ${topicCount} topics`
                } and asks only about the ${missing} ${
                  missing === 1 ? "detail" : "details"
                } still missing.`}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-3">
        <EnvironmentVoiceCapture
          compact
          script={script}
          triggerLabel={
            updating
              ? "Update by voice"
              : known === 0
                ? "Start walkthrough"
                : "Fill in what's missing"
          }
          triggerVariant={updating ? "outline" : "default"}
        />
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
            {updating ? "Update in chat" : "Chat instead"}
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

function hasKnownHabitatValue(values: HabitatValues): boolean {
  return Object.values(values).some((aspect) =>
    Object.values(aspect).some(
      (value) =>
        value !== null &&
        value !== undefined &&
        value !== HABITAT_DECLINED_VALUE,
    ),
  );
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
