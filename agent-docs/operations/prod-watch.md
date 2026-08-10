# Production Watch

Last verified: 2026-08-09

## Decision

Use **macOS `launchd` as the authoritative five-minute scheduler**, a deterministic local collector as the evidence boundary, and a **new `codex exec --ephemeral` process only for the bounded MCP stage and incident triage**. Do not use a Codex desktop scheduled task as the production scheduler.

The target lifecycle is hybrid:

1. `launchd` starts one local supervisor every 300 seconds.
2. The supervisor acquires a non-waiting run lock and gathers the deterministic database/repository snapshot.
3. Once noninteractive MCP behavior is proven in shadow mode, the supervisor starts a new ephemeral, read-only Codex process to gather provider aggregates into `prod-watch.provider-evidence.v1`.
4. Local code validates, merges, scores, deduplicates, and persists the result. Codex does not own thresholds, leases, state transitions, or file formats.
5. Only a promoted incident gets a separate fresh triage session. Database incidents support incident-scoped drill-down; Phase 1 provider incidents are claim-and-escalate only.

Phase 1 intentionally implements only step 1, step 2, and local scoring/state. It never labels missing MCP coverage healthy: Vercel, Cloudflare, and Stripe appear as `not_collected`, and the run status is `partial`. This is safer than wiring an unmeasured autonomous agent into a five-minute loop.

A strict “fresh Codex plus all MCPs every five minutes” mode can follow the same supervisor contract, but it is not cheap: it creates 288 sessions per day. Keep that mode shadow-only until cost, duration, rate-limit behavior, and evidence precision are measured. The durable end state should replace any provider MCP that gains a safe noninteractive API credential with deterministic local adapter code.

## Why not the alternatives

| Model | Decision | Reason |
| --- | --- | --- |
| Codex desktop scheduled task | Reject as scheduler of record | It couples liveness to an interactive app/task service, gives the local state owner weaker process and overlap control, and does not provide the repo-owned installation/status contract required here. |
| `launchd` directly running a long-lived agent | Reject | Long-lived context increases prompt-injection, state leakage, and duplicate-remediation risk. |
| `launchd` + fresh `codex exec --ephemeral` | Target | `launchd` owns cadence and crash semantics; each Codex process starts without resumable session state; JSON schema and read-only sandbox bound its role. |
| Hosted scheduler | Future dead-man/portability option | It is preferable for always-on coverage, but current MCP and Keychain-backed database authorization are machine-local. Do not move secrets merely to host the scheduler. |

## Five-minute lifecycle

The scheduled interval is 300 seconds. One run has a 240-second deadline, leaving 60 seconds for process teardown and the next tick.

1. `launchd` invokes the current verified Node executable directly with the repository-local `tsx` entrypoint and `prod-watch.ts run --scheduled`. It exports one fixed, bounded PATH containing `$HOME/.local/bin` plus standard Homebrew/system directories, so the Keychain-backed database helper is reachable without inheriting an interactive shell environment; it does not depend on launchd finding a shell-only pnpm/Corepack shim.
2. The command creates one contender claim in `.runtime/tmp/prod-watch/run.lock`; the oldest live claim wins. A dead PID is recoverable, and claims older than 10 minutes are stale even if the PID was reused. `launchd` itself skips an interval that fires while the job is still running; the lock additionally protects manual runs, duplicate installations, and other launchers. Any losing invocation records one bounded overlap marker and exits successfully without starting another collector.
3. The collection window ends 60 seconds before collection time to tolerate ingestion lag. It compares adjacent 15-minute windows, so every event is seen in multiple scheduled runs without becoming duplicate incident state.
4. The database adapter sends fixed SQL to `murph-prod-psql-ro` on stdin. The helper remains the only PostgreSQL entry point. The child has a 30-second deadline and bounded stdout/stderr capture. Only stdout is parsed; stderr contents are discarded and reduced to a redacted error code. A stdin failure enters the same terminate-then-force-terminate lifecycle as timeout or abort, and the parent does not settle until the child exits.
5. In the target hybrid, a new `codex exec --ephemeral` process receives only the bounded database snapshot, the production-watch skill, and a JSON output schema. It uses read-only sandboxing, queries aggregate MCP surfaces, writes one temporary provider envelope, and exits. The file is validated locally and deleted after merge.
6. Local code evaluates fixed rules, advances consecutive-source-observation streaks, deduplicates by stable fingerprint, and writes state/projections under a separate state lock. Only fresh, complete, authenticated, successful evidence contributes production counters, latency, fingerprints, or provider release context. Degraded, partial, stale, failed, or unauthenticated evidence contributes monitor-health incidents only. One observation rule governs every source-owned state slice: evidence in any status uses its source `collectedAt`; a fresh deterministic collection/admission failure without evidence uses its attempt time; and absence is no observation. Replays and unrelated-source ticks preserve state. A newer non-scorable observation may advance monitor recurrence while preserving production streaks and trusted cumulative baselines; a newer scorable clean observation resets source streaks and updates any supplied cumulative totals.
7. Files are written to a same-directory temporary file, synced, chmod `0600`, and renamed. Directories use `0700`.
8. Healthy scheduled runs produce no terminal output. New incidents, degraded monitor health, manual runs, and dry runs return a small summary.
9. A normal exit removes its contender claim. If the process crashes or is force-killed, a later tick removes the claim when its recorded PID is no longer alive or when it is older than the 10-minute PID-reuse fence. `launchd` does not use `KeepAlive`, so it does not create a crash loop; the next 300-second tick retries.
10. Missed ticks are not replayed in a burst after sleep. Scheduler lag and the last successful collection are explicit monitor-health fields.

The scheduler itself cannot prove that a powered-off laptop or unloaded `launchd` job is alive. Add an external dead-man alert only after the local false-positive rate is understood; it must receive heartbeat metadata, never production evidence.

## One-command interface

The public package entry point is:

```sh
pnpm --silent prod-watch <command>
```

### Collection and dry run

```sh
# Aggregate-only snapshot to stdout. Does not persist state.
pnpm --silent prod-watch collect --lookback-minutes 15 --output -

# Exercise synthetic parsing and scoring without state/projection writes.
pnpm --silent prod-watch collect --fixture healthy --output -
pnpm --silent prod-watch collect --fixture suspicious --output -

# Exercise live-helper scoring and locking without state/projection writes.
pnpm --silent prod-watch run --dry-run

# Merge a schema-validated provider envelope produced by a fresh Codex MCP pass.
# The file must be current-user-owned, mode 0600, and inside a private temporary directory.
pnpm --silent prod-watch run --dry-run --provider-evidence "$PROVIDER_EVIDENCE_FILE"
```

### Scheduler

```sh
pnpm --silent prod-watch scheduler render --output -
pnpm --silent prod-watch scheduler install
pnpm --silent prod-watch scheduler status
pnpm --silent prod-watch scheduler uninstall
```

`install` first verifies the current Node executable, repository-local `tsx`, tools tsconfig, production-watch entrypoint, and an executable `murph-prod-psql-ro` reachable through the exact fixed scheduler PATH. It then renders that direct chain with `$HOME`-relative paths where needed. Verification happens before an existing managed job is stopped. The command writes the plist under the current user's LaunchAgents directory and uses `launchctl bootstrap`. It refuses repositories outside the current home directory, unsafe paths, or an unavailable executable/helper chain. Neither the checked-in template nor the rendered plist contains a concrete home directory, account name, or secret. Install, replacement, and uninstall verify the label with `launchctl print`; an unknown service state is an error, and uninstall preserves the managed plist until absence is proven. Status reports `launchdState` as `loaded`, `absent`, or `unknown` and uses `loaded: null` for the unknown case. Routine stdout/stderr goes to `/dev/null`; monitor state plus `launchctl` status are the diagnostic surface.

### Incident coordination and drill-down

```sh
pnpm --silent prod-watch incident list
pnpm --silent prod-watch incident claim "$INCIDENT" --session-id "$CODEX_THREAD_ID"
pnpm --silent prod-watch incident heartbeat "$INCIDENT" --session-id "$CODEX_THREAD_ID"
# Database incidents only:
pnpm --silent prod-watch drill-down "$INCIDENT" --session-id "$CODEX_THREAD_ID" --lookback-minutes 60
pnpm --silent prod-watch incident transition "$INCIDENT" \
  --session-id "$CODEX_THREAD_ID" \
  --state escalated
```

The incident projections show each incident's source. Database incidents support the full list → claim → drill-down → transition journey. Phase 1 provider incidents support list → claim → transition to `escalated`; provider drill-down is not advertised because the temporary provider envelope has already been removed. The CLI rejects a provider incident before heartbeating or persisting its lease, and it rejects an undisclosed provider-envelope input on the drill-down command. Synthetic fixtures are accepted only by read-only `collect`; `run` and `drill-down` reject `--fixture` before lock acquisition, lease extension, or any state/projection write.

The target MCP command shape is intentionally external to Phase 1:

```sh
codex exec --ephemeral --sandbox read-only --json \
  --output-schema scripts/prod-watch/schemas/provider-evidence.v1.schema.json \
  --output-last-message "$PROVIDER_EVIDENCE_FILE" -
```

The prompt is supplied on stdin and tells Codex to use the production-watch skill, query only aggregate MCP surfaces, and emit no prose. The wrapper streams the `--json` event output through a bounded parser that retains only the session/thread ID and terminal status; it never persists tool events. It must create the final envelope below a `0700` temporary directory as a current-user-owned `0600` file, cap the child runtime, validate the result locally, and remove the file after the merge succeeds or fails. The collector rejects symlinks, non-private permissions, unexpected ownership, oversized files, and invalid envelopes outside explicit fixture mode.

### Remediation

```sh
pnpm --silent prod-watch remediate "$INCIDENT"
```

This command fails with `automation_disabled_phase_1`. Code modification, worktree creation, GitHub writes, merge, and deployment are outside Phase 1.

## Snapshot schema

`scripts/prod-watch/schemas/snapshot.v1.schema.json` is the machine contract. It is strict (`additionalProperties: false`) and bounded.

| Section | Contents |
| --- | --- |
| `run` | Run ID, mode, dry-run flag, exact windows, duration, timeout, scheduler lag, overlap observation. |
| `monitor` | `healthy`, `partial`, or `degraded`; configured and collected sources; evidence completeness. |
| `sourceHealth` | Per-source status, auth status, collection access class, coverage, freshness, redacted error code. |
| `releaseContext` | Runtime token, release SHA, observed/deployed time, current marker. |
| `counters` | Allowlisted metric and dimensions, adjacent-window values, sample counts. |
| `latency` | Count, p50/p95/p99/max, and previous-window p95/p99. |
| `fingerprints` | SHA-256 stable fingerprint plus allowlisted component/phase/operation/surface/severity/error tokens and counts. |
| `anomalyCandidates` | Rule, severity, policy class, canonical redacted metric/dimension signal, threshold evidence, correlation, consecutive-run requirement. |
| `collectorFailures` | Source, failure class, redacted code, retryability. |
| `redaction` | Policy version and assertions that raw text/direct identifiers are absent. |

Unknown fields, overlong arrays, arbitrary dimensions, free-form text, invalid timestamps, and malformed tokens fail closed. The local parser also rejects absolute/local paths, URLs, UUIDs, common provider/direct-ID shapes, credential-shaped values, JWTs, and long numeric identifiers before evidence can enter state or a projection. The production source universe is always database, Vercel, Cloudflare, and Stripe; callers cannot narrow it. Complete provider `ok` coverage requires `auth: ok` and a provider-wide request/error/timeout triple whose exact dimensions are only `{source}`. Surface-specific counters are supplementary, and every emitted exact-dimension triple must still be complete. Measured zero numerators are valid, but missing numerators are unknown. Provider producers cannot supply `sampleCount` fields: the matching exact-dimension request counter is the only rate denominator and the local scorer owns that relation. A source failure never becomes a zero counter. Evidence that is degraded, partial, stale, failed, or unauthenticated is excluded from production scoring and provider release correlation; its health/failure metadata still drives monitor incidents.

The serialized fingerprint bound is 37: 13 ranked database fingerprints plus eight from each provider. Sensitive and critical fingerprints are ranked before ordinary volume at collection time and are retained before presentation capacity is filled. The anomaly bound is the derived worst-case 245 candidates across failures, source health, counters, latency, and fingerprints, so mandatory sensitive, critical, and alert-only candidates cannot be removed by a display limit.

## Adapter ownership

| Source | Phase 1 | Target | Notes |
| --- | --- | --- | --- |
| PostgreSQL | Deterministic local SQL | Same | Fixed query on stdin through `murph-prod-psql-ro`; read-only transaction; no connection string. |
| Repository SHA | Deterministic local Git read | Same | Context only; never production truth by itself. |
| Vercel | MCP envelope, manual/shadow | Deterministic adapter when noninteractive auth is available; otherwise fresh Codex MCP | Aggregate deployment, error count/rate, and latency only. |
| Cloudflare Observability | MCP envelope, manual/shadow | Same transition rule | Aggregate Worker/runtime errors, timeouts, and latency only. |
| Stripe | MCP envelope, manual/shadow | Same transition rule | Aggregate API/webhook health only; never customer, charge, invoice, or payment-method records. |

MCP calls are isolated by provider. One failure is represented for that source and does not erase successful evidence from other sources. Provider rate-limit and auth failures are monitor incidents, not production-zero evidence.

The first database query deliberately omits full workspace/checkpoint scans: the relevant workspace fields are not indexed for a five-minute fleet-wide query in the inspected schema. Its assistant-issue scan uses the canonical `hosted` environment persisted by the current writer/importer and intentionally emits no database release context because that writer owns neither runtime name nor release SHA. The query carries the writer-owned operation and surface tokens through the importer into the bounded fingerprint identity and sensitivity classifier. Incident drill-down uses exact fingerprint equality whenever the incident owns a source fingerprint; metadata matching is only a fallback for records without one. Its issue and ingress scans are constrained to the repository's finite severity/source domains so the existing `(severity, occurred_at)` and `(source, accepted_at)` indexes are usable. Add a purpose-built indexed aggregate or existing operational summary before monitoring workspace/checkpoint fields at this cadence.

## Machine state and projections

```text
.runtime/
  operations/prod-watch/
    state.v1.json
    last-overlap.v1.json
  projections/prod-watch/
    latest.snapshot.v1.json
    ACTIVE_INCIDENTS.md
    INCIDENT_HISTORY.md
    MONITOR_STATUS.md
  tmp/prod-watch/
    run.lock/
    state.lock/
```

`state.v1.json` is durable machine-local coordination state. It stores monitor health, the latest observation identity/classification per source, anomaly streaks, cumulative-counter baselines, the Phase 1 incident lifecycle, triage lease metadata, and handling sessions. It contains no raw snapshots, production bodies, remediation lifecycle, or pull-request state. Active projections expose the source, short incident ID, and canonical redacted Signal accepted by claim, heartbeat, and transition commands; database incidents also accept the ID for drill-down. Metric signals have the form `metric|key=value|key=value` with sorted exact dimensions, so simultaneous provider/database surfaces remain distinguishable. A rate incident's drill-down retains only its matching numerator and denominator at those exact dimensions; latency and fingerprint drill-downs are equally exact. The fingerprint prefix is diagnostic only.

The Markdown files are rebuildable atomic projections. They are ignored by Git and must never be edited as inputs. `ACTIVE_INCIDENTS.md` shows nonterminal incidents and current lease ownership. `INCIDENT_HISTORY.md` shows terminal and active history without private production data. `MONITOR_STATUS.md` shows scheduler/coverage health.

JSON is sufficient for Phase 1 because state is small, single-host, and serialized by one state lock. Move baseline history to SQLite only when rolling baselines require many samples or multi-process queries; do not introduce SQLite merely for incident rows.

### Deduplication and retention

- Incident fingerprint = SHA-256 of source and rule plus the scored metric and canonical exact dimensions for metric/latency candidates, or the bounded source fingerprint for fingerprint candidates.
- Counts, timestamps, and release SHA do not participate, so one continuing regression survives new windows and release observations.
- New candidates must satisfy their consecutive-source-observation gate before promotion. The state owner records one latest observation identity/classification per source. A production streak advances only on a newer scorable observation; a monitor streak advances only on a newer observation carrying that monitor candidate; unobserved/replayed sources preserve all streaks; newer non-scorable observations preserve production streaks; newer clean observations reset source streaks; and bounded retention still expires them.
- Cumulative totals retain their last trusted value across absent, failed, degraded, stale, unavailable, or unauthenticated ticks. A newer scorable value replaces that baseline, so a recovery observation detects a positive delta across the collection gap instead of silently losing it.
- Repeated occurrences update `lastSeenAt`, count, evidence, and release context on the same incident.
- Incidents retain at most 32 transitions. Terminal incidents retain 180 days, with a hard cap of 2,000 records.
- Triage leases are per incident. Phase 1 has no remediation lease or remediation state owner.
- Leases have owner session and acquired/heartbeat/expiry times. A different session cannot claim before expiry. Stale leases are recovered on state read.

## Incident state machine

```text
anomaly observation
  └─(consecutive/min-volume gate)─> candidate
provider candidate ─claim triage─> claimed_triage ─> escalated only
database candidate ─claim triage─> claimed_triage ─> investigating
claimed_triage/investigating ─> confirmed               (causal chain supported)
                              ├─> monitor_incomplete    (coverage/provider failure)
                              ├─> escalated             (sensitive or unsafe)
                              └─> false_positive        (terminal)
monitor_incomplete ─> investigating | escalated | false_positive
confirmed/escalated ─> resolved                         (external fix observed)
```

A lease claim records the handling session. State transitions require that same owner while the lease is live. Provider incidents reject every target except `escalated` in the state authority; the broader diagnostic and terminal graph is database-only. `false_positive` and `resolved` are terminal. Every observation of an existing nonterminal incident updates its last-detected evidence before the new-incident streak gate, so a current recurrence cannot be mistaken for a later clean pass. Phase 1 permits coordination and escalation but disables the future remediation command. A later edit phase must introduce and prove its own remediation lifecycle and global lease rather than carrying unreachable future states in the Phase 1 record.

## First-release anomaly rules

Adjacent 15-minute windows are the initial baseline. Fixed ceilings remain as a fallback; no rolling statistical baseline ships until enough clean history exists.

| Rule | Minimum volume | Candidate threshold | Promotion | Policy |
| --- | ---: | --- | ---: | --- |
| Source auth failure | N/A | Any explicit auth failure | 1 run | Alert only. |
| Other source collection failure | N/A | Timeout, rate limit, schema, unavailable, internal | 2 runs | Alert only; never infer source health. |
| Degraded source | N/A | Adapter explicitly reports partial/degraded evidence | 2 runs | Alert only. |
| Stale source | N/A | Evidence freshness >30 minutes | 2 runs | Alert only. |
| Provider/deployment error-rate regression | 50 requests/deployments and 10 errors | Current rate >=2%, at least 3x prior rate, and +1 percentage point; or fixed >=5% when no baseline exists | 2 runs | Diagnosis only unless deployment-correlated and nonsensitive. Stripe remains alert-only. |
| Runtime/assistant error-count regression | 10 errors/issues | At least 3x prior count and +10; prior window required | 2 runs | Diagnosis only unless deployment-correlated and nonsensitive. |
| Provider/ingress timeout-rate regression | 50 requests/accepted ingress items and 5 timeouts/incomplete items | Current rate >=1%, at least 3x prior rate, and +0.5 percentage point; or fixed >=2% when no baseline exists | 2 runs | Diagnosis only unless deployment-correlated and nonsensitive. Stripe remains alert-only. |
| Runtime timeout-count regression | 5 timeouts | At least 3x prior count and +5; prior window required | 2 runs | Diagnosis only unless deployment-correlated and nonsensitive. |
| p95 latency | 30 samples | >=2x prior p95 and +2 seconds; or fixed >=15 seconds | 2 runs | Diagnosis only unless deployment-correlated and nonsensitive. |
| p99 latency | 30 samples | >=2x prior p99 and +5 seconds; or fixed >=60 seconds | 2 runs | Same. |
| DB connection pressure | N/A | Used/max connections >=90% | 2 runs | Alert/diagnose; never mutate DB. |
| DB blocked sessions | N/A | >=5 blocked sessions | 2 runs | Alert/diagnose. |
| Long DB transaction | N/A | >=1 transaction older than 5 minutes | 2 runs | Alert/diagnose. |
| Deadlock increase | N/A | Positive delta in cumulative deadlocks | 1 run | Alert/diagnose. |
| Sensitive-domain fingerprint | Any matching fingerprint | Billing/auth/privacy/consent/deletion/data-loss/corruption/canonical-write/replay/idempotency/credential/payment/medical/clinical/health token | 1 run | Alert and escalate only. |

Deployment correlation requires a concrete provider `deployedAt` within 60 minutes of the anomaly. Merely observing a release SHA in database issue rows is not enough. Promotion is suppressed when minimum volume is absent. A rule must not compare against a missing baseline as though the baseline were zero.

Fixed thresholds should be versioned in code and changed only with fixture/test evidence. After at least two weeks of clean aggregate history, add robust per-metric/per-dimension medians and median absolute deviation, with minimum clean sample counts and release-aware suppression. Do not train a baseline on active incident windows.

## Severity and automation policy

### Always alert and escalate

- Billing/payment/Stripe correctness; every Stripe anomaly is treated as billing-sensitive even when its metric name is generic
- Authentication/session/authorization
- Privacy, consent, deletion, export, or credential boundaries
- Data loss, corruption, canonical-write, replay, or idempotency risk
- Medical or health-data exposure/incorrect handling
- Database integrity, migration, or schema incidents
- Any incident with incomplete relevant evidence

These may be diagnosed, but production-watch must not edit or open a PR autonomously for them.

### Evidence needed for automatic diagnosis

All must hold:

1. Stable fingerprint promoted under its rule.
2. Relevant source coverage is complete and fresh.
3. Minimum volume and baseline requirements are met.
4. At least two independent aggregate signals agree, or one aggregate signal is reproduced by a deterministic test against the implicated code path.
5. A concrete release/deployment window supports the timing when the diagnosis blames a deployment.
6. Repository search identifies a narrow reachable path; no raw production data is needed.
7. The incident is not sensitive or otherwise alert-only.

### Future worktree/edit gate

A later phase may create an isolated worktree only after it adds and proves a single global remediation lease, the diagnosis gate passes, the base branch/head is recorded, and the patch fits an explicit low-risk allowlist. Initial limits should be no dependency changes, migrations, data repair, auth/billing/privacy/health handling, deployment config, or application state-machine changes; at most five files and 300 changed lines; and a deterministic regression test must fail before and pass after the patch.

### ReviewGPT and PR gate

Use existing `pnpm review:gpt` once per incident fingerprint **and exact patch head**, with only:

- the redacted incident snapshot/drill-down;
- a concise causal-chain statement;
- the minimal diff;
- directly relevant source and tests.

Never send raw logs. Do not invoke ReviewGPT on each five-minute recurrence. A later remediation phase must add bounded operational fields for the last reviewed fingerprint, patch head, outcome, and time before enabling this gate. Retry at most twice for invalid/tool failures. An unchanged fingerprint-and-patch-head pair has a six-hour cooldown. A substantive rejection requires a changed patch or new evidence, not a retry.

Only an approved, verified low-risk patch may become a **draft** PR. Production-watch never merges, enables auto-merge, deploys, mutates production state, or declares resolution merely because a PR exists.

## Self-monitoring

The monitor projection exposes:

- last scheduled run;
- last successful deterministic collection;
- last complete all-source evidence time;
- last run duration and scheduler lag;
- configured and collected source coverage;
- source failure streaks and stale/auth state;
- overlap skip count;
- active incident count and lease owner;
- latest snapshot schema/collector version.

Alert suppression rules:

- One overlap is monitor health, not a production incident; repeated overlaps indicate duration/capacity trouble.
- A provider outage produces one deduplicated monitor incident per source/rule, updated in place.
- Never suppress auth failures.
- Do not emit production anomalies from a source whose collection failed.
- A partial run cannot close an existing incident that depends on missing evidence.
- Healthy scheduled runs stay silent; `scheduler status` is the operator read surface.

## Threat model

| Threat | Control |
| --- | --- |
| Database secret exposure | Only hard-coded `murph-prod-psql-ro`; SQL on stdin; no URL/env discovery; bounded child output; no stderr persistence. |
| Private production data leakage | Aggregate-only fixed SQL; strict allowlists; hashed fingerprints; unknown-field rejection; no raw text fields; latest snapshot only. |
| Prompt injection in logs/provider output | Raw text is never ingested; tokens are allowlisted/normalized; evidence is data under a strict JSON schema; fresh read-only sessions; skill explicitly rejects embedded instructions. |
| Compromised/malformed provider evidence | Strict schema, source uniqueness, bounded arrays, token/timestamp checks, local anomaly code; failure becomes monitor-degraded, not zero evidence. |
| Runaway automation | 240-second run deadline, 30-second adapter deadline, output limits, no Phase 1 writes beyond local state, no PR/merge/deploy command. |
| Overlapping agents/split ownership | Non-waiting run lock, serialized state lock, per-incident triage leases, heartbeat/expiry, and handling-session checks. Phase 1 has no remediation owner. |
| Provider outage/rate limit | Isolated source failure, deduplicated alert, partial/degraded status, no incident closure or remediation based on missing evidence. |
| State corruption or final-path symlink | Private directories, exact schema parsing, final-directory checks, atomic same-directory rename, fail-closed reads, ignored machine-local paths. |
| Laptop sleep/offline | Scheduler lag and stale success metadata; no catch-up storm. External metadata-only dead-man is required for true 24/7 assurance. |
| Malicious code change to monitor | Review the production-watch diff like any operational code; fixtures assert private fields never enter SQL/schema; monitor has no production write credentials. |

## Verification matrix

| Surface | Proof |
| --- | --- |
| Schema bounds/redaction | Healthy fixture serializes without fixture raw fingerprint or forbidden identifier/text keys; strict provider evidence rejects extra prompt/log fields. |
| Anomaly rules | Suspicious fixture proves sensitive escalation, deployment correlation, and two-window promotion for noisy rates. |
| Deduplication | Same source/rule dimensions stay one incident across windows and release SHA changes. |
| Lease safety | A second triage owner cannot claim; stale dead-PID/PID-reuse claims are recoverable; live lock is not stolen; malformed incident state fails closed. |
| Timeout/failure isolation | Fake database helpers hang, close stdin early, and ignore the first termination request; the collector preserves bounded termination ownership, waits for exact child exit, emits only a redacted helper failure/timeout, and recovers for the next collection. |
| Fixture/read-only boundary | Fixtures exercise `collect` only. `run`, `run --dry-run`, and `drill-down` reject fixtures before state locks or leases and leave state, projections, and the latest snapshot byte-for-byte unchanged. |
| Provider evidence | A source-wide `{source}` request/error/timeout triple is the sole source-completeness proof; consistent surface-only subsets remain partial. Exact-dimension rate denominators remain mandatory supplementary proof. |
| Source-aware recurrence | Replaying one provider envelope cannot advance a streak; database-only ticks preserve it; a newer provider observation advances or cleanly resets it; retention expiry resets it. |
| Monitor/cumulative observation ownership | Replaying one unchanged failed provider envelope leaves monitor and failure streaks unchanged; a newer failed observation advances the chosen monitor policy; newer clean evidence resets it. A failed database tick preserves the trusted cumulative baseline and a higher recovery total detects the intervening delta. |
| Dry run | Live-helper dry run produces a snapshot without state or Markdown projection files. |
| Database boundary | Static proof requires a read-only transaction, bounded timeouts, and no private columns. The opt-in `scripts/prod-watch.database.integration.test.ts` lane runs the exact CLI query through `murph-prod-psql-ro`, retains the aggregate snapshot only in memory, and validates the strict snapshot contract without printing the payload. |
| Database fingerprint identity | Static writer/importer/SQL proof and behavioral parsing prove allowlisted operation/surface propagation, sensitive classification, and exact source-fingerprint drill-down matching. |
| Scheduler | Template proof requires a 300-second interval, `KeepAlive=false`, placeholders, a fixed helper PATH, and no machine path. Rendered output retains literal `$HOME` paths and rejects unsafe repository paths. A macOS-only command smoke starts from a minimal launchd environment, makes `murph-prod-psql-ro` available only at `$HOME/.local/bin`, runs the exact rendered Node/tsx chain, and proves complete database collection. A separate disposable-home/fake-`launchctl` lifecycle test proves helper verification before replacement, unmanaged-file refusal, managed replacement, failed-enable cleanup, and uninstall behavior; an operator smoke remains required before activation. |
| JSON contracts | All checked-in schemas parse; fixture evidence passes the runtime's strict parsers and produces the documented `snapshot.v1` shape. |
| Repo gates | `pnpm test:repo-tools -- scripts/prod-watch.test.ts`, tools typecheck, `git diff --check`, and relevant docs checks. |

## Rollout and rollback

### Stage 0 — local scaffold

- Run read-only fixture collection and tests; fixtures are never state-writing run or drill-down inputs.
- Inspect generated Markdown projections.
- Validate the SQL against a disposable/local production-shaped schema with the read-only role.
- Do not install the scheduler.

### Stage 1 — shadow database collection

- Install `launchd` with database-only collection for at least two weeks.
- No external alerts, Codex MCP loop, edits, or PRs.
- Review monitor duration, missed/overlap ticks, query cost, incident precision, and redaction assertions daily.
- Treat status as `partial`, never healthy.

### Stage 1.5 — provider MCP shadow

- Run fresh ephemeral read-only Codex provider collection manually, then on a limited cadence.
- Compare MCP aggregate results with provider dashboards.
- Measure session cost, p95 duration, auth/rate-limit failure rate, and false-positive contribution.
- Enable every-five-minute provider coverage only when p99 completes comfortably inside the 240-second budget and output validation is consistently clean.

### Stage 2 — alert and human triage

- Enable deduplicated local/external notification for promoted incidents.
- Require manual claim and diagnosis.
- Target at least 20 reviewed incidents, at least 90% actionable precision for remediation-candidate rules, and zero sensitive-domain automation mistakes before any edit phase.

### Stage 3 — draft-PR automation for a tiny allowlist

- Add and prove one global remediation lease before any edit path.
- Isolated worktree, deterministic regression test, patch budget, repo gates, ReviewGPT approval.
- Draft PR only. No merge or deployment.

Rollback is immediate and application-independent:

```sh
pnpm --silent prod-watch scheduler uninstall
```

This stops future runs. Local aggregate state remains for audit until intentionally removed. No application runtime, database schema, or production provider state is changed by Phase 1.

## Repository layout

```text
scripts/prod-watch.ts                         # CLI/supervisor
scripts/prod-watch/core.ts                    # Pure schemas, rules, state, leases, projections
scripts/prod-watch/collect-v1.sql             # Fixed read-only aggregate query
scripts/prod-watch/fixtures/*.json            # Synthetic healthy/suspicious evidence
scripts/prod-watch/schemas/*.schema.json      # Snapshot/provider/Codex contracts
scripts/prod-watch/com.murph.prod-watch.plist.template
scripts/prod-watch.test.ts
scripts/prod-watch.database.integration.test.ts       # Explicit opt-in live read-only boundary proof
.agents/skills/production-watch/SKILL.md
agent-docs/operations/prod-watch.md
```

No application runtime code is involved.
