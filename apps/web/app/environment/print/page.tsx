import type { Metadata } from "next";
import Image from "next/image";

import {
  deriveCategoryNote,
  overallGrade,
  type CategoryNote,
} from "../../(dashboard)/environment/category-notes";
import {
  MOCK_HABITAT_VALUES,
  resolveEnvironmentCoverage,
  resolveHabitatScene,
} from "../../(dashboard)/environment/home-model";
import { PrintButton } from "./print-button";

export const metadata: Metadata = {
  title: "Environment report — Murph",
  robots: { follow: false, index: false },
};

function PrintCategory({ note }: { note: CategoryNote }) {
  return (
    <section className="mt-5">
      <div className="print-keep flex items-baseline justify-between border-b border-[#464B24] pb-1.5">
        <h2 className="font-serif text-lg font-semibold tracking-[-0.02em] text-foreground">
          {note.title}
        </h2>
        <p className="text-[11px] text-muted-foreground">
          {note.grade.letter
            ? `Grade ${note.grade.letter} · ${note.grade.met}/${note.grade.graded} targets met · `
            : ""}
          {note.known}/{note.total} known
        </p>
      </div>
      <table className="mt-1 w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[10px] text-muted-foreground">
            <th className="py-1 font-normal">Fact</th>
            <th className="py-1 font-normal">Yours</th>
            <th className="py-1 font-normal">Target</th>
          </tr>
        </thead>
        <tbody>
          {note.rows.map((row) => (
            <tr key={row.indicatorId} className="border-t border-border">
              <td className="py-1 pr-4 font-medium text-foreground">
                {row.label}
              </td>
              <td
                className={`py-1 pr-4 ${
                  row.met === false ? "text-[#8b5d3f]" : "text-foreground"
                }`}
              >
                {row.value}
                {row.detail ? (
                  <span className="text-muted-foreground"> · {row.detail}</span>
                ) : null}
              </td>
              <td className="py-1 text-muted-foreground">{row.target}</td>
            </tr>
          ))}
          {note.unknownFacts.map((fact) => (
            <tr
              key={`unknown-${fact.indicatorId}`}
              className="border-t border-border text-muted-foreground"
            >
              <td className="py-1 pr-4 font-medium">{fact.label}</td>
              <td className="py-1 pr-4">not known yet</td>
              <td className="py-1" />
            </tr>
          ))}
          {note.skippedFacts.map((fact) => (
            <tr
              key={`skipped-${fact.indicatorId}`}
              className="border-t border-border text-muted-foreground"
            >
              <td className="py-1 pr-4 font-medium">{fact.label}</td>
              <td className="py-1 pr-4">skipped</td>
              <td className="py-1" />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function EnvironmentPrintPage() {
  const scene = resolveHabitatScene(MOCK_HABITAT_VALUES);
  const notes = scene.categories.map((category) =>
    deriveCategoryNote(category, MOCK_HABITAT_VALUES),
  );
  const grade = overallGrade(notes);
  const { known, total, coverage } = resolveEnvironmentCoverage(
    scene,
    MOCK_HABITAT_VALUES,
  );
  const generatedOn = new Date().toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <main className="mx-auto max-w-4xl px-8 py-8">
      {/* Route-scoped print overrides: globals.css print rules are sized for
          the pitch deck (fixed 1600px pages) and must not shape this report. */}
      <style>{`
        @media print {
          @page { size: auto; margin: 17mm 12mm 14mm; }
          html, body { width: auto; margin: 0; background: #fff; }
          .no-print { display: none !important; }
          tr { break-inside: avoid; }
          .print-keep { break-after: avoid; }
          thead { break-after: avoid; }
        }
      `}</style>

      <header className="flex items-center justify-between">
        <Image src="/logo.svg" alt="Murph" width={72} height={16} preload />
        <PrintButton />
      </header>

      <div className="mt-3 flex items-end justify-between border-b-2 border-[#464B24] pb-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-[-0.02em] text-foreground">
            Environment report
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Generated {generatedOn} · withmurph.ai
          </p>
        </div>
        <div className="text-right">
          <p className="font-serif text-3xl font-semibold text-[#464B24]">
            {grade.letter ?? "–"}
            {grade.pct === null ? "" : ` · ${grade.pct}%`}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {known} of {total} facts known · {coverage}% coverage
          </p>
        </div>
      </div>

      {notes.map((note) => (
        <PrintCategory key={note.id} note={note} />
      ))}

      <p className="mt-6 text-[11px] text-muted-foreground">
        Prepared by Murph — a personal health assistant. This report reflects
        what Murph currently knows about this home environment; it is not
        medical advice.
      </p>
    </main>
  );
}
