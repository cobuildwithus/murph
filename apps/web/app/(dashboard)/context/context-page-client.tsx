"use client";

import { useMemo, type ReactNode } from "react";
import {
  createBrowserVaultQueryClient,
  type BrowserVaultEntity,
  type BrowserVaultQueryClient,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import {
  AlertCircle,
  CheckCircle2,
  Dumbbell,
  FlaskConical,
  HeartPulse,
  Layers3,
  MapPin,
  Pill,
  Target,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { PageHeader } from "@/src/components/ui/page-header";
import { BrowserVaultProvider, useBrowserVault } from "@/src/lib/browser-vault/context";
import { formatIsoDate, formatStatusLabel } from "@/src/lib/browser-vault/display";

type ContextResourceStatus = "available" | "occasional" | "needs_detail";

interface ContextResource {
  availability: string;
  category: string;
  detail: string;
  id: string;
  location: string;
  status: ContextResourceStatus;
  tags: string[];
  title: string;
  updatedAt: string;
}

interface ContextCount {
  count: number;
  label: string;
}

const MOCK_MODE_ENABLED = process.env.NODE_ENV !== "production";
const MOCK_CONTEXT_CLIENT = createBrowserVaultQueryClient(createMockContextReplica());

const MOCK_CONTEXT_RESOURCES: ContextResource[] = [
  {
    availability: "Any weekday evening",
    category: "Heat",
    detail: "Dry sauna close to home. Useful for recovery blocks, sleep experiments, and heat exposure protocols.",
    id: "resource_sauna_home",
    location: "Near home",
    status: "available",
    tags: ["sauna", "recovery", "heat"],
    title: "Dry sauna access",
    updatedAt: "2026-06-29T18:00:00.000Z",
  },
  {
    availability: "Weekend visits",
    category: "Light",
    detail: "Red light panel kept at parents' house. Model details still need to be confirmed before protocol dosing is precise.",
    id: "resource_red_light_parents",
    location: "Parents' house",
    status: "needs_detail",
    tags: ["red light", "photobiomodulation"],
    title: "Red light panel",
    updatedAt: "2026-06-28T15:30:00.000Z",
  },
  {
    availability: "At home",
    category: "Strength",
    detail: "Adjustable dumbbells, flat bench, barbell, plates, pull-up bar, kettlebell, and resistance bands.",
    id: "resource_home_gym",
    location: "Home",
    status: "available",
    tags: ["home gym", "weights", "strength"],
    title: "Home gym setup",
    updatedAt: "2026-06-30T08:10:00.000Z",
  },
  {
    availability: "At home",
    category: "Conditioning",
    detail: "Jump rope for short conditioning blocks, warm-ups, and travel-friendly cardio sessions.",
    id: "resource_jump_rope",
    location: "Home",
    status: "available",
    tags: ["skakanka", "conditioning"],
    title: "Jump rope",
    updatedAt: "2026-06-30T08:12:00.000Z",
  },
  {
    availability: "At home",
    category: "Mobility",
    detail: "Foam roller, lacrosse ball, massage gun, and mini bands for mobility and tissue work.",
    id: "resource_mobility_recovery",
    location: "Home",
    status: "available",
    tags: ["roller", "massage gun", "bands"],
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
    tags: ["gym", "machines", "barbell"],
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
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <PageHeader
          eyebrow="Context"
          title="What Murph knows"
          description="Structured facts Murph can use when planning experiments, recommendations, and constraints."
        />
        <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground lg:items-end">
          {mockMode ? (
            <Badge variant="secondary">Local mock data</Badge>
          ) : null}
          <span>
            {client
              ? `Updated ${formatIsoDate(client.replica.generatedAt)}`
              : isPreparingEmptyReplica
                ? "Preparing context."
                : "No context available yet."}
          </span>
        </div>
      </div>

      {status === "loading" ? (
        <Card>
          <CardHeader>
            <CardTitle>Preparing your context</CardTitle>
            <CardDescription>
              Loading the durable context saved for Murph.
            </CardDescription>
          </CardHeader>
        </Card>
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
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryTile
              detail={`${view.availableResources} ready, ${view.resourcesNeedingDetail} need details`}
              label="Equipment & access"
              value={view.resources.length}
            />
            <SummaryTile
              detail="Active regimen facts"
              label="Supplements and meds"
              value={view.regimenEntities.length}
            />
            <SummaryTile
              detail={`${view.goalEntities.length} goals, ${view.experimentEntities.length} experiments`}
              label="Goals and experiments"
              value={view.goalEntities.length + view.experimentEntities.length}
            />
            <SummaryTile
              detail="Conditions, family, providers"
              label="Health records"
              value={view.healthContextEntities.length}
            />
          </div>

          <ContextMap
            generatedAt={client?.replica.generatedAt ?? null}
            mockMode={mockMode}
            view={view}
          />

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
            <ContextSection
              description="Tools, locations, and health assets Murph can account for."
              emptyText="No equipment or access notes found yet."
              icon={<Dumbbell className="size-4" />}
              isEmpty={view.resources.length === 0}
              title="Equipment & access"
            >
              <ResourceList resources={view.resources} />
            </ContextSection>

            <ContextSection
              description="Active supplement and medication records from your vault."
              emptyText="No supplement or medication records found yet."
              icon={<Pill className="size-4" />}
              isEmpty={view.regimenEntities.length === 0}
              title="Supplements & meds"
            >
              <EntityList entities={view.regimenEntities} />
            </ContextSection>
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-2">
            <ContextSection
              description="What Murph should optimize around."
              emptyText="No active goals found yet."
              icon={<Target className="size-4" />}
              isEmpty={view.goalEntities.length === 0}
              title="Goals"
            >
              <EntityList entities={view.goalEntities} />
            </ContextSection>

            <ContextSection
              description="Current self-experiments and protocols."
              emptyText="No active experiments found yet."
              icon={<FlaskConical className="size-4" />}
              isEmpty={view.experimentEntities.length === 0}
              title="Experiments"
            >
              <EntityList entities={view.experimentEntities} />
            </ContextSection>
          </div>

          <ContextSection
            description="Conditions, allergies, family history, and provider context."
            emptyText="No structured health context found yet."
            icon={<HeartPulse className="size-4" />}
            isEmpty={view.healthContextEntities.length === 0}
            title="Health context"
          >
            <EntityList entities={view.healthContextEntities} />
          </ContextSection>

          {mockMode ? (
            <Alert>
              <AlertCircle className="size-4" />
              <AlertTitle>Mocked context surface</AlertTitle>
              <AlertDescription>
                Equipment and access are local mock records for UI shaping. The live path still reads only structured browser-vault entities.
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ResourceList({ resources }: { resources: readonly ContextResource[] }) {
  if (resources.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-x-6 lg:grid-cols-2">
      {resources.map((resource) => (
        <article key={resource.id} className="min-w-0 border-t border-border py-4 first:border-t-0 lg:[&:nth-child(-n+2)]:border-t-0">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2.5 shrink-0 rounded-full ${resourceStatusDotClassName(resource.status)}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{resource.title}</span>
                    <Badge variant="outline">{resource.category}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-base/7 text-muted-foreground sm:text-sm/6">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-4 shrink-0 sm:size-3" />
                      {resource.location}
                    </span>
                    <span>{resource.availability}</span>
                  </div>
                </div>
                <Badge variant={resource.status === "available" ? "secondary" : "outline"}>
                  {formatResourceStatus(resource.status)}
                </Badge>
              </div>
              <p className="mt-3 text-base/7 text-muted-foreground sm:text-sm/6">
                {resource.detail}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
                  Updated {formatIsoDate(resource.updatedAt)}
                </span>
                {resource.tags.map((tag) => (
                  <Badge key={`${resource.id}:${tag}`} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function SummaryTile({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 text-card-foreground">
      <div className="font-serif text-3xl font-semibold tabular-nums tracking-tight text-foreground">{value}</div>
      <div className="truncate font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}

function ContextMap({
  generatedAt,
  mockMode,
  view,
}: {
  generatedAt: string | null;
  mockMode: boolean;
  view: ReturnType<typeof buildContextView>;
}) {
  const lanes = [
    {
      count: view.resources.length,
      detail: `${view.availableResources} ready now`,
      label: "Access",
    },
    {
      count: view.regimenEntities.length,
      detail: "Supplements and meds",
      label: "Regimen",
    },
    {
      count: view.goalEntities.length + view.experimentEntities.length,
      detail: "Active direction",
      label: "Protocols",
    },
    {
      count: view.healthContextEntities.length,
      detail: "Health constraints",
      label: "Clinical context",
    },
  ];
  const maxLaneCount = Math.max(...lanes.map((lane) => lane.count), 1);

  return (
    <section className="rounded-xl border border-border bg-card p-5 text-card-foreground">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Context map
              </h2>
              <p className="mt-1 max-w-[68ch] text-base/7 text-muted-foreground sm:text-sm/6">
                A compact read on what Murph can safely use today: access, active goals, current regimen, and constraints.
              </p>
            </div>
            <div className="flex w-fit items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-primary">
              <CheckCircle2 className="size-4 shrink-0" />
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.11em]">
                {view.totalContextItems} structured facts
              </span>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {lanes.map((lane) => (
              <div key={lane.label} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
                      {lane.label}
                    </div>
                    <div className="text-sm text-muted-foreground">{lane.detail}</div>
                  </div>
                  <div className="font-serif text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                    {lane.count}
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(8, (lane.count / maxLaneCount) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <dl className="grid gap-3 border-t border-border pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <ContextFact label="Latest fact" value={formatIsoDate(view.latestContextAt)} />
          <ContextFact label="Snapshot" value={formatIsoDate(generatedAt)} />
          <ContextFact
            label="Source"
            value={mockMode ? "Mock resources plus structured records" : "Structured browser-vault records"}
          />
          <ContextFact
            label="Equipment gaps"
            value={view.resourcesNeedingDetail > 0 ? `${view.resourcesNeedingDetail} need details` : "None flagged"}
          />
        </dl>
      </div>

      {view.resourceCategorySummaries.length > 0 ? (
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
              <Layers3 className="size-4 shrink-0" />
              Equipment coverage
            </span>
            {view.resourceCategorySummaries.map((category) => (
              <Badge key={category.label} variant="outline">
                {category.label} ({category.count})
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ContextFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-base/7 text-foreground sm:text-sm/6">{value}</dd>
    </div>
  );
}

function ContextSection({
  children,
  description,
  emptyText,
  icon,
  isEmpty,
  title,
}: {
  children: ReactNode;
  description: string;
  emptyText: string;
  icon: ReactNode;
  isEmpty: boolean;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : children}
      </CardContent>
    </Card>
  );
}

function EntityList({ entities }: { entities: readonly BrowserVaultEntity[] }) {
  if (entities.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col divide-y">
      {entities.map((entity) => (
        <div key={entity.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">
              {entity.title ?? entity.id}
            </span>
            <Badge variant="secondary">{formatStatusLabel(entity.kind)}</Badge>
            {entity.status ? (
              <Badge variant="outline">{formatStatusLabel(entity.status)}</Badge>
            ) : null}
          </div>
          {entity.bodyPreview ? (
            <p className="mt-2 line-clamp-3 text-base/7 text-muted-foreground sm:text-sm/6">
              {entity.bodyPreview}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
              {formatRecordClass(entity.recordClass)} · {formatIsoDate(entity.occurredAt ?? entity.date)}
            </span>
            {entity.tags.slice(0, 4).map((tag) => (
              <Badge key={`${entity.id}:${tag}`} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
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
  const allEntities = [
    ...regimenEntities,
    ...goalEntities,
    ...experimentEntities,
    ...healthContextEntities,
  ];
  const availableResources = resources.filter((resource) => resource.status === "available").length;
  const resourcesNeedingDetail = resources.filter((resource) => resource.status === "needs_detail").length;

  return {
    availableResources,
    experimentEntities,
    goalEntities,
    hasAnyContext:
      resources.length > 0 ||
      regimenEntities.length > 0 ||
      goalEntities.length > 0 ||
      experimentEntities.length > 0 ||
      healthContextEntities.length > 0,
    healthContextEntities,
    latestContextAt: resolveLatestContextAt(resources, allEntities),
    regimenEntities,
    resourceCategorySummaries: countResourcesByCategory(resources),
    resources,
    resourcesNeedingDetail,
    totalContextItems: resources.length + allEntities.length,
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

function formatResourceStatus(status: ContextResourceStatus): string {
  switch (status) {
    case "available":
      return "Available";
    case "occasional":
      return "Occasional";
    case "needs_detail":
      return "Needs detail";
  }
}

function resourceStatusDotClassName(status: ContextResourceStatus): string {
  switch (status) {
    case "available":
      return "bg-primary";
    case "occasional":
      return "bg-secondary";
    case "needs_detail":
      return "bg-destructive";
  }
}

function formatRecordClass(recordClass: BrowserVaultEntity["recordClass"]): string {
  switch (recordClass) {
    case "bank":
      return "Bank record";
    case "snapshot":
      return "Snapshot";
    default:
      return formatStatusLabel(recordClass);
  }
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

function countResourcesByCategory(resources: readonly ContextResource[]): ContextCount[] {
  const counts = new Map<string, number>();
  for (const resource of resources) {
    counts.set(resource.category, (counts.get(resource.category) ?? 0) + 1);
  }

  return Array.from(counts, ([label, count]) => ({ count, label }))
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      return left.label.localeCompare(right.label);
    });
}

function resolveLatestContextAt(
  resources: readonly ContextResource[],
  entities: readonly BrowserVaultEntity[],
): string | null {
  const dates = [
    ...resources.map((resource) => resource.updatedAt),
    ...entities.map((entity) => entity.occurredAt ?? entity.date).filter((date): date is string => Boolean(date)),
  ];

  return dates.sort((left, right) => right.localeCompare(left))[0] ?? null;
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
