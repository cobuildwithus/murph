# Reduce actual message processing latency

Status: completed
Created: 2026-09-25
Updated: 2026-09-25

## Outcome

Reduce work on the path to model execution and reply delivery. Moving a typing
indicator earlier is not evidence of faster processing. Preserve authority,
canonical receipt checkpoints, wake selection, cleanup retention and replay.

## Evidence and approach

Bounded production metadata shows a slow ingress transaction, an intermittent
pre-handler Worker delay, and awaited runtime status publication. Nearby ingress
requests do not consistently exhibit the pre-handler delay; do not claim its
cause or change placement speculatively.

The status checkpoint serially reads independent pending-input, outbox,
provider-cleanup, system-mailbox and cron state. Overlap these existing local
reads with bounded concurrency, retaining the same selection rules and joining
all reads before returning on failure. The Web checkpoint also records the same
unchanged snapshot twice as both current and replaced. Eliminate exact duplicate
cleanup candidates without weakening retirement validation or retention updates.

## Product UX and verification

Reply content, eligibility and delivery order remain unchanged. Verify actual
checkpoint dependency overlap through the runtime entrypoint, original scheduling
outcomes, receipt persistence, failure settlement and exact cleanup query counts.
Run relevant package and Web typechecks, focused suites, complexity and privacy
checks. Record synthetic measurements separately from unmeasured production gain.
No deployment or production mutation is authorized.

## Tasks

1. Add failing regressions for the unnecessary waits and duplicate queries.
2. Apply the smallest changes to existing owners.
3. Verify, update durable contract and changelog, and make a scoped commit.

## Verification and outcome

The composed runtime regression failed on the serial implementation: cron
inspection could not begin while the independent outbox read was blocked.
It passes after overlapping the reads. Its failure variant proves that an
outstanding read is joined before propagating another read's failure. The
checkpoint still waits for all required state and publishes the canonical
receipt fingerprint. Runtime overlap, scheduling and receipt suites passed
76 tests. Runtime typecheck passed.

The Web regression reproduced two reads and two upserts for one unchanged
snapshot. Exact candidate deduplication reduces that to one read and one upsert;
retirement validation still runs. Changed archives and changed metadata remain
distinct. The v2 recovery-deadline case preserves the original deadline and full
wrapped archive reference. Publication and workspace-store tests passed; Web
typecheck passed. Changelog rendering, log privacy and docs drift checks passed.

Complexity guard passed with unchanged complexity debt and maximum. The two
changed functions remain below the hotspot threshold; the runtime entrypoint's
existing larger orchestration hotspots are unchanged. Parent review confirmed
bounded local concurrency (five reads, four when the system result is supplied),
no new DB connection or provider/network operation, and two fewer serial DB
operations per identical current/replaced snapshot resource. Candidate comparison
is bounded by the existing maximum three legacy snapshot components.

Product UX: Ready for the tested deterministic processing boundaries. Prompt,
model input, reply policy and prose are unchanged, so no stochastic model run is
needed to establish read overlap or database operation elimination. The earlier
independent baseline foreground-suite failures remain recorded in the preceding
task's Frog entry; these focused suites do not claim to resolve them.

Production milliseconds saved remain unmeasured. The intermittent pre-handler
Worker delay is still unresolved; Worker CPU and handler wall time do not account
for the full observed request duration. No placement change is justified by the
available evidence. No deployment, PR, external review or CI run was performed.
Completed: 2026-09-25
