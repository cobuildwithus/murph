import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { ChevronDown } from "lucide-react";
import {
  MURPH_COMPARISON_EVIDENCE,
  MURPH_COMPARISON_PROFILE,
} from "@/src/lib/comparisons/murph-profile";
import type {
  ComparisonEntry,
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

const QUICK_STATUS: Record<
  ComparisonQuickStatus,
  { label: string; symbol: string; tone: string }
> = {
  limited: {
    label: "Limited",
    symbol: "–",
    tone: "border-[#c4a882]/55 bg-[#ebdfc6]/35 text-[#665d4c]",
  },
  no: {
    label: "No",
    symbol: "×",
    tone: "border-[#736a58]/20 bg-[#736a58]/5 text-[#736a58]",
  },
  yes: {
    label: "Yes",
    symbol: "✓",
    tone: "border-[#5a6e32]/30 bg-[#5a6e32]/10 text-[#445128]",
  },
};

function QuickStatus({ status }: { status: ComparisonQuickStatus }) {
  const presentation = QUICK_STATUS[status];

  return (
    <span className="inline-flex items-center gap-1 text-[0.68rem] font-medium text-[#4d4533] sm:gap-2 sm:text-[0.84rem]">
      <span
        aria-hidden="true"
        className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-sm font-semibold leading-none ${presentation.tone}`}
      >
        {presentation.symbol}
      </span>
      <span>{presentation.label}</span>
    </span>
  );
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
    <span className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[0.66rem] text-[#736a58]">
      {ordinals.map((ordinal) => {
        const sourceNumber = ordinal + sourceNumberOffset;
        const sourceLabel = String(sourceNumber).padStart(2, "0");

        return (
          <a
            aria-label={`Open source ${sourceLabel} for ${product} ${dimension}`}
            className="inline-flex min-h-6 items-center justify-center rounded-full border border-[#c4a882]/45 bg-[#f5f0e8]/70 px-2.5 font-medium transition-colors hover:border-[#5a6e32]/40 hover:text-[#5a6e32]"
            href={`#${sourcePrefix}${sourceLabel}`}
            key={ordinal}
          >
            Source {Number(sourceLabel)}
          </a>
        );
      })}
    </span>
  );
}

function QuickComparisonTable({ comparison }: { comparison: ComparisonEntry }) {
  const tableLabel = `Murph and ${comparison.name} at-a-glance comparison`;
  const competitorNameParts = comparison.name.split(
    /(?<=[a-z0-9])(?=[A-Z][a-z])/u,
  );

  return (
    <Table
      className="w-full table-fixed border-collapse"
      containerClassName="overflow-x-auto border-y border-[#c4a882]/45 bg-[#fffcf6]/55"
      containerProps={{
        "aria-label": tableLabel,
        role: "region",
      }}
    >
      <TableCaption className="sr-only">{tableLabel}</TableCaption>
      <TableHeader className="bg-transparent">
        <TableRow className="border-[#c4a882]/35 hover:bg-transparent">
          <TableHead
            className="w-[48%] px-3 py-4 font-sans text-[0.76rem] font-semibold normal-case tracking-normal text-[#665d4c] sm:px-5"
            scope="col"
          >
            Capability
          </TableHead>
          <TableHead
            className="w-[26%] border-x border-[#7a8c6e]/20 bg-[#7a8c6e]/8 px-2 py-4 text-center font-sans text-[0.76rem] font-semibold normal-case tracking-normal text-[#445128] sm:px-5"
            scope="col"
          >
            Murph
          </TableHead>
          <TableHead
            className="w-[26%] whitespace-normal px-2 py-4 text-center font-sans text-[0.76rem] font-semibold normal-case leading-4 tracking-normal text-[#665d4c] [overflow-wrap:anywhere] sm:px-5"
            scope="col"
          >
            {competitorNameParts.map((part, index) => (
              <span key={`${part}-${index}`}>
                {index > 0 ? <wbr /> : null}
                {part}
              </span>
            ))}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {comparison.quickComparison.map((row) => (
          <TableRow
            className="border-[#c4a882]/30 hover:bg-transparent"
            data-evidence-dimension={row.evidence}
            data-evidence-sources={comparison.competitorEvidence[
              row.evidence
            ]
              .map((ordinal) => String(ordinal + 2).padStart(2, "0"))
              .join(" ")}
            key={row.capability}
          >
            <TableHead
              className="h-auto whitespace-normal px-3 py-4 font-sans text-[0.84rem] font-medium normal-case leading-5 tracking-normal text-[#2d3436] sm:px-5 sm:text-[0.9rem]"
              scope="row"
            >
              {row.capability}
            </TableHead>
            <TableCell className="border-x border-[#7a8c6e]/20 bg-[#7a8c6e]/5 px-2 py-4 text-center sm:px-5">
              <QuickStatus status={row.murph} />
            </TableCell>
            <TableCell className="px-2 py-4 text-center sm:px-5">
              <QuickStatus status={row.competitor} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DetailedComparisonTable({ comparison }: { comparison: ComparisonEntry }) {
  const tableLabel = `Detailed Murph and ${comparison.name} comparison`;
  const sourcePrefix = `comparison-${comparison.slug}-source-`;

  return (
    <div className="grid gap-4 pb-1 pt-2">
      <p className="text-[0.76rem] leading-5 text-[#736a58]">
        Each claim links to the official sources listed below.
      </p>
      <Table
        className="block w-full border-collapse lg:table lg:min-w-[760px] lg:table-fixed"
        containerClassName="overflow-x-visible rounded-2xl border border-[#c4a882]/40 bg-[#fffcf6]/70 lg:overflow-x-auto lg:focus-visible:outline-none lg:focus-visible:ring-2 lg:focus-visible:ring-[#5a6e32]/45 lg:focus-visible:ring-offset-2 lg:focus-visible:ring-offset-[#f5f0e8]"
        containerProps={{
          "aria-label": tableLabel,
          role: "region",
        }}
      >
        <TableCaption className="sr-only">{tableLabel}</TableCaption>
        <TableHeader className="sr-only bg-transparent lg:not-sr-only lg:table-header-group">
          <TableRow className="border-[#c4a882]/35 hover:bg-transparent">
            <TableHead
              className="w-[18%] px-4 py-3.5 font-sans text-[0.72rem] font-semibold normal-case tracking-normal text-[#736a58]"
              scope="col"
            >
              Compare
            </TableHead>
            <TableHead
              className="w-[41%] border-x border-[#7a8c6e]/20 bg-[#7a8c6e]/10 px-4 py-3.5 font-sans text-[0.72rem] font-semibold normal-case tracking-normal text-[#445128]"
              scope="col"
            >
              Murph
            </TableHead>
            <TableHead
              className="w-[41%] px-4 py-3.5 font-sans text-[0.72rem] font-semibold normal-case tracking-normal text-[#736a58]"
              scope="col"
            >
              {comparison.name}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="block lg:table-row-group">
          {COMPARISON_DIMENSIONS.map(({ key, label }) => (
            <TableRow
              className="block border-[#c4a882]/35 align-top hover:bg-transparent lg:table-row"
              key={key}
            >
              <TableHead
                className="block h-auto whitespace-normal border-b border-[#c4a882]/30 bg-[#efe7d9]/55 px-4 py-3 font-sans text-[0.78rem] font-semibold normal-case leading-5 tracking-normal text-[#2d3436] lg:table-cell lg:border-b-0 lg:bg-transparent lg:px-4 lg:py-4 lg:text-[0.78rem]"
                scope="row"
              >
                {label}
              </TableHead>
              <TableCell className="block whitespace-normal border-b border-[#7a8c6e]/20 bg-[#7a8c6e]/5 px-4 py-4 text-[0.84rem] leading-6 text-[#2d3436] lg:table-cell lg:border-x lg:border-b-0 lg:px-4 lg:py-4">
                <span className="mb-2 block text-[0.78rem] font-semibold text-[#5a6e32] lg:hidden">
                  Murph
                </span>
                <span>{MURPH_COMPARISON_PROFILE[key]}</span>
                <SourceReferences
                  dimension={label}
                  ordinals={MURPH_COMPARISON_EVIDENCE[key]}
                  product="Murph"
                  sourceNumberOffset={0}
                  sourcePrefix={sourcePrefix}
                />
              </TableCell>
              <TableCell className="block whitespace-normal px-4 py-4 text-[0.84rem] leading-6 text-[#4d4533] lg:table-cell lg:px-4 lg:py-4">
                <span className="mb-2 block text-[0.78rem] font-semibold text-[#736a58] lg:hidden">
                  {comparison.name}
                </span>
                <span>{comparison.competitor[key]}</span>
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
    </div>
  );
}

export function ComparisonTable({ comparison }: { comparison: ComparisonEntry }) {
  return (
    <div className="grid gap-5">
      <QuickComparisonTable comparison={comparison} />
      <details
        className="group border-y border-[#c4a882]/40"
        data-detailed-comparison
      >
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[0.88rem] font-semibold text-[#4d4533] marker:content-none hover:text-[#5a6e32] [&::-webkit-details-marker]:hidden">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            Full evidence table
            <span className="text-[0.7rem] font-normal text-[#736a58]">
              9 researched dimensions
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 transition-transform group-open:rotate-180"
          />
        </summary>
        <DetailedComparisonTable comparison={comparison} />
      </details>
    </div>
  );
}
