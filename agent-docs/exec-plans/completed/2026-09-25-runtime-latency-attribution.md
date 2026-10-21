# Attribute Worker and Web runtime latency

Status: completed
Created: 2026-09-25
Updated: 2026-09-25

## Outcome and evidence

Correlate bounded production metadata for warm typing alerts across ingress,
Cloudflare traces, Web callbacks and runtime milestones. Existing traces isolate
separate pre-handler Worker delays, Web checkpoint waits and Web provider-owner
authorization waits. Provider upstream duration is already available. Do not
interpret merged Temporal and direct wake timestamps as one request.

## Scope and decisions

Add request-local fetch entry and auth timestamps to the existing correlated
Worker completion log. Add content-free callback timing for the owner and
checkpoint routes, including authenticated signed-request age and local auth/work
durations. Collect database and pool timing for owner authorization; preserve the
checkpoint's existing database collector. No additional network calls, authority
cache, skipped checkpoint, placement change or deployment.

These additions identify missing attribution; they are not themselves a latency
optimization. Earlier scoped commits separately overlap independent local reads
and remove duplicate snapshot database operations. Production savings remain
unmeasured. No further optimization is justified by an unproven cold-start claim.

## Tasks and verification

1. Implement narrow diagnostics on existing request paths.
2. Prove request correlation, failure isolation, bounded safe logging, and
   unchanged authorization/response behavior with focused tests.
3. Run Web and Worker typechecks, complexity and privacy/docs checks; review
   the diff and make a scoped commit.

Product UX: internal diagnostics only; no prompt, reply, routing or timing policy
changes. No changelog item for the diagnostic-only follow-up.

## Verification and review

The focused Web suites pass 143 tests covering callback timing, owner commands,
checkpoint routes and snapshot publication. Synthetic clocks prove auth/work
splitting, signed-age logging on a fast warm handler, bounded operation/pool
samples, quiet normal calls, and unchanged errors if logging fails. Checkpoint
coverage includes pool timing and the lower slow-call threshold. Existing owner
and checkpoint tests preserve authority checks, stale rejection and durable
publication ordering. All 164 Worker route tests pass and prove fetch-entry capture, first-call
semantics and exact request-local auth/log correlation.

Web and Worker typechecks pass. Log privacy and docs drift guards pass. Complexity
guard passes: no added complexity debt; modified diagnostic functions are below
the hotspot threshold. Earlier runtime orchestration hotspots are unchanged.

The additions reuse existing log records and Prisma collectors. No external or
database operation is added; no persisted schema, response body or auth lifetime
changes. Checkpoint metrics remain in its existing collector rather than nesting
collectors and silently losing samples. Parent review confirmed no production
row contents or direct identifiers in the patch. Deployment and production gain
measurement remain outstanding; this local task does not claim to remove the
historical platform wait.
Completed: 2026-09-25
