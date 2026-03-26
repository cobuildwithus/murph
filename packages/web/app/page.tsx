import {
  DEFAULT_SAMPLE_LIMIT,
  DEFAULT_TIMELINE_LIMIT,
  loadVaultOverviewFromEnv,
  type OverviewExperiment,
  type OverviewResult,
  type OverviewTimelineEntry,
  type OverviewWeeklyStat,
} from "../src/lib/overview";
import {
  buildInvestigationSurfaceNote,
  buildOverviewCompass,
  filterActiveExperiments,
} from "../src/lib/overview-compass";
import {
  loadDeviceSyncOverviewFromEnv,
  type DeviceSyncAccountRecord,
  type DeviceSyncOverview,
  type DeviceSyncProviderDescriptor,
} from "../src/lib/device-sync";

export const dynamic = "force-dynamic";

const PLACEHOLDER_STATS: OverviewWeeklyStat[] = [
  { stream: "sleep", currentWeekAvg: null, previousWeekAvg: null, deltaPercent: null, unit: "hrs" },
  { stream: "resting_heart_rate", currentWeekAvg: null, previousWeekAvg: null, deltaPercent: null, unit: "bpm" },
  { stream: "hrv", currentWeekAvg: null, previousWeekAvg: null, deltaPercent: null, unit: "ms" },
  { stream: "zone_2_5", currentWeekAvg: null, previousWeekAvg: null, deltaPercent: null, unit: "min/wk" },
  { stream: "strength", currentWeekAvg: null, previousWeekAvg: null, deltaPercent: null, unit: "min/wk" },
];

export default async function HomePage() {
  const [overview, deviceSync] = await Promise.all([
    loadVaultOverviewFromEnv({
      sampleLimit: DEFAULT_SAMPLE_LIMIT,
      timelineLimit: DEFAULT_TIMELINE_LIMIT,
    }),
    loadDeviceSyncOverviewFromEnv(),
  ]);

  return (
    <main className="mx-auto max-w-[1080px] min-h-screen px-6 pt-12 pb-24 max-sm:px-4 max-sm:pt-8 max-sm:pb-16">
      <header className="mb-10 animate-settle">
        <div className="flex items-end justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <div>
            <p className="text-accent font-display text-xs font-bold tracking-[0.14em] uppercase mb-3">Overview</p>
            <h1 className="font-display tracking-[-0.04em] text-[clamp(2.35rem,5vw,3.4rem)] leading-[0.94] mb-3">Healthy Bob</h1>
            <p className="text-muted text-base leading-relaxed max-w-[52ch]">
              What changed, what stayed steady, and what can stay simple.
            </p>
          </div>
          {overview.status === "ready" ? (
            <p className="text-muted font-display text-[0.78rem] font-bold tracking-[0.12em] uppercase">
              Last read {formatMoment(overview.generatedAt)}
            </p>
          ) : null}
        </div>
      </header>

      {overview.status === "ready" ? <ReadyState overview={overview} deviceSync={deviceSync} /> : null}
      {overview.status === "missing-config" ? <MissingConfigState overview={overview} /> : null}
      {overview.status === "error" ? <ErrorState overview={overview} /> : null}
    </main>
  );
}

function ReadyState({
  overview,
  deviceSync,
}: {
  overview: Extract<OverviewResult, { status: "ready" }>;
  deviceSync: DeviceSyncOverview;
}) {
  const stats = mergeWithPlaceholders(overview.weeklyStats);
  const compassRows = buildOverviewCompass(overview);
  const activeExperiments = filterActiveExperiments(overview.experiments);
  const investigationNote = buildInvestigationSurfaceNote(activeExperiments);

  return (
    <div className="grid gap-8 animate-settle">
      <CompassSection rows={compassRows} />

      <section>
        <div className="flex items-end justify-between gap-4 mb-4 max-sm:flex-col max-sm:items-start">
          <div>
            <p className="text-accent font-display text-xs font-bold tracking-[0.14em] uppercase mb-2">Week over week</p>
            <h2 className="font-display text-[1.4rem] font-bold tracking-[-0.02em]">Current signals</h2>
          </div>
          <p className="text-muted text-sm">Simple comparisons between this week and the last one.</p>
        </div>
        <div className="grid grid-cols-5 gap-3 max-[940px]:grid-cols-2 max-sm:grid-cols-1">
          {stats.map((stat) => (
            <div className="py-5 px-5 rounded-2xl bg-card border border-line" key={`${stat.stream}:${stat.unit ?? "none"}`}>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-display text-[2rem] font-bold tracking-[-0.03em] leading-none">
                  {stat.currentWeekAvg !== null ? formatStatValue(stat.currentWeekAvg) : "—"}
                </span>
                {stat.unit ? (
                  <span className="text-muted font-display text-xs font-bold uppercase">{stat.unit}</span>
                ) : null}
              </div>
              <div className="text-muted font-display text-xs font-medium tracking-wide uppercase">
                {humanizeToken(stat.stream)}
              </div>
              {stat.deltaPercent !== null ? (
                <div className={`text-xs font-display font-bold mt-1 ${stat.deltaPercent >= 0 ? "text-accent" : "text-warm"}`}>
                  {stat.deltaPercent >= 0 ? "+" : ""}{stat.deltaPercent.toFixed(1)}% vs last week
                </div>
              ) : (
                <div className="text-muted/40 text-xs mt-1">No prior week data</div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-4 max-sm:flex-col max-sm:gap-1">
          <h2 className="font-display text-[1.4rem] font-bold tracking-[-0.02em]">
            {overview.currentProfile?.title ?? "No current profile yet"}
          </h2>
          {overview.currentProfile?.recordedAt ? (
            <p className="text-muted text-sm shrink-0">{formatMoment(overview.currentProfile.recordedAt)}</p>
          ) : null}
        </div>
        <p className="text-muted leading-relaxed mb-5">
          {overview.currentProfile?.summary ??
            "The vault is readable, but there is no current profile summary yet."}
        </p>
        {overview.currentProfile?.topGoals.length ? (
          <div className="flex flex-wrap gap-2">
            {overview.currentProfile.topGoals.map((goal) => (
              <span className="inline-flex items-center font-display text-[0.88rem] font-bold text-accent bg-accent-soft/60 rounded-full py-2 px-4" key={goal.id}>
                {goal.title}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-muted text-sm">No top goals are linked to the current profile.</p>
        )}
      </section>

      <section>
        <div className="flex items-end justify-between gap-4 mb-4 max-sm:flex-col max-sm:items-start">
          <div>
            <h2 className="font-display text-xs font-bold tracking-[0.14em] uppercase text-accent mb-2">Current investigations</h2>
            <p className="text-muted text-sm">{investigationNote}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
          {activeExperiments.length ? (
            activeExperiments.map((experiment) => (
              <ExperimentCard experiment={experiment} key={experiment.id} />
            ))
          ) : (
            <p className="text-muted text-sm py-6 text-center col-span-2">No active investigations right now.</p>
          )}
        </div>
      </section>

      <DeviceSyncSection deviceSync={deviceSync} />

      <section>
        <h2 className="font-display text-xs font-bold tracking-[0.14em] uppercase text-accent mb-4">Recent activity</h2>
        <div className="grid gap-2">
          {overview.timeline.length ? (
            overview.timeline.map((entry) => <TimelineRow entry={entry} key={entry.id} />)
          ) : (
            <p className="text-muted text-sm py-6 text-center">No timeline entries matched the current view.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function CompassSection({ rows }: { rows: ReturnType<typeof buildOverviewCompass> }) {
  return (
    <section className="rounded-[1.8rem] border border-line bg-paper/80 shadow-card overflow-hidden">
      <div className="border-b border-line/70 px-6 py-5 max-sm:px-4">
        <p className="text-accent font-display text-xs font-bold tracking-[0.14em] uppercase mb-2">Weekly compass</p>
        <div className="flex items-end justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <div>
            <h2 className="font-display text-[1.6rem] font-bold tracking-[-0.03em]">What changed, what stayed steady, and what can stay simple</h2>
            <p className="text-muted text-sm leading-relaxed max-w-[64ch]">
              Use this as the first pass on the week before reacting to a single metric or adding another experiment.
            </p>
          </div>
        </div>
      </div>
      <div className="divide-y divide-line/70">
        {rows.map((row) => (
          <div className="grid grid-cols-[12rem_1fr] gap-4 px-6 py-4 max-sm:grid-cols-1 max-sm:px-4" key={row.label}>
            <div className="text-accent font-display text-[0.78rem] font-bold tracking-[0.12em] uppercase">{row.label}</div>
            <p className="text-foreground leading-relaxed">{row.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeviceSyncSection({ deviceSync }: { deviceSync: DeviceSyncOverview }) {
  return (
    <section className="rounded-[1.8rem] border border-line bg-paper/80 shadow-card overflow-hidden">
      <div className="border-b border-line/70 px-6 py-5 max-sm:px-4">
        <p className="text-accent font-display text-xs font-bold tracking-[0.14em] uppercase mb-2">
          Device sync
        </p>
        <div className="flex items-end justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <div>
            <h2 className="font-display text-[1.6rem] font-bold tracking-[-0.03em]">
              Wearable connections
            </h2>
            <p className="text-muted text-sm leading-relaxed max-w-[60ch]">
              Start OAuth from here, keep sync state in the local control plane,
              and leave room for more providers than WHOOP.
            </p>
          </div>
          {deviceSync.status === "ready" ? (
            <p className="text-muted font-display text-[0.78rem] font-bold tracking-[0.12em] uppercase">
              {deviceSync.accounts.length} linked account{deviceSync.accounts.length === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
      </div>

      {deviceSync.status === "unavailable" ? (
        <div className="px-6 py-6 max-sm:px-4">
          <div className="rounded-2xl border border-dashed border-line bg-card/70 p-5">
            <h3 className="font-display text-lg font-bold tracking-[-0.02em] mb-2">
              {deviceSync.message}
            </h3>
            <p className="text-muted text-sm leading-relaxed mb-4">{deviceSync.hint}</p>
            <div className="bg-ink rounded-xl text-[#f7f1e9] overflow-x-auto py-3 px-4">
              <code className="font-mono text-sm">{deviceSync.suggestedCommand}</code>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 px-6 py-6 max-sm:px-4">
          {deviceSync.providers.length ? (
            deviceSync.providers.map((provider) => (
              <DeviceProviderCard
                provider={provider}
                accounts={deviceSync.accounts.filter((account) => account.provider === provider.provider)}
                key={provider.provider}
              />
            ))
          ) : (
            <p className="text-muted text-sm">No device providers are registered in the local sync daemon.</p>
          )}
        </div>
      )}
    </section>
  );
}

function DeviceProviderCard({
  provider,
  accounts,
}: {
  provider: DeviceSyncProviderDescriptor;
  accounts: DeviceSyncAccountRecord[];
}) {
  const label =
    accounts.some((account) => account.status === "reauthorization_required")
      ? "Reconnect required"
      : accounts.some((account) => account.status === "active")
        ? "Connected"
        : "Not connected";
  const labelClass =
    label === "Connected"
      ? "text-accent bg-accent-soft/80"
      : label === "Reconnect required"
        ? "text-warm bg-[rgba(163,92,58,0.12)]"
        : "text-muted bg-card";
  const connectLabel =
    accounts.some((account) => account.status !== "active") || accounts.length === 0
      ? accounts.length === 0
        ? "Connect"
        : "Reconnect"
      : "Add another";

  return (
    <article className="rounded-[1.4rem] border border-line bg-card/80 p-5">
      <div className="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-display text-[1.15rem] font-bold tracking-[-0.02em]">
              {humanizeToken(provider.provider)}
            </h3>
            <span className={`inline-flex items-center rounded-full px-3 py-1 font-display text-[0.72rem] font-bold tracking-[0.12em] uppercase ${labelClass}`}>
              {label}
            </span>
          </div>
          <p className="text-muted text-sm leading-relaxed">
            Default scopes: {provider.defaultScopes.join(", ")}
          </p>
        </div>
        <a
          className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-2 font-display text-[0.8rem] font-bold tracking-[0.12em] uppercase text-bg transition-colors hover:bg-ink hover:text-[#f7f1e9]"
          href={`/devices/connect/${encodeURIComponent(provider.provider)}`}
        >
          {connectLabel}
        </a>
      </div>

      {accounts.length ? (
        <div className="mt-4 grid gap-2">
          {accounts.map((account) => (
            <DeviceAccountRow account={account} key={account.id} />
          ))}
        </div>
      ) : (
        <p className="text-muted text-sm mt-4">
          No account linked yet.
        </p>
      )}
    </article>
  );
}

function DeviceAccountRow({ account }: { account: DeviceSyncAccountRecord }) {
  return (
    <div className="rounded-xl border border-line/70 bg-card-strong/80 px-4 py-3">
      <div className="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <div className="min-w-0">
          <div className="font-display text-[0.95rem] font-bold tracking-[-0.01em]">
            {account.displayName ?? account.externalAccountId}
          </div>
          <div className="text-muted text-sm leading-relaxed">
            {humanizeToken(account.status)} · connected {formatMoment(account.connectedAt)}
          </div>
          {account.lastErrorMessage ? (
            <div className="text-warm text-xs mt-1">{account.lastErrorMessage}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={`/devices/accounts/${encodeURIComponent(account.id)}/reconcile?returnTo=/`} method="post">
            <button
              className="inline-flex items-center justify-center rounded-full border border-line bg-paper px-3 py-1.5 font-display text-[0.72rem] font-bold tracking-[0.12em] uppercase text-foreground transition-colors hover:border-accent hover:text-accent"
              type="submit"
            >
              Reconcile
            </button>
          </form>
          <form action={`/devices/accounts/${encodeURIComponent(account.id)}/disconnect?returnTo=/`} method="post">
            <button
              className="inline-flex items-center justify-center rounded-full border border-line bg-paper px-3 py-1.5 font-display text-[0.72rem] font-bold tracking-[0.12em] uppercase text-muted transition-colors hover:border-warm hover:text-warm"
              type="submit"
            >
              Disconnect
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function MissingConfigState({
  overview,
}: {
  overview: Extract<OverviewResult, { status: "missing-config" }>;
}) {
  return (
    <section className="animate-settle border border-line rounded-2xl p-8 max-w-[640px] max-sm:p-5">
      <p className="text-accent font-display text-xs font-bold tracking-[0.14em] uppercase mb-3">Setup required</p>
      <h2 className="font-display text-[1.5rem] font-bold tracking-[-0.03em] mb-3">No vault configured</h2>
      <p className="text-muted leading-relaxed mb-5">
        Start the app with <code className="font-mono text-[0.9em] bg-card-strong px-1.5 py-0.5 rounded">{overview.envVar}</code> pointing at a vault root, or save a default Healthy Bob vault first.
      </p>
      <div className="bg-ink rounded-xl text-[#f7f1e9] overflow-x-auto py-3 px-4 mb-3">
        <code className="font-mono text-sm">{overview.suggestedCommand}</code>
      </div>
      <p className="text-muted text-sm">Example: {overview.exampleVaultPath}</p>
    </section>
  );
}

function ErrorState({ overview }: { overview: Extract<OverviewResult, { status: "error" }> }) {
  return (
    <section className="animate-settle border border-line rounded-2xl p-8 max-w-[640px] max-sm:p-5">
      <p className="text-accent font-display text-xs font-bold tracking-[0.14em] uppercase mb-3">Vault unreadable</p>
      <h2 className="font-display text-[1.5rem] font-bold tracking-[-0.03em] mb-3">{overview.message}</h2>
      <p className="text-muted leading-relaxed mb-5">{overview.hint}</p>
      <div className="bg-ink rounded-xl text-[#f7f1e9] overflow-x-auto py-3 px-4">
        <code className="font-mono text-sm">{overview.recoveryCommand}</code>
      </div>
    </section>
  );
}

/* ── Subcomponents ── */

function ExperimentCard({ experiment }: { experiment: OverviewExperiment }) {
  return (
    <article className="bg-card/60 border border-line rounded-xl py-3.5 px-4 transition-colors hover:bg-card">
      <div className="flex items-baseline justify-between gap-3 mb-1 max-sm:flex-col max-sm:gap-0.5">
        <h3 className="font-display text-[0.95rem] font-bold tracking-[-0.01em]">{experiment.title}</h3>
        {experiment.status ? (
          <span className="text-accent font-display text-[0.72rem] font-bold tracking-wide uppercase shrink-0">{experiment.status}</span>
        ) : null}
      </div>
      {experiment.summary ? (
        <p className="text-muted text-sm leading-relaxed line-clamp-2">{experiment.summary}</p>
      ) : null}
      <div className="flex items-center gap-3 mt-2">
        {experiment.startedOn ? (
          <span className="text-muted text-xs">{formatDate(experiment.startedOn)}</span>
        ) : null}
        {experiment.tags.length ? (
          <div className="flex flex-wrap gap-1.5">
            {experiment.tags.map((tag) => (
              <span className="bg-accent-soft rounded-full text-accent font-display text-[0.72rem] font-bold py-0.5 px-2" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function TimelineRow({ entry }: { entry: OverviewTimelineEntry }) {
  return (
    <div className="flex items-baseline gap-4 py-2.5 border-b border-line/60 last:border-b-0 max-sm:flex-col max-sm:gap-0.5">
      <div className="text-warm font-display text-xs font-bold shrink-0 w-40 max-sm:w-auto">{formatMoment(entry.occurredAt)}</div>
      <div className="flex-1 min-w-0">
        <span className="font-display text-[0.95rem] font-bold">{entry.title}</span>
        <span className="text-muted text-sm ml-2">
          {humanizeToken(entry.entryType)}
          {entry.kind ? ` · ${humanizeToken(entry.kind)}` : ""}
          {entry.stream ? ` · ${humanizeToken(entry.stream)}` : ""}
        </span>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function mergeWithPlaceholders(weeklyStats: OverviewWeeklyStat[]): OverviewWeeklyStat[] {
  const remaining = [...weeklyStats];
  const merged = PLACEHOLDER_STATS.map((placeholder) => {
    const exactIndex = remaining.findIndex(
      (stat) => stat.stream === placeholder.stream && stat.unit === placeholder.unit,
    );

    if (exactIndex >= 0) {
      return remaining.splice(exactIndex, 1)[0]!;
    }

    const fallbackIndex = remaining.findIndex(
      (stat) => stat.stream === placeholder.stream,
    );

    if (fallbackIndex >= 0) {
      return remaining.splice(fallbackIndex, 1)[0]!;
    }

    return placeholder;
  });

  return [...merged, ...remaining];
}

function formatStatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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
