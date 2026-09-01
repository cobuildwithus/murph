import Image from "next/image";
import { Check, ChevronDown } from "lucide-react";

import { ComparisonLogo } from "@/src/components/comparisons/comparison-logo";
import { hasComparisonLogoAsset } from "@/src/lib/comparisons/logo-assets";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import {
  MURPH_COMPARISON_EVIDENCE,
  MURPH_COMPARISON_PROFILE,
} from "@/src/lib/comparisons/murph-profile";
import type {
  ComparisonEntry,
  ComparisonQuickRow,
  ComparisonQuickStatus,
  CompetitorProfile,
} from "@/src/lib/comparisons/types";

const COMPARISON_DIMENSIONS: ReadonlyArray<{
  key: keyof CompetitorProfile;
  label: string;
}> = [
  { key: "primaryJob", label: "Primary job" },
  { key: "format", label: "Product format" },
  { key: "inputs", label: "Data and inputs" },
  { key: "insightStyle", label: "How it interprets" },
  { key: "followThrough", label: "Follow-through" },
  { key: "hardware", label: "Required hardware" },
  { key: "platforms", label: "Platforms" },
  { key: "pricing", label: "Cost model" },
  { key: "clinicalRole", label: "Clinical role" },
];

const STATUS_RANK: Record<ComparisonQuickStatus, number> = {
  connected: 2,
  limited: 1,
  no: 0,
  yes: 3,
};

const STATUS_LABEL: Record<ComparisonQuickStatus, string> = {
  connected: "Via connection",
  limited: "Limited",
  no: "No",
  yes: "Yes",
};

const STATUS_TEXT_TONE: Record<ComparisonQuickStatus, string> = {
  connected: "text-[#445128]",
  limited: "text-[#665d4c]",
  no: "text-[#8a8072]",
  yes: "font-medium text-[#445128]",
};

const STATUS_ORDER = ["yes", "connected", "limited", "no"] as const;

// Harvey-ball language: full sage disc for yes, sage ring with a center dot for
// via connection, half amber disc for limited, hollow ring for no. The text
// label carries the meaning; the glyph is decor.
function StatusGlyph({ status }: { status: ComparisonQuickStatus }) {
  if (status === "yes") {
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[#5a6e32] text-[#f5f0e8]"
      >
        <Check className="size-[11px]" strokeWidth={3.2} />
      </span>
    );
  }

  if (status === "connected") {
    return (
      <svg aria-hidden="true" className="size-[18px] shrink-0" viewBox="0 0 18 18">
        <circle cx="9" cy="9" fill="none" r="8" stroke="#5a6e32" strokeWidth="1.6" />
        <circle cx="9" cy="9" fill="#5a6e32" r="3.25" />
      </svg>
    );
  }

  if (status === "limited") {
    return (
      <svg aria-hidden="true" className="size-[18px] shrink-0" viewBox="0 0 18 18">
        <circle cx="9" cy="9" fill="none" r="8" stroke="#c4a882" strokeWidth="1.6" />
        <path d="M9 1a8 8 0 0 1 0 16z" fill="#c4a882" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="size-[18px] shrink-0" viewBox="0 0 18 18">
      <circle
        cx="9"
        cy="9"
        fill="none"
        r="8"
        stroke="#736a58"
        strokeOpacity="0.5"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function QuickStatus({ status }: { status: ComparisonQuickStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-left text-[0.7rem] leading-tight sm:gap-2 sm:text-[0.84rem] ${STATUS_TEXT_TONE[status]}`}
    >
      <StatusGlyph status={status} />
      <span>{STATUS_LABEL[status]}</span>
    </span>
  );
}

function StatusLegend({ statuses }: { statuses: readonly ComparisonQuickStatus[] }) {
  return (
    <ul
      aria-label="Status key"
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.74rem] text-[#736a58]"
    >
      {STATUS_ORDER.filter((status) => statuses.includes(status)).map((status) => (
        <li className="inline-flex items-center gap-1.5" key={status}>
          <StatusGlyph status={status} />
          {STATUS_LABEL[status]}
        </li>
      ))}
    </ul>
  );
}

interface QuickRowGroup {
  id: "competitor" | "shared" | "murph";
  label: string;
  rows: readonly ComparisonQuickRow[];
}

// Presentation only: the authored rows are regrouped by who comes out ahead so
// a reader sees the competitor's real edge first and Murph's last.
export function groupQuickComparisonRows(
  comparison: Pick<ComparisonEntry, "name" | "quickComparison">,
): QuickRowGroup[] {
  const rows = comparison.quickComparison;

  return [
    {
      id: "competitor" as const,
      label: `Where ${comparison.name} goes further`,
      rows: rows.filter(
        (row) => STATUS_RANK[row.competitor] > STATUS_RANK[row.murph],
      ),
    },
    {
      id: "shared" as const,
      label: "Where they overlap",
      rows: rows.filter((row) => row.competitor === row.murph),
    },
    {
      id: "murph" as const,
      label: "Where Murph goes further",
      rows: rows.filter(
        (row) => STATUS_RANK[row.murph] > STATUS_RANK[row.competitor],
      ),
    },
  ].filter((group) => group.rows.length > 0);
}

function SourceReferences({
  dimension,
  ordinals,
  product,
  sourceNumberOffset,
  sourcePrefix,
}: {
  dimension: string;
  ordinals: readonly number[];
  product: string;
  sourceNumberOffset: number;
  sourcePrefix: string;
}) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 text-[0.7rem] text-[#736a58]">
      {ordinals.map((ordinal) => {
        const sourceNumber = ordinal + sourceNumberOffset;
        const sourceLabel = String(sourceNumber).padStart(2, "0");

        return (
          <a
            aria-label={`Open source ${sourceLabel} for ${product} ${dimension}`}
            className="inline-flex min-h-6 items-center underline decoration-[#c4a882]/70 underline-offset-[3px] transition-colors hover:text-[#5a6e32]"
            href={`#${sourcePrefix}${sourceLabel}`}
            key={ordinal}
          >
            Source {sourceNumber}
          </a>
        );
      })}
    </span>
  );
}

function ProductColumnHeader({
  children,
  logo,
  tone,
}: {
  children: React.ReactNode;
  logo: React.ReactNode;
  tone: "murph" | "competitor";
}) {
  return (
    <span className="flex flex-col items-center gap-2">
      {logo}
      <span
        className={`text-[0.74rem] font-semibold leading-4 [overflow-wrap:anywhere] sm:text-[0.8rem] ${
          tone === "murph" ? "text-[#445128]" : "text-[#4d4533]"
        }`}
      >
        {children}
      </span>
    </span>
  );
}

function QuickComparisonTable({ comparison }: { comparison: ComparisonEntry }) {
  const tableLabel = `Murph and ${comparison.name} at-a-glance comparison`;
  const competitorNameParts = comparison.name.split(
    /(?<=[a-z0-9])(?=[A-Z][a-z])/u,
  );
  const groups = groupQuickComparisonRows(comparison);
  const evidenceSources = (row: ComparisonQuickRow) =>
    comparison.competitorEvidence[row.evidence]
      .map((ordinal) => String(ordinal + 2).padStart(2, "0"))
      .join(" ");

  return (
    <Table
      className="w-full table-fixed border-collapse"
      containerClassName="overflow-x-auto border-y border-[#c4a882]/45"
      containerProps={{
        "aria-label": tableLabel,
        role: "region",
      }}
    >
      <TableCaption className="sr-only">{tableLabel}</TableCaption>
      <TableHeader className="bg-transparent">
        <TableRow className="border-[#c4a882]/40 hover:bg-transparent">
          <TableHead
            className="h-auto w-[46%] px-3 pb-3 pt-4 align-bottom font-sans text-[0.72rem] font-medium normal-case tracking-normal text-[#736a58] sm:px-5"
            scope="col"
          >
            Capability
          </TableHead>
          <TableHead
            className="h-auto w-[27%] border-x border-[#7a8c6e]/20 bg-[#7a8c6e]/8 px-2 pb-3 pt-4 text-center align-bottom font-sans normal-case tracking-normal sm:px-4"
            scope="col"
          >
            <ProductColumnHeader
              logo={
                <span className="flex h-8 w-14 items-center justify-center">
                  <Image
                    alt=""
                    className="h-7 w-auto"
                    height={44}
                    src="/logo-mark.svg"
                    width={65}
                  />
                </span>
              }
              tone="murph"
            >
              Murph
            </ProductColumnHeader>
          </TableHead>
          <TableHead
            className="h-auto w-[27%] whitespace-normal px-2 pb-3 pt-4 text-center align-bottom font-sans normal-case tracking-normal sm:px-4"
            scope="col"
          >
            <ProductColumnHeader
              logo={
                hasComparisonLogoAsset(comparison.slug) ? (
                  <ComparisonLogo
                    className="h-8 w-14 rounded-lg text-[#2d3436]"
                    decorative
                    imageClassName="max-h-8"
                    name={comparison.name}
                    slug={comparison.slug}
                  />
                ) : null
              }
              tone="competitor"
            >
              {competitorNameParts.map((part, index) => (
                <span key={`${part}-${index}`}>
                  {index > 0 ? <wbr /> : null}
                  {part}
                </span>
              ))}
            </ProductColumnHeader>
          </TableHead>
        </TableRow>
      </TableHeader>
      {groups.map((group) => (
        <TableBody className="[&_tr:last-child]:border-b" key={group.id}>
          <TableRow
            className="border-[#c4a882]/30 bg-[#efe7d9]/60 hover:bg-[#efe7d9]/60"
            data-quick-group={group.id}
          >
            <TableHead
              className="h-auto whitespace-normal px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-[#736a58] sm:px-5"
              colSpan={3}
              scope="rowgroup"
            >
              {group.label}
              <span aria-hidden="true" className="ml-2 text-[#b39a76]">
                {group.rows.length}
              </span>
              <span className="sr-only">
                {" "}({group.rows.length} {group.rows.length === 1 ? "row" : "rows"})
              </span>
            </TableHead>
          </TableRow>
          {group.rows.map((row) => (
            <TableRow
              className="border-[#c4a882]/30 hover:bg-transparent"
              data-evidence-dimension={row.evidence}
              data-evidence-sources={evidenceSources(row)}
              key={row.capability}
            >
              <TableHead
                className="h-auto whitespace-normal px-3 py-3.5 font-sans text-[0.84rem] font-medium normal-case leading-5 tracking-normal text-[#2d3436] sm:px-5 sm:text-[0.9rem]"
                scope="row"
              >
                {row.capability}
              </TableHead>
              <TableCell className="border-x border-[#7a8c6e]/20 bg-[#7a8c6e]/5 px-2 py-3.5 text-center sm:px-4">
                <QuickStatus status={row.murph} />
              </TableCell>
              <TableCell className="px-2 py-3.5 text-center sm:px-4">
                <QuickStatus status={row.competitor} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      ))}
    </Table>
  );
}

function EvidenceLedger({ comparison }: { comparison: ComparisonEntry }) {
  const tableLabel = `Detailed Murph and ${comparison.name} comparison`;
  const sourcePrefix = `comparison-${comparison.slug}-source-`;

  return (
    <Table
      className="block w-full border-collapse lg:table lg:table-fixed"
      containerClassName="overflow-x-visible lg:overflow-x-auto lg:focus-visible:outline-none lg:focus-visible:ring-2 lg:focus-visible:ring-[#5a6e32]/45 lg:focus-visible:ring-offset-2 lg:focus-visible:ring-offset-[#f5f0e8]"
      containerProps={{
        "aria-label": tableLabel,
        role: "region",
      }}
    >
      <TableCaption className="sr-only">{tableLabel}</TableCaption>
      <TableHeader className="sr-only bg-transparent lg:not-sr-only lg:table-header-group">
        <TableRow className="border-[#c4a882]/40 hover:bg-transparent">
          <TableHead
            className="h-auto w-[17%] px-0 py-3 pr-4 font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-[#736a58]"
            scope="col"
          >
            Dimension
          </TableHead>
          <TableHead
            className="h-auto w-[41.5%] border-l border-[#7a8c6e]/20 bg-[#7a8c6e]/6 px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-[#445128]"
            scope="col"
          >
            Murph
          </TableHead>
          <TableHead
            className="h-auto w-[41.5%] border-l border-[#c4a882]/30 px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-[#736a58]"
            scope="col"
          >
            {comparison.name}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="block lg:table-row-group">
        {COMPARISON_DIMENSIONS.map(({ key, label }) => (
          <TableRow
            className="block border-t border-[#c4a882]/30 py-4 align-top hover:bg-transparent lg:table-row lg:py-0"
            key={key}
          >
            <TableHead
              className="block h-auto whitespace-normal px-0 pb-3 font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-[#736a58] lg:table-cell lg:py-4 lg:pr-4 lg:align-top"
              scope="row"
            >
              {label}
            </TableHead>
            <TableCell className="block whitespace-normal px-0 pb-4 lg:table-cell lg:border-l lg:border-[#7a8c6e]/20 lg:bg-[#7a8c6e]/6 lg:px-4 lg:py-4 lg:align-top">
              <span className="mb-1 block text-[0.7rem] font-semibold text-[#5a6e32] lg:hidden">
                Murph
              </span>
              <span className="block text-[0.86rem] leading-6 text-[#2d3436]">
                {MURPH_COMPARISON_PROFILE[key]}
              </span>
              <SourceReferences
                dimension={label}
                ordinals={MURPH_COMPARISON_EVIDENCE[key]}
                product="Murph"
                sourceNumberOffset={0}
                sourcePrefix={sourcePrefix}
              />
            </TableCell>
            <TableCell className="block whitespace-normal px-0 lg:table-cell lg:border-l lg:border-[#c4a882]/30 lg:px-4 lg:py-4 lg:align-top">
              <span className="mb-1 block text-[0.7rem] font-semibold text-[#736a58] lg:hidden">
                {comparison.name}
              </span>
              <span className="block text-[0.86rem] leading-6 text-[#4d4533]">
                {comparison.competitor[key]}
              </span>
              <SourceReferences
                dimension={label}
                ordinals={comparison.competitorEvidence[key]}
                product={comparison.name}
                sourceNumberOffset={2}
                sourcePrefix={sourcePrefix}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ComparisonTable({ comparison }: { comparison: ComparisonEntry }) {
  const statuses = comparison.quickComparison.flatMap((row) => [row.murph, row.competitor]);
  const usesConnection = statuses.includes("connected");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <p className="max-w-[60ch] text-[0.84rem] leading-6 text-[#736a58]">
          Ten decisions, each traced to the official sources listed below.
          {usesConnection
            ? " Via connection means Murph uses it through a device or account you connect."
            : null}
        </p>
        <StatusLegend statuses={statuses} />
      </div>
      <QuickComparisonTable comparison={comparison} />
      <details
        className="group border-b border-[#c4a882]/40"
        data-detailed-comparison
      >
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[0.88rem] font-semibold text-[#4d4533] marker:content-none hover:text-[#5a6e32] [&::-webkit-details-marker]:hidden">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            Read the full evidence
            <span className="text-[0.72rem] font-normal text-[#736a58]">
              9 dimensions, in each product&apos;s own words
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="pb-6 pt-1">
          <EvidenceLedger comparison={comparison} />
        </div>
      </details>
    </div>
  );
}
