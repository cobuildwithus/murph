# Background startup admission

Status: completed
Created: 2026-09-30
Updated: 2026-09-30

## Goal

Keep slow background container preparation outside member execution ownership,
protect foreground standby availability, and preserve one canonical workspace
writer. Open a separate PR; no production deployment is part of this task.

## Evidence and decisions

Current background admission claims the Postgres owner before cold startup.
A concurrent foreground wake preserves that starting fence and can defer until
the thirty-second retirement deadline. Existing active mailbox invocations can
promote in place. Standby already owns pristine preparation, bounded refill,
and exact orphan retirement. Reuse those owners rather than add a scheduler.

Claude Opus 5.5 is reviewing supplied source for startup races, capacity,
rolling compatibility, simplification, and deterministic stress cases. The chosen implementation keeps claim-first allocation identity and one global
coordinator with an atomic foreground reserve. Cold preparation stays outside
member ownership. A pool miss releases the brief admission immediately. Opus's
cold fallback and durable deferral timestamp were rejected because they retain
the reproduced startup collision. Separate pools and new Postgres phases were
unnecessary. Dedicated additive RPCs protect rolling-version behavior.

## Invariants and scope

- Postgres remains the sole execution owner; no concurrent workspace writers.
- Preparation owns no member workspace or provider authority.
- Unknown RPC outcomes never prove stoppedness or permit a second launch.
- Foreground inventory is protected; unavailable background capacity defers.
- Retained warm targets and active background promotion remain supported.
- Do not change private Temporal implementation or deploy production.

## Product UX

Replay foreground arriving before, during, and after background admission;
background bursts with empty capacity; retained stopped targets; timeouts and
late responses; and active background promotion. Expected result: foreground
can start while empty containers prepare, and deferred mailbox work remains
durable. No absolute latency guarantee is claimed for infrastructure outages,
workspace restoration, or provider delays. Status: Ready for candidate review; deterministic journeys passed.

## Verification

Baseline runtime-processing and standby suites: 136 tests passed.
Focused runtime, real SQLite coordinator, container, deployment, and rollout
configuration suites: 495 tests passed. Changelog archive: 10 tests passed.
Cloudflare typecheck passed. Complexity diff passed: runner debt 67 to 65;
remaining hotspots are existing wake, readiness, and error classification logic.
Parent review preserved exact ownership, late-response cleanup, active-runtime
promotion, and unchanged foreground preparation parallelism.

Opus stress review led to direct RPC calls, jittered background retries,
sequential bounded warm proof before workspace reads, prelaunch error retirement,
and deployment validation requiring ready capacity. Inspection confirmed the SDK
fetch helper auto-started stopped containers; background health and dispatch now
use native port I/O, with explicit regression proof. Provider/global execution
concurrency is not capped by this change. No production data or incident row is
part of the patch. No production deployment was performed.

Final external review and exact-head CI are PR delivery gates; record their
results in the PR evidence rather than claiming them as local runtime proof.
Completed: 2026-09-30
