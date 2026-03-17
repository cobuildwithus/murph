import Link from "next/link";
import type { Metadata } from "next";

import { loadRestingHeartRatePageFromEnv, type RhrPageResult } from "../../../src/lib/rhr";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Resting Heart Rate",
  description: "A graph-backed local health page for resting heart rate, linked protocols, and active experiment context.",
};

export default async function RestingHeartRatePage() {
  const result = await loadRestingHeartRatePageFromEnv();

  return (
    <main className="rhr-page">
      {result.status === "ready" ? <ReadyState result={result} /> : null}
      {result.status === "missing-config" ? <MissingConfigState result={result} /> : null}
      {result.status === "not-found" ? <NotFoundState result={result} /> : null}
      {result.status === "error" ? <ErrorState result={result} /> : null}
    </main>
  );
}

function ReadyState({ result }: { result: Extract<RhrPageResult, { status: "ready" }> }) {
  const { page } = result;
  const latestSample = page.personalStats.samples.at(-1) ?? null;

  return (
    <>
      <section className="rhr-hero">
        <div className="rhr-hero__copy">
          <p className="rhr-kicker">Biomarker graph</p>
          <div className="rhr-hero__rail" />
          <h1>{page.title}</h1>
          <p className="rhr-hero__lede">{page.summary}</p>
          <div className="rhr-chip-row">
            {page.domainLinks.map((domain) => (
              <span className="rhr-chip" key={domain.slug}>
                {domain.title}
              </span>
            ))}
          </div>
          <div className="rhr-prose">
            {page.introParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <div className="rhr-hero-stat-grid">
            {page.heroStats.map((stat) => (
              <article className="rhr-hero-stat-card" key={`${stat.label}:${stat.value}`}>
                <p>{stat.label}</p>
                <div>{stat.value}</div>
                <span>{stat.context ?? "reference"}</span>
              </article>
            ))}
          </div>
          <div className="rhr-link-row">
            <Link className="rhr-primary-link" href="/">
              Back to observatory
            </Link>
            {page.mission ? <span className="rhr-inline-note">Mission: {page.mission.title}</span> : null}
          </div>
        </div>

        <aside className="rhr-hero__panel">
          <div className="rhr-panel rhr-panel--signal">
            <p className="rhr-panel__eyebrow">Current signal</p>
            <div className="rhr-stat">
              <span className="rhr-stat__value">
                {page.personalStats.latestValue !== null
                  ? `${page.personalStats.latestValue.toFixed(0)}`
                  : "—"}
              </span>
              <span className="rhr-stat__unit">bpm</span>
            </div>
            <p className="rhr-panel__copy">
              {page.defaultMeasurementContext?.label ?? "Primary measurement context"}
            </p>
            <div className="rhr-trend-grid">
              <MetricBlock label="7d baseline" value={formatNumber(page.personalStats.baseline7, "bpm")} />
              <MetricBlock label="28d baseline" value={formatNumber(page.personalStats.baseline28, "bpm")} />
              <MetricBlock label="56d baseline" value={formatNumber(page.personalStats.baseline56, "bpm")} />
              <MetricBlock
                label="vs 28d"
                value={
                  page.personalStats.deltaFrom28 !== null
                    ? `${page.personalStats.deltaFrom28 > 0 ? "+" : ""}${page.personalStats.deltaFrom28.toFixed(1)} bpm`
                    : "—"
                }
              />
            </div>
            <p className="rhr-panel__meta">
              {latestSample?.occurredAt ? `Latest sample ${formatMoment(latestSample.occurredAt)}` : "No samples yet"}
            </p>
          </div>

          <div className="rhr-panel">
            <p className="rhr-panel__eyebrow">What this page tracks</p>
            <div className="rhr-context-list">
              {page.measurementContexts.map((context) => (
                <div className="rhr-context-row" key={context.slug}>
                  <div>
                    <h2>{context.label}</h2>
                    <p>{context.summary}</p>
                  </div>
                  <span>{context.unit ?? "unitless"}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="rhr-section-grid">
        <article className="rhr-sheet">
          <div className="rhr-sheet__header">
            <p className="rhr-kicker">Reference sets</p>
            <h2>Context first, not one universal range</h2>
          </div>
          <div className="rhr-reference-list">
            {page.referenceSets.map((reference) => (
              <article className="rhr-reference-card" key={`${reference.label}:${reference.benchmark}`}>
                <div className="rhr-reference-card__topline">
                  <span>{reference.kind ?? "reference"}</span>
                  <span>{reference.measurementContextLabel ?? "mixed context"}</span>
                </div>
                <h3>{reference.label}</h3>
                <div className="rhr-reference-card__value">{reference.benchmark}</div>
                <p>{reference.note ?? reference.population ?? "No note supplied."}</p>
                <SourceList links={reference.sourceLinks} />
              </article>
            ))}
          </div>
        </article>

        <article className="rhr-sheet">
          <div className="rhr-sheet__header">
            <p className="rhr-kicker">Why it moves</p>
            <h2>First-principles and system meaning</h2>
          </div>
          <InsightList insights={page.mechanisms} />
          <div className="rhr-sheet__divider" />
          <InsightList insights={page.signalInsights} />
        </article>
      </section>

      <section className="rhr-section-grid">
        <article className="rhr-sheet">
          <div className="rhr-sheet__header">
            <p className="rhr-kicker">Personal baseline</p>
            <h2>Your baseline matters more than the crowd mean</h2>
          </div>
          <InsightList insights={page.baselineInsights} />
        </article>

        <article className="rhr-sheet">
          <div className="rhr-sheet__header">
            <p className="rhr-kicker">Healthspan relevance</p>
            <h2>Observational, not magical</h2>
          </div>
          <InsightList insights={page.healthspanEvidence} />
        </article>
      </section>

      <section className="rhr-layout">
        <article className="rhr-sheet rhr-sheet--wide">
          <div className="rhr-sheet__header">
            <p className="rhr-kicker">Protocol playbook</p>
            <h2>Exact experiments, not vague advice</h2>
          </div>
          <div className="rhr-protocol-grid">
            {page.protocols.map((protocol) => (
              <article className="rhr-protocol-card" key={protocol.slug}>
                <div className="rhr-protocol-card__topline">
                  <span>{protocol.family?.title ?? "Protocol"}</span>
                  <span>{formatEvidence(protocol.effect.evidenceLevel, protocol.effect.confidence)}</span>
                </div>
                <h3>{protocol.title}</h3>
                <p>{protocol.summary}</p>
                <dl className="rhr-protocol-stats">
                  <div>
                    <dt>Expected</dt>
                    <dd>{protocol.effect.expectedDirection ?? "unknown"}</dd>
                  </div>
                  <div>
                    <dt>Latency</dt>
                    <dd>{protocol.effect.latency ?? "unknown"}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{protocol.effect.role ?? "watch"}</dd>
                  </div>
                  <div>
                    <dt>Source mode</dt>
                    <dd>{protocol.effect.sourceMode ?? "unknown"}</dd>
                  </div>
                </dl>
                <div className="rhr-mini-list">
                  {protocol.instructions.map((instruction) => (
                    <p key={instruction}>{instruction}</p>
                  ))}
                </div>
                {protocol.contraindications.length ? (
                  <div className="rhr-protocol-card__warnings">
                    {protocol.contraindications.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                ) : null}
                <SourceList links={[...protocol.sourcePeople, ...protocol.sourceLinks]} />
              </article>
            ))}
          </div>
        </article>

        <aside className="rhr-sidebar">
          <article className="rhr-sheet">
            <div className="rhr-sheet__header">
              <p className="rhr-kicker">Live user layer</p>
              <h2>Open goals</h2>
            </div>
            <div className="rhr-mini-list">
              {page.activeGoals.length ? (
                page.activeGoals.map((goal) => (
                  <article className="rhr-pill-card" key={goal.id}>
                    <h3>{goal.title}</h3>
                    <p>{goal.target ?? "No target captured."}</p>
                    {goal.measurementContextLabel ? <span>{goal.measurementContextLabel}</span> : null}
                  </article>
                ))
              ) : (
                <p className="rhr-empty">No active RHR-linked goals are configured.</p>
              )}
            </div>
          </article>

          <article className="rhr-sheet">
            <div className="rhr-sheet__header">
              <p className="rhr-kicker">Live run</p>
              <h2>Active experiment</h2>
            </div>
            <div className="rhr-mini-list">
              {page.activeExperiments.length ? (
                page.activeExperiments.map((experiment) => (
                  <article className="rhr-pill-card" key={experiment.slug}>
                    <h3>{experiment.title}</h3>
                    <p>{experiment.hypothesis ?? "No hypothesis recorded."}</p>
                    <span>
                      {experiment.protocol?.title ?? "Protocol pending"}
                      {experiment.startedOn ? ` · started ${formatDate(experiment.startedOn)}` : ""}
                    </span>
                  </article>
                ))
              ) : (
                <p className="rhr-empty">No active RHR-linked experiment runs are configured.</p>
              )}
            </div>
          </article>

          <article className="rhr-sheet">
            <div className="rhr-sheet__header">
              <p className="rhr-kicker">Guardrails</p>
              <h2>Do not game the number</h2>
            </div>
            <InsightList insights={page.guardrails} />
          </article>
        </aside>
      </section>

      <section className="rhr-footer">
        <article className="rhr-sheet rhr-sheet--wide">
          <div className="rhr-sheet__header">
            <p className="rhr-kicker">Linked graph</p>
            <h2>What RHR should connect to</h2>
          </div>
          <div className="rhr-chip-row">
            {page.goalTemplateLinks.map((goal) => (
              <span className="rhr-chip rhr-chip--ghost" key={goal.slug}>
                {goal.title}
              </span>
            ))}
            {page.relatedBiomarkerLinks.map((biomarker) => (
              <span className="rhr-chip rhr-chip--ghost" key={biomarker.slug}>
                {biomarker.title}
              </span>
            ))}
          </div>
          <SourceList links={page.sourceLinks} />
        </article>
      </section>
    </>
  );
}

function MissingConfigState({
  result,
}: {
  result: Extract<RhrPageResult, { status: "missing-config" }>;
}) {
  return (
    <section className="rhr-shell-card">
      <p className="rhr-kicker">Setup required</p>
      <h1>No vault is configured yet</h1>
      <p>
        Start the app with <code>{result.envVar}</code> pointing at a Healthy Bob vault root.
      </p>
      <div className="command-block">
        <code>{result.suggestedCommand}</code>
      </div>
      <p className="rhr-inline-note">Example vault path: {result.exampleVaultPath}</p>
    </section>
  );
}

function NotFoundState({
  result,
}: {
  result: Extract<RhrPageResult, { status: "not-found" }>;
}) {
  return (
    <section className="rhr-shell-card">
      <p className="rhr-kicker">Missing biomarker page</p>
      <h1>Resting heart rate is not defined in this vault</h1>
      <p>{result.message}</p>
      <Link className="rhr-primary-link" href="/">
        Back to observatory
      </Link>
    </section>
  );
}

function ErrorState({ result }: { result: Extract<RhrPageResult, { status: "error" }> }) {
  return (
    <section className="rhr-shell-card">
      <p className="rhr-kicker">Vault unreadable</p>
      <h1>{result.message}</h1>
      <p>{result.hint}</p>
      <div className="command-block">
        <code>{result.recoveryCommand}</code>
      </div>
    </section>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rhr-metric-block">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function InsightList({
  insights,
}: {
  insights: Array<{ body: string; stat: string | null; title: string; sourceLinks: Array<{ slug: string; title: string; url: string | null }> }>;
}) {
  return (
    <div className="rhr-insight-list">
      {insights.map((insight) => (
        <article className="rhr-insight-card" key={`${insight.title}:${insight.stat ?? "body"}`}>
          <div className="rhr-insight-card__header">
            <h3>{insight.title}</h3>
            {insight.stat ? <span>{insight.stat}</span> : null}
          </div>
          <p>{insight.body}</p>
          <SourceList links={insight.sourceLinks} />
        </article>
      ))}
    </div>
  );
}

function SourceList({
  links,
}: {
  links: Array<{ slug: string; title: string; url: string | null }>;
}) {
  if (!links.length) {
    return null;
  }

  return (
    <div className="rhr-source-list">
      {links.map((link) =>
        link.url ? (
          <a className="rhr-source-link" href={link.url} key={link.slug} rel="noreferrer" target="_blank">
            {link.title}
          </a>
        ) : (
          <span className="rhr-source-link" key={link.slug}>
            {link.title}
          </span>
        ),
      )}
    </div>
  );
}

function formatNumber(value: number | null, unit: string): string {
  return value !== null ? `${value.toFixed(1)} ${unit}` : "—";
}

function formatEvidence(level: string | null, confidence: number | null): string {
  if (!level && confidence === null) {
    return "evidence unknown";
  }

  const confidenceLabel = confidence !== null ? `${Math.round(confidence * 100)}%` : "n/a";
  return `${level ?? "evidence"} · ${confidenceLabel}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatMoment(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
