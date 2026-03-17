import Link from "next/link";

import {
  DEFAULT_SAMPLE_LIMIT,
  DEFAULT_TIMELINE_LIMIT,
  loadVaultOverviewFromEnv,
  normalizeOverviewQuery,
  type OverviewJournalEntry,
  type OverviewResult,
  type OverviewSampleSummary,
  type OverviewTimelineEntry,
} from "../src/lib/overview";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const query = normalizeOverviewQuery(resolvedSearchParams.q);
  const overview = await loadVaultOverviewFromEnv({
    query,
    sampleLimit: DEFAULT_SAMPLE_LIMIT,
    timelineLimit: DEFAULT_TIMELINE_LIMIT,
  });

  return (
    <main className="page-shell">
      <section className="page-header">
        <div className="page-header__copy">
          <p className="page-header__eyebrow">Overview</p>
          <h1>Healthy Bob</h1>
          <p className="page-header__lede">
            Recent profile, notes, measurements, and activity in one place.
          </p>
        </div>
      </section>

      <form action="/" className="query-bar" method="get">
        <label className="query-bar__label" htmlFor="query">
          Search the vault
        </label>
        <div className="query-bar__row">
          <input
            className="query-bar__input"
            defaultValue={query}
            id="query"
            name="q"
            placeholder="sleep, glucose, goal ids, tags, notes..."
            type="search"
          />
          <button className="query-bar__button" type="submit">
            Search
          </button>
        </div>
      </form>

      <section className="library-teaser">
        <div>
          <p className="card__eyebrow">Health library</p>
          <h2>Resting Heart Rate now has a graph-backed page</h2>
          <p className="card__copy">
            See measurement contexts, reference sets, linked protocols, provenance,
            and the live goal plus experiment layer in one route.
          </p>
        </div>
        <Link className="library-teaser__link" href="/biomarkers/resting-heart-rate">
          Open RHR page
        </Link>
      </section>

      {overview.status === "ready" ? <ReadyState overview={overview} /> : null}
      {overview.status === "missing-config" ? <MissingConfigState overview={overview} /> : null}
      {overview.status === "error" ? <ErrorState overview={overview} /> : null}
    </main>
  );
}

function ReadyState({ overview }: { overview: Extract<OverviewResult, { status: "ready" }> }) {
  return (
    <>
      <section className="overview-grid">
        <article className="card card--profile card--wide">
          <div className="card__header">
            <div>
              <p className="card__eyebrow">Profile</p>
              <h2>{overview.currentProfile?.title ?? "No current profile yet"}</h2>
            </div>
            {overview.currentProfile?.recordedAt ? (
              <p className="card__meta">{formatMoment(overview.currentProfile.recordedAt)}</p>
            ) : null}
          </div>
          <p className="card__copy">
            {overview.currentProfile?.summary ??
              "The vault is readable, but there is no current profile summary yet."}
          </p>
          <div className="goal-list">
            {overview.currentProfile?.topGoals.length ? (
              overview.currentProfile.topGoals.map((goal) => (
                <div className="goal-chip" key={goal.id}>
                  {goal.title}
                </div>
              ))
            ) : (
              <p className="card__muted">No top goals are linked to the current profile.</p>
            )}
          </div>
          <div className="summary-strip">
            <SummaryPill label="goals" value={metricValue(overview, "registries")} />
            <SummaryPill label="journal days" value={metricValue(overview, "journal days")} />
            <SummaryPill label="measurements" value={metricValue(overview, "samples")} />
            <SummaryPill label="events" value={metricValue(overview, "events")} />
          </div>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="card">
          <div className="card__header">
            <div>
              <p className="card__eyebrow">Notes</p>
              <h2>Recent journal days</h2>
            </div>
          </div>
          <div className="stack-list">
            {overview.recentJournals.length ? (
              overview.recentJournals.map((journal) => <JournalCard journal={journal} key={journal.id} />)
            ) : (
              <p className="card__muted">No journal notes are available in this vault.</p>
            )}
          </div>
        </article>

        <article className="card">
          <div className="card__header">
            <div>
              <p className="card__eyebrow">Measurements</p>
              <h2>Recent measurements</h2>
            </div>
          </div>
          <div className="stack-list">
            {overview.sampleSummaries.length ? (
              overview.sampleSummaries.map((summary) => (
                <SampleSummaryRow key={`${summary.date}:${summary.stream}`} summary={summary} />
              ))
            ) : (
              <p className="card__muted">No measurement summaries are available yet.</p>
            )}
          </div>
        </article>

        <article className="card card--wide">
          <div className="card__header">
            <div>
              <p className="card__eyebrow">Activity</p>
              <h2>Latest activity</h2>
            </div>
          </div>
          <div className="timeline-list">
            {overview.timeline.length ? (
              overview.timeline.map((entry) => <TimelineRow entry={entry} key={entry.id} />)
            ) : (
              <p className="card__muted">No timeline entries matched the current view.</p>
            )}
          </div>
        </article>

        <article className="card card--wide">
          <div className="card__header">
            <div>
              <p className="card__eyebrow">Search</p>
              <h2>{overview.search ? `Matches for “${overview.search.query}”` : "Search"}</h2>
            </div>
            {overview.search ? <p className="card__meta">{overview.search.total} hits</p> : null}
          </div>
          {overview.search ? (
            <div className="stack-list">
              {overview.search.hits.length ? (
                overview.search.hits.map((hit) => (
                  <article className="search-row" key={`${hit.recordId}:${hit.date ?? "undated"}`}>
                    <div className="search-row__meta">
                      {humanizeToken(hit.recordType)}
                      {hit.kind ? ` · ${humanizeToken(hit.kind)}` : ""}
                      {hit.date ? ` · ${formatDate(hit.date)}` : ""}
                    </div>
                    <h3>{hit.title ?? hit.recordId}</h3>
                    <p>{hit.snippet}</p>
                  </article>
                ))
              ) : (
                <p className="card__muted">No matches yet.</p>
              )}
            </div>
          ) : (
            <p className="card__copy">Search notes, goals, events, and measurements.</p>
          )}
        </article>
      </section>
    </>
  );
}

function MissingConfigState({
  overview,
}: {
  overview: Extract<OverviewResult, { status: "missing-config" }>;
}) {
  return (
    <section className="card card--setup">
      <p className="card__eyebrow">Setup required</p>
      <h2>No vault is configured yet</h2>
      <p className="card__copy">
        Start the app with <code>{overview.envVar}</code> pointing at a Healthy Bob vault root.
        The app will not guess paths or scan your filesystem.
      </p>
      <div className="command-block">
        <code>{overview.suggestedCommand}</code>
      </div>
      <p className="card__meta">Example vault path: {overview.exampleVaultPath}</p>
    </section>
  );
}

function ErrorState({ overview }: { overview: Extract<OverviewResult, { status: "error" }> }) {
  return (
    <section className="card card--setup">
      <p className="card__eyebrow">Vault unreadable</p>
      <h2>{overview.message}</h2>
      <p className="card__copy">{overview.hint}</p>
      <div className="command-block">
        <code>{overview.recoveryCommand}</code>
      </div>
    </section>
  );
}

function JournalCard({ journal }: { journal: OverviewJournalEntry }) {
  return (
    <article className="note-card">
      <div className="note-card__header">
        <div>
          <h3>{journal.title}</h3>
          <p className="note-card__date">{formatDate(journal.date)}</p>
        </div>
        {journal.tags.length ? (
          <div className="tag-row">
            {journal.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <p className="note-card__summary">
        {journal.summary ?? "No journal summary text is available for this day."}
      </p>
    </article>
  );
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="summary-pill">
      <span className="summary-pill__value">{value}</span>
      <span className="summary-pill__label">{label}</span>
    </div>
  );
}

function SampleSummaryRow({ summary }: { summary: OverviewSampleSummary }) {
  return (
    <div className="sample-row">
      <div>
        <div className="sample-row__label">{humanizeToken(summary.stream)}</div>
        <div className="sample-row__meta">{formatDate(summary.date)}</div>
      </div>
      <div className="sample-row__value">
        {formatSampleValue(summary.averageValue)}
        {summary.unit ? <span className="sample-row__unit">{summary.unit}</span> : null}
      </div>
      <div className="sample-row__meta">{summary.sampleCount} samples</div>
    </div>
  );
}

function TimelineRow({ entry }: { entry: OverviewTimelineEntry }) {
  return (
    <div className="timeline-row">
      <div className="timeline-row__moment">{formatMoment(entry.occurredAt)}</div>
      <div className="timeline-row__body">
        <div className="timeline-row__title">{entry.title}</div>
        <div className="timeline-row__meta">
          {humanizeToken(entry.entryType)}
          {entry.kind ? ` · ${humanizeToken(entry.kind)}` : ""}
          {entry.stream ? ` · ${humanizeToken(entry.stream)}` : ""}
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatMoment(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function humanizeToken(value: string): string {
  return value
    .split(/[_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSampleValue(value: number | null): string {
  if (value === null) {
    return "n/a";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function metricValue(
  overview: Extract<OverviewResult, { status: "ready" }>,
  label: string,
): number {
  return overview.metrics.find((metric) => metric.label === label)?.value ?? 0;
}
