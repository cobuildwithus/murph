# Compact automation reviews and bounded connected-app reads

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Outcome and invariants

Reduce repeated automation-review context and tool discovery without changing
model eligibility, managed pins, complete ordinary instructions, version checks,
account authority, routes, or delivery. Implementation and local proof are complete;
close this plan with the scoped implementation commit.

## Ownership and reuse

Base: 1ed81127cc (origin/main); branch: perf/compact-automation-inspection.
Work uses an isolated checkout; unrelated primary-checkout edits are excluded.
The runtime automation port owns canonical readback and managed identity. Reuse
its response builder, execution-context contract, dynamic-tool serializer,
managed-identity resolver, and optimistic patch behavior. The connected-app skill
owns discovery and bounded-read guidance; execution retains live authority checks.
No new persistence, service, dependency, or cross-turn schema cache is introduced.

Existing owners already provide fresh optimizer continuity, fixed attribution for
future usage rows, 48 KiB automation instruction pages, connected-app HTML
compaction and a 120 KB response cap, and native bounded delegation. Preserve these
rather than duplicate them. Global context removal and blanket model downgrades
lack evidence that they would preserve task quality.

## Changes

- Optional model_review inspection bypasses scheduler timing and execution-history
  reads. Ordinary records retain complete instructions, references, ownership,
  override, and version. Host-managed records explicitly omit instructions because
  their model must be preserved. Default and explicit full inspection stay equal.
- Engine-only inspect_models batches up to ten exact ids through the existing host
  port. It deduplicates ids and caps output at 24 KB, reserving escaped UTF-8 space
  for missing/omitted metadata. Only whole records are returned; oversized records
  require an individual read. Unexpected failures use existing diagnostics and
  never become missing-record claims.
- The optimizer consumes bounded batches separately, reads only explicit omissions
  individually, reuses schemas within the run, and preserves incomplete candidates.
  Conflict recovery retains a fresh versioned inspection and the existing retry cap.
- Connected-app guidance reuses complete schemas for the same turn/toolkit/scope
  and applies available window/page/field controls. Pagination, truncation, errors,
  source attribution, current account access, and approval remain explicit.

## Validation

- Engine domain tools, optimizer, cron inspection: 44 tests passed.
- Expanded engine domain tools, optimizer, connected-app prompt and execution:
  63 tests passed. Final connected-app wording check: 11 passed.
- Runtime managed-automation suite: 43 passed; new production-port projection
  test: 1 passed. It verifies host identity rather than mutable tags, complete
  ordinary instructions, no canonical writes, and no compact timing reads.
- Engine and runtime package typechecks passed.
- Focused live optimizer journey passed on GPT-6.1 Sol with local subscription
  authentication and synthetic ports. Five candidates were inspected once in one
  batch; two suitable ordinary model-only patches were verified. Managed, explicit
  preference, and research records were preserved. Exactly three automation calls,
  one synthetic private feedback submission, and a quiet final result.
- Focused live connected-app journey passed: two weather reads used exactly one
  discovery and two executions, accurate comparison, and no member connection
  request. Both tested product paths are Ready within these fixture boundaries.
- Complete first-provider-request measurements passed for direct and group fixtures
  against the base above: 177,931 and 153,868 bytes respectively, unchanged.
  Deferred registered definitions grew by 1,549 bytes but were not in the initial
  request. No unavailable token estimate was substituted.
- Synthetic-vault payload measurement with current managed digest instructions:
  full 13,650 bytes versus compact 556 bytes (95.9% smaller). Long ordinary
  instructions remain intact: 37,072 versus 35,727 bytes. These are context-size
  measurements, not guaranteed allowance savings.
- Complexity diff passed without increased debt. Documentation drift, whitespace,
  privacy, and final diff review passed. Existing runtime hotspots
  remain unchanged; the projection adds no lifecycle machinery.

## Completion and limits

Read-only response changes affect co-deployed engine/runtime packages; persisted
schemas are unchanged. Rollback restores the previous bundled tool and seed.
Internal efficiency work requires no member-facing changelog entry.

No production data, push, deployment, or external review upload is authorized.
Hosted CI, production allowance savings, and the conditional final ReviewGPT
publication gate remain unverified; local tests are not represented as that proof.
Completed: 2026-10-05
