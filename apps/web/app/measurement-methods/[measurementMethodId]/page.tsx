import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardCheckIcon, FileTextIcon, GaugeIcon } from "lucide-react";

import { Badge } from "@/src/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { Separator } from "@/src/components/ui/separator";
import {
  listHealthCommonsMeasurementMethodRoutes,
  resolveHealthCommonsMeasurementMethodDetail,
  type MeasurementMethodPageModel,
} from "@/src/lib/health-commons/measurement-method-detail";
import {
  createMurphPageMetadata,
  MURPH_INDEXABLE_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

export function generateStaticParams(): Array<{ measurementMethodId: string }> {
  return listHealthCommonsMeasurementMethodRoutes().map((measurementMethodId) => ({
    measurementMethodId,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ measurementMethodId: string }>;
}): Promise<Metadata> {
  const { measurementMethodId } = await params;
  const method = resolveHealthCommonsMeasurementMethodDetail(measurementMethodId);

  if (!method) {
    return {};
  }

  return createMurphPageMetadata({
    alternates: {
      canonical: `/measurement-methods/${encodeURIComponent(method.routeId)}`,
    },
    description: method.summary,
    openGraph: {
      type: "article",
    },
    title: `${method.title} | Murph Measurement Methods`,
    robots: MURPH_INDEXABLE_PAGE_ROBOTS,
  });
}

export default async function MeasurementMethodPage({
  params,
}: {
  params: Promise<{ measurementMethodId: string }>;
}) {
  const { measurementMethodId } = await params;
  const method = resolveHealthCommonsMeasurementMethodDetail(measurementMethodId);

  if (!method) {
    notFound();
  }

  return <MeasurementMethodBody key={method.pageRevisionId} method={method} />;
}

function MeasurementMethodBody({ method }: { method: MeasurementMethodPageModel }) {
  return (
    <div className="bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8 md:px-12 lg:px-16 lg:py-12">
        <nav className="flex items-center gap-2 text-sm" aria-label="Breadcrumb">
          <Link
            href="/experiments"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Murph
          </Link>
          <span className="text-muted-foreground/60">/</span>
          <span className="text-muted-foreground">Measurement methods</span>
          <span className="text-muted-foreground/60">/</span>
          <span className="font-medium text-foreground">{method.shortName}</span>
        </nav>

        <Card className="border border-border/60 bg-card/95 py-0">
          <CardHeader className="gap-6 p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{formatTier(method.tier)}</Badge>
              <Badge variant="outline">{method.statusLabel}</Badge>
              <Badge variant="outline">{method.qualityLabel}</Badge>
              {method.categories.slice(0, 3).map((category) => (
                <Badge key={category} variant="outline">
                  {formatWords(category)}
                </Badge>
              ))}
            </div>
            <div className="flex max-w-3xl flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <GaugeIcon className="size-5" aria-hidden />
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Measurement method page
                  </p>
                  <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
                    {method.title}
                  </h1>
                </div>
              </div>
              <p className="max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
                {method.summary}
              </p>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 border-t bg-muted/30 p-6 md:grid-cols-3 md:p-8">
            <HeroFact label="Short name" value={method.shortName} />
            <HeroFact label="Modality" value={formatList(method.modalities)} />
            <HeroFact label="Commons revision" value={shortRevision(method.pageRevisionId)} />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="border border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheckIcon className="size-4 text-primary" aria-hidden />
                Procedure
              </CardTitle>
              <CardDescription>{method.procedure.summary}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {method.procedure.materials && method.procedure.materials.length > 0 ? (
                <MethodList label="Materials" items={method.procedure.materials} />
              ) : null}
              <MethodList label="Steps" items={method.procedure.steps} ordered />
              {method.procedure.schedule && method.procedure.schedule.length > 0 ? (
                <MethodList label="Schedule" items={method.procedure.schedule} />
              ) : null}
            </CardContent>
          </Card>

          <Card className="border border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileTextIcon className="size-4 text-primary" aria-hidden />
                Outputs
              </CardTitle>
              <CardDescription>
                What this method produces and how to interpret it.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {method.outputs.map((output, index) => (
                <div key={output.label} className="flex flex-col gap-2">
                  {index > 0 ? <Separator /> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{output.label}</span>
                    <Badge variant="outline">{formatWords(output.valueType)}</Badge>
                    {output.unit ? <Badge variant="outline">{output.unit}</Badge> : null}
                  </div>
                  {output.mapsToLabel ? (
                    <p className="text-xs/4 text-muted-foreground">
                      Maps to {output.mapsToLabel}.
                    </p>
                  ) : null}
                  {output.notes.length > 0 ? (
                    <p className="text-xs/4 text-muted-foreground">
                      {output.notes.join(" ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {method.fidelity ? (
            <DetailCard
              label="Fidelity"
              items={[
                ...(method.fidelity.minimumRequirements ?? []),
                ...(method.fidelity.calibration ?? []),
                ...(method.fidelity.repeatabilityRisks ?? []).map((risk) =>
                  `Repeatability risk: ${risk}.`
                ),
              ]}
            />
          ) : null}
          {method.privacy ? (
            <DetailCard
              label="Privacy"
              items={[
                ...(method.privacy.localOnlyRecommended ? ["Local-only storage is recommended."] : []),
                ...(method.privacy.containsIdentifiableImages
                  ? ["This method can include identifiable images."]
                  : []),
                ...(method.privacy.notes ?? []),
              ]}
            />
          ) : null}
          {method.burden ? (
            <DetailCard
              label="Burden"
              items={[
                `User burden: ${formatWords(method.burden.userBurden)}.`,
                `Cost tier: ${formatWords(method.burden.costTier)}.`,
              ]}
            />
          ) : null}
          {method.confounders.length > 0 ? (
            <DetailCard label="Confounders" items={method.confounders} />
          ) : null}
          {method.relatedBiomarkers.length > 0 ? (
            <DetailCard
              label="Related outcomes"
              items={method.relatedBiomarkers.map((biomarker) => biomarker.title)}
            />
          ) : null}
          {method.interpretation ? (
            <DetailCard
              label="Interpretation"
              items={[method.interpretation.principle, method.interpretation.caveat]}
            />
          ) : null}
        </div>
      </div>
    </div>
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

function MethodList({
  items,
  label,
  ordered = false,
}: {
  items: readonly string[];
  label: string;
  ordered?: boolean;
}) {
  const ListTag = ordered ? "ol" : "ul";

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <ListTag
        className={`flex flex-col gap-2.5 pl-5 marker:text-muted-foreground ${
          ordered ? "list-decimal" : "list-disc"
        }`}
      >
        {items.map((item) => (
          <li key={item} className="pl-1 text-sm/6 text-foreground/80">
            {item}
          </li>
        ))}
      </ListTag>
    </div>
  );
}

function DetailCard({
  items,
  label,
}: {
  items: readonly string[];
  label: string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Card className="border border-border/60">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => (
            <li key={item} className="flex gap-2 text-sm/6 text-muted-foreground">
              <span
                aria-hidden="true"
                className="mt-2 size-1.5 shrink-0 rounded-full bg-secondary"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function formatTier(tier: MeasurementMethodPageModel["tier"]): string {
  switch (tier) {
    case "default_home":
      return "Default home";
    case "optional_home":
      return "Optional home";
    case "consumer_device":
      return "Consumer device";
    case "clinic":
      return "Clinic";
    case "research":
      return "Research";
    case "reference":
      return "Reference";
  }
}

function formatList(values: readonly string[]): string {
  if (values.length === 0) {
    return "None listed";
  }

  if (values.length <= 2) {
    return values.join(" and ");
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function formatWords(value: string): string {
  return value
    .split(/[-_\s/]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function shortRevision(revisionId: string): string {
  return revisionId.replace(/^sha256:/u, "").slice(0, 10);
}
