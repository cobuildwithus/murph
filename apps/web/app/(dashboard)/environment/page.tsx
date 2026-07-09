import type { Metadata } from "next";
import Image from "next/image";

import {
  HABITAT_CATALOG,
  HABITAT_DECLINED_VALUE,
  type HabitatAspectDefinition,
  type HabitatIndicatorDefinition,
  type HabitatIndicatorValue,
} from "@murphai/contracts";

import { Badge } from "@/src/components/ui/badge";
import { PageHeader } from "@/src/components/ui/page-header";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Environment — Murph",
  description: "The living-context facts Murph knows about your home, bedroom, light, and workspace.",
});

// Static mock values for shaping the page; the real page will read habitat
// records from the browser vault in a follow-up PR.
const MOCK_INDICATOR_VALUES: Record<string, Record<string, HabitatIndicatorValue>> = {
  "sleep-environment": {
    night_temp_c: 19,
    temp_control: "ac",
    window_at_night: "open",
    co2_meter: HABITAT_DECLINED_VALUE,
    darkness: "blackout",
  },
  "home-air": {
    ventilation: "windows_only",
    damp_or_mold: "none",
  },
  lighting: {
    evening_light: "warm_dim",
    morning_light_access: "balcony_or_garden",
  },
  "recovery-access": {
    sauna_access: "nearby",
    cold_exposure: "cold_showers",
  },
  "health-devices": {
    bp_cuff: true,
  },
  workspace: {
    desk_hours: 8,
    standing_desk: "adjustable_used",
    screen_setup: "laptop_only",
  },
};

const MOCK_PHOTOS = [
  {
    alt: "Dry sauna",
    caption: "Dry sauna access",
    src: "/design-assets/hero-finnish-sauna.jpeg",
  },
  {
    alt: "Morning stretching by an open door",
    caption: "Morning light routine",
    src: "/design-assets/hero-at-home-static-stretching.jpeg",
  },
  {
    alt: "Red light panel in a bedroom corner",
    caption: "Red light panel",
    src: "/design-assets/hero-red-light-therapy.jpeg",
  },
];

export default function EnvironmentPage() {
  const aspects = HABITAT_CATALOG.aspects.filter(
    (aspect) => aspect.domain === "environment" || aspect.domain === "workspace",
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <PageHeader
          eyebrow="Habitat"
          title="Environment"
          description="The living-context facts Murph knows about your home, bedroom, light, and workspace — and what it still doesn't."
        />
        <Badge variant="secondary" className="shrink-0">
          Mock preview
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {MOCK_PHOTOS.map((photo) => (
          <figure key={photo.src} className="min-w-0">
            <div className="relative aspect-[3/2] overflow-hidden rounded-xl outline outline-1 -outline-offset-1 outline-black/10">
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                sizes="(max-width: 640px) 33vw, 300px"
                className="object-cover"
              />
            </div>
            <figcaption className="mt-1.5 truncate font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
              {photo.caption}
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="flex flex-col gap-12">
        {aspects.map((aspect) => (
          <AspectSection key={aspect.id} aspect={aspect} />
        ))}
      </div>

      <p className="font-mono text-[11px] text-muted-foreground">
        Mock values for UI shaping. The live page will read habitat records from your encrypted vault.
      </p>
    </div>
  );
}

function AspectSection({ aspect }: { aspect: HabitatAspectDefinition }) {
  const values = MOCK_INDICATOR_VALUES[aspect.id] ?? {};
  const knownCount = aspect.indicators.filter(
    (indicator) => values[indicator.id] !== undefined,
  ).length;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2.5">
        <div className="min-w-0">
          <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {aspect.title}
          </h2>
          <p className="mt-0.5 max-w-[70ch] text-sm text-muted-foreground">{aspect.summary}</p>
        </div>
        <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.11em] text-muted-foreground">
          {knownCount} of {aspect.indicators.length} known
        </span>
      </div>
      <div className="flex flex-col">
        {aspect.indicators.map((indicator) => (
          <IndicatorRow
            key={indicator.id}
            indicator={indicator}
            value={values[indicator.id]}
          />
        ))}
      </div>
    </section>
  );
}

function IndicatorRow({
  indicator,
  value,
}: {
  indicator: HabitatIndicatorDefinition;
  value: HabitatIndicatorValue | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-border/60 py-3 last:border-b-0">
      <div className="min-w-0">
        <span className="font-medium text-foreground">{indicator.label}</span>
        {indicator.target ? (
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {indicator.target}
          </span>
        ) : null}
      </div>
      <IndicatorValue value={value} />
    </div>
  );
}

function IndicatorValue({ value }: { value: HabitatIndicatorValue | undefined }) {
  if (value === undefined || value === null) {
    return <span className="shrink-0 text-sm text-muted-foreground/60">unknown</span>;
  }
  if (value === HABITAT_DECLINED_VALUE) {
    return <span className="shrink-0 text-sm text-muted-foreground">skipped</span>;
  }
  if (typeof value === "boolean") {
    return <span className="shrink-0 text-sm text-foreground">{value ? "yes" : "no"}</span>;
  }
  return (
    <span className="shrink-0 text-sm text-foreground">
      {typeof value === "string" ? value.replaceAll("_", " ") : value}
    </span>
  );
}
