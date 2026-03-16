import {
  DEFAULT_SAMPLE_LIMIT,
  DEFAULT_TIMELINE_LIMIT,
  loadVaultOverviewFromEnv,
  normalizeOverviewQuery,
  type OverviewResult,
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
    <main className="shell">
      <div className="shell__backdrop" />
      <div className="shell__grain" />
      <section className="hero">
        <div className="hero__eyebrow">Local-only vault viewer</div>
        <h1>Healthy Bob Observatory</h1>
        <p className="hero__lede">
          A read-only local interface over the file-native vault. It uses the query
          layer on the server, keeps search scoped to safe record fields, and stays
          intentionally narrow while product semantics remain undefined.
        </p>
        <form className="query-form" action="/" method="get">
          <label className="query-form__label" htmlFor="query">
            Search the vault
          </label>
          <div className="query-form__row">
            <input
              className="query-form__input"
              defaultValue={query}
              id="query"
              name="q"
              placeholder="sleep, glucose, goal ids, tags, notes..."
              type="search"
            />
            <button className="query-form__button" type="submit">
              Inspect
            </button>
          </div>
        </form>
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
      <section className="metrics-panel panel panel--accent">
        <div className="metrics-panel__header">
          <div>
            <p className="panel__kicker">Read model pulse</p>
            <h2>Observed shape</h2>
          </div>
          <p className="panel__meta">Generated {formatMoment(overview.generatedAt)}</p>
        </div>
        <div className="metrics-grid">
          {overview.metrics.map((metric) => (
            <article className="metric" key={metric.label}>
              <div className="metric__label">{metric.label}</div>
              <div className="metric__value">{metric.value}</div>
              <p className="metric__note">{metric.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="content-grid">
        <article className="panel panel--profile">
          <p className="panel__kicker">Current profile</p>
          <h2>{overview.currentProfile?.title ?? "No current profile surfaced"}</h2>
          <p className="panel__copy">
            {overview.currentProfile?.summary ??
              "The vault is readable, but there is no current profile summary available yet."}
          </p>
          <div className="chip-row">
            {overview.currentProfile?.topGoalIds.length ? (
              overview.currentProfile.topGoalIds.map((goalId) => (
                <span className="chip" key={goalId}>
                  {goalId}
                </span>
              ))
            ) : (
              <span className="chip chip--muted">No top goals linked</span>
            )}
          </div>
        </article>

        <article className="panel">
          <p className="panel__kicker">Sample rhythms</p>
          <h2>Recent daily summaries</h2>
          <div className="summary-list">
            {overview.sampleSummaries.length ? (
              overview.sampleSummaries.map((summary) => (
                <div className="summary-row" key={`${summary.date}:${summary.stream}`}>
                  <div>
                    <div className="summary-row__title">{summary.stream}</div>
                    <div className="summary-row__meta">{formatDate(summary.date)}</div>
                  </div>
                  <div className="summary-row__value">
                    {summary.averageValue ?? "n/a"}
                    {summary.unit ? <span className="summary-row__unit">{summary.unit}</span> : null}
                  </div>
                  <div className="summary-row__meta">{summary.sampleCount} samples</div>
                </div>
              ))
            ) : (
              <p className="panel__copy">No recent sample summaries are available.</p>
            )}
          </div>
        </article>

        <article className="panel panel--timeline">
          <p className="panel__kicker">Timeline</p>
          <h2>Latest canonical activity</h2>
          <div className="timeline-list">
            {overview.timeline.length ? (
              overview.timeline.map((entry) => (
                <div className="timeline-entry" key={entry.id}>
                  <div className="timeline-entry__date">{formatMoment(entry.occurredAt)}</div>
                  <div className="timeline-entry__body">
                    <div className="timeline-entry__title">{entry.title}</div>
                    <div className="timeline-entry__meta">
                      {entry.entryType}
                      {entry.kind ? ` · ${entry.kind}` : ""}
                      {entry.stream ? ` · ${entry.stream}` : ""}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="panel__copy">No timeline entries matched the current view.</p>
            )}
          </div>
        </article>

        <article className="panel">
          <p className="panel__kicker">Search</p>
          <h2>{overview.search ? `Matches for “${overview.search.query}”` : "Search status"}</h2>
          {overview.search ? (
            <div className="search-results">
              <p className="panel__meta">{overview.search.total} hits returned by the query layer</p>
              {overview.search.hits.length ? (
                overview.search.hits.map((hit) => (
                  <article className="search-hit" key={`${hit.recordId}:${hit.date ?? "undated"}`}>
                    <div className="search-hit__eyebrow">
                      {hit.recordType}
                      {hit.kind ? ` · ${hit.kind}` : ""}
                      {hit.date ? ` · ${formatDate(hit.date)}` : ""}
                    </div>
                    <h3>{hit.title ?? hit.recordId}</h3>
                    <p>{hit.snippet}</p>
                  </article>
                ))
              ) : (
                <p className="panel__copy">The query parsed cleanly, but it did not score any hits.</p>
              )}
            </div>
          ) : (
            <p className="panel__copy">
              Submit a search term to inspect safe record fields without exposing vault paths.
            </p>
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
    <section className="panel panel--setup">
      <p className="panel__kicker">Setup required</p>
      <h2>No vault is configured yet</h2>
      <p className="panel__copy">
        Start the app with <code>{overview.envVar}</code> pointing at a Healthy Bob vault root.
        The app will not guess paths or scan your filesystem.
      </p>
      <div className="command-block">
        <code>{overview.suggestedCommand}</code>
      </div>
      <p className="panel__meta">Example relative path: {overview.exampleVaultPath}</p>
    </section>
  );
}

function ErrorState({ overview }: { overview: Extract<OverviewResult, { status: "error" }> }) {
  return (
    <section className="panel panel--setup">
      <p className="panel__kicker">Vault unreadable</p>
      <h2>{overview.message}</h2>
      <p className="panel__copy">{overview.hint}</p>
      <div className="command-block">
        <code>{overview.recoveryCommand}</code>
      </div>
    </section>
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
