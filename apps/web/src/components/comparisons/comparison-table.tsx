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
    <span className="mt-3 flex flex-wrap items-center gap-0.5 font-mono text-[10px] text-[#736a58]">
      {ordinals.map((ordinal) => {
        const sourceNumber = ordinal + sourceNumberOffset;
        const sourceLabel = String(sourceNumber).padStart(2, "0");

        return (
          <a
            aria-label={`Open source ${sourceLabel} for ${product} ${dimension}`}
            className="inline-flex min-h-6 min-w-6 items-center justify-center underline decoration-[#c4a882] underline-offset-4 transition-colors hover:text-[#5a6e32]"
            href={`#${sourcePrefix}${sourceLabel}`}
            key={ordinal}
          >
            [{sourceLabel}]
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
    <div className="grid gap-3 pt-5">
      <p className="text-[0.78rem] leading-5 text-[#736a58]">
        Linked numbers point to the official sources below.
      </p>
      <Table
        className="block w-full border-collapse lg:table lg:min-w-[760px] lg:table-fixed"
        containerClassName="overflow-x-visible border-y border-[#c4a882]/45 bg-[#fffcf6]/55 lg:overflow-x-auto lg:focus-visible:outline-none lg:focus-visible:ring-2 lg:focus-visible:ring-[#5a6e32]/45 lg:focus-visible:ring-offset-2 lg:focus-visible:ring-offset-[#f5f0e8]"
        containerProps={{
          "aria-label": tableLabel,
          role: "region",
        }}
      >
        <TableCaption className="sr-only">{tableLabel}</TableCaption>
        <TableHeader className="sr-only bg-transparent lg:not-sr-only lg:table-header-group">
          <TableRow className="border-[#c4a882]/35 hover:bg-transparent">
            <TableHead
              className="w-[20%] px-5 py-4 font-sans text-[0.76rem] font-semibold normal-case tracking-normal text-[#736a58]"
              scope="col"
            >
              Compare
            </TableHead>
            <TableHead
              className="w-[40%] border-x border-[#7a8c6e]/20 bg-[#7a8c6e]/10 px-5 py-4 font-sans text-[0.76rem] font-semibold normal-case tracking-normal text-[#445128]"
              scope="col"
            >
              Murph
            </TableHead>
            <TableHead
              className="w-[40%] px-5 py-4 font-sans text-[0.76rem] font-semibold normal-case tracking-normal text-[#736a58]"
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
                className="block h-auto whitespace-normal border-b border-[#c4a882]/30 px-5 py-4 font-serif text-[1.05rem] font-semibold normal-case tracking-[-0.01em] text-[#2d3436] lg:table-cell lg:border-b-0 lg:px-5 lg:py-5 lg:text-[0.95rem]"
                scope="row"
              >
                {label}
              </TableHead>
              <TableCell className="block whitespace-normal border-b border-[#7a8c6e]/20 bg-[#7a8c6e]/5 px-5 py-5 text-[0.92rem] leading-7 text-[#2d3436] lg:table-cell lg:border-x lg:border-b-0 lg:px-5 lg:py-5 lg:text-[0.92rem] lg:leading-7">
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
              <TableCell className="block whitespace-normal px-5 py-5 text-[0.92rem] leading-7 text-[#4d4533] lg:table-cell lg:px-5 lg:py-5">
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
        className="group border-b border-[#c4a882]/40"
        data-detailed-comparison
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[0.88rem] font-semibold text-[#4d4533] marker:content-none hover:text-[#5a6e32] [&::-webkit-details-marker]:hidden">
          Detailed comparison and sources
          <span
            aria-hidden="true"
            className="text-lg font-normal leading-none transition-transform group-open:rotate-45"
          >
            +
          </span>
        </summary>
        <DetailedComparisonTable comparison={comparison} />
      </details>
    </div>
  );
}
