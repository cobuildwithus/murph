"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

import type {
  CategoryGrade,
  CategoryNote,
} from "./category-notes";

export function EnvironmentPrintReport({
  context,
  coverage,
  generatedOn,
  grade,
  notes,
}: {
  context?: { areaType: string | null; location: string | null };
  coverage: { coverage: number; known: number; total: number };
  generatedOn: string;
  grade: CategoryGrade;
  notes: readonly CategoryNote[];
}) {
  return (
    <div
      className="mx-auto w-full max-w-4xl bg-background px-5 py-6 sm:px-8 sm:py-8"
      data-environment-print-page
    >
      <style>{`
        @media print {
          @page { size: auto; margin: 17mm 12mm 14mm; }
          html, body { width: auto !important; margin: 0 !important; background: var(--background) !important; }
          [data-slot="sidebar"], [data-slot="sidebar-gap"], [data-slot="sidebar-inset"] > header,
          [data-environment-print-actions] { display: none !important; }
          [data-slot="sidebar-wrapper"], [data-slot="sidebar-inset"] { display: block !important; min-height: 0 !important; width: auto !important; }
          [data-slot="sidebar-inset"] > main { padding: 0 !important; }
          [data-environment-print-page] { max-width: none !important; padding: 0 !important; }
          [data-environment-print-category-heading] { break-after: avoid; }
          tr { break-inside: avoid; }
          thead { break-after: avoid; }
        }
      `}</style>

      <div
        className="mb-7 flex items-center justify-between gap-4"
        data-environment-print-actions
      >
        <Link
          href="/environment"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to environment
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Printer className="size-4" aria-hidden="true" />
          Print
        </button>
      </div>

      <header className="flex items-center justify-between">
        <Image src="/logo.svg" alt="Murph" width={72} height={16} preload />
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
          Private to you
        </p>
      </header>

      <div className="mt-4 flex flex-col items-start justify-between gap-4 border-b-2 border-primary pb-4 sm:flex-row sm:items-end sm:gap-6">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-[-0.03em] text-foreground">
            Environment report
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Generated {generatedOn} · withmurph.ai
          </p>
          {context?.location || context?.areaType ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {[context.location, context.areaType].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <p className="font-serif text-3xl font-semibold text-primary">
            {grade.letter ?? "–"}
            {grade.pct === null ? "" : ` · ${grade.pct}%`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {coverage.known} of {coverage.total} facts known · {coverage.coverage}% coverage
          </p>
        </div>
      </div>

      {notes.map((note) => (
        <PrintCategory key={note.id} note={note} />
      ))}

      <p className="mt-7 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        Prepared by Murph, your personal health assistant. This private report
        reflects what Murph currently knows about your home environment; it is
        not medical advice.
      </p>
    </div>
  );
}

function PrintCategory({ note }: { note: CategoryNote }) {
  return (
    <section className="mt-6" data-environment-print-category>
      <div
        className="flex items-baseline justify-between gap-4 border-b border-primary pb-2"
        data-environment-print-category-heading
      >
        <h2 className="font-serif text-xl font-semibold tracking-[-0.02em] text-foreground">
          {note.title}
        </h2>
        <p className="text-right text-xs text-muted-foreground">
          {note.grade.letter
            ? `Grade ${note.grade.letter} · ${note.grade.met}/${note.grade.graded} targets met · `
            : ""}
          {note.known}/{note.total} known
        </p>
      </div>
      <table className="mt-1 w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1.5 font-normal">Fact</th>
            <th className="py-1.5 font-normal">Yours</th>
            <th className="py-1.5 font-normal">Target</th>
          </tr>
        </thead>
        <tbody>
          {note.rows.map((row) => (
            <tr key={row.indicatorId} className="border-t border-border">
              <td className="py-1.5 pr-4 font-medium text-foreground">
                {row.label}
              </td>
              <td className="py-1.5 pr-4 text-foreground">
                {row.value}
                {row.detail ? (
                  <span className="text-muted-foreground"> · {row.detail}</span>
                ) : null}
              </td>
              <td className="py-1.5 text-muted-foreground">
                {row.target ?? "—"}
              </td>
            </tr>
          ))}
          {note.unknownFacts.map((fact) => (
            <PrintQuietFact key={fact.indicatorId} label={fact.label} value="not known yet" />
          ))}
          {note.skippedFacts.map((fact) => (
            <PrintQuietFact key={fact.indicatorId} label={fact.label} value="skipped" />
          ))}
          {note.optionalFacts.map((fact) => (
            <PrintQuietFact key={fact.indicatorId} label={fact.label} value="optional" />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PrintQuietFact({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t border-border text-muted-foreground">
      <td className="py-1.5 pr-4 font-medium">{label}</td>
      <td className="py-1.5 pr-4">{value}</td>
      <td className="py-1.5">—</td>
    </tr>
  );
}
