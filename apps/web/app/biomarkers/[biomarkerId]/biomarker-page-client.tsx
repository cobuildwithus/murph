"use client";

import Link from "next/link";
import {
  ActivityIcon,
  BookOpenIcon,
  ChartNoAxesColumnIncreasingIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HeartPulseIcon,
  InfoIcon,
  LineChartIcon,
  LockKeyholeIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { BrowserVaultMetricRow, BrowserVaultQueryClient } from "@murphai/query/browser";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Progress } from "@/src/components/ui/progress";
import { Skeleton } from "@/src/components/ui/skeleton";
import {
  BrowserVaultProvider,
  useBrowserVault,
  type BrowserVaultStatus,
} from "@/src/lib/browser-vault/context";
import {
  isBrowserVaultMetricBinding,
  type BiomarkerPageModel,
  type BiomarkerProtocolRankingModel,
} from "@/src/lib/health-commons/biomarker-detail";
import { cn } from "@/src/lib/utils";

interface BiomarkerPageClientProps {
  biomarker: BiomarkerPageModel;
}

type PrivateTrendState =
  | { status: "loading" }
  | { message: string; status: "empty" }
  | { message: string; status: "error" }
  | { message: string; pointCount: number; status: "insufficient_data" }
  | {
      comparison: TrendComparison | null;
      latest: TrendLatestValue;
      series: TrendPoint[];
      status: "ready";
    };

interface TrendPoint {
  date: string;
  value: number;
}

interface TrendLatestValue {
  confidence: string;
  date: string;
  sourceLabel: string;
  value: number;
}

interface TrendComparison {
  baselineValue: number;
  currentValue: number;
  delta: number;
  direction: "down" | "flat" | "up";
  label: string;
}

type BrowserVaultMetricRowWithValue = BrowserVaultMetricRow & { value: number };

export function BiomarkerPageClient({ biomarker }: BiomarkerPageClientProps) {
  return (
    <BrowserVaultProvider>
      <BiomarkerPageContent biomarker={biomarker} />
    </BrowserVaultProvider>
  );
}

function BiomarkerPageContent({ biomarker }: BiomarkerPageClientProps) {
  return (
    <div className="bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-6 py-8 md:px-12 lg:px-16 lg:py-12">
        <BiomarkerBreadcrumb biomarker={biomarker} />
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-stretch">
          <BiomarkerHero biomarker={biomarker} />
          <PrivateBiomarkerTrendCard biomarker={biomarker} />
        </section>
        <BiomarkerExplainerSection biomarker={biomarker} />
        <BiomarkerMeasurementSection biomarker={biomarker} />
        <BiomarkerEvidenceSection biomarker={biomarker} />
        <BiomarkerProtocolRankingSection biomarker={biomarker} />
        <BiomarkerCommunityOutcomeSection biomarker={biomarker} />
        <BiomarkerResearchNotesSection biomarker={biomarker} />
      </div>
    </div>
  );
}

function BiomarkerBreadcrumb({ biomarker }: BiomarkerPageClientProps) {
  return (
    <nav className="flex items-center gap-2 text-sm" aria-label="Breadcrumb">
      <Link
        href="/overview"
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        Murph
      </Link>
      <span className="text-muted-foreground/60">→</span>
      <span className="text-muted-foreground">Biomarkers</span>
      <span className="text-muted-foreground/60">→</span>
      <span className="font-medium text-foreground">{biomarker.shortName}</span>
    </nav>
  );
}

function BiomarkerHero({ biomarker }: BiomarkerPageClientProps) {
  return (
    <Card className="relative overflow-hidden border border-border/60 bg-card/95 py-0">
      <div className="absolute inset-x-0 top-0 h-1 bg-primary/70" />
      <CardHeader className="gap-6 p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{biomarker.unit}</Badge>
          <Badge variant="outline">{biomarker.statusLabel}</Badge>
          <Badge variant="outline">{biomarker.qualityLabel}</Badge>
          {biomarker.categories.slice(0, 3).map((category) => (
            <Badge key={category} variant="outline">
              {formatChipLabel(category)}
            </Badge>
          ))}
        </div>
        <div className="flex max-w-3xl flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <HeartPulseIcon className="size-5" aria-hidden />
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Biomarker page
              </p>
              <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
                {biomarker.title}
              </h1>
            </div>
          </div>
          <p className="max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
            {biomarker.summary}
          </p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 border-t bg-muted/30 p-6 md:grid-cols-3 md:p-8">
        <HeroFact label="Short name" value={biomarker.shortName} />
        <HeroFact
          label="Measurement"
          value={formatMeasurementContexts(biomarker.measurementContexts)}
        />
        <HeroFact label="Commons revision" value={shortRevision(biomarker.pageRevisionId)} />
      </CardContent>
    </Card>
  );
}

function HeroFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/80 p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function PrivateBiomarkerTrendCard({ biomarker }: BiomarkerPageClientProps) {
  const { client, error, refresh, status } = useBrowserVault();
  const trend = useMemo(
    () => resolvePrivateTrend({ biomarker, browserVaultStatus: status, client, error }),
    [biomarker, client, error, status],
  );

  if (trend.status === "loading") {
    return (
      <Card className="border border-border/60">
        <CardHeader>
          <CardTitle>Your private {biomarker.shortName}</CardTitle>
          <CardDescription>Loading browser-vault data…</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-16 w-40" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (trend.status === "empty" || trend.status === "insufficient_data") {
    return (
      <Card className="border border-border/60">
        <CardHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <LockKeyholeIcon className="size-5" aria-hidden />
          </div>
          <CardTitle>Your private {biomarker.shortName}</CardTitle>
          <CardDescription>{trend.message}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Connect wearable data or sync a browser-vault replica to see this module. Nothing
            from this card is public.
          </div>
          {trend.status === "insufficient_data" ? (
            <p className="text-xs text-muted-foreground">
              Found {trend.pointCount} point{trend.pointCount === 1 ? "" : "s"}; Murph waits
              for at least {biomarker.trendDefaults.minimumPoints} before summarizing a trend.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (trend.status === "error") {
    return (
      <Card className="border border-border/60">
        <CardHeader>
          <CardTitle>Your private {biomarker.shortName}</CardTitle>
          <CardDescription>{trend.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            Retry private trend
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-border/60">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Private to you
            </p>
            <CardTitle>Your {biomarker.shortName} trend</CardTitle>
            <CardDescription>
              Murph compares this to your own recent baseline, not to other people.
            </CardDescription>
          </div>
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LineChartIcon className="size-5" aria-hidden />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          <div className="flex items-end gap-2">
            <span className="font-serif text-5xl font-semibold tracking-tight text-foreground">
              {formatMetricValue(trend.latest.value, biomarker.valuePrecision)}
            </span>
            <span className="pb-2 text-sm font-medium text-muted-foreground">
              {biomarker.unit}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Latest {formatChipLabel(trend.latest.sourceLabel)} ·{" "}
            {formatDateLabel(trend.latest.date)} ·{" "}
            {formatChipLabel(trend.latest.confidence)} confidence
          </p>
        </div>
        <TrendSparkline series={trend.series} />
        {trend.comparison ? (
          <TrendDeltaRow
            comparison={trend.comparison}
            precision={biomarker.valuePrecision}
            unit={biomarker.unit}
          />
        ) : (
          <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            Not enough baseline data yet for a clean window comparison.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrendDeltaRow({
  comparison,
  precision,
  unit,
}: {
  comparison: TrendComparison;
  precision: number;
  unit: string;
}) {
  const absoluteDelta = Math.abs(roundMetricValue(comparison.delta, precision));
  const directionLabel = comparison.direction === "flat"
    ? "flat"
    : comparison.direction === "down"
      ? "down"
      : "up";

  return (
    <div className="grid gap-3 rounded-xl border border-border/60 bg-background/80 p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">{comparison.label}</span>
        <span className="font-medium text-foreground">
          {directionLabel} {formatMetricValue(absoluteDelta, precision)} {unit}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>Recent: {formatMetricValue(comparison.currentValue, precision)} {unit}</span>
        <span>Prior: {formatMetricValue(comparison.baselineValue, precision)} {unit}</span>
      </div>
    </div>
  );
}

function TrendSparkline({ series }: { series: TrendPoint[] }) {
  const points = useMemo(() => toSparklinePoints(series), [series]);

  if (points.length < 2) {
    return <div className="h-24 rounded-xl bg-muted/40" aria-hidden />;
  }

  const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <svg
      role="img"
      aria-label="Private biomarker trend sparkline"
      viewBox="0 0 100 42"
      className="h-24 w-full overflow-visible rounded-xl border border-border/60 bg-muted/20 p-3 text-primary"
      preserveAspectRatio="none"
    >
      <polyline
        points={pointString}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function BiomarkerExplainerSection({ biomarker }: BiomarkerPageClientProps) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        eyebrow="What is it?"
        title={`What is ${biomarker.shortName}?`}
        description="A quick, intuitive breakdown before you decide whether this is the right signal to chase."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {biomarker.explainerCards.map((card, index) => (
          <Card key={`${card.title}:${index}`} className="border border-border/60">
            <CardHeader>
              <div className="mb-1 flex size-9 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                {iconForExplainerIndex(index)}
              </div>
              <CardTitle>{card.title}</CardTitle>
              <CardDescription>{card.body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}

function BiomarkerMeasurementSection({ biomarker }: BiomarkerPageClientProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="border border-border/60">
        <CardHeader>
          <SectionKicker
            icon={<ShieldCheckIcon className="size-4" aria-hidden />}
            label="Measurement context"
          />
          <CardTitle>How Murph reads it</CardTitle>
          <CardDescription>{biomarker.measurement.bestContext}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3">
            {biomarker.measurement.howToMeasure.map((item, index) => (
              <li
                key={`${index}:${item}`}
                className="flex gap-3 rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background font-mono text-[10px] text-foreground">
                  {index + 1}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Card className="border border-border/60">
        <CardHeader>
          <CardTitle>Keep these visible</CardTitle>
          <CardDescription>{biomarker.interpretationFrame.caveat}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {biomarker.measurement.confounders.map((confounder) => (
            <Badge key={confounder} variant="outline">
              {formatChipLabel(confounder)}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function BiomarkerEvidenceSection({ biomarker }: BiomarkerPageClientProps) {
  const hasClaims = biomarker.claims.length > 0;
  const hasSourceHighlights = biomarker.sourceHighlights.length > 0;

  if (!hasClaims && !hasSourceHighlights) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        eyebrow="Evidence map"
        title="What the research supports"
        description="Source-backed claims stay separate from your private trend and from future opt-in community outcomes."
      />
      <div
        className={cn(
          "grid gap-4",
          hasClaims && hasSourceHighlights ? "lg:grid-cols-[minmax(0,1fr)_400px]" : null,
        )}
      >
        {hasClaims ? (
          <Card className="border border-border/60">
            <CardHeader className="gap-3">
              <SectionKicker
                icon={<BookOpenIcon className="size-4" aria-hidden />}
                label="Claim boundaries"
              />
              <CardTitle>Evidence-backed interpretation</CardTitle>
              <CardDescription>
                These claims are attached to source artifacts in Health Commons so the page can
                stay useful without overreaching.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {biomarker.claims.map((claim) => (
                <div
                  key={claim.claimId}
                  className="rounded-xl border border-border/60 bg-muted/30 p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{formatChipLabel(claim.strength)} evidence</Badge>
                    <Badge variant="outline">{formatChipLabel(claim.type)}</Badge>
                  </div>
                  <p className="text-sm leading-6 text-foreground">{claim.text}</p>
                  {claim.caveats.length > 0 ? (
                    <ul className="mt-3 grid gap-1 text-xs leading-5 text-muted-foreground">
                      {claim.caveats.map((caveat) => (
                        <li key={caveat} className="flex gap-2">
                          <span
                            className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                            aria-hidden
                          />
                          <span>{caveat}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {claim.sources.length > 0 ? (
                    <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                      Sources: {claim.sources.map((source) => source.title).join(" · ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {hasSourceHighlights ? (
          <Card className="border border-border/60">
            <CardHeader>
              <SectionKicker
                icon={<FileTextIcon className="size-4" aria-hidden />}
                label="Source artifacts"
              />
              <CardTitle>Research highlights</CardTitle>
              <CardDescription>
                A compact source list for the claims and measurement guardrails on this page.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {biomarker.sourceHighlights.slice(0, 8).map((source) => (
                <SourceHighlightCard key={source.key} source={source} />
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </section>
  );
}

function SourceHighlightCard({
  source,
}: {
  source: BiomarkerPageModel["sourceHighlights"][number];
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-5 text-foreground">{source.title}</p>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {source.typeLabel}{source.year ? ` · ${source.year}` : ""}
          </p>
        </div>
        {source.externalUrl ? (
          <ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{source.summary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="outline">{source.evidenceLabel}</Badge>
        {source.externalUrl ? (
          <a
            href={source.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground underline-offset-4 hover:underline"
          >
            Open original source
            <ExternalLinkIcon className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
    </div>
  );
}

type BiomarkerBodyBlock =
  | { text: string; type: "paragraph" }
  | { items: string[]; listStyle: "ordered" | "unordered"; type: "list" };

interface BiomarkerBodySection {
  blocks: BiomarkerBodyBlock[];
  heading: string;
}

function BiomarkerResearchNotesSection({ biomarker }: BiomarkerPageClientProps) {
  const sections = useMemo(
    () => selectResearchNotesSections(parseBiomarkerBodySections(biomarker.body)),
    [biomarker.body],
  );

  if (sections.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        eyebrow="Research read"
        title={`${biomarker.shortName} evidence notes`}
        description="A calmer appendix from the Health Commons memo, trimmed to the sections that add context beyond the cards and rankings above."
      />
      <Card className="border border-border/60">
        <CardHeader>
          <SectionKicker
            icon={<InfoIcon className="size-4" aria-hidden />}
            label="Commons memo"
          />
          <CardTitle>{biomarker.shortName} evidence notes</CardTitle>
          <CardDescription>
            Longer biomarker notes from Health Commons, organized as a single appendix instead of
            peer cards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {sections.map((section, sectionIndex) => (
            <div
              key={section.heading}
              className={cn("space-y-4", sectionIndex > 0 ? "border-t border-border/60 pt-6" : null)}
            >
              <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                {section.heading}
              </h3>
              <div className="space-y-4 text-sm leading-6 text-muted-foreground">
                {section.blocks.map((block, index) => {
                  if (block.type === "list") {
                    const ListTag = block.listStyle === "ordered" ? "ol" : "ul";

                    return (
                      <ListTag
                        key={`list:${index}`}
                        className={block.listStyle === "ordered"
                          ? "list-decimal space-y-2 pl-5"
                          : "list-disc space-y-2 pl-5"}
                      >
                        {block.items.map((item) => (
                          <li key={`${index}:${item}`}>{renderInlineMarkdown(item)}</li>
                        ))}
                      </ListTag>
                    );
                  }

                  return <p key={`paragraph:${index}`}>{renderInlineMarkdown(block.text)}</p>;
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function BiomarkerProtocolRankingSection({ biomarker }: BiomarkerPageClientProps) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        eyebrow="Protocol ranking"
        title={`Protocols that may move ${biomarker.shortName}`}
        description="Ranked by most likely to improve this biomarker overall: evidence, biomarker relevance, wearable measurability, burden, and safety caution."
      />
      <div className="grid gap-4">
        {biomarker.protocolRankings.map((protocol, index) => (
          <ProtocolRankingCard
            key={protocol.key}
            biomarker={biomarker}
            protocol={protocol}
            rank={index + 1}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Ranking model {biomarker.protocolRankingVersion} balances evidence, biomarker relevance,
        wearable measurability, burden, and safety caution. Community outcome confidence is
        reserved for opted-in aggregate results.
      </p>
    </section>
  );
}

function ProtocolRankingCard({
  biomarker,
  protocol,
  rank,
}: {
  biomarker: BiomarkerPageModel;
  protocol: BiomarkerProtocolRankingModel;
  rank: number;
}) {
  return (
    <Card className="border border-border/60">
      <CardContent className="grid gap-5 p-5 lg:grid-cols-[auto_minmax(0,1fr)_260px] lg:items-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary font-serif text-xl font-semibold text-primary-foreground">
          {rank}
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{protocol.category}</Badge>
            <Badge variant="outline">
              {formatExpectedDirection(protocol.expectedDirection)}
            </Badge>
            <Badge variant="outline">{formatChipLabel(protocol.confidence)} confidence</Badge>
          </div>
          <div>
            <h3 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
              {protocol.title}
            </h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              {protocol.mechanism}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <ProtocolScoreBar label="Evidence" value={protocol.scoring.evidenceWeight} />
            <ProtocolScoreBar
              label={`${biomarker.shortName} relevance`}
              value={protocol.scoring.biomarkerRelevance}
            />
            <ProtocolScoreBar label="Measurable" value={protocol.scoring.wearableMeasurability} />
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <ProtocolMeta label="Burden" value={protocol.burdenLabel} />
            <ProtocolMeta label="Caution" value={protocol.cautionLabel} />
            <ProtocolMeta label="Rank score" value={String(protocol.rankScore)} />
            <ProtocolMeta label="Outcomes" value="Coming soon" />
          </div>
          <Link href={protocol.href} className={cn(buttonVariants({ size: "sm" }), "w-full")}>
            View protocol
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function ProtocolScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{value}/5</span>
      </div>
      <Progress value={(value / 5) * 100} aria-label={`${label} score ${value} out of 5`} />
    </div>
  );
}

function ProtocolMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-medium text-foreground">{value}</p>
    </div>
  );
}

function BiomarkerCommunityOutcomeSection({ biomarker }: BiomarkerPageClientProps) {
  const summary = biomarker.communityOutcomeSummary;

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="border border-border/60">
        <CardHeader>
          <SectionKicker
            icon={<SparklesIcon className="size-4" aria-hidden />}
            label="Community outcomes"
          />
          <CardTitle>Early Murph results</CardTitle>
          <CardDescription>
            {summary.placeholder ?? "Community summaries will appear once enough opted-in runs exist."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTitle>{formatChipLabel(summary.state)}</AlertTitle>
            <AlertDescription>
              The first version of this page ranks protocols, not people. Murph should only show
              cohort summaries after minimum sample-size and privacy thresholds are met.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
      <Card className="border border-border/60">
        <CardHeader>
          <CardTitle>Interpretation rule</CardTitle>
          <CardDescription>{biomarker.interpretationFrame.principle}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          No public raw comparison against other people yet. Your private trend is for
          self-comparison; public learning will come from opt-in aggregate outcome summaries.
        </CardContent>
      </Card>
    </section>
  );
}

function SectionHeader({
  description,
  eyebrow,
  title,
}: {
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {eyebrow}
      </p>
      <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
        {title}
      </h2>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function SectionKicker({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      <span className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      {label}
    </div>
  );
}

function parseBiomarkerBodySections(body: string): BiomarkerBodySection[] {
  const sections: BiomarkerBodySection[] = [];
  let current: BiomarkerBodySection = { blocks: [], heading: "Commons interpretation" };
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listStyle: "ordered" | "unordered" | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    current.blocks.push({ text: paragraphLines.join(" "), type: "paragraph" });
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0 || listStyle === null) {
      return;
    }

    current.blocks.push({ items: listItems, listStyle, type: "list" });
    listItems = [];
    listStyle = null;
  };

  const pushCurrent = () => {
    flushParagraph();
    flushList();

    if (current.blocks.length > 0) {
      sections.push(current);
    }
  };

  const pushListItem = (nextListStyle: "ordered" | "unordered", item: string) => {
    flushParagraph();

    if (listStyle !== null && listStyle !== nextListStyle) {
      flushList();
    }

    listStyle = nextListStyle;
    listItems.push(item);
  };

  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (line.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith("## ")) {
      pushCurrent();
      current = { blocks: [], heading: stripInlineMarkdown(line.replace(/^##\s+/u, "")).trim() };
      continue;
    }

    if (line.startsWith("- ")) {
      pushListItem("unordered", line.replace(/^-\s+/u, ""));
      continue;
    }

    const orderedListMatch = line.match(/^\d+\.\s+(.*)$/u);
    if (orderedListMatch) {
      pushListItem("ordered", orderedListMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  pushCurrent();
  return sections;
}

function renderInlineMarkdown(text: string): ReactNode {
  const pieces = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/u)
    .filter((piece) => piece.length > 0);

  return pieces.map((piece, index) => {
    if (piece.startsWith("**") && piece.endsWith("**")) {
      return <strong key={`${index}:${piece}`}>{piece.slice(2, -2)}</strong>;
    }

    if (piece.startsWith("`") && piece.endsWith("`")) {
      return (
        <code
          key={`${index}:${piece}`}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
        >
          {piece.slice(1, -1)}
        </code>
      );
    }

    return <span key={`${index}:${piece}`}>{stripInlineMarkdown(piece)}</span>;
  });
}

function stripInlineMarkdown(value: string): string {
  return value.replace(/\*\*/gu, "").replace(/`/gu, "");
}

const DUPLICATIVE_RESEARCH_NOTE_HEADINGS = new Set([
  "how murph should interpret your trend",
  "protocol interpretation",
  "protocol ranking logic",
]);

function selectResearchNotesSections(sections: BiomarkerBodySection[]): BiomarkerBodySection[] {
  const filtered = sections.filter(
    (section) => !DUPLICATIVE_RESEARCH_NOTE_HEADINGS.has(normalizeResearchHeading(section.heading)),
  );

  return filtered.length > 0 ? filtered : sections;
}

function normalizeResearchHeading(value: string): string {
  return stripInlineMarkdown(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function resolvePrivateTrend(input: {
  biomarker: BiomarkerPageModel;
  browserVaultStatus: BrowserVaultStatus;
  client: BrowserVaultQueryClient | null;
  error: string | null;
}): PrivateTrendState {
  if (input.browserVaultStatus === "loading") {
    return { status: "loading" };
  }

  if (input.browserVaultStatus === "error") {
    return {
      message: input.error ?? "Your private biomarker trend could not be decrypted.",
      status: "error",
    };
  }

  if (!input.client) {
    return {
      message: "No browser-vault wearable data is connected yet.",
      status: "empty",
    };
  }

  const binding = input.biomarker.privateMetricBindings.find(isBrowserVaultMetricBinding);

  if (!binding) {
    return {
      message: "This biomarker does not have a browser-vault metric binding yet.",
      status: "empty",
    };
  }

  const rows = input.client.metrics
    .series({ domain: binding.domain, metric: binding.metric })
    .filter(hasNumericMetricValue)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (rows.length < input.biomarker.trendDefaults.minimumPoints) {
    return {
      message: `Not enough ${input.biomarker.shortName} data yet for a clean trend.`,
      pointCount: rows.length,
      status: "insufficient_data",
    };
  }

  const latestRow = rows.at(-1);

  if (!latestRow) {
    return {
      message: `No ${input.biomarker.shortName} values were found in browser-vault.`,
      status: "empty",
    };
  }

  return {
    comparison: buildTrendComparison(rows, input.biomarker),
    latest: {
      confidence: latestRow.confidence,
      date: latestRow.date,
      sourceLabel: latestRow.sourceKind ?? latestRow.sourceFamily ?? "wearable summary",
      value: latestRow.value,
    },
    series: rows.map((row) => ({ date: row.date, value: row.value })),
    status: "ready",
  };
}

function buildTrendComparison(
  rows: BrowserVaultMetricRowWithValue[],
  biomarker: BiomarkerPageModel,
): TrendComparison | null {
  const latest = rows.at(-1);

  if (!latest) {
    return null;
  }

  const currentStart = subtractIsoDays(latest.date, biomarker.trendDefaults.latestWindowDays - 1);
  const baselineStart = subtractIsoDays(currentStart, biomarker.trendDefaults.comparisonWindowDays);
  const currentRows = rows.filter((row) => row.date >= currentStart && row.date <= latest.date);
  const baselineRows = rows.filter((row) => row.date >= baselineStart && row.date < currentStart);

  if (currentRows.length === 0 || baselineRows.length < biomarker.trendDefaults.minimumPoints) {
    return null;
  }

  const currentValue = aggregateMetricRows(currentRows, biomarker.trendDefaults.aggregation);
  const baselineValue = aggregateMetricRows(baselineRows, biomarker.trendDefaults.aggregation);
  const delta = currentValue - baselineValue;
  const roundedDelta = roundMetricValue(delta, biomarker.valuePrecision);
  const nearFlatThreshold = nearFlatThresholdForUnit(biomarker.unit);
  const direction = Math.abs(roundedDelta) <= nearFlatThreshold + 1e-9
    ? "flat"
    : roundedDelta < 0
      ? "down"
      : "up";

  return {
    baselineValue,
    currentValue,
    delta,
    direction,
    label: `${biomarker.trendDefaults.latestWindowDays}-day ${biomarker.trendDefaults.aggregation} vs prior ${biomarker.trendDefaults.comparisonWindowDays} days`,
  };
}

function hasNumericMetricValue(row: BrowserVaultMetricRow): row is BrowserVaultMetricRowWithValue {
  return typeof row.value === "number" && Number.isFinite(row.value);
}

function nearFlatThresholdForUnit(unit: string): number {
  const normalized = unit.trim().toLowerCase();

  if (normalized === "bpm") {
    return 0.5;
  }

  if (normalized === "ml/kg/min") {
    return 0.1;
  }

  if (normalized === "%" || normalized === "percent" || normalized.includes("percentage")) {
    return 0.5;
  }

  if (normalized === "minutes") {
    return 1;
  }

  return 0.01;
}

function aggregateMetricRows(
  rows: readonly BrowserVaultMetricRowWithValue[],
  aggregation: "mean" | "median",
): number {
  const values = rows.map((row) => row.value);

  if (aggregation === "mean") {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  const sorted = values.slice().sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
  }

  return sorted[midpoint] ?? 0;
}

function toSparklinePoints(series: readonly TrendPoint[]): Array<{ x: number; y: number }> {
  const recent = series.slice(-30);
  const values = recent.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const denominator = Math.max(1, recent.length - 1);

  return recent.map((point, index) => ({
    x: (index / denominator) * 100,
    y: 36 - ((point.value - min) / range) * 30 + 3,
  }));
}

function subtractIsoDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function iconForExplainerIndex(index: number): ReactNode {
  if (index === 0) {
    return <InfoIcon className="size-4" aria-hidden />;
  }

  if (index === 1) {
    return <HeartPulseIcon className="size-4" aria-hidden />;
  }

  if (index === 2) {
    return <ChartNoAxesColumnIncreasingIcon className="size-4" aria-hidden />;
  }

  return <ActivityIcon className="size-4" aria-hidden />;
}

function formatMetricValue(value: number, precision: number): string {
  return value.toFixed(precision);
}

function roundMetricValue(value: number, precision: number): number {
  return Number(value.toFixed(precision));
}

function formatDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(
    new Date(`${date}T00:00:00.000Z`),
  );
}

function formatChipLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatMeasurementContexts(contexts: readonly string[]): string {
  if (contexts.length === 0) {
    return "Consistent context";
  }

  return contexts.map(formatChipLabel).join(" · ");
}

function shortRevision(revisionId: string): string {
  return revisionId.replace(/^sha256:/u, "").slice(0, 10);
}

function formatExpectedDirection(value: string): string {
  switch (value) {
    case "down":
      return "Expected lower";
    case "down_or_stable":
      return "Lower or stable";
    case "up":
      return "Expected higher";
    case "up_or_stable":
      return "Higher or stable";
    case "stable":
      return "Expected stable";
    case "mixed_or_contextual":
      return "Contextual";
    default:
      return formatChipLabel(value);
  }
}
