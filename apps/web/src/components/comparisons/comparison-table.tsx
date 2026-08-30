import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { MURPH_COMPARISON_PROFILE } from "@/src/lib/comparisons/murph-profile";
import type { ComparisonEntry, CompetitorProfile } from "@/src/lib/comparisons/types";

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

export function ComparisonTable({ comparison }: { comparison: ComparisonEntry }) {
  const tableLabel = `Murph and ${comparison.name} feature comparison`;
  const sourceSectionId = `comparison-${comparison.slug}-sources`;
  const lastSourceNumber = String(comparison.sources.length + 2).padStart(2, "0");

  return (
    <div className="grid gap-3">
      <p className="text-right font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
        Evidence: <a className="underline decoration-[#c4a882] underline-offset-4 hover:text-[#5a6e32]" href={`#${sourceSectionId}`}>Murph 01 to 02</a>
        {" · "}
        <a className="underline decoration-[#c4a882] underline-offset-4 hover:text-[#5a6e32]" href={`#${sourceSectionId}`}>{comparison.name} 03 to {lastSourceNumber}</a>
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
          <TableHead className="w-[20%] px-5 py-4 text-[#736a58]" scope="col">
            Compare
          </TableHead>
          <TableHead
            className="w-[40%] border-x border-[#7a8c6e]/20 bg-[#7a8c6e]/10 px-5 py-4 text-[#445128]"
            scope="col"
          >
            Murph
          </TableHead>
          <TableHead className="w-[40%] px-5 py-4 text-[#736a58]" scope="col">
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
              <span className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-[#5a6e32] lg:hidden">
                Murph
              </span>
              <span>{MURPH_COMPARISON_PROFILE[key]}</span>
            </TableCell>
            <TableCell className="block whitespace-normal px-5 py-5 text-[0.92rem] leading-7 text-[#4d4533] lg:table-cell lg:px-5 lg:py-5">
              <span className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-[#736a58] lg:hidden">
                {comparison.name}
              </span>
              <span>{comparison.competitor[key]}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      </Table>
    </div>
  );
}
