"use client";

import type {
  PersonalPatternCell,
  PersonalPatternReport,
  PersonalPatternStage,
} from "@murphai/query/browser-overview";

import { selectVisiblePatternReport } from "./personal-patterns-section";

const STAGE_LABELS: Record<PersonalPatternStage, string> = {
  insufficient: "Not enough matched days",
  no_clear_pattern: "No clear difference",
  new_clue: "New clue",
  seen_again: "Seen again",
  worth_testing: "Worth testing",
};

export function PersonalPatternsDiagnostics({
  activityEvents = [],
  factorToken,
  report,
}: {
  activityEvents?: Array<{
    date: string | null;
    inputFields: string;
    resolvedFactor: string | null;
    title: string;
  }>;
  factorToken: string;
  report: PersonalPatternReport;
}) {
  const factor = report.factors.find(
    (candidate) => candidate.id === factorToken,
  );
  const visibleReport = selectVisiblePatternReport(report);
  const isVisible = visibleReport.factors.some(
    (candidate) => candidate.id === factorToken,
  );

  return (
    <section
      aria-labelledby="patterns-diagnostics-title"
      className="rounded-2xl border border-border bg-card px-6 py-6 sm:px-8"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div>
          <h2
            className="font-serif text-2xl font-semibold tracking-tight text-foreground"
            id="patterns-diagnostics-title"
          >
            Local pattern diagnostics
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Read-only details from the decrypted report already loaded in this
            browser.
          </p>
        </div>
        <code className="w-fit rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
          {factorToken}
        </code>
      </div>

      <dl className="mt-6 grid gap-x-8 gap-y-4 border-y border-border py-5 sm:grid-cols-4">
        <DiagnosticFact
          label="Report window"
          value={`${report.windowDays} days`}
        />
        <DiagnosticFact label="Report date" value={report.asOfDate} />
        <DiagnosticFact
          label="Report factors"
          value={`${report.factors.length}`}
        />
        <DiagnosticFact
          label="Shown in matrix"
          value={isVisible ? "Yes" : "No"}
        />
      </dl>

      {factor ? (
        <FactorDiagnostics factorToken={factorToken} report={report} />
      ) : (
        <MissingFactorDiagnostics
          activityEvents={activityEvents}
          factorToken={factorToken}
        />
      )}

      <details className="mt-6 border-t border-border pt-5 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          How the comparison works
        </summary>
        <div className="mt-3 max-w-4xl space-y-2 leading-6">
          <p>
            Each recorded factor day is paired with the nearest day of the same
            weekday, within 35 days, when the factor was not recorded.
          </p>
          <p>
            Sleep outcomes use the same day or the next day. A repeated
            direction needs at least two independent matched cases. Larger
            evidence grades also require more cases and a longer time span.
          </p>
        </div>
      </details>
    </section>
  );
}

function MissingFactorDiagnostics({
  activityEvents,
  factorToken,
}: {
  activityEvents: Array<{
    date: string | null;
    inputFields: string;
    resolvedFactor: string | null;
    title: string;
  }>;
  factorToken: string;
}) {
  const matchingResolvedEvents = activityEvents.filter(
    (event) => event.resolvedFactor === factorToken,
  );
  return (
    <div className="mt-6">
      <div className="max-w-4xl">
        <h3 className="font-serif text-xl font-semibold text-foreground">
          Factor is not in the selected report
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {activityEvents.length === 0
            ? "No matching activity events were found in the browser replica."
            : matchingResolvedEvents.length === 0
            ? "Matching Journal events exist, but none resolves to the requested Patterns factor."
            : "Matching activity events resolve correctly, so the factor was removed later in report selection."}
        </p>
      </div>

      {activityEvents.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="border-b border-border font-medium text-muted-foreground">
              <tr>
                <th className="py-3 pr-5">Date</th>
                <th className="px-5 py-3">Journal title</th>
                <th className="px-5 py-3">Stored type fields</th>
                <th className="py-3 pl-5">Patterns factor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-foreground">
              {activityEvents.map((event, index) => (
                <tr key={`${event.date ?? "unknown"}:${index}`}>
                  <td className="py-3 pr-5 tabular-nums text-muted-foreground">
                    {event.date ?? "Unknown"}
                  </td>
                  <td className="px-5 py-3 font-medium">{event.title}</td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                    {event.inputFields}
                  </td>
                  <td className="py-3 pl-5 font-mono text-xs">
                    {event.resolvedFactor ?? "None"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function FactorDiagnostics({
  factorToken,
  report,
}: {
  factorToken: string;
  report: PersonalPatternReport;
}) {
  const factor = report.factors.find(
    (candidate) => candidate.id === factorToken,
  );
  if (!factor) return null;
  const cells = report.outcomes.map((outcome) => ({
    cell: report.cells.find(
      (candidate) =>
        candidate.factorId === factorToken &&
        candidate.outcomeId === outcome.id,
    ),
    outcome,
  }));

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="font-serif text-xl font-semibold text-foreground">
          {factor.label}
        </h3>
        <p className="text-sm text-muted-foreground">
          {formatRecordedCases(factor.observedDays, factor.episodeCount)}
        </p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="border-b border-border font-medium text-muted-foreground">
            <tr>
              <th className="py-3 pr-5">Outcome</th>
              <th className="px-5 py-3">Lag</th>
              <th className="px-5 py-3">Matched cases</th>
              <th className="px-5 py-3">Difference</th>
              <th className="px-5 py-3">Repeated</th>
              <th className="py-3 pl-5">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-foreground">
            {cells.map(({ cell, outcome }) => (
              <tr key={outcome.id}>
                <th className="py-3 pr-5 font-medium">{outcome.label}</th>
                <td className="px-5 py-3 text-muted-foreground">
                  {outcome.lagDays === 1 ? "Next day" : "Same day"}
                </td>
                <td className="px-5 py-3 tabular-nums">
                  {cell?.comparisonDays ?? 0}
                </td>
                <td className="px-5 py-3 tabular-nums">
                  {formatDifference(cell)}
                </td>
                <td className="px-5 py-3">
                  {cell?.repeatedDirection ? "Yes" : "No"}
                </td>
                <td className="py-3 pl-5">{formatStage(cell)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiagnosticFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-serif text-lg font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

function formatRecordedCases(
  observedDays: number,
  episodeCount?: number,
): string {
  const dayLabel = observedDays === 1 ? "recorded day" : "recorded days";
  if (episodeCount === undefined || episodeCount === observedDays) {
    return `${observedDays} ${dayLabel}`;
  }
  const episodeLabel = episodeCount === 1 ? "session" : "sessions";
  return `${observedDays} ${dayLabel}, ${episodeCount} ${episodeLabel}`;
}

function formatDifference(cell: PersonalPatternCell | undefined): string {
  if (!cell || cell.deltaPercent === null) return "Not calculated";
  const prefix = cell.deltaPercent > 0 ? "+" : "";
  return `${prefix}${cell.deltaPercent}%`;
}

function formatStage(cell: PersonalPatternCell | undefined): string {
  return cell ? STAGE_LABELS[cell.stage] : "Missing cell";
}
