"use client";

import Image from "next/image";
import { useMemo, type ReactNode, type SVGProps } from "react";
import {
  createBrowserVaultQueryClient,
  type BrowserVaultEntity,
  type BrowserVaultQueryClient,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import { AlertCircle, Dumbbell, FlaskConical, HeartPulse, Pill, Target } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { PageHeader } from "@/src/components/ui/page-header";
import { BrowserVaultProvider, useBrowserVault } from "@/src/lib/browser-vault/context";
import { formatIsoDate, formatStatusLabel } from "@/src/lib/browser-vault/display";

type ContextResourceStatus = "available" | "occasional" | "needs_detail";

interface ContextResource {
  availability: string;
  category: string;
  detail: string;
  id: string;
  image?: string;
  location: string;
  status: ContextResourceStatus;
  title: string;
  updatedAt: string;
}

const ENTITY_IMAGES: Record<string, string> = {
  "experiment:caffeine-timing": "/design-assets/hero-caffeine-curfew.jpeg",
  "experiment:dry-sauna": "/design-assets/hero-bryan-johnson-sauna.jpg",
  "goal:goal_rhr": "/design-assets/hero-zone-2-cardio.jpeg",
  "goal:goal_strength": "/design-assets/hero-tabata-20-10-interval-training.jpeg",
};

function resolveEntityImage(entity: BrowserVaultEntity): string | null {
  if (entity.experimentSlug) {
    const bySlug = ENTITY_IMAGES[`experiment:${entity.experimentSlug}`];
    if (bySlug) {
      return bySlug;
    }
  }

  return ENTITY_IMAGES[`${entity.family}:${entity.id}`] ?? null;
}

const MOCK_MODE_ENABLED = process.env.NODE_ENV !== "production";
const MOCK_CONTEXT_CLIENT = createBrowserVaultQueryClient(createMockContextReplica());

const MOCK_CONTEXT_RESOURCES: ContextResource[] = [
  {
    availability: "Any weekday evening",
    category: "Heat",
    detail: "Dry sauna close to home. Useful for recovery blocks, sleep experiments, and heat exposure protocols.",
    id: "resource_sauna_home",
    image: "/design-assets/hero-finnish-sauna.jpeg",
    location: "Near home",
    status: "available",
    title: "Dry sauna access",
    updatedAt: "2026-06-29T18:00:00.000Z",
  },
  {
    availability: "Weekend visits",
    category: "Light",
    detail: "Red light panel kept at parents' house. Model details still need to be confirmed before protocol dosing is precise.",
    id: "resource_red_light_parents",
    image: "/design-assets/hero-red-light-therapy.jpeg",
    location: "Parents' house",
    status: "needs_detail",
    title: "Red light panel",
    updatedAt: "2026-06-28T15:30:00.000Z",
  },
  {
    availability: "Anytime",
    category: "Strength",
    detail: "Adjustable dumbbells, flat bench, barbell, plates, pull-up bar, kettlebell, and resistance bands.",
    id: "resource_home_gym",
    location: "Home",
    status: "available",
    title: "Home gym setup",
    updatedAt: "2026-06-30T08:10:00.000Z",
  },
  {
    availability: "Anytime",
    category: "Conditioning",
    detail: "Jump rope for short conditioning blocks, warm-ups, and travel-friendly cardio sessions.",
    id: "resource_jump_rope",
    location: "Home",
    status: "available",
    title: "Jump rope",
    updatedAt: "2026-06-30T08:12:00.000Z",
  },
  {
    availability: "Anytime",
    category: "Mobility",
    detail: "Foam roller, lacrosse ball, massage gun, and mini bands for mobility and tissue work.",
    id: "resource_mobility_recovery",
    image: "/design-assets/hero-at-home-static-stretching.jpeg",
    location: "Home",
    status: "available",
    title: "Mobility and massage tools",
    updatedAt: "2026-06-30T08:14:00.000Z",
  },
  {
    availability: "Occasional",
    category: "Access",
    detail: "Commercial gym access for heavier lower-body sessions and machines not available at home.",
    id: "resource_commercial_gym",
    location: "Nearby gym",
    status: "occasional",
    title: "Commercial gym access",
    updatedAt: "2026-06-27T19:00:00.000Z",
  },
];

export default function ContextPageClient({ mockMode = false }: { mockMode?: boolean }) {
  if (mockMode && MOCK_MODE_ENABLED) {
    return (
      <ContextPageLayout
        context={{
          client: MOCK_CONTEXT_CLIENT,
          error: null,
          refresh: async () => {},
          refreshPending: false,
          status: "ready",
        }}
        mockMode
        resources={MOCK_CONTEXT_RESOURCES}
      />
    );
  }

  return (
    <BrowserVaultProvider>
      <ContextPageContent />
    </BrowserVaultProvider>
  );
}

type ContextBrowserVaultState = Pick<
  ReturnType<typeof useBrowserVault>,
  "client" | "error" | "refresh" | "refreshPending" | "status"
>;

function ContextPageContent({
  resources = [],
}: {
  resources?: readonly ContextResource[];
}) {
  const browserVault = useBrowserVault();

  return <ContextPageLayout context={browserVault} resources={resources} />;
}

function ContextPageLayout({
  context,
  mockMode = false,
  resources = [],
}: {
  context: ContextBrowserVaultState;
  mockMode?: boolean;
  resources?: readonly ContextResource[];
}) {
  const { client, error, refresh, refreshPending, status } = context;
  const view = useMemo(() => client ? buildContextView(client, { resources }) : null, [client, resources]);
  const canRenderContent = status === "empty" || client !== null;
  const isPreparingEmptyReplica = status === "empty" && refreshPending;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <PageHeader
            eyebrow="Context"
            title="What Murph knows"
            description="Structured facts Murph can use when planning experiments, recommendations, and constraints."
          />
          <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
            {mockMode ? <Badge variant="secondary">Local mock data</Badge> : null}
            <span className="font-mono text-[11px] text-muted-foreground">
              {client && view
                ? `${view.totalContextItems} facts · updated ${formatIsoDate(client.replica.generatedAt)}`
                : isPreparingEmptyReplica
                  ? "Preparing context."
                  : "No context available yet."}
            </span>
          </div>
        </div>

        {view?.hasAnyContext ? <SectionIndex view={view} /> : null}
      </div>

      {view ? <PhotoStrip resources={view.resources} /> : null}

      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading the durable context saved for Murph.</p>
      ) : null}

      {status === "error" ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Could not load context</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{error ?? "Your context is not available right now."}</span>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {canRenderContent && !view?.hasAnyContext ? (
        <Card
          aria-live={isPreparingEmptyReplica ? "polite" : undefined}
          role={isPreparingEmptyReplica ? "status" : undefined}
        >
          <CardHeader>
            <CardTitle>
              {isPreparingEmptyReplica ? "Preparing your context" : "No saved context yet"}
            </CardTitle>
            <CardDescription>
              {isPreparingEmptyReplica
                ? "Your latest context is still being prepared."
                : "When Murph saves durable facts or structured health context, they will appear here."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {view?.hasAnyContext ? (
        <div className="flex flex-col gap-12">
          <ContextSection
            count={view.resources.length}
            emptyText="Nothing recorded yet on equipment or access."
            icon={<Dumbbell className="size-4" />}
            id="equipment"
            title="Equipment & access"
          >
            <div className="grid gap-x-10 sm:grid-cols-2">
              {view.resources.map((resource) => (
                <ResourceItem key={resource.id} resource={resource} />
              ))}
            </div>
          </ContextSection>

          <ContextSection
            count={view.regimenEntities.length}
            emptyText="No supplement or medication records yet."
            icon={<Pill className="size-4" />}
            id="regimen"
            title="Supplements & meds"
          >
            <EntityList entities={view.regimenEntities} />
          </ContextSection>

          <ContextSection
            count={view.goalEntities.length}
            emptyText="No active goals yet."
            icon={<Target className="size-4" />}
            id="goals"
            title="Goals"
          >
            <EntityList entities={view.goalEntities} />
          </ContextSection>

          <ContextSection
            count={view.experimentEntities.length}
            emptyText="No active experiments yet."
            icon={<FlaskConical className="size-4" />}
            id="experiments"
            title="Experiments"
          >
            <EntityList entities={view.experimentEntities} />
          </ContextSection>

          <ContextSection
            count={view.healthContextEntities.length}
            emptyText="No structured health context yet."
            icon={<HeartPulse className="size-4" />}
            id="health"
            title="Health context"
          >
            <EntityList entities={view.healthContextEntities} />
          </ContextSection>

          {mockMode ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              Equipment and access are local mock records for UI shaping. The live path reads only structured browser-vault entities.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PhotoStrip({ resources }: { resources: readonly ContextResource[] }) {
  const plates = resources
    .filter((resource): resource is ContextResource & { image: string } => Boolean(resource.image))
    .slice(0, 3);

  if (plates.length === 0) {
    return null;
  }

  return (
    <div className="-mt-2 grid grid-cols-3 gap-3">
      {plates.map((plate) => (
        <figure key={plate.id} className="min-w-0">
          <div className="relative aspect-[3/2] overflow-hidden rounded-xl outline outline-1 -outline-offset-1 outline-black/10">
            <Image
              src={plate.image}
              alt={plate.title}
              fill
              sizes="(max-width: 640px) 33vw, 300px"
              className="object-cover"
            />
          </div>
          <figcaption className="mt-1.5 truncate font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            {plate.title}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function SectionIndex({ view }: { view: NonNullable<ReturnType<typeof buildContextView>> }) {
  const entries = [
    { count: view.resources.length, href: "#equipment", label: "Equipment" },
    { count: view.regimenEntities.length, href: "#regimen", label: "Supplements" },
    { count: view.goalEntities.length, href: "#goals", label: "Goals" },
    { count: view.experimentEntities.length, href: "#experiments", label: "Experiments" },
    { count: view.healthContextEntities.length, href: "#health", label: "Health" },
  ];

  return (
    <nav
      aria-label="Context sections"
      className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-y border-border py-2.5"
    >
      {entries.map((entry) => (
        <a
          key={entry.href}
          href={entry.href}
          className="group inline-flex items-baseline gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {entry.label}
          <span className="font-serif text-sm font-semibold tabular-nums tracking-normal normal-case text-foreground/80 group-hover:text-foreground">
            {entry.count}
          </span>
        </a>
      ))}
    </nav>
  );
}

function ContextSection({
  children,
  count,
  emptyText,
  icon,
  id,
  title,
}: {
  children: ReactNode;
  count: number;
  emptyText: string;
  icon: ReactNode;
  id: string;
  title: string;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2.5">
        <h2 className="flex items-center gap-2.5 font-serif text-xl font-semibold tracking-tight text-foreground">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </h2>
        <span className="font-serif text-xl font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="pt-4 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        children
      )}
    </section>
  );
}

function ResourceItem({ resource }: { resource: ContextResource }) {
  return (
    <article className="flex gap-4 border-b border-border/60 py-5 sm:[&:nth-last-child(-n+2)]:border-b-0 max-sm:last:border-b-0">
      <ResourceGlyph
        aria-hidden="true"
        category={resource.category}
        className="mt-0.5 size-8 shrink-0 text-primary"
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="font-medium text-foreground">{resource.title}</h3>
          {resource.status === "needs_detail" ? (
            <span className="text-xs text-[#8b5d3f]">Needs detail</span>
          ) : null}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {resource.location}
          {resource.availability !== resource.location ? ` · ${resource.availability}` : null}
        </p>
        <p className="mt-2 max-w-[60ch] text-sm/6 text-muted-foreground">{resource.detail}</p>
      </div>
    </article>
  );
}

function EntityList({ entities }: { entities: readonly BrowserVaultEntity[] }) {
  return (
    <div className="flex flex-col">
      {entities.map((entity) => {
        const image = resolveEntityImage(entity);

        return (
          <div
            key={entity.id}
            className="flex gap-4 border-b border-border/60 py-4 last:border-b-0"
          >
            {image ? (
              <div className="relative size-20 shrink-0 self-center overflow-hidden rounded-lg outline outline-1 -outline-offset-1 outline-black/10">
                <Image src={image} alt="" fill sizes="80px" className="object-cover" />
              </div>
            ) : null}
            <div className="flex min-w-0 flex-1 items-baseline justify-between gap-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {entity.status === "active" ? (
                    <span aria-hidden="true" className="size-1.5 shrink-0 translate-y-[-1.5px] rounded-full bg-primary" />
                  ) : null}
                  <h3 className="font-medium text-foreground">{entity.title ?? entity.id}</h3>
                  <span className="text-sm text-muted-foreground">{formatStatusLabel(entity.kind)}</span>
                  {entity.status && entity.status !== "active" ? (
                    <span className="text-sm text-muted-foreground">· {formatStatusLabel(entity.status)}</span>
                  ) : null}
                </div>
                {entity.bodyPreview ? (
                  <p className="mt-1 line-clamp-3 max-w-[65ch] text-sm/6 text-muted-foreground">
                    {entity.bodyPreview}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {formatIsoDate(entity.occurredAt ?? entity.date)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResourceGlyph({
  category,
  className,
  ...props
}: { category: string } & SVGProps<SVGSVGElement>) {
  const shared = {
    className,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.5,
    viewBox: "0 0 24 24",
    ...props,
  };

  switch (category) {
    case "Heat":
      return (
        <svg {...shared}>
          <path d="M8 3.5c-1.1 1.3-1.1 2.7 0 4s1.1 2.7 0 4" />
          <path d="M12 3.5c-1.1 1.3-1.1 2.7 0 4s1.1 2.7 0 4" />
          <path d="M16 3.5c-1.1 1.3-1.1 2.7 0 4s1.1 2.7 0 4" />
          <path d="M4 16.5h16" />
          <path d="M6 16.5v4M18 16.5v4" />
        </svg>
      );
    case "Light":
      return (
        <svg {...shared}>
          <rect x="7" y="3" width="10" height="13" rx="1.5" />
          <path d="M7 7.5h10M7 12h10" />
          <path d="M9.5 18.5v1.5M12 18.5v2.5M14.5 18.5v1.5" />
        </svg>
      );
    case "Strength":
      return (
        <svg {...shared}>
          <path d="M6 8v8M9 6v12M15 6v12M18 8v8" />
          <path d="M9 12h6" />
          <path d="M3 12h3M18 12h3" />
        </svg>
      );
    case "Conditioning":
      return (
        <svg {...shared}>
          <path d="M3.5 4.5l3.2 3.2M20.5 4.5l-3.2 3.2" />
          <path d="M6.7 7.7C3.5 18.5 20.5 18.5 17.3 7.7" />
        </svg>
      );
    case "Mobility":
      return (
        <svg {...shared}>
          <rect x="3" y="8.5" width="18" height="7" rx="3.5" />
          <circle cx="6.5" cy="12" r="1" />
          <path d="M12 9.5v5M16 9.5v5" />
        </svg>
      );
    case "Access":
      return (
        <svg {...shared}>
          <circle cx="8" cy="12" r="3.5" />
          <path d="M11.5 12h9" />
          <path d="M17 12v3M20.5 12v2.5" />
        </svg>
      );
    default:
      return (
        <svg {...shared}>
          <path d="M12 4.5v15M5.5 8l13 8M18.5 8l-13 8" />
        </svg>
      );
  }
}

function buildContextView(
  client: BrowserVaultQueryClient,
  input: { resources?: readonly ContextResource[] } = {},
) {
  const resources = sortResources(input.resources ?? []);
  const regimenEntities = sortEntities(
    client.entities.list({ families: ["regimen"] }).filter(isSupplementOrMedicationEntity),
  );
  const goalEntities = sortEntities(client.entities.list({ families: ["goal"], statuses: ["active"] }));
  const experimentEntities = sortEntities(client.entities.list({ families: ["experiment"], statuses: ["active"] }));
  const healthContextEntities = sortEntities(client.entities.list({
    families: ["allergy", "condition", "family", "genetics", "provider"],
  }));
  const totalEntityCount =
    regimenEntities.length +
    goalEntities.length +
    experimentEntities.length +
    healthContextEntities.length;

  return {
    experimentEntities,
    goalEntities,
    hasAnyContext: resources.length > 0 || totalEntityCount > 0,
    healthContextEntities,
    regimenEntities,
    resources,
    totalContextItems: resources.length + totalEntityCount,
  };
}

function isSupplementOrMedicationEntity(entity: BrowserVaultEntity): boolean {
  const haystack = [
    entity.kind,
    entity.title,
    entity.bodyPreview,
    entity.tags.join(" "),
  ].join(" ");
  const normalized = normalizeSearchText(haystack);

  return normalized.includes("supplement") || normalized.includes("medication") || normalized.includes("medicine");
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase();
}

function sortEntities(entities: readonly BrowserVaultEntity[]): BrowserVaultEntity[] {
  return entities.slice().sort((left, right) => {
    const leftDate = left.date ?? left.occurredAt ?? "";
    const rightDate = right.date ?? right.occurredAt ?? "";
    if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
    return (left.title ?? left.id).localeCompare(right.title ?? right.id);
  });
}

function sortResources(resources: readonly ContextResource[]): ContextResource[] {
  return resources.slice().sort((left, right) => {
    if (left.status !== right.status) {
      return resourceStatusRank(left.status) - resourceStatusRank(right.status);
    }
    if (left.category !== right.category) return left.category.localeCompare(right.category);
    return left.title.localeCompare(right.title);
  });
}

function resourceStatusRank(status: ContextResourceStatus): number {
  switch (status) {
    case "available":
      return 0;
    case "occasional":
      return 1;
    case "needs_detail":
      return 2;
  }
}

function createMockContextReplica(): BrowserVaultReplica {
  return {
    assistantSummary: {
      highlights: [],
      latestDate: null,
    },
    entities: [
      createMockEntity("regimen", "regimen_creatine", {
        bodyPreview: "Creatine monohydrate 5 g daily with morning hydration.",
        kind: "supplement",
        status: "active",
        tags: ["supplement", "strength"],
        title: "Creatine monohydrate",
      }),
      createMockEntity("regimen", "regimen_magnesium", {
        bodyPreview: "Magnesium glycinate in the evening when sleep pressure is low.",
        kind: "supplement",
        status: "active",
        tags: ["supplement", "sleep"],
        title: "Magnesium glycinate",
      }),
      createMockEntity("goal", "goal_rhr", {
        bodyPreview: "Bring resting heart rate under 45 bpm without suppressing training readiness.",
        kind: "metric_goal",
        status: "active",
        tags: ["cardio", "recovery"],
        title: "Improve resting heart rate",
      }),
      createMockEntity("goal", "goal_strength", {
        bodyPreview: "Maintain two strength sessions weekly during travel-heavy weeks.",
        kind: "behavior_goal",
        status: "active",
        tags: ["strength", "consistency"],
        title: "Keep strength training consistent",
      }),
      createMockEntity("experiment", "experiment_sauna", {
        bodyPreview: "Three Finnish dry sauna sessions weekly, tracked against HRV, sleep latency, and resting heart rate.",
        experimentSlug: "dry-sauna",
        kind: "protocol_run",
        status: "active",
        tags: ["heat", "recovery"],
        title: "Finnish dry sauna",
      }),
      createMockEntity("experiment", "experiment_caffeine", {
        bodyPreview: "Caffeine cutoff before noon for two weeks, with sleep onset and subjective energy as primary outcomes.",
        experimentSlug: "caffeine-timing",
        kind: "protocol_run",
        status: "active",
        tags: ["sleep", "caffeine"],
        title: "Caffeine timing reset",
      }),
      createMockEntity("condition", "condition_lipid_context", {
        bodyPreview: "Family history makes lipid markers worth watching when diet or supplement protocols change.",
        kind: "family_risk_context",
        status: "active",
        tags: ["cardiometabolic"],
        title: "Cardiometabolic family context",
      }),
      createMockEntity("provider", "provider_primary_care", {
        bodyPreview: "Primary care labs are usually available with a short lead time.",
        kind: "care_access",
        status: "active",
        tags: ["labs"],
        title: "Primary care lab access",
      }),
    ],
    generatedAt: "2026-07-01T12:00:00.000Z",
    metricGoalProgressRows: [],
    metricRows: [],
    metricSelectionRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: ["audit", "core", "food", "recipe"],
      id: "health-vault-browser",
      includedFamilies: [
        "allergy",
        "assessment",
        "condition",
        "event",
        "experiment",
        "family",
        "genetics",
        "goal",
        "journal",
        "protocol",
        "regimen",
        "provider",
        "sample",
        "workout_format",
      ],
      metricLookbackDays: 365,
    },
    schema: "murph.browser-vault-replica",
    searchRows: [],
    source: {
      dataVersion: "mock-context",
      sourceBundleHash: "mock-context-source",
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
}

function createMockEntity(
  family: BrowserVaultEntity["family"],
  id: string,
  overrides: Partial<BrowserVaultEntity>,
): BrowserVaultEntity {
  const title = overrides.title ?? id;

  return {
    attributes: overrides.attributes ?? {},
    bodyPreview: overrides.bodyPreview ?? null,
    date: overrides.date ?? "2026-06-30",
    experimentSlug: overrides.experimentSlug ?? null,
    family,
    id,
    kind: overrides.kind ?? family,
    links: overrides.links ?? [],
    lookupIds: overrides.lookupIds ?? [id],
    occurredAt: overrides.occurredAt ?? "2026-06-30T08:00:00.000Z",
    recordClass: overrides.recordClass ?? resolveMockRecordClass(family),
    status: overrides.status ?? null,
    stream: overrides.stream ?? null,
    tags: overrides.tags ?? [],
    title,
  };
}

function resolveMockRecordClass(family: BrowserVaultEntity["family"]): BrowserVaultEntity["recordClass"] {
  switch (family) {
    case "experiment":
    case "goal":
    case "regimen":
    case "condition":
    case "provider":
      return "bank";
    default:
      return "snapshot";
  }
}
